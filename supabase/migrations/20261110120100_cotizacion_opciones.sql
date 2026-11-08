-- Opciones de cotización, paso 2 de 2.
--
-- Un mismo envío puede llevar varias opciones (p. ej. vidrio de 4 mm o templado
-- de 5 mm) para que el cliente elija la que le convenga. Cada opción es una
-- cotización normal, con su número, sus ítems y su total, enlazada a las demás
-- por `grupo_id`. Así el cobro, el saldo, la orden de trabajo, la anulación y la
-- producción siguen funcionando por cotización, sin cambios.
--
-- Al cobrar el anticipo de una opción, las demás del grupo pasan solas a
-- 'descartada', en la misma transacción del cobro.

-- ── 1. Columnas ─────────────────────────────────────────────────────────────

alter table public.cotizaciones
  add column if not exists grupo_id        uuid,
  add column if not exists opcion_etiqueta text,
  add column if not exists opcion_nombre   text;

comment on column public.cotizaciones.grupo_id is
  'Envío al que pertenece la opción. Null en una cotización suelta.';
comment on column public.cotizaciones.opcion_etiqueta is
  'Letra de la opción dentro del envío (A, B, C…). Null en una cotización suelta.';
comment on column public.cotizaciones.opcion_nombre is
  'Nombre corto de la opción para el cliente (p. ej. "Templado 5 mm"). Opcional.';

-- Una opción tiene grupo y letra; una suelta, ninguno de los dos ni nombre.
alter table public.cotizaciones drop constraint if exists cotizaciones_opcion_completa;
alter table public.cotizaciones add constraint cotizaciones_opcion_completa
  check (
    (grupo_id is null and opcion_etiqueta is null and opcion_nombre is null)
    or (grupo_id is not null and opcion_etiqueta is not null)
  );

alter table public.cotizaciones drop constraint if exists cotizaciones_opcion_etiqueta_formato;
alter table public.cotizaciones add constraint cotizaciones_opcion_etiqueta_formato
  check (opcion_etiqueta is null or opcion_etiqueta ~ '^[A-Z]$');

-- Una letra por opción dentro del envío.
create unique index if not exists cotizaciones_grupo_etiqueta_unica
  on public.cotizaciones (grupo_id, opcion_etiqueta)
  where grupo_id is not null;

-- ── 2. No se cobra sobre una opción descartada ──────────────────────────────
-- Se amplía el trigger que ya rechaza los cobros sobre una anulada. Cubre el
-- RPC del anticipo y el insert directo de los abonos.
create or replace function public.ventas_rechazar_cotizacion_anulada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_numero text;
  v_estado public.estado_cotizacion;
begin
  if new.cotizacion_id is null then
    return new;
  end if;

  select numero, estado into v_numero, v_estado from public.cotizaciones
   where id = new.cotizacion_id
     and estado in ('anulada'::public.estado_cotizacion, 'descartada'::public.estado_cotizacion);
  if found then
    if v_estado = 'anulada'::public.estado_cotizacion then
      raise exception 'La cotización % está anulada: no se le pueden registrar cobros', v_numero;
    end if;
    raise exception 'La cotización % está descartada: el cliente eligió otra opción del envío', v_numero;
  end if;

  return new;
end;
$$;

revoke execute on function public.ventas_rechazar_cotizacion_anulada() from public, anon, authenticated;

-- ── 3. registrar_anticipo_cotizacion descarta las demás opciones ────────────
-- Mismo cuerpo que 20261106120100_anulacion_ventas.sql, con dos agregados:
-- el bloqueo del grupo antes de cobrar y el descarte de las hermanas después.
create or replace function public.registrar_anticipo_cotizacion(
  p_cotizacion_id         uuid,
  p_metodo_pago           public.metodo_pago_venta,
  p_monto                 numeric,
  p_fecha_entrega         date default null,
  p_autorizado_por        uuid default null,
  p_motivo_autorizacion   text default null,
  p_financiera_id         uuid default null,
  p_referencia_financiera text default null,
  p_idempotency_key       uuid default null
) returns public.ordenes_trabajo
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_empresa uuid := public.current_empresa_id();
  v_session uuid;
  v_cot     public.cotizaciones;
  v_previa  public.ventas;
  v_abonado numeric;
  v_orden   public.ordenes_trabajo;
  v_tipo    public.tipo_pago;
  v_grupo   uuid;
  v_elegida public.cotizaciones;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar un anticipo';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El anticipo debe ser mayor a cero';
  end if;

  -- Si la cotización es una opción de un envío, se bloquea el grupo completo y
  -- siempre en el mismo orden (por id): dos cobros simultáneos sobre opciones
  -- distintas del mismo envío se serializan aquí en lugar de cruzarse.
  select grupo_id into v_grupo from public.cotizaciones
   where id = p_cotizacion_id and empresa_id = v_empresa;
  if v_grupo is not null then
    perform 1 from public.cotizaciones
     where grupo_id = v_grupo and empresa_id = v_empresa
     order by id
     for update;
  end if;

  -- El `for update` serializa contra otro cobro simultaneo sobre la misma
  -- cotizacion. Va antes de mirar la clave y los cobros existentes: el segundo
  -- clic espera aquí y, al seguir, ya ve el cobro del primero.
  select * into v_cot from public.cotizaciones
   where id = p_cotizacion_id and empresa_id = v_empresa
   for update;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;

  -- Reintento de la misma petición: el cobro ya entró, se devuelve su orden
  -- sin cobrar otra vez.
  if p_idempotency_key is not null then
    select * into v_previa from public.ventas
     where empresa_id = v_empresa and idempotency_key = p_idempotency_key;
    if found then
      if v_previa.cotizacion_id is distinct from p_cotizacion_id then
        raise exception 'La clave de idempotencia ya se usó en otro cobro';
      end if;
      select * into v_orden from public.ordenes_trabajo
       where cotizacion_id = p_cotizacion_id and empresa_id = v_empresa
       order by (estado = 'cancelada'), created_at desc
       limit 1;
      return v_orden;
    end if;
  end if;

  -- El cliente elige una sola opción del envío.
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

  select coalesce(sum(monto), 0) into v_abonado
    from public.ventas
   where cotizacion_id = p_cotizacion_id and anulado_at is null;

  -- Esto evita el duplicado del 05/11/2026: convertir es el primer cobro, y los
  -- siguientes son abonos.
  if v_abonado > 0 then
    raise exception 'La cotización % ya fue convertida en venta (tiene cobros por %). Para cobrar el saldo usa "Registrar abono".',
      v_cot.numero, v_abonado;
  end if;

  select id into v_session from public.cash_register_sessions
   where status = 'open' and empresa_id = v_empresa;
  if v_session is null then
    raise exception 'Debes abrir caja antes de registrar el anticipo';
  end if;

  -- El crédito liquida la venta de una vez: no es un anticipo.
  v_tipo := case
    when p_metodo_pago = 'financiera' then 'contado'::public.tipo_pago
    else public.tipo_de_pago(v_abonado, p_monto, v_cot.total)
  end;

  -- El insert dispara validar_pago_cotizacion, que comprueba saldo, caja
  -- abierta, anticipo minimo y las reglas de financiera. Aqui no se replica.
  insert into public.ventas
    (cotizacion_id, session_id, metodo_pago, monto, tipo, autorizado_por,
     motivo_autorizacion, usuario_id, financiera_id, referencia_financiera,
     idempotency_key)
  values
    (p_cotizacion_id, v_session, p_metodo_pago, p_monto, v_tipo,
     p_autorizado_por,
     nullif(btrim(coalesce(p_motivo_autorizacion, '')), ''),
     v_usuario, p_financiera_id, p_referencia_financiera,
     p_idempotency_key);

  -- Se guarda de dónde venía la cotización para poder devolverla ahí si se
  -- anula este cobro. Si ya estaba 'vendida' (una venta anulada antes que no
  -- se devolvió), se conserva el previo que hubiera.
  update public.cotizaciones
     set estado_previo_venta = case
           when estado = 'vendida' then estado_previo_venta
           else estado
         end,
         estado = 'vendida',
         fecha_aprobacion = coalesce(fecha_aprobacion, now())
   where id = p_cotizacion_id;

  -- Las demás opciones del envío quedan descartadas. Las rechazadas y las ya
  -- descartadas se dejan como están.
  if v_cot.grupo_id is not null then
    update public.cotizaciones
       set estado = 'descartada'
     where grupo_id = v_cot.grupo_id and empresa_id = v_empresa
       and id <> v_cot.id
       and estado in ('borrador', 'enviada', 'vencida', 'aprobada');
  end if;

  -- La orden viva de la cotización. Si solo hay una cancelada (su venta se
  -- anuló antes), se reactiva en lugar de crear otra.
  select * into v_orden from public.ordenes_trabajo
   where cotizacion_id = p_cotizacion_id and empresa_id = v_empresa
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
     p_cotizacion_id, v_cot.cliente_id, 'pendiente', p_fecha_entrega, v_cot.notas)
  returning * into v_orden;

  return v_orden;
end;
$function$;

revoke execute on function public.registrar_anticipo_cotizacion(
  uuid, public.metodo_pago_venta, numeric, date, uuid, text, uuid, text, uuid
) from public, anon;
grant execute on function public.registrar_anticipo_cotizacion(
  uuid, public.metodo_pago_venta, numeric, date, uuid, text, uuid, text, uuid
) to authenticated;
