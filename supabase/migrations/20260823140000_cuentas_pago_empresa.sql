-- Cuentas bancarias propias de la vidrieria, para imprimirlas en la cotizacion y que el
-- cliente sepa a donde transferir. No confundir con proveedor_cuentas_pago (las cuentas
-- del proveedor, a donde le pagamos nosotros) ni con el enum metodo_pago_venta, que
-- registra como se recibio un pago ya hecho.

CREATE TABLE IF NOT EXISTS "public"."cuentas_pago_empresa" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "alias" "text",
    "banco" "text" NOT NULL,
    "tipo_cuenta" "text" NOT NULL,
    "numero_cuenta" "text" NOT NULL,
    "titular" "text" NOT NULL,
    -- Retirar una cuenta del documento sin borrarla: las cotizaciones ya impresas la
    -- siguen mencionando, y el registro sirve para conciliar pagos viejos.
    "activo" boolean DEFAULT true NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."cuentas_pago_empresa" OWNER TO "postgres";

ALTER TABLE ONLY "public"."cuentas_pago_empresa"
    ADD CONSTRAINT "cuentas_pago_empresa_pkey" PRIMARY KEY ("id");

CREATE INDEX "idx_cuentas_pago_empresa_activo" ON "public"."cuentas_pago_empresa" USING "btree" ("activo", "orden");

CREATE OR REPLACE TRIGGER "trg_cuentas_pago_empresa_updated_at" BEFORE UPDATE ON "public"."cuentas_pago_empresa" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

ALTER TABLE "public"."cuentas_pago_empresa" ENABLE ROW LEVEL SECURITY;

-- Cualquier autenticado necesita leerlas para imprimir la cotizacion. La escritura queda
-- solo en admin: a diferencia de las cuentas de proveedor, un numero alterado aqui desvia
-- el dinero que el cliente transfiere.
CREATE POLICY "autenticados_select_cuentas_pago_empresa" ON "public"."cuentas_pago_empresa" FOR SELECT USING (("auth"."uid"() IS NOT NULL));

CREATE POLICY "admin_insert_cuentas_pago_empresa" ON "public"."cuentas_pago_empresa" FOR INSERT WITH CHECK (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));

CREATE POLICY "admin_update_cuentas_pago_empresa" ON "public"."cuentas_pago_empresa" FOR UPDATE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));

CREATE POLICY "admin_delete_cuentas_pago_empresa" ON "public"."cuentas_pago_empresa" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));

GRANT ALL ON TABLE "public"."cuentas_pago_empresa" TO "anon";
GRANT ALL ON TABLE "public"."cuentas_pago_empresa" TO "authenticated";
GRANT ALL ON TABLE "public"."cuentas_pago_empresa" TO "service_role";
