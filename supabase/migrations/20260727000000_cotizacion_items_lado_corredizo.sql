-- "Derecha" es ambiguo: una medida tomada desde adentro de la casa da la mano
-- contraria a una tomada desde afuera, y el instalador termina montando la hoja
-- corrediza en el lado equivocado. Se registra por ítem desde qué lado se tomó la
-- medida y cuál hoja corre; el sistema normaliza ambos a un único marco canónico
-- (vista desde el exterior) para dibujar la vista previa y la ficha de producción.
--
-- Se guarda el dato crudo, tal como lo dictó quien midió: la normalización ocurre
-- solo al renderizar (ver ladoCorredizoExterior en src/lib/lados.ts). Guardar el
-- lado ya normalizado haría que el dato dejara de coincidir con la hoja de medición
-- en papel y volvería a lado_medicion un campo muerto.
--
-- Solo afecta la orientación del dibujo y de las fichas: no cambia medidas de
-- corte ni cálculo de materiales. Ambas columnas son nulas porque los ítems ya
-- cotizados y los productos fijos no tienen valor.

alter table public.cotizacion_items
  add column if not exists lado_medicion  text check (lado_medicion  in ('interior', 'exterior')),
  add column if not exists lado_corredizo text check (lado_corredizo in ('izquierda', 'derecha'));
