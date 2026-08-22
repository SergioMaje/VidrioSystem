-- El anticipo mínimo se calculaba distinto en el front y en el trigger.
--
-- El front ofrece como mínimo `round(total * 0.5)` y acepta una tolerancia de $1
-- por el redondeo del IVA; el trigger comparaba contra `total * 0.5` sin
-- redondear ni tolerar nada. Con un total de 467.082,14 el botón "50%" precarga
-- 233.541 y el trigger exigía 233.541,07: el insert se rechazaba con 400 y el
-- cajero no podía cobrar el anticipo de ninguna cotización con decimales.
--
-- Se alinea el trigger con la regla del front (`cumpleAnticipoMinimo` en
-- src/lib/pagos.ts): mínimo redondeado y la misma tolerancia de $1 que ya se
-- aplica al comparar contra el saldo pendiente.

create or replace function public.validar_pago_cotizacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_abonado numeric;
  v_minimo numeric;
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

  v_minimo := round(v_total * 0.5);
  if v_abonado = 0 and new.monto + 1 < v_minimo then
    if new.autorizado_por is null then
      raise exception 'El anticipo debe ser al menos el 50%% del total (mínimo: %)', v_minimo;
    end if;
    if (select rol from public.usuarios where id = new.autorizado_por) <> 'admin'::rol_usuario then
      raise exception 'Solo un administrador puede autorizar un anticipo menor al 50%%';
    end if;
  end if;

  return new;
end $$;
