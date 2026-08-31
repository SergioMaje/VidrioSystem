-- Las cuatro medidas se capturan siempre.
--
-- `medidas_irregulares` nacio como un modo que se elegia al cotizar: apagado, el
-- configurador pedia solo ancho y alto. Eso hacia que el caso correcto fuera el que
-- habia que acordarse de activar, y produccion terminaba cortando a la medida nominal
-- en vanos que no lo eran. Ahora el configurador pide siempre los cuatro lados y la
-- columna pasa a ser un dato derivado.
--
-- No se borra la columna: sigue diciendo algo util para el taller (si el vano quedo
-- fuera de escuadra) y borrarla seria destructivo sin ganancia.
COMMENT ON COLUMN public.cotizacion_items.medidas_irregulares IS
  'Derivado: los cuatro lados no son todos iguales. Ya no es un modo que se elija al cotizar.';

COMMENT ON COLUMN public.cotizacion_items.ancho_sup_cm IS
  'Medida tomada en obra. Se guarda siempre; NULL solo en items anteriores a las medidas por lado.';
