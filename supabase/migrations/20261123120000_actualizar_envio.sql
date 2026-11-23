-- Editar un envío completo (todas sus opciones y categorías) en una sola
-- transacción.
--
-- Antes, "Editar" abría una sola opción y, si estaba enviada, el resto del envío
-- volvía a borrador con una segunda llamada desde el navegador: si esa fallaba,
-- el envío quedaba a medias. Ahora el formulario manda el envío entero y esta
-- función lo deja como viene, o no cambia nada.
--
-- p_datos:
--   { cliente_id, fecha_vencimiento, notas,
--     categorias: [{ id|null, nombre, tipo, tipo_personalizado_id }],
--     opciones:   [{ id|null, categoria: índice|null, nombre, descuento_pct,
--                    iva_pct, recomendada, items: [ columnas de cotizacion_items ] }] }
--
-- Reglas:
--   - Solo se edita un envío abierto: todas sus opciones vivas en borrador o enviada.
--   - Todo el envío queda en borrador: lo que vio el cliente ya no vale y hay
--     que reenviarlo.
--   - Una opción que ya existía y no viene en p_datos pasa a 'anulada'. Conserva
--     su número, que el cliente pudo haber visto, y su letra no se reutiliza.
--   - Las categorías nuevas van al final (orden siguiente). Nunca se reordenan:
--     el orden forma parte del número (COT-…-2A).
--   - No se divide ni se une un envío ya creado: cambiaría los números.

create or replace function public.actualizar_envio(
  p_cotizacion_id uuid,
  p_datos         jsonb
) returns public.cotizaciones
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario    uuid := auth.uid();
  v_empresa    uuid := public.current_empresa_id();
  v_cot        public.cotizaciones;
  v_mal        public.cotizaciones;
  v_grupo      uuid;
  v_cliente    uuid := nullif(p_datos->>'cliente_id', '')::uuid;
  v_vence      date := nullif(p_datos->>'fecha_vencimiento', '')::date;
  v_notas      text := nullif(btrim(coalesce(p_datos->>'notas', '')), '');
  v_cats_in    jsonb := coalesce(p_datos->'categorias', '[]'::jsonb);
  v_ops_in     jsonb := coalesce(p_datos->'opciones', '[]'::jsonb);
  v_n_cats     int;
  v_n_ops      int;
  v_tenia_cats boolean;
  v_cat_ids    uuid[] := '{}';
  v_cat        jsonb;
  v_cat_id     uuid;
  v_orden      int;
  v_op         jsonb;
  v_op_id      uuid;
  v_op_cat     uuid;
  v_idx        int;
  v_etiqueta   text;
  v_subtotal   numeric;
  v_total      numeric;
  v_abonado    numeric;
  v_desc       numeric;
  v_iva        numeric;
  v_vivas      uuid[] := '{}';
  v_resultado  public.cotizaciones;
begin
  -- ── Permisos y datos ──
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para editar una cotización';
  end if;
  if v_cliente is null then
    raise exception 'Selecciona un cliente';
  end if;
  if v_vence is null then
    raise exception 'Indica la fecha de vencimiento de la cotización';
  end if;
  if jsonb_typeof(v_ops_in) <> 'array' or jsonb_typeof(v_cats_in) <> 'array' then
    raise exception 'Datos del envío inválidos';
  end if;
  v_n_ops := jsonb_array_length(v_ops_in);
  v_n_cats := jsonb_array_length(v_cats_in);
  if v_n_ops = 0 then
    raise exception 'El envío necesita al menos una opción';
  end if;

  select * into v_cot from public.cotizaciones
   where id = p_cotizacion_id and empresa_id = v_empresa;
  if not found then
    raise exception 'La cotización no existe';
  end if;
  v_grupo := v_cot.grupo_id;

  -- ── Bloquear el envío completo y comprobar que sigue abierto ──
  perform 1 from public.cotizaciones
   where empresa_id = v_empresa
     and (id = v_cot.id or (v_grupo is not null and grupo_id = v_grupo))
   order by id
   for update;

  select * into v_mal from public.cotizaciones
   where empresa_id = v_empresa
     and (id = v_cot.id or (v_grupo is not null and grupo_id = v_grupo))
     and estado not in ('borrador', 'enviada', 'anulada')
   limit 1;
  if found then
    raise exception 'El envío ya no se puede editar: la opción % está en estado "%"', v_mal.numero, v_mal.estado;
  end if;
  if v_cot.estado = 'anulada' then
    raise exception 'La cotización % está anulada y no se puede modificar', v_cot.numero;
  end if;

  -- ── Categorías ──
  v_tenia_cats := v_grupo is not null
    and exists (select 1 from public.envio_categorias where grupo_id = v_grupo and empresa_id = v_empresa);
  if v_tenia_cats <> (v_n_cats > 0) then
    raise exception 'No se puede dividir ni unir por categorías un envío ya creado: cambiaría los números que vio el cliente';
  end if;

  for v_idx in 0 .. v_n_cats - 1 loop
    v_cat := v_cats_in->v_idx;
    v_cat_id := nullif(v_cat->>'id', '')::uuid;
    if v_cat_id is not null then
      update public.envio_categorias
         set nombre = btrim(coalesce(v_cat->>'nombre', '')),
             tipo = case when nullif(v_cat->>'tipo_personalizado_id', '') is not null then 'otro'
                         else coalesce(nullif(v_cat->>'tipo', ''), 'otro') end::public.tipo_producto_enum,
             tipo_personalizado_id = nullif(v_cat->>'tipo_personalizado_id', '')::uuid
       where id = v_cat_id and grupo_id = v_grupo and empresa_id = v_empresa;
      if not found then
        raise exception 'Una de las categorías no pertenece a este envío';
      end if;
    else
      select coalesce(max(orden), -1) + 1 into v_orden
        from public.envio_categorias where grupo_id = v_grupo and empresa_id = v_empresa;
      insert into public.envio_categorias (grupo_id, nombre, tipo, tipo_personalizado_id, orden)
      values (
        v_grupo,
        btrim(coalesce(v_cat->>'nombre', '')),
        case when nullif(v_cat->>'tipo_personalizado_id', '') is not null then 'otro'
             else coalesce(nullif(v_cat->>'tipo', ''), 'otro') end::public.tipo_producto_enum,
        nullif(v_cat->>'tipo_personalizado_id', '')::uuid,
        v_orden
      )
      returning id into v_cat_id;
    end if;
    v_cat_ids := v_cat_ids || v_cat_id;
  end loop;

  -- ── Validaciones de las opciones que llegan ──
  for v_idx in 0 .. v_n_ops - 1 loop
    v_op := v_ops_in->v_idx;
    if jsonb_typeof(v_op->'items') is distinct from 'array' or jsonb_array_length(v_op->'items') = 0 then
      raise exception 'Cada opción necesita al menos un producto';
    end if;
    if v_n_cats > 0 then
      if nullif(v_op->>'categoria', '') is null
         or (v_op->>'categoria')::int not between 0 and v_n_cats - 1 then
        raise exception 'Cada opción debe pertenecer a una categoría';
      end if;
    elsif nullif(v_op->>'categoria', '') is not null then
      raise exception 'El envío no está dividido por categorías';
    end if;
  end loop;

  for v_idx in 0 .. v_n_cats - 1 loop
    if not exists (
      select 1 from jsonb_array_elements(v_ops_in) o where (o->>'categoria')::int = v_idx
    ) then
      raise exception 'La categoría "%" no tiene opciones', v_cats_in->v_idx->>'nombre';
    end if;
  end loop;

  -- Una recomendada por categoría (o por envío).
  if exists (
    select 1 from jsonb_array_elements(v_ops_in) o
     where coalesce((o->>'recomendada')::boolean, false)
     group by o->>'categoria' having count(*) > 1
  ) then
    raise exception 'Solo puede haber una opción recomendada por categoría';
  end if;

  -- Con categorías, el descuento y el IVA son del envío: el pedido los suma juntos.
  if v_n_cats > 0 and (
    select count(distinct (coalesce((o->>'descuento_pct')::numeric, 0), coalesce((o->>'iva_pct')::numeric, 0)))
      from jsonb_array_elements(v_ops_in) o
  ) > 1 then
    raise exception 'Con categorías, el descuento y el IVA son los mismos para todo el envío';
  end if;

  -- Una cotización suelta a la que se le agregan opciones pasa a ser la A.
  if v_grupo is null and v_n_ops > 1 then
    v_grupo := gen_random_uuid();
    update public.cotizaciones
       set grupo_id = v_grupo, opcion_etiqueta = 'A'
     where id = v_cot.id;
  end if;

  -- ── Guardar cada opción ──
  for v_idx in 0 .. v_n_ops - 1 loop
    v_op := v_ops_in->v_idx;
    v_op_id := nullif(v_op->>'id', '')::uuid;
    v_op_cat := case when v_n_cats > 0 then v_cat_ids[(v_op->>'categoria')::int + 1] end;
    v_desc := coalesce((v_op->>'descuento_pct')::numeric, 0);
    v_iva := coalesce((v_op->>'iva_pct')::numeric, 0);

    -- Misma fórmula que calcularTotales (src/lib/cotizaciones.ts) y consolidar_eleccion_envio.
    select coalesce(sum((i->>'precio_total')::numeric), 0) into v_subtotal
      from jsonb_array_elements(v_op->'items') i;
    v_total := (v_subtotal - v_subtotal * (v_desc / 100)) * (1 + v_iva / 100);

    if v_op_id is not null then
      if v_op_id = any (v_vivas) then
        raise exception 'Hay opciones repetidas en el envío';
      end if;
      select * into v_mal from public.cotizaciones
       where id = v_op_id and empresa_id = v_empresa
         and (id = v_cot.id or grupo_id = v_grupo);
      if not found then
        raise exception 'Una de las opciones no pertenece a este envío';
      end if;
      if v_mal.estado = 'anulada' then
        raise exception 'La opción % está anulada y no se puede modificar', v_mal.numero;
      end if;
      if v_mal.categoria_id is distinct from v_op_cat then
        raise exception 'La opción % no se puede pasar a otra categoría: cambiaría su número', v_mal.numero;
      end if;

      -- No se deja un total por debajo de lo ya cobrado (saldo negativo).
      select coalesce(total_abonado, 0) into v_abonado
        from public.cotizaciones_saldo where cotizacion_id = v_op_id;
      if coalesce(v_abonado, 0) > 0 and round(v_total, 2) + 1 < v_abonado then
        raise exception 'El nuevo total de % es menor que lo ya cobrado. Devuelve la diferencia antes de reducir la cotización.', v_mal.numero;
      end if;

      update public.cotizaciones
         set cliente_id = v_cliente,
             estado = 'borrador',
             fecha_vencimiento = v_vence,
             notas = v_notas,
             subtotal = v_subtotal,
             descuento_pct = v_desc,
             iva_pct = v_iva,
             total = v_total,
             opcion_nombre = case when grupo_id is not null then nullif(btrim(coalesce(v_op->>'nombre', '')), '') end,
             recomendada = grupo_id is not null and coalesce((v_op->>'recomendada')::boolean, false)
       where id = v_op_id;

      delete from public.cotizacion_items where cotizacion_id = v_op_id;
    else
      -- Primera letra libre dentro de su categoría (o del envío), como
      -- siguienteEtiqueta en src/lib/cotizaciones.ts. Cuentan también las
      -- anuladas: su número ya existe.
      select chr(ascii('A') + g) into v_etiqueta
        from generate_series(0, 25) g
       where not exists (
         select 1 from public.cotizaciones c
          where c.grupo_id = v_grupo and c.empresa_id = v_empresa
            and c.categoria_id is not distinct from v_op_cat
            and c.opcion_etiqueta = chr(ascii('A') + g))
       order by g
       limit 1;
      if v_etiqueta is null then
        raise exception 'Máximo 26 opciones por categoría';
      end if;

      insert into public.cotizaciones
        (cliente_id, usuario_id, estado, fecha_vencimiento, subtotal, descuento_pct, iva_pct,
         total, notas, grupo_id, opcion_etiqueta, opcion_nombre, categoria_id, recomendada)
      values
        (v_cliente, v_usuario, 'borrador', v_vence, v_subtotal, v_desc, v_iva,
         v_total, v_notas, v_grupo, v_etiqueta, nullif(btrim(coalesce(v_op->>'nombre', '')), ''),
         v_op_cat, coalesce((v_op->>'recomendada')::boolean, false))
      returning id into v_op_id;
    end if;

    insert into public.cotizacion_items
      (cotizacion_id, plantilla_id, descripcion, ancho_cm, alto_cm, area_m2, cantidad,
       precio_unitario, precio_total, notas, referencia_id, color_perfil, opciones,
       lado_medicion, lado_corredizo, medidas_irregulares, alto_izq_cm, alto_der_cm,
       ancho_sup_cm, ancho_inf_cm, notas_cotizacion)
    select v_op_id, r.plantilla_id, r.descripcion, r.ancho_cm, r.alto_cm, r.area_m2, coalesce(r.cantidad, 1),
           coalesce(r.precio_unitario, 0), coalesce(r.precio_total, 0), r.notas, r.referencia_id, r.color_perfil,
           coalesce(r.opciones, '[]'::jsonb), r.lado_medicion, r.lado_corredizo, coalesce(r.medidas_irregulares, false),
           r.alto_izq_cm, r.alto_der_cm, r.ancho_sup_cm, r.ancho_inf_cm, r.notas_cotizacion
      from jsonb_array_elements(v_op->'items') with ordinality e(item, n)
      cross join lateral jsonb_populate_record(null::public.cotizacion_items, e.item) r
     order by e.n;

    v_vivas := v_vivas || v_op_id;
  end loop;

  -- ── Las opciones que ya no vienen se anulan ──
  if v_grupo is not null then
    perform set_config('glazz.anulando_cotizacion', 'on', true);
    update public.cotizaciones
       set estado = 'anulada',
           anulado_at = now(),
           anulado_por = v_usuario,
           motivo_anulacion = 'Opción quitada al editar el envío',
           tipo_anulacion = 'error'
     where grupo_id = v_grupo and empresa_id = v_empresa
       and estado <> 'anulada'
       and not (id = any (v_vivas));
    perform set_config('glazz.anulando_cotizacion', 'off', true);
  elsif not (v_cot.id = any (v_vivas)) then
    raise exception 'Una cotización suelta no se puede quitar al editarla';
  end if;

  -- Se devuelve la cotización desde la que se editó, o la primera viva si esa se anuló.
  select * into v_resultado from public.cotizaciones where id = v_cot.id and estado <> 'anulada';
  if not found then
    select * into v_resultado from public.cotizaciones where id = v_vivas[1];
  end if;
  return v_resultado;
end;
$function$;

revoke execute on function public.actualizar_envio(uuid, jsonb) from public, anon;
grant execute on function public.actualizar_envio(uuid, jsonb) to authenticated;

comment on function public.actualizar_envio(uuid, jsonb) is
  'Guarda un envío completo (opciones y categorías) en una transacción. Todo queda en borrador; las opciones quitadas pasan a anulada.';
