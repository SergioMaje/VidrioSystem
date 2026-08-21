-- Datos semilla para la base de datos LOCAL en Docker.
--
-- La CLI de Supabase ejecuta este archivo automaticamente al final de cada
-- `supabase db reset`, despues de aplicar todas las migraciones.
--
-- NUNCA se aplica al proyecto remoto: `supabase db push` solo envia migraciones,
-- no el seed. Por eso las credenciales de abajo son deliberadamente falsas y
-- publicas: solo sirven para entrar a la app en la maquina de cada desarrollador.
--
--   Usuario:  admin@glazz.local
--   Clave:    admin123
--
-- Todos los inserts son idempotentes, asi que correr el seed dos veces no falla.

create extension if not exists pgcrypto with schema extensions;

-- ==========================================================================
-- Usuario administrador de pruebas
-- ==========================================================================
-- Se inserta directo en auth.users porque GoTrue no expone un endpoint de
-- "crear usuario ya confirmado" sin service_role. `email_confirmed_at` se setea
-- para saltarse el correo de confirmacion, que en local no se envia a ningun lado.
--
-- OJO con el trigger `on_auth_user_created`: al insertar en auth.users, la
-- funcion handle_new_user() crea sola la fila en public.usuarios con
-- rol = 'vendedor'. Por eso el insert de abajo hace `do update` y no
-- `do nothing`: sin eso, este usuario quedaria como vendedor y no podria
-- ejecutar las politicas de borrado, que exigen get_user_rol() = 'admin'.

do $$
declare
  v_user_id uuid := '00000000-0000-4000-8000-000000000001';
begin
  -- Las cuatro columnas de token del final no tienen default y quedarian en
  -- NULL. GoTrue las lee como texto no nulo, asi que un NULL ahi hace que el
  -- login falle con un opaco "Database error querying schema" (HTTP 500).
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    'admin@glazz.local',
    extensions.crypt('admin123', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nombre":"Admin","apellido":"Local"}'::jsonb,
    '', '', '', ''
  )
  on conflict (id) do nothing;

  -- Identidad de tipo email: GoTrue la exige para permitir login con contrasena.
  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, created_at, updated_at
  ) values (
    gen_random_uuid(),
    v_user_id,
    v_user_id::text,
    'email',
    format('{"sub":"%s","email":"admin@glazz.local","email_verified":true}', v_user_id)::jsonb,
    now(), now()
  )
  on conflict (provider, provider_id) do nothing;

  -- Promueve a admin la fila que ya creo el trigger.
  insert into public.usuarios (id, nombre, apellido, email, rol, activo)
  values (v_user_id, 'Admin', 'Local', 'admin@glazz.local', 'admin'::public.rol_usuario, true)
  on conflict (id) do update
    set rol = 'admin'::public.rol_usuario,
        nombre = excluded.nombre,
        apellido = excluded.apellido,
        activo = true;
end $$;

-- ==========================================================================
-- Catalogos base
-- ==========================================================================
insert into public.categorias (nombre, descripcion, icono) values
  ('Vidrio',    'Laminas de vidrio de distintos espesores y acabados', 'square'),
  ('Perfileria','Perfiles de aluminio para marcos y hojas',            'minus'),
  ('Herrajes',  'Rodachinas, cerraduras, bisagras y accesorios',       'settings'),
  ('Sellantes', 'Siliconas, empaques y felpas',                        'droplet')
on conflict (nombre) do nothing;

insert into public.unidades_medida (nombre, simbolo, tipo) values
  ('Metro cuadrado', 'm2', 'area'::public.tipo_unidad),
  ('Metro lineal',   'ml', 'longitud'::public.tipo_unidad),
  ('Unidad',         'und','unidad'::public.tipo_unidad),
  ('Kilogramo',      'kg', 'peso'::public.tipo_unidad),
  ('Litro',          'L',  'volumen'::public.tipo_unidad)
on conflict (nombre) do nothing;

insert into public.tipos_producto (nombre, descripcion) values
  ('ventana'::public.tipo_producto_enum,  'Ventanas corredizas, proyectantes y fijas'),
  ('puerta'::public.tipo_producto_enum,   'Puertas de aluminio y vidrio templado'),
  ('division'::public.tipo_producto_enum, 'Divisiones de bano y oficina'),
  ('espejo'::public.tipo_producto_enum,   'Espejos con y sin marco'),
  ('otro'::public.tipo_producto_enum,     'Productos que no encajan en las categorias anteriores')
on conflict (nombre) do nothing;

-- ==========================================================================
-- Inventario de ejemplo
-- ==========================================================================
insert into public.items_inventario (
  codigo, nombre, descripcion, categoria_id, unidad_medida_id,
  stock_actual, stock_minimo, precio_costo, precio_venta
)
select v.codigo, v.nombre, v.descripcion,
       (select id from public.categorias      where nombre = v.categoria limit 1),
       (select id from public.unidades_medida where simbolo = v.unidad   limit 1),
       v.stock_actual, v.stock_minimo, v.precio_costo, v.precio_venta
from (values
  ('VID-4MM',  'Vidrio incoloro 4mm',   'Lamina de vidrio flotado 4mm',      'Vidrio',     'm2',  50.0,  10.0,  28000.0,  45000.0),
  ('VID-6MM',  'Vidrio incoloro 6mm',   'Lamina de vidrio flotado 6mm',      'Vidrio',     'm2',  30.0,   8.0,  42000.0,  68000.0),
  ('PER-MAR',  'Perfil marco 3814',     'Perfil de aluminio para marco',     'Perfileria', 'ml', 120.0,  30.0,   9500.0,  16000.0),
  ('PER-HOJ',  'Perfil hoja 3815',      'Perfil de aluminio para hoja movil','Perfileria', 'ml', 100.0,  30.0,   8800.0,  15000.0),
  ('HER-ROD',  'Rodachina doble',       'Rodachina para ventana corrediza',  'Herrajes',   'und', 80.0,  20.0,   3200.0,   6500.0),
  ('SEL-SIL',  'Silicona neutra',       'Cartucho de silicona neutra 280ml', 'Sellantes',  'und', 25.0,  10.0,  11000.0,  18000.0)
) as v(codigo, nombre, descripcion, categoria, unidad, stock_actual, stock_minimo, precio_costo, precio_venta)
on conflict (codigo) do nothing;

-- ==========================================================================
-- Cliente de ejemplo, para poder cotizar de inmediato
-- ==========================================================================
insert into public.clientes (nombre, apellido, tipo, documento, telefono, email, ciudad)
values ('Cliente', 'De Prueba', 'natural'::public.tipo_cliente,
        '1000000000', '3000000000', 'cliente@glazz.local', 'Bogota')
on conflict (documento) do nothing;
