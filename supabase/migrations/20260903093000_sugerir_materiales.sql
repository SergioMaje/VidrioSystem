-- Sugerencia de materiales al armar una orden de producción.
--
-- El orden de preferencia no es un capricho de la pantalla, es la política del
-- negocio: primero se gasta lo que ya está cortado y pagado (un recorte),
-- después la bodega, y solo si el material es de los que no se guardan se
-- habilita pedirlo al proveedor. Vive en SQL porque depende de stock_actual y
-- de la clase de otros items, datos vivos que cambian con cada movimiento — no
-- de la geometría del vano, que es lo único que hoy vive en src/lib.

create or replace function public.sugerir_materiales(p_item_id uuid, p_cantidad numeric)
returns table (
  item_id uuid,
  codigo text,
  nombre text,
  origen public.origen_material,
  clase public.clase_inventario,
  stock_actual numeric,
  ancho_cm numeric,
  alto_cm numeric,
  cubre boolean,
  prioridad integer
)
  language sql
  stable
  set search_path to 'public'
as $$
  with base as (
    select id, coalesce(item_origen_id, id) as raiz_id
    from public.items_inventario
    where id = p_item_id
  ),
  candidatos as (
    -- Prioridad 1: recortes que salieron de la misma lámina raíz que el item pedido.
    select i.id as item_id, i.codigo, i.nombre, 'desperdicio'::public.origen_material as origen,
           i.clase_inventario as clase, i.stock_actual, i.ancho_cm, i.alto_cm, 1 as prioridad
    from public.items_inventario i, base
    where i.activo and i.stock_actual > 0
      and i.clase_inventario = 'desperdicio'
      and coalesce(i.item_origen_id, i.id) = base.raiz_id

    union all

    -- Prioridad 2: el propio item, si está en stock normal.
    select i.id, i.codigo, i.nombre, 'stock_normal'::public.origen_material,
           i.clase_inventario, i.stock_actual, i.ancho_cm, i.alto_cm, 2
    from public.items_inventario i
    where i.id = p_item_id and i.activo and i.stock_actual > 0
      and i.clase_inventario = 'stock_normal'

    union all

    -- Prioridad 3: el propio item, si es sobre pedido. Sin exigir stock: eso es
    -- justo lo que habilita el flujo de compra.
    select i.id, i.codigo, i.nombre, 'sobre_pedido'::public.origen_material,
           i.clase_inventario, i.stock_actual, i.ancho_cm, i.alto_cm, 3
    from public.items_inventario i
    where i.id = p_item_id and i.activo
      and i.clase_inventario = 'sobre_pedido'
  )
  select c.item_id, c.codigo, c.nombre, c.origen, c.clase, c.stock_actual, c.ancho_cm, c.alto_cm,
         (c.stock_actual >= p_cantidad) as cubre, c.prioridad
  from candidatos c
  -- Entre los que alcanzan gana el más pequeño que alcanza (minimiza el
  -- desperdicio del desperdicio); si ninguno alcanza, el más grande primero.
  order by c.prioridad,
           (c.stock_actual >= p_cantidad) desc,
           case when c.stock_actual >= p_cantidad then c.stock_actual end asc,
           c.stock_actual desc
$$;

comment on function public.sugerir_materiales(uuid, numeric) is
  'Candidatos para cubrir p_cantidad de p_item_id, en orden de prioridad: recortes de la misma lámina, stock normal, y por último sobre pedido. Solo lectura, respeta RLS (no es security definer).';

grant execute on function public.sugerir_materiales(uuid, numeric) to authenticated;
