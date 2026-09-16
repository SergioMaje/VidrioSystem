-- Valor de enum para las ventas pagadas con crédito de una financiera (Addi,
-- Sistecrédito): el cliente le queda debiendo a la financiera, y ella le
-- desembolsa a la vidriería días después, con su comisión descontada.
--
-- Va solo en su archivo a propósito: Postgres no permite usar un valor de enum
-- en la misma transacción en que se añade, y la CLI corre cada migración dentro
-- de una transacción. Mismo caso que 20260823120000_tipo_pago_contado.sql.
alter type public.metodo_pago_venta add value if not exists 'financiera';
