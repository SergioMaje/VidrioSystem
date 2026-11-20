-- IVA configurable por vidriería.
--
-- Hasta ahora toda cotización nueva arrancaba con IVA del 19%, fijo en el
-- código. Ahora el admin decide en Configuración:
--   * usa_iva = true: la cotización nueva arranca con `iva_pct` y el vendedor
--     lo puede cambiar en cada una.
--   * usa_iva = false: la cotización nueva sale con 0% y el campo no aparece.
--
-- Es solo el valor inicial del formulario: `cotizaciones.iva_pct` sigue siendo
-- de cada cotización y las existentes no cambian. Los defaults (true, 19)
-- mantienen el comportamiento de antes, también en las vidrierías nuevas.
alter table public.configuracion_empresa
  add column if not exists usa_iva boolean not null default true,
  add column if not exists iva_pct numeric(5,2) not null default 19;

comment on column public.configuracion_empresa.usa_iva is
  'La vidriería cobra IVA. False: las cotizaciones nuevas salen con 0% y sin el campo de IVA.';
comment on column public.configuracion_empresa.iva_pct is
  '% de IVA con el que arranca una cotización nueva cuando usa_iva es true.';

alter table public.configuracion_empresa
  drop constraint if exists configuracion_empresa_iva_pct_check;
alter table public.configuracion_empresa
  add constraint configuracion_empresa_iva_pct_check check (iva_pct between 0 and 100);
