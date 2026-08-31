-- Descuento por lado en los cortes.
--
-- Una fila de corte tenia un solo margen_cm, asi que en un vano fuera de escuadra
-- las dos jambas salian con el mismo descuento aunque cada lado lo necesite distinto.
-- Estas cuatro columnas son sobreescrituras opcionales: cuando una pieza se resuelve
-- por un lado y ese lado tiene valor, manda; si no, cae a margen_cm.
--
-- Se permiten valores negativos a proposito: un descuento negativo suma, que es como
-- se pide holgura extra cuando el vano cierra hacia adentro.
ALTER TABLE public.referencia_cortes
  ADD COLUMN IF NOT EXISTS margen_izq_cm numeric(8,2),
  ADD COLUMN IF NOT EXISTS margen_der_cm numeric(8,2),
  ADD COLUMN IF NOT EXISTS margen_sup_cm numeric(8,2),
  ADD COLUMN IF NOT EXISTS margen_inf_cm numeric(8,2);

COMMENT ON COLUMN public.referencia_cortes.margen_cm IS
  'Descuento base de la pieza. Se usa cuando el lado no tiene sobreescritura, y en vanos a escuadra.';
COMMENT ON COLUMN public.referencia_cortes.margen_izq_cm IS
  'Descuento del lado izquierdo. NULL = usa margen_cm. Negativo suma.';
