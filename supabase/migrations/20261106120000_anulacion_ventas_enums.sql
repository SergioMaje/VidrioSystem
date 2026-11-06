-- Anulación de ventas, paso 1 de 2: valores nuevos de enum.
--
-- Van en su propia migración porque Postgres no deja usar un valor agregado con
-- ADD VALUE dentro de la misma transacción que lo crea (mismo patrón que
-- 20260916090000_metodo_pago_financiera.sql). La migración siguiente los usa.

-- Movimiento de inventario que devuelve al stock lo que descontó una venta
-- anulada. No se edita la cantidad: se registra la entrada inversa.
alter type public.tipo_movimiento add value if not exists 'reintegro_anulacion';

-- Egreso de caja que compensa el ingreso de una venta anulada.
alter type public.categoria_gasto add value if not exists 'reverso_anulacion';
