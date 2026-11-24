-- Solicitud de autorización de un anticipo menor al 50%.
--
-- Hasta ahora solo el admin podía cobrar un anticipo bajo el mínimo, y tenía
-- que hacerlo con su propia sesión (20261124120000_autorizacion_anticipo.sql).
-- Ahora el vendedor pide la autorización desde el cobro, el admin la aprueba o
-- la rechaza, y con la solicitud aprobada el vendedor cobra.
--
-- La autorización vive en la base: el trigger busca la solicitud aprobada de la
-- cotización, no confía en un id que mande el navegador. El monto aprobado es
-- un piso (se puede cobrar desde ahí hacia arriba), la solicitud se usa una vez
-- y deja de valer si el total de la cotización cambia después de aprobarla.

-- ── 1. Tabla ────────────────────────────────────────────────────────────────

do $$ begin
  create type public.estado_solicitud_anticipo as enum
    ('pendiente', 'aprobada', 'rechazada', 'usada', 'cancelada');
exception when duplicate_object then null;
end $$;

create table if not exists public.solicitudes_anticipo (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null default public.current_empresa_id() references public.empresas(id),
  cotizacion_id    uuid not null,
  -- Lo mínimo que se podrá cobrar con esta autorización.
  monto_minimo     numeric(14,2) not null check (monto_minimo > 0),
  -- Total de la cotización al pedir: si cambia, la autorización ya no aplica.
  total_cotizacion numeric(14,2) not null,
  motivo           text not null check (btrim(motivo) <> ''),
  estado           public.estado_solicitud_anticipo not null default 'pendiente',
  solicitado_por   uuid not null default auth.uid(),
  resuelto_por     uuid,
  resuelto_at      timestamptz,
  motivo_rechazo   text,
  -- El cobro que la usó.
  venta_id         uuid,
  created_at       timestamptz not null default now(),
  constraint solicitudes_anticipo_resolucion_coherente check (
    (estado in ('aprobada', 'rechazada', 'usada')) = (resuelto_por is not null and resuelto_at is not null)
    or estado = 'cancelada'
  ),
  constraint solicitudes_anticipo_rechazo_con_motivo check (
    estado <> 'rechazada' or nullif(btrim(coalesce(motivo_rechazo, '')), '') is not null
  ),
  constraint solicitudes_anticipo_cotizacion_id_fkey
    foreign key (empresa_id, cotizacion_id) references public.cotizaciones (empresa_id, id) on delete cascade,
  constraint solicitudes_anticipo_solicitado_por_fkey
    foreign key (empresa_id, solicitado_por) references public.usuarios (empresa_id, id),
  constraint solicitudes_anticipo_resuelto_por_fkey
    foreign key (empresa_id, resuelto_por) references public.usuarios (empresa_id, id)
);

comment on table public.solicitudes_anticipo is
  'Pedido de un vendedor para cobrar un anticipo menor al 50%. Se escribe solo por RPC y lo consume validar_pago_cotizacion.';

-- Una sola solicitud viva (pendiente o aprobada) por cotización.
create unique index if not exists solicitudes_anticipo_una_viva
  on public.solicitudes_anticipo (empresa_id, cotizacion_id)
  where estado in ('pendiente', 'aprobada');
create index if not exists idx_solicitudes_anticipo_pendientes
  on public.solicitudes_anticipo (empresa_id, created_at) where estado = 'pendiente';
create index if not exists idx_solicitudes_anticipo_cotizacion
  on public.solicitudes_anticipo (cotizacion_id, created_at desc);

create or replace trigger trg_00_forzar_empresa_id
  before insert or update or delete on public.solicitudes_anticipo
  for each row execute function public.forzar_empresa_id();

alter table public.solicitudes_anticipo enable row level security;

drop policy if exists autenticados_select_solicitudes_anticipo on public.solicitudes_anticipo;
create policy autenticados_select_solicitudes_anticipo on public.solicitudes_anticipo
  for select using (empresa_id = (select public.current_empresa_id()) and auth.uid() is not null);

revoke all on public.solicitudes_anticipo from anon, authenticated;
grant select on public.solicitudes_anticipo to authenticated;

-- ── 2. RPC: pedir la autorización ───────────────────────────────────────────

create or replace function public.solicitar_autorizacion_anticipo(
  p_cotizacion_id uuid,
  p_monto         numeric,
  p_motivo        text
) returns public.solicitudes_anticipo
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_empresa uuid := public.current_empresa_id();
  v_cot     public.cotizaciones;
  v_sol     public.solicitudes_anticipo;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para pedir una autorización';
  end if;

  select * into v_cot from public.cotizaciones
   where id = p_cotizacion_id and empresa_id = v_empresa
   for update;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;

  if v_cot.condicion_pago = 'credito' then
    raise exception 'Esta venta es a crédito con la vidriería: no lleva anticipo';
  end if;

  if v_cot.estado not in ('borrador', 'enviada', 'aprobada', 'vencida') then
    raise exception 'La cotización % no admite cobros (estado actual: %)', v_cot.numero, v_cot.estado;
  end if;

  if exists (select 1 from public.ventas where cotizacion_id = v_cot.id and anulado_at is null) then
    raise exception 'La cotización % ya tiene cobros: el mínimo del 50%% ya no aplica', v_cot.numero;
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El anticipo debe ser mayor a cero';
  end if;
  if public.cumple_anticipo_minimo(p_monto, v_cot.total) then
    raise exception 'Ese monto ya cumple el mínimo del 50%%: no necesita autorización';
  end if;

  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Escribe el motivo de la solicitud';
  end if;

  -- Pedir otra vez reemplaza a la anterior (por ejemplo, el cliente cambió de
  -- monto).
  update public.solicitudes_anticipo
     set estado = 'cancelada'
   where cotizacion_id = v_cot.id and empresa_id = v_empresa
     and estado in ('pendiente', 'aprobada');

  insert into public.solicitudes_anticipo
    (cotizacion_id, monto_minimo, total_cotizacion, motivo, solicitado_por)
  values
    (v_cot.id, p_monto, v_cot.total, btrim(p_motivo), v_usuario)
  returning * into v_sol;

  return v_sol;
end $function$;

revoke execute on function public.solicitar_autorizacion_anticipo(uuid, numeric, text) from public, anon;
grant execute on function public.solicitar_autorizacion_anticipo(uuid, numeric, text) to authenticated;

-- ── 3. RPC: aprobar o rechazar ──────────────────────────────────────────────

create or replace function public.resolver_solicitud_anticipo(
  p_solicitud_id   uuid,
  p_aprobar        boolean,
  p_motivo_rechazo text default null
) returns public.solicitudes_anticipo
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_empresa uuid := public.current_empresa_id();
  v_sol     public.solicitudes_anticipo;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para resolver una solicitud';
  end if;
  if public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede autorizar un anticipo menor al 50%%';
  end if;

  select * into v_sol from public.solicitudes_anticipo
   where id = p_solicitud_id and empresa_id = v_empresa
   for update;
  if not found then
    raise exception 'Solicitud no encontrada';
  end if;
  if v_sol.estado <> 'pendiente' then
    raise exception 'La solicitud ya no está pendiente (estado actual: %)', v_sol.estado;
  end if;

  if p_aprobar is not true and nullif(btrim(coalesce(p_motivo_rechazo, '')), '') is null then
    raise exception 'Escribe el motivo del rechazo';
  end if;

  update public.solicitudes_anticipo
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end::public.estado_solicitud_anticipo,
         resuelto_por = v_usuario,
         resuelto_at = now(),
         motivo_rechazo = case when p_aprobar then null else btrim(p_motivo_rechazo) end
   where id = v_sol.id
  returning * into v_sol;

  return v_sol;
end $function$;

revoke execute on function public.resolver_solicitud_anticipo(uuid, boolean, text) from public, anon;
grant execute on function public.resolver_solicitud_anticipo(uuid, boolean, text) to authenticated;

-- ── 4. El cobro consume la solicitud aprobada ───────────────────────────────
-- Mismo cuerpo que 20261124120000_autorizacion_anticipo.sql; solo cambia el
-- bloque del anticipo bajo el mínimo.
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
  v_sol public.solicitudes_anticipo;
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
      -- Sin autorización del que cobra: vale una solicitud aprobada por un admin.
      select * into v_sol from public.solicitudes_anticipo
       where cotizacion_id = new.cotizacion_id and empresa_id = new.empresa_id
         and estado = 'aprobada'
       for update;
      if not found then
        raise exception 'El anticipo debe ser al menos el 50%% del total (mínimo: %)',
          public.anticipo_minimo(v_total);
      end if;
      if abs(v_sol.total_cotizacion - v_total) > 1 then
        raise exception 'El total de la cotización cambió después de la autorización: pide una nueva';
      end if;
      if new.monto < v_sol.monto_minimo then
        raise exception 'El anticipo autorizado es desde % (mínimo sin autorización: %)',
          v_sol.monto_minimo, public.anticipo_minimo(v_total);
      end if;
      new.autorizado_por := v_sol.resuelto_por;
      new.motivo_autorizacion := v_sol.motivo;
      -- Si el cobro no entra, esto se revierte con él.
      update public.solicitudes_anticipo
         set estado = 'usada', venta_id = new.id
       where id = v_sol.id;
      return new;
    end if;
    if auth.uid() is not null and new.autorizado_por is distinct from auth.uid() then
      raise exception 'Solo el administrador que registra el cobro puede autorizar un anticipo menor al 50%%';
    end if;
    if (select rol from public.usuarios where id = new.autorizado_por and empresa_id = new.empresa_id) is distinct from 'admin'::rol_usuario then
      raise exception 'Solo un administrador puede autorizar un anticipo menor al 50%%';
    end if;
  end if;

  return new;
end $function$;
