-- Observación del cierre de caja.
--
-- Si el conteo físico se aleja del esperado más allá de la tolerancia, el
-- cierre exige una explicación y la guarda con el turno. El cálculo del arqueo
-- no cambia: es el mismo cuerpo de 20261106120100_anulacion_ventas.sql.

alter table public.cash_register_sessions
  add column if not exists observacion_cierre text;

comment on column public.cash_register_sessions.observacion_cierre is
  'Explicación del cajero al cerrar. Obligatoria si |difference| supera la tolerancia de cerrar_caja.';

-- La firma cambia (parámetro nuevo), así que se reemplaza en vez de sobrecargar:
-- con las dos versiones vivas, PostgREST no sabría a cuál llamar.
drop function if exists public.cerrar_caja(uuid, numeric);

create function public.cerrar_caja(
  p_session_id uuid,
  p_counted_amount numeric,
  p_observacion text default null
)
 returns cash_register_sessions
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  -- Espejo de TOLERANCIA_CAJA en src/lib/caja.ts: si cambia aquí, cambia allá.
  v_tolerancia constant numeric := 2000;
  v_sesion public.cash_register_sessions;
  v_efectivo numeric;
  v_egresos numeric;
  v_esperado numeric;
  v_observacion text := nullif(btrim(p_observacion), '');
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para cerrar la caja';
  end if;

  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'El conteo físico no puede ser negativo';
  end if;

  select * into v_sesion
  from public.cash_register_sessions
  where id = p_session_id and empresa_id = public.current_empresa_id()
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

  -- Gastos y reversos de anulación. Los gastos anulados no salieron del cajón,
  -- y un reverso sin salida de efectivo tampoco.
  select coalesce(sum(monto), 0) into v_egresos
  from public.caja_movimientos
  where session_id = p_session_id
    and metodo_pago = 'efectivo'
    and anulado_at is null
    and afecta_efectivo;

  v_esperado := v_sesion.opening_amount + v_efectivo - v_egresos;

  if abs(p_counted_amount - v_esperado) > v_tolerancia and v_observacion is null then
    raise exception 'La diferencia supera la tolerancia de $%: escribe una observación para cerrar la caja',
      to_char(v_tolerancia, 'FM999G999G999');
  end if;

  update public.cash_register_sessions
  set closed_at = now(),
      closed_by = auth.uid(),
      expected_amount = v_esperado,
      counted_amount = p_counted_amount,
      difference = p_counted_amount - v_esperado,
      observacion_cierre = v_observacion,
      status = 'closed'::public.estado_caja
  where id = p_session_id
  returning * into v_sesion;

  return v_sesion;
end;
$function$;

revoke execute on function public.cerrar_caja(uuid, numeric, text) from public, anon;
grant execute on function public.cerrar_caja(uuid, numeric, text) to authenticated;
