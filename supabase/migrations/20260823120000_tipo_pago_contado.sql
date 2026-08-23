-- Valor de enum para el pago único de una venta de mostrador: no es anticipo ni
-- abono, liquida la venta en el acto.
--
-- Va solo en su archivo a propósito: Postgres no permite usar un valor de enum
-- en la misma transacción en que se añade, y la CLI corre cada migración dentro
-- de una transacción.
alter type public.tipo_pago add value if not exists 'contado';
