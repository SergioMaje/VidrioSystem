-- Registrar el anticipo de forma atomica.
--
-- useRegistrarAnticipo eran cuatro llamadas HTTP sueltas, y la primera movia
-- dinero: insert en ventas, update de la cotizacion a 'vendida', buscar orden,
-- crear orden. Sin una transaccion que las una, cualquier fallo despues de la
-- primera dejaba el pago cobrado y la cotizacion sin aprobar ni producir.
--
-- El 31/08/2026 paso en produccion: el update fallo con 400 porque la columna
-- fecha_aprobacion aun no existia en la base, y COT-1788194686608 quedo en
-- 'enviada' con 150.000 ya cobrados y sin orden de trabajo. Al reintentar, el
-- trigger rechazaba el cobro por exceder el saldo, y la UI no sabia por que.
--
-- Se sigue el patron de registrar_venta_mostrador: una sola funcion security
-- definer, todo en la misma transaccion. O entra todo o no entra nada.

-- ── 1. El tipo de pago, definido una sola vez ───────────────────────────────
-- Espejo en SQL de tipoDePago() en src/lib/pagos.ts, en la misma linea que
-- anticipo_minimo(): la regla vive en la base para que se decida dentro de la
-- transaccion, con el abonado ya bloqueado, y no con el que vio el navegador.

create or replace function public.tipo_de_pago(
  p_abonado numeric,
  p_monto   numeric,
  p_total   numeric
) returns public.tipo_pago
language sql immutable set search_path = public as $$
  -- La tolerancia de $1 es la misma que usan cumple_anticipo_minimo() y el
  -- trigger de saldo, por el redondeo del IVA.
  select case
    when p_abonado <= 0                        then 'anticipo'::public.tipo_pago
    when p_abonado + p_monto + 1 >= p_total    then 'saldo_final'::public.tipo_pago
    else                                            'abono'::public.tipo_pago
  end
$$;

-- ── 2. El anticipo, en una sola transaccion ─────────────────────────────────

create or replace function public.registrar_anticipo_cotizacion(
  p_cotizacion_id       uuid,
  p_metodo_pago         public.metodo_pago_venta,
  p_monto               numeric,
  p_fecha_entrega       date default null,
  p_autorizado_por      uuid default null,
  p_motivo_autorizacion text default null
) returns public.ordenes_trabajo
language plpgsql security definer set search_path = public as $$
declare
  v_usuario uuid := auth.uid();
  v_session uuid;
  v_cot     public.cotizaciones;
  v_abonado numeric;
  v_orden   public.ordenes_trabajo;
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

  -- Se lee dentro del lock, no desde la pantalla: una cotizacion que ya tenga
  -- abonos y siga sin aprobar (el estado que dejaba el bug viejo) recibe aqui
  -- el tipo correcto en vez de otro 'anticipo' duplicado.
  select coalesce(sum(monto), 0) into v_abonado
    from public.ventas where cotizacion_id = p_cotizacion_id;

  -- El insert dispara validar_pago_cotizacion, que comprueba saldo, caja
  -- abierta y anticipo minimo. Esa es la garantia: aqui no se replica.
  insert into public.ventas
    (cotizacion_id, session_id, metodo_pago, monto, tipo, autorizado_por,
     motivo_autorizacion, usuario_id)
  values
    (p_cotizacion_id, v_session, p_metodo_pago, p_monto,
     public.tipo_de_pago(v_abonado, p_monto, v_cot.total),
     p_autorizado_por,
     nullif(btrim(coalesce(p_motivo_autorizacion, '')), ''),
     v_usuario);

  -- coalesce: si la cotizacion ya estaba aprobada se respeta su fecha original
  -- en vez de pisarla con la de este cobro.
  update public.cotizaciones
     set estado = 'vendida',
         fecha_aprobacion = coalesce(fecha_aprobacion, now())
   where id = p_cotizacion_id;

  -- Un flujo anterior creaba la orden al aprobar, antes de cobrar nada: esas
  -- cotizaciones llegan aqui con orden ya existente y no debe duplicarse.
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

grant execute on function public.tipo_de_pago(numeric, numeric, numeric) to authenticated;
grant execute on function public.registrar_anticipo_cotizacion(
  uuid, public.metodo_pago_venta, numeric, date, uuid, text
) to authenticated;
