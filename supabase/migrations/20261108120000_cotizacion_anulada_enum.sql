-- Cotización anulada, paso 1 de 2: valor nuevo de enum.
--
-- Va en su propia migración porque Postgres no deja usar un valor agregado con
-- ADD VALUE dentro de la misma transacción que lo crea (mismo patrón que
-- 20261106120000_anulacion_ventas_enums.sql). La migración siguiente lo usa.

-- Cotización vendida cuyo negocio se cayó: todos sus cobros quedan anulados y
-- ya no se puede volver a cobrar ni editar.
alter type public.estado_cotizacion add value if not exists 'anulada';
