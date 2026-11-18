-- Crédito a clientes y cuenta de cobro.
--
-- Algunas empresas no dan anticipo: reciben el trabajo y pagan después, a 30
-- o 60 días, contra un documento de cobro. Hasta ahora Glazz no podía
-- registrarlo, porque tres reglas lo impedían:
--   * la cotización solo pasa a 'vendida' y crea su OT al cobrar el anticipo
--     (registrar_anticipo_cotizacion);
--   * la producción no arranca sin el 50% (validar_avance_orden);
--   * la orden no se entrega con saldo (validar_avance_orden).
--
-- Con esta migración:
--   1. El admin habilita el crédito en el cliente, con su plazo en días y un
--      cupo opcional.
--   2. El admin aprueba la cotización a crédito (aprobar_cotizacion_credito):
--      queda 'vendida' y con su OT, sin cobro y sin caja.
--   3. La OT a crédito produce sin anticipo. Para entregarla con saldo hace
--      falta una cuenta de cobro vigente (CC-0001), que emite
--      entregar_orden_credito en la misma transacción.
--   4. Los pagos entran como abonos normales, con caja abierta y su recibo
--      RC. El estado de la cuenta (pendiente, parcial, vencida o pagada) se
--      deriva del saldo, igual que en cotizaciones_saldo; no se guarda.
--
-- La cuenta de cobro no es una factura electrónica. Si la vidriería está
-- obligada a facturar, la DIAN queda como fase 2 sobre este mismo modelo.

-- ── 1. Crédito en el cliente ────────────────────────────────────────────────

alter table public.clientes
  add column if not exists credito_habilitado boolean not null default false,
  add column if not exists dias_credito       integer not null default 30,
  add column if not exists cupo_credito       numeric(14,2);

comment on column public.clientes.credito_habilitado is
  'El cliente puede llevarse trabajos sin anticipo y pagar contra cuenta de cobro. Solo lo cambia un admin.';
comment on column public.clientes.dias_credito is
  'Plazo de pago de sus cuentas de cobro, contado desde la emisión.';
comment on column public.clientes.cupo_credito is
  'Tope de lo que puede deber a crédito al mismo tiempo. Null = sin tope.';

alter table public.clientes drop constraint if exists clientes_dias_credito_check;
alter table public.clientes add constraint clientes_dias_credito_check
  check (dias_credito between 0 and 365);
alter table public.clientes drop constraint if exists clientes_cupo_credito_check;
alter table public.clientes add constraint clientes_cupo_credito_check
  check (cupo_credito is null or cupo_credito > 0);

-- La política de UPDATE de clientes deja editar a cualquier usuario. El crédito
-- es una decisión del admin, así que se protege aquí, columna por columna.
create or replace function public.clientes_proteger_credito()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Sin usuario en sesión (migraciones, service_role) no se restringe.
  if auth.uid() is null
     or public.get_user_rol() is not distinct from 'admin'::public.rol_usuario then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.credito_habilitado or new.cupo_credito is not null or new.dias_credito <> 30 then
      raise exception 'Solo un administrador puede dar crédito a un cliente';
    end if;
    return new;
  end if;

  if (new.credito_habilitado, new.dias_credito, new.cupo_credito)
     is distinct from (old.credito_habilitado, old.dias_credito, old.cupo_credito) then
    raise exception 'Solo un administrador puede cambiar el crédito de un cliente';
  end if;
  return new;
end;
$$;

revoke execute on function public.clientes_proteger_credito() from public, anon, authenticated;

drop trigger if exists clientes_proteger_credito on public.clientes;
create trigger clientes_proteger_credito
  before insert or update on public.clientes
  for each row execute function public.clientes_proteger_credito();

-- ── 2. Condición de pago de la cotización ───────────────────────────────────

alter table public.cotizaciones
  add column if not exists condicion_pago         text not null default 'anticipo',
  add column if not exists orden_compra           text,
  add column if not exists credito_autorizado_por uuid,
  add column if not exists credito_autorizado_at  timestamptz;

comment on column public.cotizaciones.condicion_pago is
  '''anticipo'' (lo normal: se cobra para producir y se liquida para entregar) o ''credito'' (aprobada por un admin, se paga contra cuenta de cobro).';
comment on column public.cotizaciones.orden_compra is
  'Número de orden de compra del cliente (empresas). Se imprime en la cuenta de cobro.';

alter table public.cotizaciones drop constraint if exists cotizaciones_condicion_pago_check;
alter table public.cotizaciones add constraint cotizaciones_condicion_pago_check
  check (condicion_pago in ('anticipo', 'credito'));

alter table public.cotizaciones drop constraint if exists cotizaciones_credito_autorizado;
alter table public.cotizaciones add constraint cotizaciones_credito_autorizado
  check (condicion_pago = 'anticipo'
         or (credito_autorizado_por is not null and credito_autorizado_at is not null));

alter table public.cotizaciones drop constraint if exists cotizaciones_orden_compra_check;
alter table public.cotizaciones add constraint cotizaciones_orden_compra_check
  check (orden_compra is null or char_length(orden_compra) between 1 and 60);

alter table public.cotizaciones drop constraint if exists cotizaciones_credito_autorizado_por_fkey;
alter table public.cotizaciones add constraint cotizaciones_credito_autorizado_por_fkey
  foreign key (empresa_id, credito_autorizado_por) references public.usuarios (empresa_id, id);

-- Estas columnas solo las escribe aprobar_cotizacion_credito, que enciende la
-- bandera de la transacción (el mismo patrón que glazz.anulando_cotizacion).
-- En un INSERT se limpian sin error, para no romper los flujos que copian una
-- cotización (opciones, pedidos).
create or replace function public.cotizaciones_proteger_credito()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null
     or current_setting('glazz.aprobando_credito', true) is not distinct from 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.condicion_pago := 'anticipo';
    new.credito_autorizado_por := null;
    new.credito_autorizado_at := null;
    return new;
  end if;

  if (new.condicion_pago, new.orden_compra, new.credito_autorizado_por, new.credito_autorizado_at)
     is distinct from
     (old.condicion_pago, old.orden_compra, old.credito_autorizado_por, old.credito_autorizado_at) then
    raise exception 'La venta a crédito solo se registra con "Aprobar a crédito"';
  end if;
  return new;
end;
$$;

revoke execute on function public.cotizaciones_proteger_credito() from public, anon, authenticated;

drop trigger if exists cotizaciones_proteger_credito on public.cotizaciones;
create trigger cotizaciones_proteger_credito
  before insert or update on public.cotizaciones
  for each row execute function public.cotizaciones_proteger_credito();

-- ── 3. Cuentas de cobro ─────────────────────────────────────────────────────

-- Contador por vidriería, como recibos_consecutivo: una tabla y no una
-- sequence, para que una emisión fallida no deje huecos.
create table if not exists public.cuentas_cobro_consecutivo (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ultimo     integer not null default 0 check (ultimo >= 0)
);

comment on table public.cuentas_cobro_consecutivo is
  'Último número de cuenta de cobro emitido por vidriería. Solo lo escribe el trigger cuentas_cobro_zz_asignar_numero.';

alter table public.cuentas_cobro_consecutivo enable row level security;
revoke all on public.cuentas_cobro_consecutivo from public, anon, authenticated;

create table if not exists public.cuentas_cobro (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null default public.current_empresa_id() references public.empresas(id),
  numero            text not null,
  cotizacion_id     uuid not null,
  cliente_id        uuid not null,
  orden_id          uuid,
  fecha_emision     date not null default (now() at time zone 'America/Bogota')::date,
  fecha_vencimiento date not null,
  -- Congelado al emitir: lo que se le cobró en el documento. Lo que falta hoy
  -- sale de cotizaciones_saldo.
  monto             numeric(14,2) not null check (monto > 0),
  orden_compra      text,
  usuario_id        uuid not null,
  created_at        timestamptz not null default now(),
  anulado_at        timestamptz,
  anulado_por       uuid,
  motivo_anulacion  text,
  constraint cuentas_cobro_empresa_id_id_key unique (empresa_id, id),
  constraint cuentas_cobro_numero_unico unique (empresa_id, numero),
  constraint cuentas_cobro_vencimiento_valido check (fecha_vencimiento >= fecha_emision),
  constraint cuentas_cobro_anulacion_coherente check (
    (anulado_at is null) = (anulado_por is null)
    and (anulado_at is null) = (motivo_anulacion is null)
  ),
  constraint cuentas_cobro_cotizacion_id_fkey
    foreign key (empresa_id, cotizacion_id) references public.cotizaciones (empresa_id, id) on delete restrict,
  constraint cuentas_cobro_cliente_id_fkey
    foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id) on delete restrict,
  constraint cuentas_cobro_orden_id_fkey
    foreign key (empresa_id, orden_id) references public.ordenes_trabajo (empresa_id, id) on delete restrict,
  constraint cuentas_cobro_usuario_id_fkey
    foreign key (empresa_id, usuario_id) references public.usuarios (empresa_id, id),
  constraint cuentas_cobro_anulado_por_fkey
    foreign key (empresa_id, anulado_por) references public.usuarios (empresa_id, id)
);

comment on table public.cuentas_cobro is
  'Cuenta de cobro de una venta a crédito (CC-0001…). Se escribe solo por RPC; el estado se deriva del saldo (vista cartera).';

-- Una sola cuenta vigente por cotización. Anulada, se puede volver a emitir.
create unique index if not exists cuentas_cobro_una_vigente
  on public.cuentas_cobro (empresa_id, cotizacion_id) where anulado_at is null;
create index if not exists idx_cuentas_cobro_cliente on public.cuentas_cobro (cliente_id);

create or replace trigger trg_00_forzar_empresa_id
  before insert or update or delete on public.cuentas_cobro
  for each row execute function public.forzar_empresa_id();

create or replace function public.cuentas_cobro_asignar_numero()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n integer;
begin
  insert into public.cuentas_cobro_consecutivo as cc (empresa_id, ultimo)
  values (new.empresa_id, 1)
  on conflict (empresa_id) do update set ultimo = cc.ultimo + 1
  returning ultimo into v_n;

  new.numero := 'CC-' || lpad(v_n::text, 4, '0');
  return new;
end;
$$;

revoke execute on function public.cuentas_cobro_asignar_numero() from public, anon, authenticated;

drop trigger if exists cuentas_cobro_zz_asignar_numero on public.cuentas_cobro;
create trigger cuentas_cobro_zz_asignar_numero
  before insert on public.cuentas_cobro
  for each row execute function public.cuentas_cobro_asignar_numero();

-- Emitida, solo cambia para anularse (una vez).
create or replace function public.cuentas_cobro_inmutable()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.anulado_at is not null then
    raise exception 'La cuenta de cobro % ya está anulada', old.numero;
  end if;
  if (to_jsonb(new) - array['anulado_at', 'anulado_por', 'motivo_anulacion'])
     is distinct from (to_jsonb(old) - array['anulado_at', 'anulado_por', 'motivo_anulacion']) then
    raise exception 'Una cuenta de cobro emitida no se modifica: anúlala y emite otra';
  end if;
  return new;
end;
$$;

revoke execute on function public.cuentas_cobro_inmutable() from public, anon, authenticated;

drop trigger if exists cuentas_cobro_inmutable on public.cuentas_cobro;
create trigger cuentas_cobro_inmutable
  before update on public.cuentas_cobro
  for each row execute function public.cuentas_cobro_inmutable();

-- Se lee desde el navegador; se escribe solo por los RPC de abajo.
alter table public.cuentas_cobro enable row level security;

drop policy if exists autenticados_select_cuentas_cobro on public.cuentas_cobro;
create policy autenticados_select_cuentas_cobro on public.cuentas_cobro
  for select using (empresa_id = (select public.current_empresa_id()) and auth.uid() is not null);

-- Los privilegios por defecto de Supabase dan todo a authenticated; aquí solo
-- se lee.
revoke all on public.cuentas_cobro from anon, authenticated;
grant select on public.cuentas_cobro to authenticated;

-- ── 4. Los cobros de una venta a crédito no son anticipos ───────────────────
-- Mismo cuerpo que 20261106120100_anulacion_ventas.sql. Lo nuevo: con
-- condicion_pago = 'credito' no se exige el 50% en el primer pago, y ese pago
-- se registra como abono (o saldo final), no como anticipo.
create or replace function public.validar_pago_cotizacion()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_total numeric;
  v_abonado numeric;
  v_credito boolean;
  v_financiera public.financieras;
begin
  if (select status from public.cash_register_sessions where id = new.session_id and empresa_id = new.empresa_id) is distinct from 'open' then
    raise exception 'La sesión de caja está cerrada';
  end if;

  new.desembolso_id := null;
  new.anulado_at := null;
  new.anulado_por := null;
  new.motivo_anulacion := null;

  if new.metodo_pago = 'financiera' then
    select * into v_financiera from public.financieras where id = new.financiera_id and empresa_id = new.empresa_id;
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

  select total, condicion_pago = 'credito' into v_total, v_credito
    from public.cotizaciones where id = new.cotizacion_id and empresa_id = new.empresa_id for update;
  if v_total is null then
    raise exception 'Cotización no encontrada';
  end if;

  select coalesce(sum(monto), 0) into v_abonado
    from public.ventas
   where cotizacion_id = new.cotizacion_id and anulado_at is null;

  if new.metodo_pago = 'financiera' then
    if v_credito then
      raise exception 'Esta venta es a crédito con la vidriería: registra los pagos como abonos';
    end if;
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

  if v_credito then
    -- Ya está vendida y produciendo: el primer pago es un abono a la cuenta.
    if new.tipo = 'anticipo'::public.tipo_pago then
      new.tipo := case
        when v_abonado + new.monto + 1 >= v_total then 'saldo_final'::public.tipo_pago
        else 'abono'::public.tipo_pago
      end;
    end if;
    return new;
  end if;

  if v_abonado = 0 and not public.cumple_anticipo_minimo(new.monto, v_total) then
    if new.autorizado_por is null then
      raise exception 'El anticipo debe ser al menos el 50%% del total (mínimo: %)',
        public.anticipo_minimo(v_total);
    end if;
    if (select rol from public.usuarios where id = new.autorizado_por and empresa_id = new.empresa_id) is distinct from 'admin'::rol_usuario then
      raise exception 'Solo un administrador puede autorizar un anticipo menor al 50%%';
    end if;
  end if;

  return new;
end $function$;

-- ── 5. La OT a crédito produce sin anticipo y se entrega con cuenta de cobro ─
-- Mismo cuerpo que 20260903094000_cierre_produccion.sql, con la condición de
-- pago en los dos extremos.
create or replace function public.validar_avance_orden()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_abonado numeric;
  v_saldo numeric;
  v_faltantes text;
  v_sin_consumir integer;
  v_credito boolean;
begin
  if new.estado = 'lista' and old.estado is distinct from 'lista' then
    select string_agg(i.nombre, ', ' order by i.nombre) into v_faltantes
      from public.orden_materiales om
      join public.items_inventario i on i.id = om.item_id
     where om.orden_id = new.id and om.origen = 'sobre_pedido'
       and om.estado <> 'consumido' and om.costo_unitario_real is null;

    if v_faltantes is not null then
      raise exception 'No se puede cerrar la producción: falta registrar el costo de %', v_faltantes;
    end if;

    select count(*) into v_sin_consumir
      from public.orden_materiales
     where orden_id = new.id and estado <> 'consumido';

    if v_sin_consumir > 0 then
      raise exception 'No se puede marcar lista: quedan % materiales sin descontar del inventario. Usa "Cerrar producción".',
        v_sin_consumir;
    end if;
  end if;

  if new.cotizacion_id is null then
    return new;
  end if;

  select condicion_pago = 'credito' into v_credito
    from public.cotizaciones where id = new.cotizacion_id;
  v_credito := coalesce(v_credito, false);

  if new.estado = 'en_produccion' and old.estado is distinct from 'en_produccion' and not v_credito then
    select total, total_abonado into v_total, v_abonado
      from public.cotizaciones_saldo where cotizacion_id = new.cotizacion_id;
    if v_total is not null and not public.cumple_anticipo_minimo(coalesce(v_abonado, 0), v_total) then
      raise exception 'No se puede iniciar producción: falta cobrar el anticipo (mínimo: %)',
        public.anticipo_minimo(v_total);
    end if;
  end if;

  if new.estado = 'entregada' and old.estado is distinct from 'entregada' then
    select saldo into v_saldo from public.cotizaciones_saldo where cotizacion_id = new.cotizacion_id;
    if coalesce(v_saldo, 0) > 1 then
      if not v_credito then
        raise exception 'No se puede entregar: la cotización tiene un saldo pendiente de %', v_saldo;
      end if;
      if not exists (select 1 from public.cuentas_cobro
                      where cotizacion_id = new.cotizacion_id and anulado_at is null) then
        raise exception 'No se puede entregar: emite la cuenta de cobro por el saldo de % (venta a crédito)', v_saldo;
      end if;
    end if;
  end if;

  return new;
end $$;

-- ── 6. Aprobar a crédito ────────────────────────────────────────────────────
-- El equivalente a registrar_anticipo_cotizacion para un cliente con crédito:
-- vende y crea la orden, pero sin cobro y sin caja. Solo el admin.
create or replace function public.aprobar_cotizacion_credito(
  p_cotizacion_id uuid,
  p_fecha_entrega date default null,
  p_orden_compra  text default null
) returns public.ordenes_trabajo
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_empresa uuid := public.current_empresa_id();
  v_cot     public.cotizaciones;
  v_cliente public.clientes;
  v_elegida public.cotizaciones;
  v_deuda   numeric;
  v_orden   public.ordenes_trabajo;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para aprobar a crédito';
  end if;

  if public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede aprobar una venta a crédito';
  end if;

  -- Mismo orden de bloqueo que registrar_anticipo_cotizacion: el envío completo
  -- por id y después la cotización.
  select * into v_cot from public.cotizaciones
   where id = p_cotizacion_id and empresa_id = v_empresa;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;
  if v_cot.grupo_id is not null then
    perform 1 from public.cotizaciones
     where grupo_id = v_cot.grupo_id and empresa_id = v_empresa
     order by id
     for update;
  end if;
  select * into v_cot from public.cotizaciones
   where id = p_cotizacion_id and empresa_id = v_empresa
   for update;

  if v_cot.categoria_id is not null then
    raise exception 'Esta opción es parte de un envío por categorías: arma el pedido y apruébalo a crédito';
  end if;

  if v_cot.estado not in ('enviada'::public.estado_cotizacion, 'aprobada'::public.estado_cotizacion) then
    raise exception 'Solo se aprueba a crédito una cotización enviada al cliente (estado actual: %)', v_cot.estado;
  end if;

  if exists (select 1 from public.ventas where cotizacion_id = v_cot.id and anulado_at is null) then
    raise exception 'La cotización % ya tiene cobros: no se puede pasar a crédito', v_cot.numero;
  end if;

  if v_cot.grupo_id is not null then
    select * into v_elegida from public.cotizaciones
     where grupo_id = v_cot.grupo_id and empresa_id = v_empresa
       and id <> v_cot.id and estado = 'vendida'
     limit 1;
    if found then
      raise exception 'El cliente ya eligió la opción % (%) de este envío',
        v_elegida.opcion_etiqueta, v_elegida.numero;
    end if;
  end if;

  -- El cliente se bloquea para que dos aprobaciones simultáneas no pasen el
  -- cupo entre las dos.
  select * into v_cliente from public.clientes
   where id = v_cot.cliente_id and empresa_id = v_empresa
   for update;
  if not v_cliente.credito_habilitado then
    raise exception 'El cliente no tiene crédito habilitado: actívalo en su ficha';
  end if;

  if v_cliente.cupo_credito is not null then
    select coalesce(sum(s.saldo), 0) into v_deuda
      from public.cotizaciones c
      join public.cotizaciones_saldo s on s.cotizacion_id = c.id
     where c.cliente_id = v_cliente.id and c.empresa_id = v_empresa
       and c.condicion_pago = 'credito' and c.estado = 'vendida';
    if v_deuda + v_cot.total > v_cliente.cupo_credito + 1 then
      raise exception 'Supera el cupo de crédito del cliente: debe % y el cupo es %',
        v_deuda, v_cliente.cupo_credito;
    end if;
  end if;

  perform set_config('glazz.aprobando_credito', 'on', true);

  update public.cotizaciones
     set condicion_pago = 'credito',
         orden_compra = nullif(btrim(coalesce(p_orden_compra, '')), ''),
         credito_autorizado_por = v_usuario,
         credito_autorizado_at = now(),
         estado_previo_venta = estado,
         estado = 'vendida',
         fecha_aprobacion = coalesce(fecha_aprobacion, now())
   where id = v_cot.id
  returning * into v_cot;

  perform set_config('glazz.aprobando_credito', 'off', true);

  if v_cot.grupo_id is not null then
    update public.cotizaciones
       set estado = 'descartada'
     where grupo_id = v_cot.grupo_id and empresa_id = v_empresa
       and id <> v_cot.id
       and estado in ('borrador', 'enviada', 'vencida', 'aprobada');
  end if;

  -- La orden viva, o la cancelada reactivada, como en el anticipo.
  select * into v_orden from public.ordenes_trabajo
   where cotizacion_id = v_cot.id and empresa_id = v_empresa
   order by (estado = 'cancelada'), created_at desc
   limit 1
   for update;

  if found then
    update public.ordenes_trabajo
       set estado = case when estado = 'cancelada' then 'pendiente'::public.estado_orden else estado end,
           fecha_entrega_estimada = coalesce(p_fecha_entrega, fecha_entrega_estimada)
     where id = v_orden.id
    returning * into v_orden;
    return v_orden;
  end if;

  insert into public.ordenes_trabajo
    (numero, cotizacion_id, cliente_id, estado, fecha_entrega_estimada, notas)
  values
    ('OT-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text,
     v_cot.id, v_cot.cliente_id, 'pendiente', p_fecha_entrega, v_cot.notas)
  returning * into v_orden;

  return v_orden;
end;
$function$;

revoke execute on function public.aprobar_cotizacion_credito(uuid, date, text) from public, anon;
grant execute on function public.aprobar_cotizacion_credito(uuid, date, text) to authenticated;

-- ── 7. Emitir la cuenta de cobro ────────────────────────────────────────────
-- Por el saldo de hoy, con vencimiento a los días de crédito del cliente.
-- Puede emitirse antes de entregar (hay empresas que la piden con la OC) o la
-- emite entregar_orden_credito. El llamador debe tener la cotización
-- bloqueada; esta función la vuelve a bloquear, lo que no cuesta nada.
create or replace function public.emitir_cuenta_cobro(
  p_cotizacion_id uuid
) returns public.cuentas_cobro
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_empresa uuid := public.current_empresa_id();
  v_cot     public.cotizaciones;
  v_cliente public.clientes;
  v_saldo   numeric;
  v_previa  public.cuentas_cobro;
  v_orden   uuid;
  v_hoy     date := (now() at time zone 'America/Bogota')::date;
  v_cc      public.cuentas_cobro;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para emitir una cuenta de cobro';
  end if;

  select * into v_cot from public.cotizaciones
   where id = p_cotizacion_id and empresa_id = v_empresa
   for update;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;

  if v_cot.condicion_pago <> 'credito' or v_cot.estado <> 'vendida'::public.estado_cotizacion then
    raise exception 'Solo una venta a crédito lleva cuenta de cobro';
  end if;

  select * into v_previa from public.cuentas_cobro
   where cotizacion_id = v_cot.id and anulado_at is null;
  if found then
    raise exception 'La cotización % ya tiene la cuenta de cobro %', v_cot.numero, v_previa.numero;
  end if;

  select saldo into v_saldo from public.cotizaciones_saldo where cotizacion_id = v_cot.id;
  if coalesce(v_saldo, 0) <= 1 then
    raise exception 'La cotización % no tiene saldo por cobrar', v_cot.numero;
  end if;

  select * into v_cliente from public.clientes where id = v_cot.cliente_id;

  select id into v_orden from public.ordenes_trabajo
   where cotizacion_id = v_cot.id and estado <> 'cancelada'
   order by created_at desc
   limit 1;

  insert into public.cuentas_cobro
    (cotizacion_id, cliente_id, orden_id, fecha_emision, fecha_vencimiento,
     monto, orden_compra, usuario_id)
  values
    (v_cot.id, v_cot.cliente_id, v_orden, v_hoy, v_hoy + v_cliente.dias_credito,
     round(v_saldo), v_cot.orden_compra, v_usuario)
  returning * into v_cc;

  return v_cc;
end;
$function$;

revoke execute on function public.emitir_cuenta_cobro(uuid) from public, anon;
grant execute on function public.emitir_cuenta_cobro(uuid) to authenticated;

-- ── 8. Entregar una orden a crédito ─────────────────────────────────────────
-- Emite la cuenta de cobro (si hay saldo y aún no existe) y entrega en la
-- misma transacción: no queda una orden entregada sin documento de cobro, ni
-- un documento de una entrega que falló.
create or replace function public.entregar_orden_credito(
  p_orden_id uuid
) returns public.cuentas_cobro
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.current_empresa_id();
  v_orden   public.ordenes_trabajo;
  v_cot     public.cotizaciones;
  v_saldo   numeric;
  v_cc      public.cuentas_cobro;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para entregar una orden';
  end if;

  select * into v_orden from public.ordenes_trabajo
   where id = p_orden_id and empresa_id = v_empresa;
  if not found or v_orden.cotizacion_id is null then
    raise exception 'Orden no encontrada';
  end if;

  -- Cotización antes que orden: el mismo orden que el anticipo y la anulación.
  select * into v_cot from public.cotizaciones
   where id = v_orden.cotizacion_id and empresa_id = v_empresa
   for update;
  select * into v_orden from public.ordenes_trabajo where id = p_orden_id for update;

  if v_cot.condicion_pago <> 'credito' then
    raise exception 'La orden % no es una venta a crédito', v_orden.numero;
  end if;

  if v_orden.estado <> 'lista'::public.estado_orden then
    raise exception 'La orden % debe estar lista para entregarse (estado actual: %)', v_orden.numero, v_orden.estado;
  end if;

  select * into v_cc from public.cuentas_cobro
   where cotizacion_id = v_cot.id and anulado_at is null;

  if not found then
    select saldo into v_saldo from public.cotizaciones_saldo where cotizacion_id = v_cot.id;
    if coalesce(v_saldo, 0) > 1 then
      v_cc := public.emitir_cuenta_cobro(v_cot.id);
    end if;
  end if;

  update public.ordenes_trabajo
     set estado = 'entregada',
         fecha_entrega_real = (now() at time zone 'America/Bogota')::date
   where id = v_orden.id;

  -- Null si ya estaba pagada: se entregó sin cuenta de cobro.
  return v_cc;
end;
$function$;

revoke execute on function public.entregar_orden_credito(uuid) from public, anon;
grant execute on function public.entregar_orden_credito(uuid) to authenticated;

-- ── 9. Anular una cuenta de cobro ───────────────────────────────────────────
-- Para corregirla (OC equivocada, monto acordado distinto): se anula y se
-- emite otra. No toca cobros ni la orden.
create or replace function public.anular_cuenta_cobro(
  p_cuenta_id uuid,
  p_motivo    text
) returns public.cuentas_cobro
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_cc      public.cuentas_cobro;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para anular una cuenta de cobro';
  end if;
  if public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede anular una cuenta de cobro';
  end if;
  if length(v_motivo) < 10 then
    raise exception 'Escribe el motivo de la anulación (mínimo 10 caracteres)';
  end if;

  select * into v_cc from public.cuentas_cobro
   where id = p_cuenta_id and empresa_id = public.current_empresa_id()
   for update;
  if not found then
    raise exception 'La cuenta de cobro no existe';
  end if;
  if v_cc.anulado_at is not null then
    raise exception 'La cuenta de cobro % ya está anulada', v_cc.numero;
  end if;

  update public.cuentas_cobro
     set anulado_at = now(), anulado_por = v_usuario, motivo_anulacion = v_motivo
   where id = v_cc.id
  returning * into v_cc;

  return v_cc;
end;
$function$;

revoke execute on function public.anular_cuenta_cobro(uuid, text) from public, anon;
grant execute on function public.anular_cuenta_cobro(uuid, text) to authenticated;

-- ── 10. Anular el único cobro de una venta a crédito no la deshace ──────────
-- Mismo cuerpo que 20261106120100_anulacion_ventas.sql. Lo único nuevo: con
-- condicion_pago = 'credito', quedarse sin cobros no cancela la orden ni
-- devuelve la cotización. La venta existe por la aprobación a crédito, no por
-- el cobro.
create or replace function public.anular_venta(
  p_venta_id      uuid,
  p_motivo        text,
  -- Solo cuenta si la caja del cobro ya cerró y el pago fue en efectivo: ¿sale
  -- hoy plata del cajón (devolución) o el dinero nunca entró?
  p_sale_efectivo boolean default true
) returns public.ventas
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario   uuid := auth.uid();
  v_empresa   uuid := public.current_empresa_id();
  v_motivo    text := btrim(coalesce(p_motivo, ''));
  v_venta     public.ventas;
  v_cot       public.cotizaciones;
  v_vm        public.ventas_mostrador;
  v_documento text;
  v_original  public.cash_register_sessions;
  v_sesion    public.cash_register_sessions;
  v_afecta    boolean := true;
  v_otros     integer;
  v_orden     public.ordenes_trabajo;
  v_mov       public.movimientos_inventario;
  v_item      public.items_inventario;
  v_financiera text;
begin
  -- ── Permisos y datos ──
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para anular una venta';
  end if;

  -- `is distinct from`: un usuario sin fila en `usuarios` tiene rol null y no
  -- debe pasar como admin (mismo criterio que anular_movimiento_caja).
  if public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede anular una venta';
  end if;

  if length(v_motivo) < 10 then
    raise exception 'Escribe el motivo de la anulación (mínimo 10 caracteres)';
  end if;

  -- ── Bloqueos ──
  -- Primero el documento y después el cobro: es el mismo orden en que toman
  -- los locks registrar_anticipo_cotizacion y validar_pago_cotizacion. Así una
  -- anulación y un cobro simultáneos no se cruzan en un deadlock.
  select * into v_venta from public.ventas
   where id = p_venta_id and empresa_id = v_empresa;
  if not found then
    raise exception 'La venta no existe';
  end if;

  if v_venta.cotizacion_id is not null then
    select * into v_cot from public.cotizaciones
     where id = v_venta.cotizacion_id for update;
    v_documento := v_cot.numero;
  else
    select * into v_vm from public.ventas_mostrador
     where id = v_venta.venta_mostrador_id for update;
    v_documento := v_vm.numero;
  end if;

  select * into v_venta from public.ventas where id = p_venta_id for update;

  if v_venta.anulado_at is not null then
    raise exception 'Esta venta ya fue anulada';
  end if;

  -- TODO(DIAN): cuando exista la facturación electrónica, una venta con
  -- factura emitida no se anula aquí: debe emitirse una nota crédito ante la
  -- DIAN, y esta función tiene que rechazarla o delegar en ese flujo. Hoy Glazz
  -- no emite facturas electrónicas.

  -- ── Validaciones (antes de escribir nada) ──

  -- Financiera: el dinero no entró a caja, así que no hay egreso. Si la
  -- financiera ya desembolsó, la devolución se negocia con ella.
  if v_venta.metodo_pago = 'financiera' then
    if v_venta.desembolso_id is not null then
      select nombre into v_financiera from public.financieras where id = v_venta.financiera_id;
      raise exception 'El desembolso de % para esta venta ya fue registrado: la anulación requiere gestión manual con la financiera',
        coalesce(v_financiera, 'la financiera');
    end if;
  else
    -- El reverso va a la caja original si sigue abierta. Si ya cerró, va a la
    -- caja abierta de hoy: una caja cerrada nunca se toca.
    select * into v_original from public.cash_register_sessions
     where id = v_venta.session_id for update;

    if v_original.status = 'open'::public.estado_caja then
      v_sesion := v_original;
    else
      select * into v_sesion from public.cash_register_sessions
       where status = 'open'::public.estado_caja and empresa_id = v_empresa
       for update;
      if not found then
        raise exception 'No hay caja abierta: abre la caja para registrar el reverso de esta venta (su caja original ya fue cerrada)';
      end if;
      v_afecta := v_venta.metodo_pago <> 'efectivo' or coalesce(p_sale_efectivo, true);
    end if;

    if v_venta.metodo_pago = 'efectivo' and v_afecta
       and v_venta.monto > public.efectivo_disponible_caja(v_sesion.id) then
      raise exception 'No hay suficiente efectivo en caja para el reverso: disponible %',
        public.efectivo_disponible_caja(v_sesion.id);
    end if;
  end if;

  -- Cotización: si este es su último cobro activo, la venta se deshace del
  -- todo. La orden solo se cancela si no ha empezado: lo que ya se produjo o
  -- consumió material requiere decidir a mano qué hacer con él.
  if v_venta.cotizacion_id is not null then
    select count(*) into v_otros from public.ventas
     where cotizacion_id = v_venta.cotizacion_id
       and anulado_at is null
       and id <> v_venta.id;

    if v_otros = 0 and v_cot.condicion_pago is distinct from 'credito' then
      for v_orden in
        select * from public.ordenes_trabajo
         where cotizacion_id = v_venta.cotizacion_id and estado <> 'cancelada'
         for update
      loop
        if v_orden.estado <> 'pendiente'::public.estado_orden then
          raise exception 'La orden % ya está en estado "%": anular su único cobro requiere gestión manual de la orden',
            v_orden.numero, v_orden.estado;
        end if;
        if exists (select 1 from public.orden_materiales
                    where orden_id = v_orden.id and estado = 'consumido') then
          raise exception 'La orden % ya consumió material del inventario: anular su único cobro requiere decidir qué hacer con ese material',
            v_orden.numero;
        end if;
      end loop;
    end if;
  end if;

  -- ── Escrituras ──

  update public.ventas
     set anulado_at = now(),
         anulado_por = v_usuario,
         motivo_anulacion = v_motivo
   where id = v_venta.id
  returning * into v_venta;

  if v_venta.metodo_pago <> 'financiera' then
    -- Pasa por exigir_caja_del_dia: si la caja abierta es de otro día, hay que
    -- cerrarla primero, como con cualquier movimiento.
    insert into public.caja_movimientos
      (session_id, categoria, concepto, monto, metodo_pago, usuario_id, venta_id, afecta_efectivo)
    values
      (v_sesion.id, 'reverso_anulacion', 'Anulación ' || v_documento || ': ' || v_motivo,
       v_venta.monto, v_venta.metodo_pago, v_usuario, v_venta.id, v_afecta);
  end if;

  if v_venta.cotizacion_id is not null then
    if v_otros = 0 and v_cot.condicion_pago is distinct from 'credito' then
      update public.ordenes_trabajo
         set estado = 'cancelada'
       where cotizacion_id = v_venta.cotizacion_id and estado = 'pendiente';

      update public.cotizaciones
         set estado = coalesce(estado_previo_venta, 'aprobada'::public.estado_cotizacion),
             estado_previo_venta = null
       where id = v_venta.cotizacion_id and estado = 'vendida';
    end if;
    -- Con otros cobros activos (el caso del duplicado), la cotización sigue
    -- vendida por el cobro válido y la orden no se toca.
  else
    update public.ventas_mostrador
       set anulado_at = v_venta.anulado_at,
           anulado_por = v_usuario,
           motivo_anulacion = v_motivo
     where id = v_vm.id;

    -- Se reintegra exactamente lo que esta venta descontó, con un movimiento
    -- nuevo, sin editar cantidades. El mostrador vende ítems enteros, sin
    -- corte, así que lo que salió vuelve igual.
    for v_mov in
      select * from public.movimientos_inventario
       where referencia = v_vm.id::text and tipo = 'salida' and empresa_id = v_empresa
       order by created_at
    loop
      select * into v_item from public.items_inventario
       where id = v_mov.item_id for update;

      insert into public.movimientos_inventario
        (item_id, tipo, cantidad, cantidad_anterior, cantidad_posterior, motivo, referencia, usuario_id)
      values
        (v_item.id, 'reintegro_anulacion', v_mov.cantidad, v_item.stock_actual,
         v_item.stock_actual + v_mov.cantidad,
         'Anulación venta ' || v_vm.numero, v_vm.id::text, v_usuario);
    end loop;
  end if;

  return v_venta;
end;
$function$;

revoke execute on function public.anular_venta(uuid, text, boolean) from public, anon;
grant execute on function public.anular_venta(uuid, text, boolean) to authenticated;


-- ── 11. Anular una venta a crédito ──────────────────────────────────────────
-- Mismo cuerpo que 20261108120100_cotizacion_anulada.sql. Lo nuevo: una venta
-- a crédito puede no tener cobros, así que se anula igual. Como anular_venta
-- ya no cancela su orden, la cancela esta función, y también anula la cuenta
-- de cobro vigente.
create or replace function public.anular_cotizacion(
  p_cotizacion_id uuid,
  p_motivo        text,
  p_tipo          text
) returns public.cotizaciones
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_empresa uuid := public.current_empresa_id();
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_cot     public.cotizaciones;
  v_orden   public.ordenes_trabajo;
  v_venta   public.ventas;
  v_cobros  integer := 0;
  v_credito boolean;
begin
  -- ── Permisos y datos (mismos criterios que anular_venta) ──
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para anular una cotización';
  end if;

  if public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede anular una cotización';
  end if;

  if length(v_motivo) < 10 then
    raise exception 'Escribe el motivo de la anulación (mínimo 10 caracteres)';
  end if;

  if p_tipo is null or p_tipo not in ('desistimiento', 'error') then
    raise exception 'Indica si el cliente desistió o si fue un error de registro';
  end if;

  -- Primero el documento, como anular_venta y los cobros: sin deadlocks.
  select * into v_cot from public.cotizaciones
   where id = p_cotizacion_id and empresa_id = v_empresa
   for update;
  if not found then
    raise exception 'La cotización no existe';
  end if;

  if v_cot.estado = 'anulada'::public.estado_cotizacion then
    raise exception 'La cotización % ya fue anulada', v_cot.numero;
  end if;

  if v_cot.estado <> 'vendida'::public.estado_cotizacion then
    raise exception 'Solo se anula una cotización vendida. Si nunca se cobró, usa "Rechazar"';
  end if;

  v_credito := v_cot.condicion_pago = 'credito';

  -- ── Validaciones de la orden, con mensajes de cotización ──
  for v_orden in
    select * from public.ordenes_trabajo
     where cotizacion_id = v_cot.id and estado <> 'cancelada'
     for update
  loop
    if v_orden.estado <> 'pendiente'::public.estado_orden then
      raise exception 'La orden % ya está en estado "%": resuelve la orden antes de anular la cotización',
        v_orden.numero, v_orden.estado;
    end if;
    if exists (select 1 from public.orden_materiales
                where orden_id = v_orden.id and estado = 'consumido') then
      raise exception 'La orden % ya consumió material del inventario: decide qué hacer con ese material antes de anular la cotización',
        v_orden.numero;
    end if;
  end loop;

  -- ── Cobros: del más nuevo al más viejo ──
  for v_venta in
    select * from public.ventas
     where cotizacion_id = v_cot.id and anulado_at is null
     order by created_at desc, id desc
  loop
    perform public.anular_venta(v_venta.id, v_motivo, p_tipo = 'desistimiento');
    v_cobros := v_cobros + 1;
  end loop;

  if v_cobros = 0 and not v_credito then
    raise exception 'La cotización % no tiene cobros activos: no hay nada que anular', v_cot.numero;
  end if;

  if v_credito then
    update public.ordenes_trabajo
       set estado = 'cancelada'
     where cotizacion_id = v_cot.id and estado = 'pendiente';

    update public.cuentas_cobro
       set anulado_at = now(), anulado_por = v_usuario, motivo_anulacion = v_motivo
     where cotizacion_id = v_cot.id and anulado_at is null;
  end if;

  perform set_config('glazz.anulando_cotizacion', 'on', true);

  update public.cotizaciones
     set estado = 'anulada'::public.estado_cotizacion,
         estado_previo_venta = null,
         anulado_at = now(),
         anulado_por = v_usuario,
         motivo_anulacion = v_motivo,
         tipo_anulacion = p_tipo
   where id = v_cot.id
  returning * into v_cot;

  perform set_config('glazz.anulando_cotizacion', 'off', true);

  return v_cot;
end;
$function$;

revoke execute on function public.anular_cotizacion(uuid, text, text) from public, anon;
grant execute on function public.anular_cotizacion(uuid, text, text) to authenticated;

-- ── 12. Cartera ─────────────────────────────────────────────────────────────
-- Las ventas a crédito vivas, con su cuenta de cobro vigente si ya se emitió.
-- El estado se deriva del saldo de hoy:
--   sin_emitir  todavía no tiene cuenta de cobro (en producción, por lo general);
--   pendiente   emitida, sin pagos desde la emisión;
--   parcial     emitida, con algún pago desde la emisión;
--   vencida     pasó la fecha de vencimiento con saldo;
--   pagada      saldo en cero (tolerancia de $1).
-- Espejo en TS: estadoCartera() en src/lib/pagos.ts.
create or replace view public.cartera
with (security_invoker = on) as
select
  c.id                 as cotizacion_id,
  c.numero             as cotizacion_numero,
  c.orden_compra,
  c.fecha_aprobacion,
  cl.id                as cliente_id,
  cl.nombre            as cliente_nombre,
  cl.apellido          as cliente_apellido,
  cl.empresa           as cliente_empresa,
  cl.documento         as cliente_documento,
  cl.dias_credito,
  s.total,
  s.total_abonado,
  s.saldo,
  cc.id                as cuenta_cobro_id,
  cc.numero            as cuenta_cobro_numero,
  cc.fecha_emision,
  cc.fecha_vencimiento,
  cc.monto             as monto_cuenta,
  o.id                 as orden_id,
  o.numero             as orden_numero,
  o.estado             as orden_estado,
  case when cc.id is null or s.saldo <= 1 then 0
       else greatest(0, (now() at time zone 'America/Bogota')::date - cc.fecha_vencimiento)
  end                  as dias_mora,
  case
    when s.saldo <= 1 then 'pagada'
    when cc.id is null then 'sin_emitir'
    when (now() at time zone 'America/Bogota')::date > cc.fecha_vencimiento then 'vencida'
    when s.saldo < cc.monto - 1 then 'parcial'
    else 'pendiente'
  end                  as estado
from public.cotizaciones c
join public.clientes cl on cl.id = c.cliente_id
join public.cotizaciones_saldo s on s.cotizacion_id = c.id
left join public.cuentas_cobro cc on cc.cotizacion_id = c.id and cc.anulado_at is null
left join lateral (
  select id, numero, estado from public.ordenes_trabajo
   where cotizacion_id = c.id and estado <> 'cancelada'
   order by created_at desc
   limit 1
) o on true
where c.condicion_pago = 'credito'
  and c.estado = 'vendida';

revoke all on public.cartera from anon, authenticated;
grant select on public.cartera to authenticated;
