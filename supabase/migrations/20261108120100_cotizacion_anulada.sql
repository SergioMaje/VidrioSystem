-- Cotización anulada, paso 2 de 2.
--
-- Hasta ahora solo se anulaba un cobro (anular_venta, 20261106120100). Si se
-- anulaba el último, la cotización volvía a 'aprobada' y se podía vender otra
-- vez: no quedaba asentado que el negocio se cayó.
--
-- anular_cotizacion anula de una vez todos los cobros activos de una cotización
-- vendida y la deja en 'anulada', un estado final. Por dentro llama a
-- anular_venta por cada cobro, así que los reversos de caja, las reglas de
-- financiera, el chequeo de efectivo y la cancelación de la orden son los
-- mismos. Todo corre en una transacción: si un cobro no se puede anular, no se
-- anula ninguno.
--
-- El tipo de anulación responde la pregunta "¿sale efectivo del cajón hoy?"
-- para los cobros en efectivo de cajas ya cerradas:
--   * 'desistimiento': el cliente desistió y se le devuelve el dinero;
--   * 'error': cobro o cotización duplicada, ese dinero nunca entró.
-- Los cobros de la caja que sigue abierta siempre corrigen el esperado.
--
-- Anular un cobro suelto (el duplicado dentro de una cotización válida) sigue
-- siendo anular_venta.

-- ── 1. Columnas ─────────────────────────────────────────────────────────────

alter table public.cotizaciones
  add column if not exists anulado_at       timestamptz,
  add column if not exists anulado_por      uuid,
  add column if not exists motivo_anulacion text,
  add column if not exists tipo_anulacion   text;

alter table public.cotizaciones drop constraint if exists cotizaciones_anulado_por_fkey;
alter table public.cotizaciones add constraint cotizaciones_anulado_por_fkey
  foreign key (anulado_por) references public.usuarios(id);

alter table public.cotizaciones drop constraint if exists cotizaciones_tipo_anulacion_check;
alter table public.cotizaciones add constraint cotizaciones_tipo_anulacion_check
  check (tipo_anulacion in ('desistimiento', 'error'));

-- Una cotización anulada tiene todos sus datos de anulación, y solo ella.
alter table public.cotizaciones drop constraint if exists cotizaciones_anulada_completa;
alter table public.cotizaciones add constraint cotizaciones_anulada_completa
  check (
    (estado = 'anulada'::public.estado_cotizacion)
      = (anulado_at is not null and anulado_por is not null
         and motivo_anulacion is not null and tipo_anulacion is not null)
  );

comment on column public.cotizaciones.tipo_anulacion is
  'desistimiento: el cliente desistió y se le devolvió el dinero. error: cobro o cotización duplicada, el dinero nunca entró.';

-- ── 2. Una cotización anulada no se toca ────────────────────────────────────
-- useCambiarEstadoCotizacion actualiza el estado directo desde el navegador, así
-- que el paso a 'anulada' se protege aquí: solo lo permite anular_cotizacion,
-- que enciende la flag local `glazz.anulando_cotizacion` en su transacción.
create or replace function public.cotizaciones_proteger_anulada()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    if old.estado = 'anulada'::public.estado_cotizacion then
      raise exception 'La cotización % está anulada y no se puede borrar', old.numero;
    end if;
    return old;
  end if;

  if old.estado = 'anulada'::public.estado_cotizacion then
    raise exception 'La cotización % está anulada y no se puede modificar', old.numero;
  end if;

  if new.estado = 'anulada'::public.estado_cotizacion
     and current_setting('glazz.anulando_cotizacion', true) is distinct from 'on' then
    raise exception 'Una cotización solo se anula con "Anular cotización"';
  end if;

  return new;
end;
$$;

drop trigger if exists cotizaciones_proteger_anulada on public.cotizaciones;
create trigger cotizaciones_proteger_anulada
  before update or delete on public.cotizaciones
  for each row execute function public.cotizaciones_proteger_anulada();

-- ── 3. No se cobra sobre una cotización anulada ─────────────────────────────
-- Trigger aparte de validar_pago_cotizacion para no reescribir su cuerpo. Cubre
-- registrar_anticipo_cotizacion y el insert directo de los abonos. Los
-- triggers BEFORE corren por orden alfabético: este va antes de
-- ventas_validar_pago.
create or replace function public.ventas_rechazar_cotizacion_anulada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_numero text;
begin
  if new.cotizacion_id is null then
    return new;
  end if;

  select numero into v_numero from public.cotizaciones
   where id = new.cotizacion_id and estado = 'anulada'::public.estado_cotizacion;
  if found then
    raise exception 'La cotización % está anulada: no se le pueden registrar cobros', v_numero;
  end if;

  return new;
end;
$$;

revoke execute on function public.ventas_rechazar_cotizacion_anulada() from public, anon, authenticated;

drop trigger if exists ventas_cotizacion_no_anulada on public.ventas;
create trigger ventas_cotizacion_no_anulada
  before insert on public.ventas
  for each row execute function public.ventas_rechazar_cotizacion_anulada();

-- ── 4. anular_cotizacion ────────────────────────────────────────────────────
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

  -- ── Validaciones de la orden, con mensajes de cotización ──
  -- anular_venta las repite en el último cobro; aquí van primero para que el
  -- mensaje hable de la cotización y no de "su único cobro".
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
  -- El último en anularse (el anticipo) es el que cancela la orden y devuelve
  -- la cotización a su estado previo; enseguida se pasa a 'anulada'.
  for v_venta in
    select * from public.ventas
     where cotizacion_id = v_cot.id and anulado_at is null
     order by created_at desc, id desc
  loop
    perform public.anular_venta(v_venta.id, v_motivo, p_tipo = 'desistimiento');
    v_cobros := v_cobros + 1;
  end loop;

  if v_cobros = 0 then
    raise exception 'La cotización % no tiene cobros activos: no hay nada que anular', v_cot.numero;
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
