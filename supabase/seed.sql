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
-- Todos los inserts son idempotentes (`on conflict do nothing`) para que correr
-- el seed dos veces no falle.

create extension if not exists pgcrypto with schema extensions;

-- ==========================================================================
-- Usuario administrador de pruebas
-- ==========================================================================
-- Se inserta directo en auth.users porque GoTrue no expone un endpoint de
-- "crear usuario ya confirmado" sin service_role. `email_confirmed_at` se setea
-- para saltarse el correo de confirmacion, que en local no se envia a ningun lado.

do $$
declare
  v_user_id uuid := '00000000-0000-4000-8000-000000000001';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    'admin@glazz.local',
    extensions.crypt('admin123', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nombre":"Admin","apellido":"Local"}'::jsonb
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

  -- Perfil de la app. useAuth() lo busca por id despues del login
  -- (src/hooks/useAuth.ts); sin esta fila el usuario entra sin rol.
  insert into public.usuarios (id, nombre, apellido, email, rol, activo)
  values (v_user_id, 'Admin', 'Local', 'admin@glazz.local', 'admin', true)
  on conflict (id) do nothing;
end $$;

-- ==========================================================================
-- Catalogos base
-- ==========================================================================
insert into public.categorias (nombre, descripcion, icono) values
  ('Vidrio',    'Laminas de vidrio de distintos espesores y acabados', 'square'),
  ('Perfileria','Perfiles de aluminio para marcos y hojas',            'minus'),
  ('Herrajes',  'Rodachinas, cerraduras, bisagras y accesorios',       'settings'),
  ('Sellantes', 'Siliconas, empaques y felpas',                        'droplet')
on conflict do nothing;

insert into public.unidades_medida (nombre, simbolo, tipo) values
  ('Metro cuadrado', 'm2', 'area'),
  ('Metro lineal',   'ml', 'longitud'),
  ('Unidad',         'und','unidad'),
  ('Kilogramo',      'kg', 'peso'),
  ('Litro',          'L',  'volumen')
on conflict do nothing;

insert into public.tipos_producto (nombre, descripcion) values
  ('ventana',  'Ventanas corredizas, proyectantes y fijas'),
  ('puerta',   'Puertas de aluminio y vidrio templado'),
  ('division', 'Divisiones de bano y oficina'),
  ('espejo',   'Espejos con y sin marco'),
  ('otro',     'Productos que no encajan en las categorias anteriores')
on conflict do nothing;

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
values ('Cliente', 'De Prueba', 'natural', '1000000000', '3000000000', 'cliente@glazz.local', 'Bogota')
on conflict do nothing;
