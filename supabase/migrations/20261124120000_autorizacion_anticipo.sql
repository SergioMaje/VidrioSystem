-- Autorización de un anticipo menor al 50%: la da quien registra el cobro.
--
-- Antes, validar_pago_cotizacion solo comprobaba que `autorizado_por` fuera
-- algún admin de la empresa. Como ese id llega del cliente (RPC
-- registrar_anticipo_cotizacion o INSERT directo en ventas), un vendedor podía
-- poner el id del admin y cobrar un anticipo bajo "autorizado" por él.
--
-- Ahora, con un usuario en sesión, autorizado_por tiene que ser ese mismo
-- usuario (y además admin). Es lo que ya hace la interfaz: solo un admin
-- autoriza y envía su propio id (RegistrarPagoDialog). Sin sesión (migraciones,
-- service_role) no cambia nada, como en cotizaciones_proteger_credito.
--
-- Mismo cuerpo que 20261118120000_credito_clientes.sql; solo cambia el bloque
-- del anticipo bajo el mínimo.
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
    if auth.uid() is not null and new.autorizado_por is distinct from auth.uid() then
      raise exception 'Solo el administrador que registra el cobro puede autorizar un anticipo menor al 50%%';
    end if;
    if (select rol from public.usuarios where id = new.autorizado_por and empresa_id = new.empresa_id) is distinct from 'admin'::rol_usuario then
      raise exception 'Solo un administrador puede autorizar un anticipo menor al 50%%';
    end if;
  end if;

  return new;
end $function$;
