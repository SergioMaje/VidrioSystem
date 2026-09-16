-- Ventas a crédito de financiera (Addi, Sistecrédito).
--
-- El cliente no le paga a la vidriería: saca un crédito con la financiera, y ella
-- cobra las cuotas y le desembolsa la venta al negocio a los 7, 30 o 60 días
-- según el convenio, con su comisión ya descontada. Del lado del cliente la venta
-- queda pagada (saldo 0, la orden puede producirse), pero el dinero todavía no
-- llegó: es una cuenta por cobrar a la financiera, no al cliente.
--
-- Hasta ahora eso solo se podía anotar como 'transferencia' el día de la venta,
-- y los reportes daban por recibido un dinero que llegaba semanas después y
-- incompleto. Aquí se separan las tres cifras: lo vendido (ventas.monto), lo
-- pendiente (ventas sin desembolso) y lo recibido (financiera_desembolsos).
--
-- Reglas acordadas:
--   * El crédito cubre el total de la venta; no se combina con otros medios.
--   * La comisión se estima con el % de la financiera al vender, y la real sale
--     de lo que llegó al banco.
--   * Un desembolso puede cubrir varias ventas: no se sabe aún si las
--     financieras pagan venta por venta o en lote, y el lote cubre ambos casos.

-- ── Catálogo de financieras ─────────────────────────────────────────────────
create table if not exists public.financieras (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  -- Estimado: el real depende de la campaña y se conoce al desembolsar.
  comision_pct numeric(5,2) not null default 0
    check (comision_pct >= 0 and comision_pct < 100),
  -- Plazo pactado; pasado este tiempo la venta pendiente se marca vencida.
  dias_desembolso integer not null default 30 check (dias_desembolso >= 0),
  -- Retirar sin borrar: las ventas viejas siguen apuntando a ella.
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financieras_nombre_no_vacio check (length(trim(nombre)) > 0)
);

drop trigger if exists trg_financieras_updated_at on public.financieras;
create trigger trg_financieras_updated_at before update on public.financieras
  for each row execute function public.set_updated_at();

-- Comisión en 0 a propósito: el % real lo pone el admin en Configuración con el
-- dato de su convenio, no un número inventado aquí.
insert into public.financieras (nombre, comision_pct, dias_desembolso)
values ('Addi', 0, 7), ('Sistecrédito', 0, 30)
on conflict (nombre) do nothing;

alter table public.financieras enable row level security;

-- Todos la leen para vender con ella; solo el admin cambia el % y el plazo,
-- igual que cuentas_pago_empresa. Sin DELETE: se desactiva.
drop policy if exists "autenticados_select_financieras" on public.financieras;
create policy "autenticados_select_financieras" on public.financieras
  for select using (auth.uid() is not null);

drop policy if exists "admin_insert_financieras" on public.financieras;
create policy "admin_insert_financieras" on public.financieras
  for insert with check (public.get_user_rol() = 'admin'::public.rol_usuario);

drop policy if exists "admin_update_financieras" on public.financieras;
create policy "admin_update_financieras" on public.financieras
  for update using (public.get_user_rol() = 'admin'::public.rol_usuario);

grant select, insert, update on public.financieras to authenticated;

-- ── Desembolsos ─────────────────────────────────────────────────────────────
-- Las cifras de las ventas cubiertas se congelan al registrar: si después se
-- anula el desembolso y las ventas vuelven a pendientes, el registro anulado
-- sigue diciendo qué cubría y cuánto llegó.
create table if not exists public.financiera_desembolsos (
  id uuid primary key default gen_random_uuid(),
  financiera_id uuid not null references public.financieras(id),
  fecha date not null,
  monto_recibido numeric(12,2) not null check (monto_recibido > 0),
  total_ventas numeric(12,2) not null check (total_ventas > 0),
  comision_estimada numeric(12,2) not null default 0,
  comision_real numeric(12,2) generated always as (total_ventas - monto_recibido) stored,
  num_ventas integer not null check (num_ventas > 0),
  cuenta_pago_empresa_id uuid references public.cuentas_pago_empresa(id),
  referencia text,
  notas text,
  usuario_id uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  anulado_at timestamptz,
  anulado_por uuid references public.usuarios(id),
  motivo_anulacion text,
  constraint financiera_desembolsos_no_excede check (monto_recibido <= total_ventas)
);

create index if not exists idx_financiera_desembolsos_fecha on public.financiera_desembolsos(fecha);
create index if not exists idx_financiera_desembolsos_financiera on public.financiera_desembolsos(financiera_id);

alter table public.financiera_desembolsos enable row level security;

-- Sin políticas de escritura: solo los RPC de abajo, que validan que las ventas
-- sean de esa financiera y no estén ya cubiertas.
drop policy if exists "autenticados_select_financiera_desembolsos" on public.financiera_desembolsos;
create policy "autenticados_select_financiera_desembolsos" on public.financiera_desembolsos
  for select using (auth.uid() is not null);

grant select on public.financiera_desembolsos to authenticated;

-- ── Los pagos saben de la financiera ────────────────────────────────────────
alter table public.ventas
  add column if not exists financiera_id uuid references public.financieras(id),
  add column if not exists referencia_financiera text,
  -- Congelada al vender: cambiar el % después no reescribe lo ya vendido.
  add column if not exists comision_estimada numeric(12,2),
  add column if not exists desembolso_id uuid references public.financiera_desembolsos(id);

alter table public.ventas drop constraint if exists ventas_financiera_coherente;
alter table public.ventas add constraint ventas_financiera_coherente
  check ((metodo_pago = 'financiera') = (financiera_id is not null));

create index if not exists idx_ventas_financiera_pendiente
  on public.ventas(financiera_id) where metodo_pago = 'financiera' and desembolso_id is null;
create index if not exists idx_ventas_desembolso on public.ventas(desembolso_id);

-- Un gasto no se paga con el crédito de un cliente.
alter table public.caja_movimientos drop constraint if exists caja_movimientos_sin_financiera;
alter table public.caja_movimientos add constraint caja_movimientos_sin_financiera
  check (metodo_pago <> 'financiera');

-- ── El trigger de pagos conoce el crédito de financiera ─────────────────────
-- Parte de la versión de 20260823120100_venta_mostrador.sql. Lo nuevo:
--   * La financiera se valida y la comisión se calcula aquí, para los dos
--     orígenes (cotización y mostrador) y también para el insert directo de
--     useRegistrarAbono: ninguna vía queda sin la regla.
--   * desembolso_id nunca llega desde el insert: solo lo pone el RPC de
--     desembolso, y así no se puede marcar como cobrado lo que no llegó.
--   * En cotizaciones, el crédito es el primer y único pago, por el total.
create or replace function public.validar_pago_cotizacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_abonado numeric;
  v_financiera public.financieras;
begin
  if (select status from public.cash_register_sessions where id = new.session_id) <> 'open' then
    raise exception 'La sesión de caja está cerrada';
  end if;

  new.desembolso_id := null;

  if new.metodo_pago = 'financiera' then
    select * into v_financiera from public.financieras where id = new.financiera_id;
    if not found then
      raise exception 'Selecciona la financiera que otorgó el crédito';
    end if;
    if not v_financiera.activa then
      raise exception 'La financiera % está desactivada', v_financiera.nombre;
    end if;
    new.referencia_financiera := nullif(btrim(coalesce(new.referencia_financiera, '')), '');
    -- Pesos enteros, igual que comisionEstimada() en src/lib/pagos.ts.
    new.comision_estimada := round(new.monto * v_financiera.comision_pct / 100);
  else
    new.financiera_id := null;
    new.referencia_financiera := null;
    new.comision_estimada := null;
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

  if new.metodo_pago = 'financiera' then
    if v_abonado > 0 then
      raise exception 'El crédito con financiera cubre el total de la venta: esta cotización ya tiene pagos registrados';
    end if;
    if new.monto < v_total - 1 then
      raise exception 'El crédito con financiera debe cubrir el total de la cotización (%)', v_total;
    end if;
  end if;

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

-- ── Anticipo: admite la financiera ──────────────────────────────────────────
-- Se borra la firma vieja en vez de sobrecargar: con parámetros opcionales,
-- PostgREST no sabría a cuál de las dos llamar.
drop function if exists public.registrar_anticipo_cotizacion(
  uuid, public.metodo_pago_venta, numeric, date, uuid, text
);

create or replace function public.registrar_anticipo_cotizacion(
  p_cotizacion_id         uuid,
  p_metodo_pago           public.metodo_pago_venta,
  p_monto                 numeric,
  p_fecha_entrega         date default null,
  p_autorizado_por        uuid default null,
  p_motivo_autorizacion   text default null,
  p_financiera_id         uuid default null,
  p_referencia_financiera text default null
) returns public.ordenes_trabajo
language plpgsql security definer set search_path = public as $$
declare
  v_usuario uuid := auth.uid();
  v_session uuid;
  v_cot     public.cotizaciones;
  v_abonado numeric;
  v_orden   public.ordenes_trabajo;
  v_tipo    public.tipo_pago;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar un anticipo';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El anticipo debe ser mayor a cero';
  end if;

  select id into v_session from public.cash_register_sessions where status = 'open';
  if v_session is null then
    raise exception 'Debes abrir caja antes de registrar el anticipo';
  end if;

  -- El `for update` serializa contra otro cobro simultaneo sobre la misma
  -- cotizacion: sin el, dos anticipos concurrentes leerian el mismo abonado.
  select * into v_cot from public.cotizaciones where id = p_cotizacion_id for update;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;

  select coalesce(sum(monto), 0) into v_abonado
    from public.ventas where cotizacion_id = p_cotizacion_id;

  -- El crédito liquida la venta de una vez: no es un anticipo.
  v_tipo := case
    when p_metodo_pago = 'financiera' then 'contado'::public.tipo_pago
    else public.tipo_de_pago(v_abonado, p_monto, v_cot.total)
  end;

  -- El insert dispara validar_pago_cotizacion, que comprueba saldo, caja
  -- abierta, anticipo minimo y las reglas de financiera. Aqui no se replica.
  insert into public.ventas
    (cotizacion_id, session_id, metodo_pago, monto, tipo, autorizado_por,
     motivo_autorizacion, usuario_id, financiera_id, referencia_financiera)
  values
    (p_cotizacion_id, v_session, p_metodo_pago, p_monto, v_tipo,
     p_autorizado_por,
     nullif(btrim(coalesce(p_motivo_autorizacion, '')), ''),
     v_usuario, p_financiera_id, p_referencia_financiera);

  update public.cotizaciones
     set estado = 'vendida',
         fecha_aprobacion = coalesce(fecha_aprobacion, now())
   where id = p_cotizacion_id;

  select * into v_orden from public.ordenes_trabajo
   where cotizacion_id = p_cotizacion_id
   limit 1;

  if found then
    if p_fecha_entrega is not null then
      update public.ordenes_trabajo
         set fecha_entrega_estimada = p_fecha_entrega
       where id = v_orden.id
      returning * into v_orden;
    end if;
    return v_orden;
  end if;

  insert into public.ordenes_trabajo
    (numero, cotizacion_id, cliente_id, estado, fecha_entrega_estimada, notas)
  values
    ('OT-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text,
     p_cotizacion_id, v_cot.cliente_id, 'pendiente', p_fecha_entrega, v_cot.notas)
  returning * into v_orden;

  return v_orden;
end;
$$;

grant execute on function public.registrar_anticipo_cotizacion(
  uuid, public.metodo_pago_venta, numeric, date, uuid, text, uuid, text
) to authenticated;

-- ── Venta de mostrador: admite la financiera ────────────────────────────────
drop function if exists public.registrar_venta_mostrador(uuid, public.metodo_pago_venta, jsonb);

create or replace function public.registrar_venta_mostrador(
  p_cliente_id            uuid,
  p_metodo_pago           public.metodo_pago_venta,
  p_items                 jsonb,
  p_financiera_id         uuid default null,
  p_referencia_financiera text default null
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

    insert into public.movimientos_inventario
      (item_id, tipo, cantidad, cantidad_anterior, cantidad_posterior, motivo, referencia, usuario_id)
    values
      (v_item.id, 'salida', v_cantidad, v_item.stock_actual, v_item.stock_actual - v_cantidad,
       'Venta ' || v_venta.numero, v_venta.id::text, v_usuario);

    v_total := v_total + round(v_cantidad * v_precio, 2);
  end loop;

  update public.ventas_mostrador set total = v_total where id = v_venta.id
  returning * into v_venta;

  -- La financiera y la comisión las valida y calcula validar_pago_cotizacion.
  insert into public.ventas
    (venta_mostrador_id, session_id, metodo_pago, monto, tipo, usuario_id,
     financiera_id, referencia_financiera)
  values
    (v_venta.id, v_session, p_metodo_pago, v_total, 'contado', v_usuario,
     p_financiera_id, p_referencia_financiera);

  return v_venta;
end;
$$;

grant execute on function public.registrar_venta_mostrador(
  uuid, public.metodo_pago_venta, jsonb, uuid, text
) to authenticated;

-- ── Lo que las financieras deben ────────────────────────────────────────────
-- Una fila por venta a crédito sin desembolso, con el documento y el cliente ya
-- resueltos para listar y conciliar sin armar joins en el navegador. Los días se
-- cuentan en hora de Colombia: en UTC una venta de la noche ya sería "de mañana".
create or replace view public.financieras_por_cobrar
with (security_invoker = on) as
  select
    v.id as venta_id,
    v.financiera_id,
    f.nombre as financiera,
    v.monto,
    coalesce(v.comision_estimada, 0) as comision_estimada,
    v.referencia_financiera,
    v.created_at,
    v.cotizacion_id,
    v.venta_mostrador_id,
    coalesce(c.numero, vm.numero) as documento,
    nullif(trim(coalesce(cc.nombre || ' ' || cc.apellido, mc.nombre || ' ' || mc.apellido, '')), '') as cliente,
    f.dias_desembolso,
    ((now() at time zone 'America/Bogota')::date
      - (v.created_at at time zone 'America/Bogota')::date) as dias,
    ((now() at time zone 'America/Bogota')::date
      - (v.created_at at time zone 'America/Bogota')::date) > f.dias_desembolso as vencida
  from public.ventas v
  join public.financieras f on f.id = v.financiera_id
  left join public.cotizaciones c on c.id = v.cotizacion_id
  left join public.clientes cc on cc.id = c.cliente_id
  left join public.ventas_mostrador vm on vm.id = v.venta_mostrador_id
  left join public.clientes mc on mc.id = vm.cliente_id
  where v.metodo_pago = 'financiera'
    and v.desembolso_id is null;

grant select on public.financieras_por_cobrar to authenticated;

-- ── Registrar un desembolso ─────────────────────────────────────────────────
-- Cualquier usuario puede conciliar (es anotar lo que llegó al banco); anular
-- sí queda en admin. Todo o nada: si una sola venta no cuadra, no se enlaza
-- ninguna.
create or replace function public.registrar_desembolso_financiera(
  p_financiera_id  uuid,
  p_fecha          date,
  p_monto_recibido numeric,
  p_venta_ids      uuid[],
  p_cuenta_id      uuid default null,
  p_referencia     text default null,
  p_notas          text default null
) returns public.financiera_desembolsos
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_usuario uuid := auth.uid();
  v_ids uuid[];
  v_encontradas integer;
  v_invalidas integer;
  v_total numeric(12,2);
  v_comision numeric(12,2);
  v_desembolso public.financiera_desembolsos;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar un desembolso';
  end if;

  if not exists (select 1 from public.financieras where id = p_financiera_id) then
    raise exception 'La financiera no existe';
  end if;

  if p_fecha is null then
    raise exception 'Indica la fecha en que llegó el desembolso';
  end if;

  if p_monto_recibido is null or p_monto_recibido <= 0 then
    raise exception 'El monto recibido debe ser mayor a cero';
  end if;

  select array_agg(distinct id) into v_ids from unnest(p_venta_ids) as id where id is not null;
  if v_ids is null then
    raise exception 'Selecciona las ventas que cubre este desembolso';
  end if;

  -- El lock serializa contra otra conciliación simultánea de las mismas ventas:
  -- sin él, dos desembolsos podrían cubrir la misma venta.
  perform 1 from public.ventas where id = any(v_ids) for update;

  select count(*),
         count(*) filter (where metodo_pago <> 'financiera'
                             or financiera_id is distinct from p_financiera_id
                             or desembolso_id is not null),
         coalesce(sum(monto), 0),
         coalesce(sum(comision_estimada), 0)
    into v_encontradas, v_invalidas, v_total, v_comision
    from public.ventas
   where id = any(v_ids);

  if v_encontradas <> cardinality(v_ids) then
    raise exception 'Alguna de las ventas seleccionadas ya no existe';
  end if;

  if v_invalidas > 0 then
    raise exception 'Hay ventas que no son de esta financiera o que ya tienen desembolso';
  end if;

  if p_monto_recibido > v_total then
    raise exception 'El monto recibido (%) supera el total de las ventas seleccionadas (%)',
      p_monto_recibido, v_total;
  end if;

  insert into public.financiera_desembolsos
    (financiera_id, fecha, monto_recibido, total_ventas, comision_estimada, num_ventas,
     cuenta_pago_empresa_id, referencia, notas, usuario_id)
  values
    (p_financiera_id, p_fecha, p_monto_recibido, v_total, v_comision, cardinality(v_ids),
     p_cuenta_id,
     nullif(btrim(coalesce(p_referencia, '')), ''),
     nullif(btrim(coalesce(p_notas, '')), ''),
     v_usuario)
  returning * into v_desembolso;

  update public.ventas set desembolso_id = v_desembolso.id where id = any(v_ids);

  return v_desembolso;
end;
$$;

grant execute on function public.registrar_desembolso_financiera(
  uuid, date, numeric, uuid[], uuid, text, text
) to authenticated;

-- ── Anular un desembolso ────────────────────────────────────────────────────
-- Para deshacer una conciliación equivocada. Soft-delete como caja_movimientos:
-- el registro queda con sus cifras congeladas, y las ventas vuelven a pendientes.
create or replace function public.anular_desembolso_financiera(
  p_desembolso_id uuid,
  p_motivo text
) returns public.financiera_desembolsos
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_usuario uuid := auth.uid();
  v_desembolso public.financiera_desembolsos;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para anular un desembolso';
  end if;

  -- `is distinct from` por el mismo motivo que en anular_movimiento_caja: un
  -- rol null no debe pasar como admin.
  if public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede anular un desembolso';
  end if;

  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Indica el motivo de la anulación';
  end if;

  select * into v_desembolso
    from public.financiera_desembolsos
   where id = p_desembolso_id
   for update;

  if not found then
    raise exception 'El desembolso no existe';
  end if;

  if v_desembolso.anulado_at is not null then
    raise exception 'Este desembolso ya fue anulado';
  end if;

  update public.ventas set desembolso_id = null where desembolso_id = p_desembolso_id;

  update public.financiera_desembolsos
     set anulado_at = now(),
         anulado_por = v_usuario,
         motivo_anulacion = trim(p_motivo)
   where id = p_desembolso_id
  returning * into v_desembolso;

  return v_desembolso;
end;
$$;

grant execute on function public.anular_desembolso_financiera(uuid, text) to authenticated;

-- ── El resumen del turno separa lo vendido a crédito ────────────────────────
-- Parte de 20260901150000_movimientos_caja.sql y solo suma total_financiera.
-- cerrar_caja no cambia: ya cuenta únicamente 'efectivo', así que el crédito
-- nunca entra al esperado del cajón.
drop view if exists public.caja_sesiones_resumen;
create view public.caja_sesiones_resumen
with (security_invoker = on) as
  select
    s.id as session_id,
    coalesce(v.total_efectivo, 0) as total_efectivo,
    coalesce(v.total_transferencia, 0) as total_transferencia,
    coalesce(v.total_tarjeta, 0) as total_tarjeta,
    coalesce(v.total_financiera, 0) as total_financiera,
    coalesce(v.total_cobrado, 0) as total_cobrado,
    coalesce(v.num_pagos, 0) as num_pagos,
    coalesce(g.total_gastos_efectivo, 0) as total_gastos_efectivo,
    coalesce(g.total_gastos, 0) as total_gastos,
    coalesce(g.num_gastos, 0) as num_gastos,
    s.opening_amount + coalesce(v.total_efectivo, 0) - coalesce(g.total_gastos_efectivo, 0) as neto_efectivo
  from public.cash_register_sessions s
  left join (
    select
      session_id,
      sum(monto) filter (where metodo_pago = 'efectivo') as total_efectivo,
      sum(monto) filter (where metodo_pago = 'transferencia') as total_transferencia,
      sum(monto) filter (where metodo_pago = 'tarjeta') as total_tarjeta,
      sum(monto) filter (where metodo_pago = 'financiera') as total_financiera,
      sum(monto) as total_cobrado,
      count(*) as num_pagos
    from public.ventas
    group by session_id
  ) v on v.session_id = s.id
  left join (
    select
      session_id,
      sum(monto) filter (where metodo_pago = 'efectivo') as total_gastos_efectivo,
      sum(monto) as total_gastos,
      count(*) as num_gastos
    from public.caja_movimientos
    where anulado_at is null
    group by session_id
  ) g on g.session_id = s.id;

grant select on public.caja_sesiones_resumen to authenticated;
