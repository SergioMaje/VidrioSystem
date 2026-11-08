-- Opciones de cotización, paso 1 de 2: valor nuevo de enum.
--
-- Va en su propia migración porque Postgres no deja usar un valor agregado con
-- ADD VALUE dentro de la misma transacción que lo crea (mismo patrón que
-- 20261108120000_cotizacion_anulada_enum.sql). La migración siguiente lo usa.

-- Opción de un envío que el cliente no eligió: otra opción del mismo grupo se
-- vendió. No es un rechazo del cliente, por eso no reutiliza 'rechazada'.
alter type public.estado_cotizacion add value if not exists 'descartada';
