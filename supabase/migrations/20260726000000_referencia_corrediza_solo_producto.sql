-- El flag corredizo es una propiedad del producto, no de cada medida de corte.
-- Las piezas de referencia_cortes son solo medidas; ninguna es "corrediza".

alter table public.referencia_cortes
  drop column es_corredizo;
