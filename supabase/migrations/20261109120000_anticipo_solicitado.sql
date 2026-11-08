-- Anticipo que la vidriería le pide al cliente, impreso en la cotización
-- ("Anticipo del 100% de la cotización").
--
-- No es la regla de cobro: el sistema sigue aceptando desde el mínimo del 50%
-- (`anticipo_minimo()` en Postgres, `ANTICIPO_MIN_PCT` en src/lib/pagos.ts).
-- Por eso el piso del check es 50: pedir menos que el mínimo exigido no tiene
-- sentido. Si el mínimo cambia, este check cambia con él.
--
-- Null = la vidriería no lo configuró y la cotización no muestra mensaje.
alter table public.configuracion_empresa
  add column if not exists anticipo_solicitado_pct integer;

alter table public.configuracion_empresa
  drop constraint if exists configuracion_empresa_anticipo_solicitado_pct_check;
alter table public.configuracion_empresa
  add constraint configuracion_empresa_anticipo_solicitado_pct_check
  check (anticipo_solicitado_pct is null or anticipo_solicitado_pct between 50 and 100);
