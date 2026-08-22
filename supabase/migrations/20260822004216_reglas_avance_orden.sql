-- Reglas de avance de la orden de producción.
--
-- El negocio funciona así: el cliente entrega el anticipo (mínimo 50%), con eso
-- arranca la producción, y tiene plazo hasta el día de la entrega para abonar el
-- resto. Sin saldo en cero no se entrega.
--
-- Hasta ahora la primera mitad de esa regla se cumplía solo por efecto colateral
-- (la orden se creaba junto con el anticipo, desde el front). Nada impedía poner
-- en producción una orden impaga, y de hecho hay órdenes creadas por un flujo
-- anterior que nunca cobraron nada. Ambas reglas pasan a vivir en la base.

-- ── 1. El anticipo mínimo, definido una sola vez ────────────────────────────
-- Estaba duplicado entre el trigger y el front (src/lib/pagos.ts), y ese
-- desajuste de redondeo fue justo lo que rechazaba los pagos del botón "50%".

create or replace function public.anticipo_minimo(p_total numeric)
returns numeric language sql immutable set search_path = public as $$
  select round(p_total * 0.5)
$$;

-- Tolerancia de $1 por el redondeo del IVA, igual que `cumpleAnticipoMinimo`.
create or replace function public.cumple_anticipo_minimo(p_abonado numeric, p_total numeric)
returns boolean language sql immutable set search_path = public as $$
  select p_abonado + 1 >= public.anticipo_minimo(p_total)
$$;

-- ── 2. Reglas de cobro, ahora sobre las funciones compartidas ───────────────
-- El `for update` sobre la cotización serializa inserts concurrentes: sin él,
-- dos pagos simultáneos podrían leer el mismo abonado y sobrepasar el total.

create or replace function public.validar_pago_cotizacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_abonado numeric;
begin
  select total into v_total from public.cotizaciones where id = new.cotizacion_id for update;
  if v_total is null then
    raise exception 'Cotización no encontrada';
  end if;

  if (select status from public.cash_register_sessions where id = new.session_id) <> 'open' then
    raise exception 'La sesión de caja está cerrada';
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

-- ── 3. Avance de la orden: producir exige anticipo, entregar exige saldo cero ─
-- Sustituye a validar_entrega_orden: las dos reglas del ciclo de la orden en un
-- solo lugar. Las órdenes sin cotización asociada quedan exentas, como antes.

create or replace function public.validar_avance_orden()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_abonado numeric;
  v_saldo numeric;
begin
  if new.cotizacion_id is null then
    return new;
  end if;

  if new.estado = 'en_produccion' and old.estado is distinct from 'en_produccion' then
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
      raise exception 'No se puede entregar: la cotización tiene un saldo pendiente de %', v_saldo;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists ordenes_validar_entrega on public.ordenes_trabajo;
drop function if exists public.validar_entrega_orden();

drop trigger if exists ordenes_validar_avance on public.ordenes_trabajo;
create trigger ordenes_validar_avance before update on public.ordenes_trabajo
  for each row execute function public.validar_avance_orden();
