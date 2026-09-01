-- Medidas por lado: alto izquierdo/derecho y ancho superior/inferior.
--
-- Un vano fuera de plomo no es un rectangulo: sus dos alturas y sus dos anchos
-- difieren. Hasta ahora el despiece solo conocia un ancho y un alto, asi que el
-- vidriero tenia que cotizar con la medida mayor y corregir a mano en el taller.

-- 1. Formulas de corte por lado.
--
-- No se agregan variantes "_menos_margen": en las formulas por lado margen_cm se
-- resta siempre, y su default es 0, asi que sin descuento se comportan igual.
-- Duplicar el enum dejaria el select del formulario en 15 opciones.
ALTER TABLE public.referencia_cortes
  DROP CONSTRAINT IF EXISTS referencia_cortes_formula_check;

ALTER TABLE public.referencia_cortes
  ADD CONSTRAINT referencia_cortes_formula_check CHECK (
    formula = ANY (ARRAY[
      'ancho'::text,
      'alto'::text,
      'ancho_menos_margen'::text,
      'alto_menos_margen'::text,
      'mitad_ancho'::text,
      'mitad_alto'::text,
      'fijo'::text,
      'alto_izquierdo'::text,
      'alto_derecho'::text,
      'ancho_superior'::text,
      'ancho_inferior'::text
    ])
  );

-- 2. Medidas del vano en el item cotizado.
--
-- ancho_cm y alto_cm siguen siendo las medidas nominales (el maximo de cada par).
-- Es lo que mantiene funcionando sin cambios el PDF de la cotizacion, la ficha de
-- produccion y el panel de items. Los items ya existentes quedan con
-- medidas_irregulares = false y las cuatro columnas en NULL, que es exactamente lo
-- que eran: vanos rectangulares.
ALTER TABLE public.cotizacion_items
  ADD COLUMN IF NOT EXISTS medidas_irregulares boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alto_izq_cm   numeric(8,2),
  ADD COLUMN IF NOT EXISTS alto_der_cm   numeric(8,2),
  ADD COLUMN IF NOT EXISTS ancho_sup_cm  numeric(8,2),
  ADD COLUMN IF NOT EXISTS ancho_inf_cm  numeric(8,2);

COMMENT ON COLUMN public.cotizacion_items.medidas_irregulares IS
  'El vano esta fuera de escuadra: las cuatro medidas por lado son las que mandan.';
COMMENT ON COLUMN public.cotizacion_items.ancho_cm IS
  'Ancho nominal (bounding box): max(ancho_sup_cm, ancho_inf_cm).';
COMMENT ON COLUMN public.cotizacion_items.alto_cm IS
  'Alto nominal (bounding box): max(alto_izq_cm, alto_der_cm).';
