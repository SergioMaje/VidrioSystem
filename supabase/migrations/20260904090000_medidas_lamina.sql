-- Medida estándar de la lámina (y de cualquier item que se compre por pieza).
--
-- ancho_cm/alto_cm nacieron en 20260903090000 pensadas solo para el recorte: eran
-- "las medidas del pedazo que sobró". Pero la lámina de la que sale ese pedazo
-- también tiene una medida, y no tenerla dejaba dos cosas rotas:
--
--   1. La validación de registrar_recorte que impide registrar un recorte más
--      grande que su origen era código muerto. Solo dispara cuando el origen
--      tiene medidas, y el origen nunca las tenía: se podía registrar un retal
--      de 500×500 cm sacado de una lámina de 240×180 y nadie se quejaba.
--   2. El vidrio se almacena y se cobra por m² (precio_costo se multiplica por
--      la cantidad en la unidad del item), pero quien compra piensa en láminas:
--      "una de 2.40×1.80 me cuesta $180.000". Sin la medida estándar guardada,
--      esa conversión a $/m² se hacía a mano y a ojo en cada carga.
--
-- No hay cambio de estructura: las columnas ya existen y el CHECK
-- items_inventario_recorte_coherente solo ata item_origen_id a la clase
-- 'desperdicio', nunca las medidas. Lo que cambia es la semántica, y por eso se
-- reescriben los comentarios: a partir de aquí un item de cualquier clase puede
-- declarar su medida física, y en el recorte esa medida es la del retal.

comment on column public.items_inventario.ancho_cm is
  'Ancho físico en centímetros. En un recorte es la medida del retal; en un item normal, la medida estándar de la pieza con que se compra (la lámina). Null si el item no se maneja por pieza.';

comment on column public.items_inventario.alto_cm is
  'Alto físico en centímetros. En un recorte es la medida del retal; en un item normal, la medida estándar de la pieza con que se compra (la lámina). Null si el item no se maneja por pieza.';
