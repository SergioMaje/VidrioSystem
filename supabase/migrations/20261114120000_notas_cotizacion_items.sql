-- Notas por producto que sí ve el cliente.
--
-- `cotizacion_items.notas` guarda las especificaciones del producto, que son
-- para producción y salen solo en la orden. `notas_cotizacion` es aparte:
-- lo que la vidriería le quiere decir al cliente sobre ese producto (incluye
-- instalación, tiempo de entrega…), y sale en la cotización.

alter table public.cotizacion_items add column notas_cotizacion text;

comment on column public.cotizacion_items.notas is
  'Especificaciones del producto para producción. Salen en la orden, no en la cotización.';
comment on column public.cotizacion_items.notas_cotizacion is
  'Notas del producto para el cliente. Salen en la cotización.';

-- consolidar_eleccion_envio copia los ítems de las opciones elegidas al pedido:
-- se redefine igual que en 20261112120000_envio_categorias.sql, sumando la
-- columna nueva para que el pedido conserve las notas.
create or replace function public.consolidar_eleccion_envio(
  p_grupo_id uuid,
  p_opciones uuid[]
) returns public.cotizaciones
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario  uuid := auth.uid();
  v_empresa  uuid := public.current_empresa_id();
  v_elegidas public.cotizaciones[];
  v_primera  public.cotizaciones;
  v_previo   public.cotizaciones;
  v_mal      public.cotizaciones;
  v_cantidad integer;
  v_subtotal numeric;
  v_base     numeric;
  v_pedido   public.cotizaciones;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar la elección del cliente';
  end if;

  if p_grupo_id is null then
    raise exception 'Falta el envío';
  end if;

  v_cantidad := coalesce(cardinality(array(select distinct unnest(p_opciones))), 0);
  if v_cantidad = 0 then
    raise exception 'El cliente debe elegir al menos una opción';
  end if;
  if v_cantidad <> cardinality(p_opciones) then
    raise exception 'Hay opciones repetidas en la elección';
  end if;

  -- Mismo bloqueo que registrar_anticipo_cotizacion: el grupo completo, por id.
  perform 1 from public.cotizaciones
   where grupo_id = p_grupo_id and empresa_id = v_empresa
   order by id
   for update;
  if not found then
    raise exception 'Envío no encontrado';
  end if;

  select * into v_previo from public.cotizaciones
   where grupo_id = p_grupo_id and empresa_id = v_empresa and pedido_id is not null
   limit 1;
  if found then
    select * into v_previo from public.cotizaciones where id = v_previo.pedido_id;
    raise exception 'El cliente ya eligió en este envío: pedido %', v_previo.numero;
  end if;

  select * into v_previo from public.cotizaciones
   where grupo_id = p_grupo_id and empresa_id = v_empresa and estado = 'vendida'
   limit 1;
  if found then
    raise exception 'El envío ya tiene una opción vendida (%)', v_previo.numero;
  end if;

  select array_agg(c order by cat.orden, c.opcion_etiqueta) into v_elegidas
    from public.cotizaciones c
    left join public.envio_categorias cat on cat.id = c.categoria_id
   where c.id = any(p_opciones) and c.grupo_id = p_grupo_id and c.empresa_id = v_empresa;

  if coalesce(cardinality(v_elegidas), 0) <> v_cantidad then
    raise exception 'Alguna de las opciones elegidas no pertenece a este envío';
  end if;

  select * into v_mal from unnest(v_elegidas) e where e.categoria_id is null limit 1;
  if found then
    raise exception 'El envío no está dividido por categorías: cobra directamente la opción elegida';
  end if;

  select * into v_mal from unnest(v_elegidas) e where e.estado <> 'enviada' limit 1;
  if found then
    raise exception 'La opción % no está enviada (estado: %)', v_mal.numero, v_mal.estado;
  end if;

  if (select count(distinct e.categoria_id) from unnest(v_elegidas) e) <> v_cantidad then
    raise exception 'Solo se puede elegir una opción por categoría';
  end if;

  v_primera := v_elegidas[1];
  if exists (
    select 1 from unnest(v_elegidas) e
     where e.descuento_pct is distinct from v_primera.descuento_pct
        or e.iva_pct is distinct from v_primera.iva_pct
        or e.cliente_id is distinct from v_primera.cliente_id
  ) then
    raise exception 'Las opciones elegidas tienen distinto cliente, descuento o IVA: revisa el envío';
  end if;

  -- Misma fórmula que calcularTotales (src/lib/cotizaciones.ts).
  select coalesce(sum(i.precio_total), 0) into v_subtotal
    from public.cotizacion_items i
   where i.cotizacion_id = any(p_opciones);
  v_base := v_subtotal - v_subtotal * (coalesce(v_primera.descuento_pct, 0) / 100);

  insert into public.cotizaciones
    (numero, cliente_id, usuario_id, estado, fecha_emision, fecha_vencimiento,
     subtotal, descuento_pct, iva_pct, total, notas, fecha_aprobacion)
  values
    (regexp_replace(v_primera.numero, '-[0-9]*[A-Z]$', ''),
     v_primera.cliente_id, v_usuario, 'aprobada',
     (now() at time zone 'America/Bogota')::date, v_primera.fecha_vencimiento,
     v_subtotal, v_primera.descuento_pct, v_primera.iva_pct,
     v_base + v_base * (coalesce(v_primera.iva_pct, 0) / 100),
     v_primera.notas, now())
  returning * into v_pedido;

  -- Los ítems, en el orden de las categorías.
  insert into public.cotizacion_items
    (cotizacion_id, plantilla_id, descripcion, ancho_cm, alto_cm, area_m2, cantidad,
     precio_unitario, precio_total, notas, referencia_id, color_perfil, opciones,
     lado_medicion, lado_corredizo, medidas_irregulares, alto_izq_cm, alto_der_cm,
     ancho_sup_cm, ancho_inf_cm, notas_cotizacion)
  select v_pedido.id, i.plantilla_id, i.descripcion, i.ancho_cm, i.alto_cm, i.area_m2, i.cantidad,
         i.precio_unitario, i.precio_total, i.notas, i.referencia_id, i.color_perfil, i.opciones,
         i.lado_medicion, i.lado_corredizo, i.medidas_irregulares, i.alto_izq_cm, i.alto_der_cm,
         i.ancho_sup_cm, i.ancho_inf_cm, i.notas_cotizacion
    from unnest(array(select e.id from unnest(v_elegidas) e)) with ordinality o(cotizacion_id, pos)
    join public.cotizacion_items i on i.cotizacion_id = o.cotizacion_id
   order by o.pos, i.id;

  update public.cotizaciones
     set estado = 'aprobada',
         fecha_aprobacion = coalesce(fecha_aprobacion, now()),
         pedido_id = v_pedido.id
   where id = any(p_opciones);

  -- Lo demás que seguía abierto queda descartado, también las categorías que
  -- el cliente no tomó. Las rechazadas y las anuladas se dejan como están.
  update public.cotizaciones
     set estado = 'descartada',
         pedido_id = v_pedido.id
   where grupo_id = p_grupo_id and empresa_id = v_empresa
     and id <> all(p_opciones)
     and estado in ('borrador', 'enviada', 'vencida', 'aprobada');

  return v_pedido;
end;
$function$;

revoke execute on function public.consolidar_eleccion_envio(uuid, uuid[]) from public, anon;
grant execute on function public.consolidar_eleccion_envio(uuid, uuid[]) to authenticated;
