-- Detecta cobros duplicados. Es solo lectura: no corrige nada.
--
-- Correr ANTES de mergear 20261106120100_anulacion_ventas.sql. Si la consulta 1
-- devuelve filas, el índice ventas_una_conversion_por_cotizacion no se puede
-- crear y la migración falla. Hay que anular primero los cobros sobrantes, o
-- decidir qué hacer con ellos.
--
-- No usa columnas nuevas, así que funciona antes y después de la migración.
-- No filtra por empresa: se corre como postgres (SQL Editor o psql) y revisa
-- todas las vidrierías.

-- 1. Cotizaciones con más de un cobro de conversión activo (anticipo/contado).
--    Las ventas anteriores al 21/08/2026 quedaron todas como 'anticipo'
--    (20260821053000), así que una cotización vieja con varios pagos aparece
--    aquí aunque no sea un duplicado real.
select
  e.nombre                                   as empresa,
  c.numero                                   as cotizacion,
  c.total,
  count(*)                                   as cobros_conversion,
  sum(v.monto)                               as suma,
  array_agg(v.id order by v.created_at)      as venta_ids,
  array_agg(v.monto order by v.created_at)   as montos,
  array_agg(v.created_at order by v.created_at) as fechas
from public.ventas v
join public.cotizaciones c on c.id = v.cotizacion_id
join public.empresas e on e.id = v.empresa_id
where v.cotizacion_id is not null
  and v.tipo in ('anticipo', 'contado')
  -- Después de la migración, sumar: and v.anulado_at is null
group by e.nombre, c.numero, c.total
having count(*) > 1
order by e.nombre, c.numero;

-- 2. Pares sospechosos: misma cotización, mismo monto, mismo método, cobrados
--    con menos de 10 minutos de diferencia. Así se ve un doble clic, que en la
--    base queda como anticipo + abono/saldo_final y no lo detecta la consulta 1.
select
  e.nombre                     as empresa,
  c.numero                     as cotizacion,
  c.total,
  a.id                         as primer_cobro,
  a.tipo                       as tipo_primero,
  b.id                         as segundo_cobro,
  b.tipo                       as tipo_segundo,
  a.monto,
  a.metodo_pago,
  a.created_at                 as fecha_primero,
  b.created_at - a.created_at  as diferencia,
  ua.email                     as cobro_primero,
  ub.email                     as cobro_segundo,
  sa.status                    as caja_primero,
  sb.status                    as caja_segundo
from public.ventas a
join public.ventas b
  on b.cotizacion_id = a.cotizacion_id
 and (b.created_at, b.id) > (a.created_at, a.id)
 and b.created_at - a.created_at < interval '10 minutes'
 and b.monto = a.monto
 and b.metodo_pago = a.metodo_pago
join public.cotizaciones c on c.id = a.cotizacion_id
join public.empresas e on e.id = a.empresa_id
left join public.usuarios ua on ua.id = a.usuario_id
left join public.usuarios ub on ub.id = b.usuario_id
join public.cash_register_sessions sa on sa.id = a.session_id
join public.cash_register_sessions sb on sb.id = b.session_id
where a.cotizacion_id is not null
order by a.created_at desc;
