-- Identidad de la vidrieria (nombre, logo, NIT, contacto) para que el membrete de los
-- documentos impresos deje de estar escrito a mano en el codigo. No confundir con
-- cuentas_pago_empresa, que guarda a donde transfiere el cliente.

CREATE TABLE IF NOT EXISTS "public"."configuracion_empresa" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "nombre" "text" NOT NULL,
    "eslogan" "text",
    "nit" "text",
    "direccion" "text",
    "ciudad" "text",
    "telefono" "text",
    "email" "text",
    -- Ruta dentro del bucket 'empresa', no la URL publica completa: si el proyecto de
    -- Supabase cambia de dominio, la fila sigue siendo valida.
    "logo_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."configuracion_empresa" OWNER TO "postgres";

ALTER TABLE ONLY "public"."configuracion_empresa"
    ADD CONSTRAINT "configuracion_empresa_pkey" PRIMARY KEY ("id");

-- Una sola vidrieria por instalacion: el indice sobre una constante impide que una
-- segunda fila aparezca y deje a la app eligiendo cual de las dos imprimir.
CREATE UNIQUE INDEX "idx_configuracion_empresa_fila_unica" ON "public"."configuracion_empresa" ((true));

CREATE OR REPLACE TRIGGER "trg_configuracion_empresa_updated_at" BEFORE UPDATE ON "public"."configuracion_empresa" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- Fila semilla con la marca que hasta ahora estaba hardcodeada, para que los documentos
-- salgan igual que antes mientras nadie entre a Configuracion a cambiarla.
INSERT INTO "public"."configuracion_empresa" ("nombre", "eslogan")
SELECT 'VidrioSystem', 'Vidriería y aluminio'
WHERE NOT EXISTS (SELECT 1 FROM "public"."configuracion_empresa");

ALTER TABLE "public"."configuracion_empresa" ENABLE ROW LEVEL SECURITY;

-- Cualquier autenticado la lee: todos imprimen documentos. Escribir es solo de admin,
-- igual que las cuentas de pago; no hay politica de DELETE porque la fila es unica y
-- borrarla dejaria los documentos sin membrete.
CREATE POLICY "autenticados_select_configuracion_empresa" ON "public"."configuracion_empresa" FOR SELECT USING (("auth"."uid"() IS NOT NULL));

CREATE POLICY "admin_insert_configuracion_empresa" ON "public"."configuracion_empresa" FOR INSERT WITH CHECK (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));

CREATE POLICY "admin_update_configuracion_empresa" ON "public"."configuracion_empresa" FOR UPDATE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));

GRANT ALL ON TABLE "public"."configuracion_empresa" TO "anon";
GRANT ALL ON TABLE "public"."configuracion_empresa" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_empresa" TO "service_role";

-- Bucket del logo. Publico para que la lectura salga por CDN sin firmar URLs; el limite
-- de 2 MB y la lista de mime types los aplica Storage aunque el cliente no valide.
-- Sin image/svg+xml a proposito: un SVG servido desde un bucket publico ejecuta el script
-- que traiga dentro, y aqui el archivo lo sube un usuario.
INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types")
VALUES ('empresa', 'empresa', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT ("id") DO NOTHING;

-- La lectura no necesita politica: en un bucket publico Storage la sirve sin consultar RLS.
-- La escritura si, y queda solo en admin: el logo es la cara de la empresa en documentos
-- que salen hacia el cliente.
CREATE POLICY "admin_insert_logo_empresa" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (("bucket_id" = 'empresa' AND "public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));

CREATE POLICY "admin_update_logo_empresa" ON "storage"."objects" FOR UPDATE TO "authenticated" USING (("bucket_id" = 'empresa' AND "public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));

CREATE POLICY "admin_delete_logo_empresa" ON "storage"."objects" FOR DELETE TO "authenticated" USING (("bucket_id" = 'empresa' AND "public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));
