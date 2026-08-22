-- Reportes y caja: lectura de usuarios, resumen por sesión y cierre en servidor.

-- ── 1. Lectura de `usuarios` para autenticados ──────────────────────────────
-- La única política SELECT era `usuario_select_propio (auth.uid() = id)`, así que
-- cualquier embed a `usuarios` devolvía null para registros de otra persona: las
-- columnas Vendedor (Ingresos) y Abrió/Cerró (Caja) salían siempre en "—".
-- La escritura sigue restringida a la propia fila.
drop policy if exists "autenticados_select_usuarios" on public.usuarios;
create policy "autenticados_select_usuarios" on public.usuarios
  for select using (auth.uid() is not null);

-- ── 2. Resumen de cada turno de caja ────────────────────────────────────────
-- `expected_amount` solo cubre el efectivo, así que un turno que cobró millones
-- por transferencia se veía idéntico a uno vacío. Esta vista da el movimiento
-- completo del turno. security_invoker: respeta las RLS de quien consulta.
create or replace view public.caja_sesiones_resumen
with (security_invoker = on) as
  select
    s.id as session_id,
    coalesce(sum(v.monto) filter (where v.metodo_pago = 'efectivo'), 0) as total_efectivo,
    coalesce(sum(v.monto) filter (where v.metodo_pago = 'transferencia'), 0) as total_transferencia,
    coalesce(sum(v.monto) filter (where v.metodo_pago = 'tarjeta'), 0) as total_tarjeta,
    coalesce(sum(v.monto), 0) as total_cobrado,
    count(v.id) as num_pagos
  from public.cash_register_sessions s
  left join public.ventas v on v.session_id = s.id
  group by s.id;

-- ── 3. Cierre de caja calculado en el servidor ──────────────────────────────
-- Antes el navegador calculaba `expected_amount` y `difference` y los mandaba en
-- un UPDATE: era la única regla de dinero sin validar en Postgres (comparar con
-- el trigger `ventas_validar_pago`).
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

  v_esperado := v_sesion.opening_amount + v_efectivo;

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

grant execute on function public.cerrar_caja(uuid, numeric) to authenticated;

-- El cierre solo puede entrar por el RPC: un UPDATE directo ya no puede sacar a
-- una sesión del estado 'open' ni inventarse el arqueo.
drop policy if exists "autenticados_update_caja" on public.cash_register_sessions;
create policy "autenticados_update_caja" on public.cash_register_sessions
  for update
  using (auth.uid() is not null and status = 'open'::public.estado_caja)
  with check (status = 'open'::public.estado_caja);
