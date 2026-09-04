-- Clase de inventario: de dónde sale un material.
--
-- Hasta ahora el único eje de clasificación era `categorias` (Vidrio, Perfil de
-- aluminio, Herrajes...), y eso describe QUÉ ES un material, no CÓMO SE ABASTECE.
-- Son ejes ortogonales: un vidrio puede estar en bodega, ser un retal recuperado
-- de otra lámina, o comprarse solo cuando hay una orden concreta. Meter esto en
-- `categorias` obligaría a triplicar cada categoría.
--
-- Sin este campo hay dos huecos reales:
--   - El retal es invisible. Se corta una lámina de 2.4 m², se usan 1.6 y el
--     sobrante desaparece del sistema aunque siga físicamente en el taller.
--   - No existe el material "se compra sobre pedido": hoy un vidrio que solo se
--     pide cuando hay una orden aparece siempre en rojo, como si faltara stock.
--
-- item_origen_id enlaza un recorte con la lámina (u otro item) del que salió.
-- Se aplana siempre a la raíz (nunca apunta a otro recorte) para que la búsqueda
-- de "qué recortes salieron de este material" sea una igualdad simple.
-- ancho_cm/alto_cm son las medidas del recorte; quedan null en cualquier item
-- que no sea un recorte.

do $$ begin
  create type public.clase_inventario as enum ('stock_normal', 'desperdicio', 'sobre_pedido');
exception when duplicate_object then null; end $$;

alter table public.items_inventario
  add column if not exists clase_inventario public.clase_inventario not null default 'stock_normal',
  add column if not exists item_origen_id uuid references public.items_inventario(id),
  add column if not exists ancho_cm numeric(8,2),
  add column if not exists alto_cm  numeric(8,2);

alter table public.items_inventario drop constraint if exists items_inventario_recorte_coherente;
alter table public.items_inventario add constraint items_inventario_recorte_coherente
  check (item_origen_id is null or clase_inventario = 'desperdicio');

alter table public.items_inventario drop constraint if exists items_inventario_origen_distinto;
alter table public.items_inventario add constraint items_inventario_origen_distinto
  check (item_origen_id is null or item_origen_id <> id);

alter table public.items_inventario drop constraint if exists items_inventario_medidas_positivas;
alter table public.items_inventario add constraint items_inventario_medidas_positivas
  check ((ancho_cm is null or ancho_cm > 0) and (alto_cm is null or alto_cm > 0));

create index if not exists idx_items_clase  on public.items_inventario(clase_inventario);
create index if not exists idx_items_origen on public.items_inventario(item_origen_id)
  where item_origen_id is not null;

comment on column public.items_inventario.clase_inventario is
  'De dónde sale el material: stock_normal (bodega), desperdicio (recorte de otro item) o sobre_pedido (se compra solo para una orden concreta).';
comment on column public.items_inventario.item_origen_id is
  'Lámina/item raíz del que salió este recorte. Siempre apunta a la raíz, nunca a otro recorte.';
comment on column public.items_inventario.ancho_cm is
  'Ancho del recorte en centímetros. Null en cualquier item que no sea un recorte.';
comment on column public.items_inventario.alto_cm is
  'Alto del recorte en centímetros. Null en cualquier item que no sea un recorte.';
