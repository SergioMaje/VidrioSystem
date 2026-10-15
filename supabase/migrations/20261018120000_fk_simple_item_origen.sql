-- El paso 1 de multi-tenant dejo items_inventario.item_origen_id con FK compuesta
-- (empresa_id, item_origen_id) -> items_inventario(empresa_id, id). PostgREST descarta
-- las FK compuestas de una tabla hacia si misma, asi que el embebido
-- `item_origen:item_origen_id(*)` del inventario respondia 400 y la pantalla quedaba vacia.
--
-- Se agrega una FK simple sobre la misma columna solo para que PostgREST vea la relacion.
-- La compuesta se queda: es la que impide enlazar un recorte con un item de otra empresa.
alter table public.items_inventario
  add constraint items_inventario_item_origen_id_simple_fkey
  foreign key (item_origen_id) references public.items_inventario(id);

notify pgrst, 'reload schema';
