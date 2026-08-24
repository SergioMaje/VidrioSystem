-- Venta directa de mostrador: productos que salen del inventario tal cual, sin
-- pasar por cotización ni orden de trabajo.
--
-- `ventas` es un libro de pagos (N filas por cotización, sin líneas ni cliente),
-- así que la venta necesita documento propio. El cobro sigue entrando como una
-- fila de `ventas`, y con eso caja y reportes la recogen sin cambios.

-- ── Cabecera ────────────────────────────────────────────────────────────────
create sequence if not exists public.ventas_mostrador_numero_seq;

create table if not exists public.ventas_mostrador (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique
    default 'VD-' || lpad(nextval('public.ventas_mostrador_numero_seq')::text, 6, '0'),
  -- Nullable a propósito: una venta de mostrador puede ser a público general.
  cliente_id uuid references public.clientes(id),
  session_id uuid not null references public.cash_register_sessions(id),
  usuario_id uuid not null references public.usuarios(id),
  total numeric(12,2) not null check (total >= 0),
  created_at timestamptz not null default now()
);

-- ── Líneas ──────────────────────────────────────────────────────────────────
create table if not exists public.ventas_mostrador_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas_mostrador(id) on delete cascade,
  item_id uuid not null references public.items_inventario(id),
  -- Snapshot del nombre: renombrar un item no debe reescribir la historia.
  descripcion text not null,
  cantidad numeric(10,3) not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  precio_total numeric(12,2) not null check (precio_total >= 0)
);

create index if not exists idx_ventas_mostrador_session on public.ventas_mostrador(session_id);
create index if not exists idx_ventas_mostrador_items_venta on public.ventas_mostrador_items(venta_id);
create index if not exists idx_ventas_mostrador_items_item on public.ventas_mostrador_items(item_id);

-- ── `ventas` admite los dos orígenes ────────────────────────────────────────
alter table public.ventas alter column cotizacion_id drop not null;

alter table public.ventas
  add column if not exists venta_mostrador_id uuid references public.ventas_mostrador(id);

-- Un pago pertenece a una cotización o a una venta de mostrador, nunca a las dos
-- ni a ninguna.
alter table public.ventas drop constraint if exists ventas_origen_unico;
alter table public.ventas add constraint ventas_origen_unico
  check (num_nonnulls(cotizacion_id, venta_mostrador_id) = 1);

create index if not exists idx_ventas_venta_mostrador on public.ventas(venta_mostrador_id);

-- ── El trigger de pagos ya no asume que hay cotización ──────────────────────
-- La validación de caja abierta es común a los dos orígenes y va primero; el
-- resto (saldo, anticipo mínimo) solo aplica al camino de cotizaciones. Mismo
-- early-return que ya usa validar_avance_orden().
create or replace function public.validar_pago_cotizacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_abonado numeric;
begin
  if (select status from public.cash_register_sessions where id = new.session_id) <> 'open' then
    raise exception 'La sesión de caja está cerrada';
  end if;

  -- Venta de mostrador: se cobra completa en el acto, no hay saldo que validar.
  if new.cotizacion_id is null then
    return new;
  end if;

  select total into v_total from public.cotizaciones where id = new.cotizacion_id for update;
  if v_total is null then
    raise exception 'Cotización no encontrada';
  end if;

  select coalesce(sum(monto), 0) into v_abonado
    from public.ventas where cotizacion_id = new.cotizacion_id;

  -- Tolerancia de $1 por el redondeo del IVA.
  if v_abonado + new.monto > v_total + 1 then
    raise exception 'El pago excede el saldo pendiente (saldo: %)', v_total - v_abonado;
  end if;

  if v_abonado = 0 and not public.cumple_anticipo_minimo(new.monto, v_total) then
    if new.autorizado_por is null then
      raise exception 'El anticipo debe ser al menos el 50%% del total (mínimo: %)',
        public.anticipo_minimo(v_total);
    end if;
    if (select rol from public.usuarios where id = new.autorizado_por) <> 'admin'::rol_usuario then
      raise exception 'Solo un administrador puede autorizar un anticipo menor al 50%%';
    end if;
  end if;

  return new;
end $$;

-- ── Registrar la venta, de forma atómica ────────────────────────────────────
-- Cobro, líneas y descuento de stock en una sola transacción: o entra todo o no
-- entra nada.
create or replace function public.registrar_venta_mostrador(
  p_cliente_id uuid,
  p_metodo_pago public.metodo_pago_venta,
  p_items jsonb
) returns public.ventas_mostrador
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_usuario uuid := auth.uid();
  v_session uuid;
  v_venta public.ventas_mostrador;
  v_total numeric(12,2) := 0;
  v_linea jsonb;
  v_item public.items_inventario;
  v_cantidad numeric(10,3);
  v_precio numeric(12,2);
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar una venta';
  end if;

  select id into v_session from public.cash_register_sessions where status = 'open';
  if v_session is null then
    raise exception 'Debes abrir caja antes de registrar una venta';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;

  insert into public.ventas_mostrador (cliente_id, session_id, usuario_id, total)
  values (p_cliente_id, v_session, v_usuario, 0)
  returning * into v_venta;

  for v_linea in select * from jsonb_array_elements(p_items) loop
    v_cantidad := (v_linea->>'cantidad')::numeric;
    v_precio := (v_linea->>'precio_unitario')::numeric;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad debe ser mayor a cero';
    end if;
    if v_precio is null or v_precio < 0 then
      raise exception 'El precio no puede ser negativo';
    end if;

    -- El lock serializa contra otra venta simultánea del mismo item.
    select * into v_item from public.items_inventario
    where id = (v_linea->>'item_id')::uuid
    for update;

    if not found then
      raise exception 'El producto ya no existe en el inventario';
    end if;

    if v_item.stock_actual < v_cantidad then
      raise exception 'Stock insuficiente de "%": hay % y se piden %',
        v_item.nombre, v_item.stock_actual, v_cantidad;
    end if;

    insert into public.ventas_mostrador_items
      (venta_id, item_id, descripcion, cantidad, precio_unitario, precio_total)
    values
      (v_venta.id, v_item.id, v_item.nombre, v_cantidad, v_precio, round(v_cantidad * v_precio, 2));

    -- El stock lo aplica trg_actualizar_stock a partir de cantidad_posterior.
    -- Sin Math.max(0, ...): la validación de arriba ya garantiza que alcanza, así
    -- que el movimiento registrado coincide con el descuento real.
    insert into public.movimientos_inventario
      (item_id, tipo, cantidad, cantidad_anterior, cantidad_posterior, motivo, referencia, usuario_id)
    values
      (v_item.id, 'salida', v_cantidad, v_item.stock_actual, v_item.stock_actual - v_cantidad,
       'Venta ' || v_venta.numero, v_venta.id::text, v_usuario);

    v_total := v_total + round(v_cantidad * v_precio, 2);
  end loop;

  -- El total sale de las líneas, no de lo que dijo el cliente.
  update public.ventas_mostrador set total = v_total where id = v_venta.id
  returning * into v_venta;

  insert into public.ventas (venta_mostrador_id, session_id, metodo_pago, monto, tipo, usuario_id)
  values (v_venta.id, v_session, p_metodo_pago, v_total, 'contado', v_usuario);

  return v_venta;
end;
$$;

grant execute on function public.registrar_venta_mostrador(uuid, public.metodo_pago_venta, jsonb) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Sin políticas de INSERT/UPDATE: la única vía de escritura es el RPC, para que
-- las validaciones de stock y de caja no se puedan esquivar desde el navegador.
alter table public.ventas_mostrador enable row level security;
alter table public.ventas_mostrador_items enable row level security;

drop policy if exists "autenticados_select_ventas_mostrador" on public.ventas_mostrador;
create policy "autenticados_select_ventas_mostrador" on public.ventas_mostrador
  for select using (auth.uid() is not null);

drop policy if exists "admin_delete_ventas_mostrador" on public.ventas_mostrador;
create policy "admin_delete_ventas_mostrador" on public.ventas_mostrador
  for delete using (public.get_user_rol() = 'admin'::public.rol_usuario);

drop policy if exists "autenticados_select_ventas_mostrador_items" on public.ventas_mostrador_items;
create policy "autenticados_select_ventas_mostrador_items" on public.ventas_mostrador_items
  for select using (auth.uid() is not null);

drop policy if exists "admin_delete_ventas_mostrador_items" on public.ventas_mostrador_items;
create policy "admin_delete_ventas_mostrador_items" on public.ventas_mostrador_items
  for delete using (public.get_user_rol() = 'admin'::public.rol_usuario);

grant select on public.ventas_mostrador to authenticated;
grant select on public.ventas_mostrador_items to authenticated;
