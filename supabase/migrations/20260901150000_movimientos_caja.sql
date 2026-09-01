-- Movimientos de caja: las salidas de dinero del turno.
--
-- Hasta ahora la caja solo sabía de entradas (ventas de mostrador, anticipos y
-- abonos). Pero del cajón sale plata todos los días: domicilios, transporte,
-- papelería, refrigerios, pagos menores a proveedor, retiros. Como no había
-- dónde registrarlos, cada gasto en efectivo aparecía al cerrar como un
-- descuadre negativo sin explicación, y el negocio no tenía trazabilidad de sus
-- egresos.
--
-- Con esto el arqueo vuelve a significar lo que debe: la diferencia es un error
-- de conteo, no un gasto que nadie anotó.

-- ── Catálogo de gastos ──────────────────────────────────────────────────────
-- Enum y no tabla: son las categorías fijas de la operación y sirven para
-- agrupar en reportes. 'otro' + el concepto obligatorio cubren el resto.
do $$ begin
  create type public.categoria_gasto as enum
    ('domicilio', 'transporte', 'papeleria', 'servicios', 'refrigerio', 'proveedor', 'retiro', 'otro');
exception when duplicate_object then null;
end $$;

-- ── La tabla ────────────────────────────────────────────────────────────────
-- `metodo_pago` reusa `metodo_pago_venta`: un gasto pagado por transferencia se
-- registra y se reporta, pero no toca el arqueo — igual que las ventas por ese
-- medio, que tampoco pasan por el cajón.
--
-- Anular es un soft-delete, no un DELETE: un movimiento de efectivo borrado es
-- evidencia perdida, justo lo contrario de lo que busca esta tabla. Un
-- movimiento vivo es `anulado_at is null`, y ese predicado se repite en la
-- vista, en el cierre y en la app.
create table if not exists public.caja_movimientos (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cash_register_sessions(id),
  categoria public.categoria_gasto not null,
  concepto text not null,
  monto numeric(12,2) not null,
  metodo_pago public.metodo_pago_venta not null,
  usuario_id uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  anulado_at timestamptz,
  anulado_por uuid references public.usuarios(id),
  motivo_anulacion text,
  constraint caja_movimientos_monto_positivo check (monto > 0),
  constraint caja_movimientos_concepto_no_vacio check (length(trim(concepto)) > 0)
);

create index if not exists idx_caja_movimientos_session on public.caja_movimientos(session_id);
create index if not exists idx_caja_movimientos_created on public.caja_movimientos(created_at);

-- ── Registrar un gasto ──────────────────────────────────────────────────────
-- La sesión no se recibe del cliente: se resuelve aquí la que esté abierta,
-- mismo criterio que registrar_venta_mostrador y registrar_anticipo_cotizacion.
-- Así no se puede colgar un gasto de un turno ya cerrado y cuadrado.
create or replace function public.registrar_gasto_caja(
  p_categoria public.categoria_gasto,
  p_concepto text,
  p_monto numeric,
  p_metodo_pago public.metodo_pago_venta
) returns public.caja_movimientos
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_usuario uuid := auth.uid();
  v_sesion public.cash_register_sessions;
  v_ventas numeric;
  v_gastos numeric;
  v_disponible numeric;
  v_movimiento public.caja_movimientos;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar un gasto';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del gasto debe ser mayor a cero';
  end if;

  if p_concepto is null or length(trim(p_concepto)) = 0 then
    raise exception 'Describe el gasto';
  end if;

  -- El lock serializa contra otro gasto simultáneo: sin él, dos retiros podrían
  -- validar cada uno contra el mismo disponible y vaciar el cajón de más.
  select * into v_sesion
  from public.cash_register_sessions
  where status = 'open'::public.estado_caja
  for update;

  if not found then
    raise exception 'Debes abrir caja antes de registrar un gasto';
  end if;

  -- Del cajón no puede salir plata que no está. Sin esta validación el efectivo
  -- esperado del cierre podría quedar negativo.
  if p_metodo_pago = 'efectivo'::public.metodo_pago_venta then
    select coalesce(sum(monto), 0) into v_ventas
    from public.ventas
    where session_id = v_sesion.id and metodo_pago = 'efectivo'::public.metodo_pago_venta;

    select coalesce(sum(monto), 0) into v_gastos
    from public.caja_movimientos
    where session_id = v_sesion.id
      and metodo_pago = 'efectivo'::public.metodo_pago_venta
      and anulado_at is null;

    v_disponible := v_sesion.opening_amount + v_ventas - v_gastos;

    if p_monto > v_disponible then
      raise exception 'No hay tanto efectivo en caja: disponible %', v_disponible;
    end if;
  end if;

  insert into public.caja_movimientos (session_id, categoria, concepto, monto, metodo_pago, usuario_id)
  values (v_sesion.id, p_categoria, trim(p_concepto), p_monto, p_metodo_pago, v_usuario)
  returning * into v_movimiento;

  return v_movimiento;
end;
$$;

grant execute on function public.registrar_gasto_caja(
  public.categoria_gasto, text, numeric, public.metodo_pago_venta
) to authenticated;

-- ── Anular un gasto ─────────────────────────────────────────────────────────
-- Solo admin, y solo mientras el turno siga abierto: el arqueo de un turno
-- cerrado es una cifra de control, y mover un gasto después invalidaría el
-- `difference` ya guardado.
create or replace function public.anular_movimiento_caja(
  p_movimiento_id uuid,
  p_motivo text
) returns public.caja_movimientos
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_usuario uuid := auth.uid();
  v_movimiento public.caja_movimientos;
  v_estado public.estado_caja;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para anular un movimiento';
  end if;

  -- `is distinct from` y no `<>`: si el usuario no tiene fila en `usuarios`,
  -- get_user_rol() devuelve null y la comparación normal daría null, que en un
  -- `if` es falso — es decir, dejaría anular a quien no es nadie.
  if public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede anular un movimiento';
  end if;

  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Indica el motivo de la anulación';
  end if;

  select * into v_movimiento
  from public.caja_movimientos
  where id = p_movimiento_id
  for update;

  if not found then
    raise exception 'El movimiento no existe';
  end if;

  if v_movimiento.anulado_at is not null then
    raise exception 'Este movimiento ya fue anulado';
  end if;

  select status into v_estado
  from public.cash_register_sessions
  where id = v_movimiento.session_id;

  if v_estado <> 'open'::public.estado_caja then
    raise exception 'No se puede anular un movimiento de un turno ya cerrado';
  end if;

  update public.caja_movimientos
  set anulado_at = now(),
      anulado_por = v_usuario,
      motivo_anulacion = trim(p_motivo)
  where id = p_movimiento_id
  returning * into v_movimiento;

  return v_movimiento;
end;
$$;

grant execute on function public.anular_movimiento_caja(uuid, text) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Sin políticas de INSERT/UPDATE/DELETE: la única vía de escritura son los dos
-- RPC de arriba, para que la validación de efectivo disponible y el permiso de
-- anulación no se puedan esquivar desde el navegador.
alter table public.caja_movimientos enable row level security;

drop policy if exists "autenticados_select_caja_movimientos" on public.caja_movimientos;
create policy "autenticados_select_caja_movimientos" on public.caja_movimientos
  for select using (auth.uid() is not null);

grant select on public.caja_movimientos to authenticated;

-- ── El resumen del turno incluye los gastos ─────────────────────────────────
-- Los gastos no se pueden agregar en el mismo left join que las ventas: serían
-- dos filas por cada combinación y ambos totales saldrían multiplicados. Cada
-- lado se agrega por separado y se cruza por sesión.
drop view if exists public.caja_sesiones_resumen;
create view public.caja_sesiones_resumen
with (security_invoker = on) as
  select
    s.id as session_id,
    coalesce(v.total_efectivo, 0) as total_efectivo,
    coalesce(v.total_transferencia, 0) as total_transferencia,
    coalesce(v.total_tarjeta, 0) as total_tarjeta,
    coalesce(v.total_cobrado, 0) as total_cobrado,
    coalesce(v.num_pagos, 0) as num_pagos,
    coalesce(g.total_gastos_efectivo, 0) as total_gastos_efectivo,
    coalesce(g.total_gastos, 0) as total_gastos,
    coalesce(g.num_gastos, 0) as num_gastos,
    -- Lo que debería quedar en el cajón: el mismo cálculo que hace cerrar_caja.
    s.opening_amount + coalesce(v.total_efectivo, 0) - coalesce(g.total_gastos_efectivo, 0) as neto_efectivo
  from public.cash_register_sessions s
  left join (
    select
      session_id,
      sum(monto) filter (where metodo_pago = 'efectivo') as total_efectivo,
      sum(monto) filter (where metodo_pago = 'transferencia') as total_transferencia,
      sum(monto) filter (where metodo_pago = 'tarjeta') as total_tarjeta,
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

-- ── El cierre descuenta los gastos en efectivo ──────────────────────────────
-- Único cambio de fondo respecto a 20260822190000_reportes_caja.sql: el
-- esperado deja de ser `fondo + ventas` y pasa a ser `fondo + ventas - gastos`.
-- El resto (lock, estado, closed_by desde auth.uid()) se conserva igual.
create or replace function public.cerrar_caja(
  p_session_id uuid,
  p_counted_amount numeric
) returns public.cash_register_sessions
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_sesion public.cash_register_sessions;
  v_efectivo numeric;
  v_gastos numeric;
  v_esperado numeric;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para cerrar la caja';
  end if;

  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'El conteo físico no puede ser negativo';
  end if;

  select * into v_sesion
  from public.cash_register_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'La sesión de caja no existe';
  end if;

  if v_sesion.status <> 'open'::public.estado_caja then
    raise exception 'Esta caja ya fue cerrada';
  end if;

  select coalesce(sum(monto), 0) into v_efectivo
  from public.ventas
  where session_id = p_session_id and metodo_pago = 'efectivo';

  -- Los gastos anulados no salieron del cajón: no cuentan.
  select coalesce(sum(monto), 0) into v_gastos
  from public.caja_movimientos
  where session_id = p_session_id
    and metodo_pago = 'efectivo'
    and anulado_at is null;

  v_esperado := v_sesion.opening_amount + v_efectivo - v_gastos;

  update public.cash_register_sessions
  set closed_at = now(),
      closed_by = auth.uid(),
      expected_amount = v_esperado,
      counted_amount = p_counted_amount,
      difference = p_counted_amount - v_esperado,
      status = 'closed'::public.estado_caja
  where id = p_session_id
  returning * into v_sesion;

  return v_sesion;
end;
$$;
