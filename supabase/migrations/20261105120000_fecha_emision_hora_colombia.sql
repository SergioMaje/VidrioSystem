-- fecha_emision se guardaba con la fecha UTC del navegador: las cotizaciones
-- creadas desde las 19:00 hora Colombia quedaban con la fecha del día siguiente.
-- CURRENT_DATE en Supabase también es UTC, así que el default tenía el mismo problema.

ALTER TABLE public.cotizaciones
  ALTER COLUMN fecha_emision SET DEFAULT (now() AT TIME ZONE 'America/Bogota')::date;

-- Recalcula las fechas ya guardadas a partir del instante real de creación.
UPDATE public.cotizaciones
SET fecha_emision = (created_at AT TIME ZONE 'America/Bogota')::date
WHERE fecha_emision <> (created_at AT TIME ZONE 'America/Bogota')::date;
