


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."estado_caja" AS ENUM (
    'open',
    'closed'
);


ALTER TYPE "public"."estado_caja" OWNER TO "postgres";


CREATE TYPE "public"."estado_cotizacion" AS ENUM (
    'borrador',
    'enviada',
    'aprobada',
    'rechazada',
    'vencida',
    'vendida'
);


ALTER TYPE "public"."estado_cotizacion" OWNER TO "postgres";


CREATE TYPE "public"."estado_orden" AS ENUM (
    'pendiente',
    'en_produccion',
    'lista',
    'entregada',
    'cancelada'
);


ALTER TYPE "public"."estado_orden" OWNER TO "postgres";


CREATE TYPE "public"."formula_componente" AS ENUM (
    'area',
    'perimetro',
    'ancho',
    'alto',
    'fijo'
);


ALTER TYPE "public"."formula_componente" OWNER TO "postgres";


CREATE TYPE "public"."metodo_pago_venta" AS ENUM (
    'efectivo',
    'tarjeta',
    'transferencia'
);


ALTER TYPE "public"."metodo_pago_venta" OWNER TO "postgres";


CREATE TYPE "public"."rol_usuario" AS ENUM (
    'admin',
    'vendedor',
    'bodega'
);


ALTER TYPE "public"."rol_usuario" OWNER TO "postgres";


CREATE TYPE "public"."tipo_cliente" AS ENUM (
    'natural',
    'juridico'
);


ALTER TYPE "public"."tipo_cliente" OWNER TO "postgres";


CREATE TYPE "public"."tipo_movimiento" AS ENUM (
    'entrada',
    'salida',
    'ajuste',
    'produccion'
);


ALTER TYPE "public"."tipo_movimiento" OWNER TO "postgres";


CREATE TYPE "public"."tipo_producto_enum" AS ENUM (
    'ventana',
    'puerta',
    'division',
    'espejo',
    'otro'
);


ALTER TYPE "public"."tipo_producto_enum" OWNER TO "postgres";


CREATE TYPE "public"."tipo_unidad" AS ENUM (
    'area',
    'longitud',
    'unidad',
    'peso',
    'volumen'
);


ALTER TYPE "public"."tipo_unidad" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."actualizar_stock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE items_inventario
  SET stock_actual = NEW.cantidad_posterior
  WHERE id = NEW.item_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."actualizar_stock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_rol"() RETURNS "public"."rol_usuario"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT rol FROM usuarios WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."get_user_rol"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.usuarios (id, nombre, apellido, email, rol, activo)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombre', 'Sin nombre'),
    COALESCE(NEW.raw_user_meta_data->>'apellido', ''),
    NEW.email,
    'vendedor',
    true
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."cash_register_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    "opened_by" "uuid" NOT NULL,
    "closed_by" "uuid",
    "opening_amount" numeric NOT NULL,
    "expected_amount" numeric,
    "counted_amount" numeric,
    "difference" numeric,
    "status" "public"."estado_caja" DEFAULT 'open'::"public"."estado_caja" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cash_register_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categorias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "icono" "text",
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."categorias" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "apellido" "text" NOT NULL,
    "empresa" "text",
    "tipo" "public"."tipo_cliente" DEFAULT 'natural'::"public"."tipo_cliente" NOT NULL,
    "documento" "text",
    "telefono" "text",
    "email" "text",
    "direccion" "text",
    "ciudad" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."clientes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cotizacion_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cotizacion_id" "uuid" NOT NULL,
    "plantilla_id" "uuid",
    "descripcion" "text" NOT NULL,
    "ancho_cm" numeric(8,2),
    "alto_cm" numeric(8,2),
    "area_m2" numeric(8,4),
    "cantidad" integer DEFAULT 1 NOT NULL,
    "precio_unitario" numeric(12,2) DEFAULT 0 NOT NULL,
    "precio_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "notas" "text",
    "referencia_id" "uuid",
    "color_perfil" "text",
    "opciones" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "lado_medicion" "text",
    "lado_corredizo" "text",
    CONSTRAINT "cotizacion_items_lado_corredizo_check" CHECK (("lado_corredizo" = ANY (ARRAY['izquierda'::"text", 'derecha'::"text"]))),
    CONSTRAINT "cotizacion_items_lado_medicion_check" CHECK (("lado_medicion" = ANY (ARRAY['interior'::"text", 'exterior'::"text"])))
);


ALTER TABLE "public"."cotizacion_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cotizaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "numero" "text" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "usuario_id" "uuid",
    "estado" "public"."estado_cotizacion" DEFAULT 'borrador'::"public"."estado_cotizacion" NOT NULL,
    "fecha_emision" "date" DEFAULT CURRENT_DATE NOT NULL,
    "fecha_vencimiento" "date",
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "descuento_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    "iva_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "notas" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cotizaciones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."items_inventario" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codigo" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "categoria_id" "uuid",
    "unidad_medida_id" "uuid",
    "proveedor_id" "uuid",
    "stock_actual" numeric(10,3) DEFAULT 0 NOT NULL,
    "stock_minimo" numeric(10,3) DEFAULT 0 NOT NULL,
    "precio_costo" numeric(12,2) DEFAULT 0 NOT NULL,
    "precio_venta" numeric(12,2) DEFAULT 0 NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rol_configurador" "text",
    "vidrio_tipo" "text",
    "vidrio_calibre_mm" numeric,
    "vidrio_acabado" "text",
    CONSTRAINT "items_inventario_rol_configurador_check" CHECK (("rol_configurador" = ANY (ARRAY['vidrio'::"text", 'chapa'::"text", 'pelicula'::"text"]))),
    CONSTRAINT "items_inventario_vidrio_tipo_check" CHECK (("vidrio_tipo" = ANY (ARRAY['crudo'::"text", 'templado'::"text", 'laminado'::"text"])))
);


ALTER TABLE "public"."items_inventario" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."movimientos_inventario" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "item_id" "uuid" NOT NULL,
    "tipo" "public"."tipo_movimiento" NOT NULL,
    "cantidad" numeric(10,3) NOT NULL,
    "cantidad_anterior" numeric(10,3) NOT NULL,
    "cantidad_posterior" numeric(10,3) NOT NULL,
    "motivo" "text",
    "referencia" "text",
    "usuario_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."movimientos_inventario" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ordenes_trabajo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "numero" "text" NOT NULL,
    "cotizacion_id" "uuid",
    "cliente_id" "uuid" NOT NULL,
    "estado" "public"."estado_orden" DEFAULT 'pendiente'::"public"."estado_orden" NOT NULL,
    "fecha_inicio" "date",
    "fecha_entrega_estimada" "date",
    "fecha_entrega_real" "date",
    "notas" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ordenes_trabajo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plantilla_componentes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plantilla_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "formula" "public"."formula_componente" NOT NULL,
    "cantidad_fija" numeric(10,3),
    "desperdicio_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    "obligatorio" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."plantilla_componentes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plantillas_producto" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tipo_producto_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "requiere_medidas" boolean DEFAULT true NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."plantillas_producto" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proveedor_cuentas_pago" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "proveedor_id" "uuid" NOT NULL,
    "alias" "text",
    "banco" "text" NOT NULL,
    "tipo_cuenta" "text" NOT NULL,
    "numero_cuenta" "text" NOT NULL,
    "titular" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."proveedor_cuentas_pago" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proveedores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "contacto" "text",
    "telefono" "text",
    "email" "text",
    "direccion" "text",
    "nit" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."proveedores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referencia_cortes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referencia_id" "uuid" NOT NULL,
    "nombre_pieza" "text" NOT NULL,
    "formula" "text" NOT NULL,
    "margen_cm" numeric(8,2) DEFAULT 0 NOT NULL,
    "cantidad_fija_cm" numeric(8,2),
    "cantidad_piezas" integer DEFAULT 1 NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "referencia_cortes_formula_check" CHECK (("formula" = ANY (ARRAY['ancho'::"text", 'alto'::"text", 'ancho_menos_margen'::"text", 'alto_menos_margen'::"text", 'mitad_ancho'::"text", 'mitad_alto'::"text", 'fijo'::"text"])))
);


ALTER TABLE "public"."referencia_cortes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referencias_producto" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "tipo_producto_id" "uuid" NOT NULL,
    "plantilla_id" "uuid" NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "es_corrediza" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."referencias_producto" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tipos_producto" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "public"."tipo_producto_enum" NOT NULL,
    "descripcion" "text",
    "activo" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."tipos_producto" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unidades_medida" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "simbolo" "text" NOT NULL,
    "tipo" "public"."tipo_unidad" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."unidades_medida" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usuarios" (
    "id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "apellido" "text" NOT NULL,
    "email" "text" NOT NULL,
    "rol" "public"."rol_usuario" DEFAULT 'vendedor'::"public"."rol_usuario" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."usuarios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ventas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cotizacion_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "metodo_pago" "public"."metodo_pago_venta" NOT NULL,
    "monto" numeric NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ventas" OWNER TO "postgres";


ALTER TABLE ONLY "public"."cash_register_sessions"
    ADD CONSTRAINT "cash_register_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categorias"
    ADD CONSTRAINT "categorias_nombre_key" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."categorias"
    ADD CONSTRAINT "categorias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_documento_key" UNIQUE ("documento");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cotizacion_items"
    ADD CONSTRAINT "cotizacion_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."items_inventario"
    ADD CONSTRAINT "items_inventario_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."items_inventario"
    ADD CONSTRAINT "items_inventario_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movimientos_inventario"
    ADD CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ordenes_trabajo"
    ADD CONSTRAINT "ordenes_trabajo_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."ordenes_trabajo"
    ADD CONSTRAINT "ordenes_trabajo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plantilla_componentes"
    ADD CONSTRAINT "plantilla_componentes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plantillas_producto"
    ADD CONSTRAINT "plantillas_producto_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proveedor_cuentas_pago"
    ADD CONSTRAINT "proveedor_cuentas_pago_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proveedores"
    ADD CONSTRAINT "proveedores_nit_key" UNIQUE ("nit");



ALTER TABLE ONLY "public"."proveedores"
    ADD CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referencia_cortes"
    ADD CONSTRAINT "referencia_cortes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referencias_producto"
    ADD CONSTRAINT "referencias_producto_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tipos_producto"
    ADD CONSTRAINT "tipos_producto_nombre_key" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."tipos_producto"
    ADD CONSTRAINT "tipos_producto_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unidades_medida"
    ADD CONSTRAINT "unidades_medida_nombre_key" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."unidades_medida"
    ADD CONSTRAINT "unidades_medida_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_cotizacion_id_key" UNIQUE ("cotizacion_id");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "cash_register_sessions_one_open_idx" ON "public"."cash_register_sessions" USING "btree" ("status") WHERE ("status" = 'open'::"public"."estado_caja");



CREATE INDEX "idx_clientes_documento" ON "public"."clientes" USING "btree" ("documento");



CREATE INDEX "idx_componentes_item" ON "public"."plantilla_componentes" USING "btree" ("item_id");



CREATE INDEX "idx_componentes_plantilla" ON "public"."plantilla_componentes" USING "btree" ("plantilla_id");



CREATE INDEX "idx_cot_items_cotizacion" ON "public"."cotizacion_items" USING "btree" ("cotizacion_id");



CREATE INDEX "idx_cot_items_plantilla" ON "public"."cotizacion_items" USING "btree" ("plantilla_id");



CREATE INDEX "idx_cotizaciones_cliente" ON "public"."cotizaciones" USING "btree" ("cliente_id");



CREATE INDEX "idx_cotizaciones_estado" ON "public"."cotizaciones" USING "btree" ("estado");



CREATE INDEX "idx_cotizaciones_numero" ON "public"."cotizaciones" USING "btree" ("numero");



CREATE INDEX "idx_cotizaciones_usuario" ON "public"."cotizaciones" USING "btree" ("usuario_id");



CREATE INDEX "idx_items_categoria" ON "public"."items_inventario" USING "btree" ("categoria_id");



CREATE INDEX "idx_items_codigo" ON "public"."items_inventario" USING "btree" ("codigo");



CREATE INDEX "idx_items_nombre" ON "public"."items_inventario" USING "btree" ("nombre");



CREATE INDEX "idx_items_proveedor" ON "public"."items_inventario" USING "btree" ("proveedor_id");



CREATE INDEX "idx_items_unidad" ON "public"."items_inventario" USING "btree" ("unidad_medida_id");



CREATE INDEX "idx_movimientos_item" ON "public"."movimientos_inventario" USING "btree" ("item_id");



CREATE INDEX "idx_movimientos_usuario" ON "public"."movimientos_inventario" USING "btree" ("usuario_id");



CREATE INDEX "idx_ordenes_cliente" ON "public"."ordenes_trabajo" USING "btree" ("cliente_id");



CREATE INDEX "idx_ordenes_cotizacion" ON "public"."ordenes_trabajo" USING "btree" ("cotizacion_id");



CREATE INDEX "idx_ordenes_estado" ON "public"."ordenes_trabajo" USING "btree" ("estado");



CREATE INDEX "idx_plantillas_tipo" ON "public"."plantillas_producto" USING "btree" ("tipo_producto_id");



CREATE INDEX "idx_proveedor_cuentas_pago_proveedor" ON "public"."proveedor_cuentas_pago" USING "btree" ("proveedor_id");



CREATE INDEX "items_inventario_rol_configurador_idx" ON "public"."items_inventario" USING "btree" ("rol_configurador") WHERE ("rol_configurador" IS NOT NULL);



CREATE INDEX "referencia_cortes_referencia_id_idx" ON "public"."referencia_cortes" USING "btree" ("referencia_id");



CREATE INDEX "referencias_producto_activa_idx" ON "public"."referencias_producto" USING "btree" ("activa");



CREATE INDEX "referencias_producto_tipo_producto_id_idx" ON "public"."referencias_producto" USING "btree" ("tipo_producto_id");



CREATE OR REPLACE TRIGGER "trg_actualizar_stock" AFTER INSERT ON "public"."movimientos_inventario" FOR EACH ROW EXECUTE FUNCTION "public"."actualizar_stock"();



CREATE OR REPLACE TRIGGER "trg_clientes_updated_at" BEFORE UPDATE ON "public"."clientes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cotizaciones_updated_at" BEFORE UPDATE ON "public"."cotizaciones" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_items_inventario_updated_at" BEFORE UPDATE ON "public"."items_inventario" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_ordenes_trabajo_updated_at" BEFORE UPDATE ON "public"."ordenes_trabajo" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_plantillas_producto_updated_at" BEFORE UPDATE ON "public"."plantillas_producto" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_proveedores_updated_at" BEFORE UPDATE ON "public"."proveedores" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_usuarios_updated_at" BEFORE UPDATE ON "public"."usuarios" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."cash_register_sessions"
    ADD CONSTRAINT "cash_register_sessions_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."cash_register_sessions"
    ADD CONSTRAINT "cash_register_sessions_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."cotizacion_items"
    ADD CONSTRAINT "cotizacion_items_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "public"."cotizaciones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cotizacion_items"
    ADD CONSTRAINT "cotizacion_items_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "public"."plantillas_producto"("id");



ALTER TABLE ONLY "public"."cotizacion_items"
    ADD CONSTRAINT "cotizacion_items_referencia_id_fkey" FOREIGN KEY ("referencia_id") REFERENCES "public"."referencias_producto"("id");



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."items_inventario"
    ADD CONSTRAINT "items_inventario_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id");



ALTER TABLE ONLY "public"."items_inventario"
    ADD CONSTRAINT "items_inventario_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id");



ALTER TABLE ONLY "public"."items_inventario"
    ADD CONSTRAINT "items_inventario_unidad_medida_id_fkey" FOREIGN KEY ("unidad_medida_id") REFERENCES "public"."unidades_medida"("id");



ALTER TABLE ONLY "public"."movimientos_inventario"
    ADD CONSTRAINT "movimientos_inventario_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items_inventario"("id");



ALTER TABLE ONLY "public"."movimientos_inventario"
    ADD CONSTRAINT "movimientos_inventario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id");



ALTER TABLE ONLY "public"."ordenes_trabajo"
    ADD CONSTRAINT "ordenes_trabajo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."ordenes_trabajo"
    ADD CONSTRAINT "ordenes_trabajo_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "public"."cotizaciones"("id");



ALTER TABLE ONLY "public"."plantilla_componentes"
    ADD CONSTRAINT "plantilla_componentes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items_inventario"("id");



ALTER TABLE ONLY "public"."plantilla_componentes"
    ADD CONSTRAINT "plantilla_componentes_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "public"."plantillas_producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plantillas_producto"
    ADD CONSTRAINT "plantillas_producto_tipo_producto_id_fkey" FOREIGN KEY ("tipo_producto_id") REFERENCES "public"."tipos_producto"("id");



ALTER TABLE ONLY "public"."proveedor_cuentas_pago"
    ADD CONSTRAINT "proveedor_cuentas_pago_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referencia_cortes"
    ADD CONSTRAINT "referencia_cortes_referencia_id_fkey" FOREIGN KEY ("referencia_id") REFERENCES "public"."referencias_producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referencias_producto"
    ADD CONSTRAINT "referencias_producto_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "public"."plantillas_producto"("id");



ALTER TABLE ONLY "public"."referencias_producto"
    ADD CONSTRAINT "referencias_producto_tipo_producto_id_fkey" FOREIGN KEY ("tipo_producto_id") REFERENCES "public"."tipos_producto"("id");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "public"."cotizaciones"("id");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."cash_register_sessions"("id");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id");



CREATE POLICY "admin_delete_caja" ON "public"."cash_register_sessions" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_categorias" ON "public"."categorias" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_clientes" ON "public"."clientes" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_componentes" ON "public"."plantilla_componentes" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_cot_items" ON "public"."cotizacion_items" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_cotizaciones" ON "public"."cotizaciones" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_cuentas_pago" ON "public"."proveedor_cuentas_pago" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_items" ON "public"."items_inventario" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_movimientos" ON "public"."movimientos_inventario" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_ordenes" ON "public"."ordenes_trabajo" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_plantillas" ON "public"."plantillas_producto" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_proveedores" ON "public"."proveedores" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_ref_cortes" ON "public"."referencia_cortes" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_referencias" ON "public"."referencias_producto" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_tipos" ON "public"."tipos_producto" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_unidades" ON "public"."unidades_medida" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_usuarios" ON "public"."usuarios" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "admin_delete_ventas" ON "public"."ventas" FOR DELETE USING (("public"."get_user_rol"() = 'admin'::"public"."rol_usuario"));



CREATE POLICY "autenticados_insert_caja" ON "public"."cash_register_sessions" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_categorias" ON "public"."categorias" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_clientes" ON "public"."clientes" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_componentes" ON "public"."plantilla_componentes" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_cot_items" ON "public"."cotizacion_items" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_cotizaciones" ON "public"."cotizaciones" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_cuentas_pago" ON "public"."proveedor_cuentas_pago" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_items" ON "public"."items_inventario" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_movimientos" ON "public"."movimientos_inventario" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_ordenes" ON "public"."ordenes_trabajo" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_plantillas" ON "public"."plantillas_producto" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_proveedores" ON "public"."proveedores" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_ref_cortes" ON "public"."referencia_cortes" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_referencias" ON "public"."referencias_producto" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_tipos" ON "public"."tipos_producto" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_unidades" ON "public"."unidades_medida" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_insert_ventas" ON "public"."ventas" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_caja" ON "public"."cash_register_sessions" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_categorias" ON "public"."categorias" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_clientes" ON "public"."clientes" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_componentes" ON "public"."plantilla_componentes" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_cot_items" ON "public"."cotizacion_items" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_cotizaciones" ON "public"."cotizaciones" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_cuentas_pago" ON "public"."proveedor_cuentas_pago" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_items" ON "public"."items_inventario" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_movimientos" ON "public"."movimientos_inventario" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_ordenes" ON "public"."ordenes_trabajo" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_plantillas" ON "public"."plantillas_producto" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_proveedores" ON "public"."proveedores" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_ref_cortes" ON "public"."referencia_cortes" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_referencias" ON "public"."referencias_producto" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_tipos" ON "public"."tipos_producto" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_unidades" ON "public"."unidades_medida" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_select_ventas" ON "public"."ventas" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_caja" ON "public"."cash_register_sessions" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_categorias" ON "public"."categorias" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_clientes" ON "public"."clientes" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_componentes" ON "public"."plantilla_componentes" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_cot_items" ON "public"."cotizacion_items" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_cotizaciones" ON "public"."cotizaciones" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_cuentas_pago" ON "public"."proveedor_cuentas_pago" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_items" ON "public"."items_inventario" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_ordenes" ON "public"."ordenes_trabajo" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_plantillas" ON "public"."plantillas_producto" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_proveedores" ON "public"."proveedores" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_ref_cortes" ON "public"."referencia_cortes" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_referencias" ON "public"."referencias_producto" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_tipos" ON "public"."tipos_producto" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "autenticados_update_unidades" ON "public"."unidades_medida" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."cash_register_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categorias" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clientes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cotizacion_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cotizaciones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."items_inventario" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."movimientos_inventario" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ordenes_trabajo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plantilla_componentes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plantillas_producto" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proveedor_cuentas_pago" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proveedores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referencia_cortes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referencias_producto" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tipos_producto" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."unidades_medida" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuario_insert_propio" ON "public"."usuarios" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "usuario_select_propio" ON "public"."usuarios" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "usuario_update_propio" ON "public"."usuarios" FOR UPDATE USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ventas" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."actualizar_stock"() TO "anon";
GRANT ALL ON FUNCTION "public"."actualizar_stock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."actualizar_stock"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_rol"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_rol"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_rol"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."cash_register_sessions" TO "anon";
GRANT ALL ON TABLE "public"."cash_register_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_register_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."categorias" TO "anon";
GRANT ALL ON TABLE "public"."categorias" TO "authenticated";
GRANT ALL ON TABLE "public"."categorias" TO "service_role";



GRANT ALL ON TABLE "public"."clientes" TO "anon";
GRANT ALL ON TABLE "public"."clientes" TO "authenticated";
GRANT ALL ON TABLE "public"."clientes" TO "service_role";



GRANT ALL ON TABLE "public"."cotizacion_items" TO "anon";
GRANT ALL ON TABLE "public"."cotizacion_items" TO "authenticated";
GRANT ALL ON TABLE "public"."cotizacion_items" TO "service_role";



GRANT ALL ON TABLE "public"."cotizaciones" TO "anon";
GRANT ALL ON TABLE "public"."cotizaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."cotizaciones" TO "service_role";



GRANT ALL ON TABLE "public"."items_inventario" TO "anon";
GRANT ALL ON TABLE "public"."items_inventario" TO "authenticated";
GRANT ALL ON TABLE "public"."items_inventario" TO "service_role";



GRANT ALL ON TABLE "public"."movimientos_inventario" TO "anon";
GRANT ALL ON TABLE "public"."movimientos_inventario" TO "authenticated";
GRANT ALL ON TABLE "public"."movimientos_inventario" TO "service_role";



GRANT ALL ON TABLE "public"."ordenes_trabajo" TO "anon";
GRANT ALL ON TABLE "public"."ordenes_trabajo" TO "authenticated";
GRANT ALL ON TABLE "public"."ordenes_trabajo" TO "service_role";



GRANT ALL ON TABLE "public"."plantilla_componentes" TO "anon";
GRANT ALL ON TABLE "public"."plantilla_componentes" TO "authenticated";
GRANT ALL ON TABLE "public"."plantilla_componentes" TO "service_role";



GRANT ALL ON TABLE "public"."plantillas_producto" TO "anon";
GRANT ALL ON TABLE "public"."plantillas_producto" TO "authenticated";
GRANT ALL ON TABLE "public"."plantillas_producto" TO "service_role";



GRANT ALL ON TABLE "public"."proveedor_cuentas_pago" TO "anon";
GRANT ALL ON TABLE "public"."proveedor_cuentas_pago" TO "authenticated";
GRANT ALL ON TABLE "public"."proveedor_cuentas_pago" TO "service_role";



GRANT ALL ON TABLE "public"."proveedores" TO "anon";
GRANT ALL ON TABLE "public"."proveedores" TO "authenticated";
GRANT ALL ON TABLE "public"."proveedores" TO "service_role";



GRANT ALL ON TABLE "public"."referencia_cortes" TO "anon";
GRANT ALL ON TABLE "public"."referencia_cortes" TO "authenticated";
GRANT ALL ON TABLE "public"."referencia_cortes" TO "service_role";



GRANT ALL ON TABLE "public"."referencias_producto" TO "anon";
GRANT ALL ON TABLE "public"."referencias_producto" TO "authenticated";
GRANT ALL ON TABLE "public"."referencias_producto" TO "service_role";



GRANT ALL ON TABLE "public"."tipos_producto" TO "anon";
GRANT ALL ON TABLE "public"."tipos_producto" TO "authenticated";
GRANT ALL ON TABLE "public"."tipos_producto" TO "service_role";



GRANT ALL ON TABLE "public"."unidades_medida" TO "anon";
GRANT ALL ON TABLE "public"."unidades_medida" TO "authenticated";
GRANT ALL ON TABLE "public"."unidades_medida" TO "service_role";



GRANT ALL ON TABLE "public"."usuarios" TO "anon";
GRANT ALL ON TABLE "public"."usuarios" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios" TO "service_role";



GRANT ALL ON TABLE "public"."ventas" TO "anon";
GRANT ALL ON TABLE "public"."ventas" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


