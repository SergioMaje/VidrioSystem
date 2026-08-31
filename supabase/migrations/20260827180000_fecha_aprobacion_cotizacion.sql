-- La fecha/hora de creacion ya vive en cotizaciones.created_at. Falta el otro
-- momento clave del ciclo de vida: cuando el cliente aprueba (paga el anticipo
-- y la cotizacion pasa a 'vendida' via useRegistrarAnticipo). Se guarda aparte
-- porque created_at no cambia y fecha_emision es solo fecha, sin hora.

ALTER TABLE "public"."cotizaciones"
    ADD COLUMN IF NOT EXISTS "fecha_aprobacion" timestamp with time zone;
