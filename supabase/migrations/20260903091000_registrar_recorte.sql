-- Registrar un recorte de vidrio (u otro material por área/longitud) como inventario.
--
-- El retal es la pérdida más grande del taller y hoy es invisible: se corta una
-- lámina de 2.4 m², se usan 1.6 y el pedazo sobrante desaparece del sistema aunque
-- siga físicamente apoyado en la pared. En vez de una tabla `laminas` aparte (que
-- duplicaría categoría, unidad, proveedor, precios, movimientos y RLS), el retal
-- es una fila hija de items_inventario: hereda todo del origen y reusa el motor
-- de stock que ya existe.
--
-- Por qué NO se descuenta el item de origen: el BOM ya cobró el área del vano MÁS
-- el desperdicio_pct, es decir la lámina entera se dio de baja en el movimiento de
-- producción. Registrar el recorte es recuperar como activo un pedazo que ya se
-- había llevado a gasto — es una `entrada` sobre un item nuevo, no un ajuste sobre
-- el origen. Descontar el origen otra vez contaría el mismo material dos veces.
--
-- Los recortes se aplanan siempre a la lámina raíz (item_origen_id nunca apunta a
-- otro recorte), así que emparejar "qué retales salieron de este material" es una
-- igualdad simple y no una consulta recursiva.

create sequence if not exists public.items_recorte_codigo_seq;

create or replace function public.registrar_recorte(
  p_item_origen_id uuid,
  p_ancho_cm numeric,
  p_alto_cm numeric,
  p_cantidad numeric default null,
  p_referencia text default null,
  p_notas text default null
) returns public.items_inventario
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_usuario uuid := auth.uid();
  v_origen public.items_inventario;
  v_tipo_unidad public.tipo_unidad;
  v_cantidad numeric;
  v_nuevo_id uuid;
  v_resultado public.items_inventario;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar un recorte';
  end if;

  if p_ancho_cm is null or p_ancho_cm <= 0 or p_alto_cm is null or p_alto_cm <= 0 then
    raise exception 'Las medidas del recorte deben ser mayores a cero';
  end if;

  select * into v_origen from public.items_inventario
  where id = p_item_origen_id
  for update;

  if not found then
    raise exception 'El item de origen no existe';
  end if;

  if not v_origen.activo then
    raise exception 'El item "%" está inactivo y no puede generar recortes', v_origen.nombre;
  end if;

  if v_origen.clase_inventario = 'sobre_pedido' then
    raise exception 'Un material sobre pedido no deja recortes en bodega';
  end if;

  if v_origen.ancho_cm is not null and v_origen.alto_cm is not null
     and (p_ancho_cm > v_origen.ancho_cm or p_alto_cm > v_origen.alto_cm) then
    raise exception 'El recorte (% × % cm) no cabe en "%"', p_ancho_cm, p_alto_cm, v_origen.nombre;
  end if;

  select tipo into v_tipo_unidad from public.unidades_medida where id = v_origen.unidad_medida_id;

  v_cantidad := case
    when p_cantidad is not null then p_cantidad
    when v_tipo_unidad = 'area' then (p_ancho_cm * p_alto_cm) / 10000
    when v_tipo_unidad = 'longitud' then greatest(p_ancho_cm, p_alto_cm) / 100
    else 1
  end;

  if v_cantidad is null or v_cantidad <= 0 then
    raise exception 'La cantidad recuperada del recorte debe ser mayor a cero';
  end if;

  v_nuevo_id := gen_random_uuid();

  -- stock_actual entra en 0 a propósito: lo aplica trg_actualizar_stock a partir
  -- del movimiento de entrada que se inserta abajo, igual que cualquier otra alta.
  insert into public.items_inventario (
    id, codigo, nombre, descripcion, categoria_id, unidad_medida_id, proveedor_id,
    stock_actual, stock_minimo, precio_costo, precio_venta, activo,
    rol_configurador, vidrio_tipo, vidrio_calibre_mm, vidrio_acabado,
    clase_inventario, item_origen_id, ancho_cm, alto_cm
  ) values (
    v_nuevo_id,
    'REC-' || lpad(nextval('public.items_recorte_codigo_seq')::text, 6, '0'),
    v_origen.nombre || ' — recorte ' || p_ancho_cm || '×' || p_alto_cm || ' cm',
    p_notas,
    v_origen.categoria_id, v_origen.unidad_medida_id, v_origen.proveedor_id,
    0, 0, v_origen.precio_costo, v_origen.precio_venta, true,
    v_origen.rol_configurador, v_origen.vidrio_tipo, v_origen.vidrio_calibre_mm, v_origen.vidrio_acabado,
    'desperdicio', coalesce(v_origen.item_origen_id, v_origen.id), p_ancho_cm, p_alto_cm
  );

  insert into public.movimientos_inventario
    (item_id, tipo, cantidad, cantidad_anterior, cantidad_posterior, motivo, referencia, usuario_id)
  values
    (v_nuevo_id, 'entrada', v_cantidad, 0, v_cantidad,
     'Recorte de ' || v_origen.codigo, p_referencia, v_usuario);

  select * into v_resultado from public.items_inventario where id = v_nuevo_id;
  return v_resultado;
end;
$$;

comment on function public.registrar_recorte(uuid, numeric, numeric, numeric, text, text) is
  'Crea un item hijo de tipo desperdicio a partir de un recorte de otro item y registra su entrada de stock. No descuenta el item de origen: ese material ya se dio de baja en el movimiento de producción que generó el recorte.';

grant execute on function public.registrar_recorte(uuid, numeric, numeric, numeric, text, text) to authenticated;
