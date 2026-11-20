-- Pruebas de los tipos de categoría propios de cada vidriería.
--
-- Mismo esquema que categorias_envio.sql: todo dentro de una transacción que
-- termina en ROLLBACK, con usuarios simulados por `request.jwt.claims`.
--
--   npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;

begin;

-- ── Utilidades ──────────────────────────────────────────────────────────────

create function pg_temp.id(k text) returns uuid language sql as
  $$ select current_setting('t.' || k)::uuid $$;

create function pg_temp.guardar(k text, v uuid) returns uuid language sql as
  $$ select set_config('t.' || k, v::text, true)::uuid $$;

create function pg_temp.como(k text) returns void language sql as
  $$ select set_config('request.jwt.claims',
       json_build_object('sub', current_setting('t.' || k), 'role', 'authenticated')::text, true) $$;

create function pg_temp.debe_fallar(p_sql text, p_patron text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not ilike '%' || p_patron || '%' then
      raise exception 'Se esperaba un error con "%", pero fue: %', p_patron, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Se esperaba un error con "%", pero la operación pasó: %', p_patron, p_sql;
end $$;

create function pg_temp.afirmar(p_ok boolean, p_mensaje text) returns void language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'FALLA: %', p_mensaje;
  end if;
end $$;

-- Filas que el usuario actual toca con un update (RLS no falla: deja 0 filas).
create function pg_temp.filas_update(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

do $$ begin
  execute format('grant execute on all functions in schema %I to authenticated', pg_my_temp_schema()::regnamespace);
end $$;

-- ── Datos de prueba ─────────────────────────────────────────────────────────

select pg_temp.guardar('e1', gen_random_uuid()), pg_temp.guardar('e2', gen_random_uuid());
insert into public.empresas (id, nombre) values
  (pg_temp.id('e1'), 'Prueba tipos de categoría 1'),
  (pg_temp.id('e2'), 'Prueba tipos de categoría 2');

select pg_temp.guardar('admin', gen_random_uuid()),
       pg_temp.guardar('vendedor', gen_random_uuid()),
       pg_temp.guardar('admin2', gen_random_uuid());
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.id('admin'),    'admin.tiposcat@test.local',    'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'admin')::jsonb, '{"nombre":"Admin"}'),
  (pg_temp.id('vendedor'), 'vendedor.tiposcat@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'vendedor')::jsonb, '{"nombre":"Vendedor"}'),
  (pg_temp.id('admin2'),   'admin2.tiposcat@test.local',   'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e2'), 'rol', 'admin')::jsonb, '{"nombre":"Otra"}');

select pg_temp.guardar('grupo', gen_random_uuid());

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Un vendedor crea un tipo y lo usa en una categoría del envío
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;

with x as (
  insert into public.tipos_categoria_envio (nombre, color) values ('Baño', '#15803d') returning id
) select pg_temp.guardar('bano', id) from x;

select pg_temp.afirmar(
  (select empresa_id from public.tipos_categoria_envio where id = pg_temp.id('bano')) = pg_temp.id('e1'),
  'el tipo queda en la empresa del vendedor');

with x as (
  insert into public.envio_categorias (grupo_id, nombre, tipo, tipo_personalizado_id, orden)
  values (pg_temp.id('grupo'), 'Baño principal', 'otro', pg_temp.id('bano'), 0) returning id
) select pg_temp.guardar('cat', id) from x;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Restricciones
-- ════════════════════════════════════════════════════════════════════════════
-- Con tipo propio, el tipo fijo es 'otro'.
select pg_temp.debe_fallar(format(
  $q$insert into public.envio_categorias (grupo_id, nombre, tipo, tipo_personalizado_id, orden)
     values (%L, 'Puerta baño', 'puerta', %L, 1)$q$,
  pg_temp.id('grupo'), pg_temp.id('bano')),
  'envio_categorias_tipo_personalizado_otro');

-- El nombre no se repite, sin importar mayúsculas ni espacios.
select pg_temp.debe_fallar(
  $q$insert into public.tipos_categoria_envio (nombre, color) values ('  BAÑO ', '#0369a1')$q$,
  'tipos_categoria_envio_nombre_unico');

-- Color en hex minúscula de 6 dígitos.
select pg_temp.debe_fallar(
  $q$insert into public.tipos_categoria_envio (nombre, color) values ('Fachada', 'verde')$q$,
  'tipos_categoria_envio_color_valido');
select pg_temp.debe_fallar(
  $q$insert into public.tipos_categoria_envio (nombre, color) values ('Fachada', '#15803D')$q$,
  'tipos_categoria_envio_color_valido');

-- Nombre vacío o de más de 30 caracteres.
select pg_temp.debe_fallar(
  $q$insert into public.tipos_categoria_envio (nombre, color) values ('   ', '#15803d')$q$,
  'tipos_categoria_envio_nombre_valido');
select pg_temp.debe_fallar(
  $q$insert into public.tipos_categoria_envio (nombre, color) values (repeat('x', 31), '#15803d')$q$,
  'tipos_categoria_envio_nombre_valido');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Permisos: el vendedor crea pero no edita ni borra
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.afirmar(
  pg_temp.filas_update(format(
    $q$update public.tipos_categoria_envio set nombre = 'Baños' where id = %L$q$, pg_temp.id('bano'))) = 0,
  'el vendedor no puede renombrar un tipo');
select pg_temp.afirmar(
  pg_temp.filas_update(format(
    $q$delete from public.tipos_categoria_envio where id = %L$q$, pg_temp.id('bano'))) = 0,
  'el vendedor no puede borrar un tipo');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. El admin edita y archiva, pero no borra uno en uso
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;

select pg_temp.afirmar(
  pg_temp.filas_update(format(
    $q$update public.tipos_categoria_envio set nombre = 'Baños', color = '#0369a1', activo = false where id = %L$q$,
    pg_temp.id('bano'))) = 1,
  'el admin renombra, cambia el color y archiva');

select pg_temp.debe_fallar(format(
  $q$delete from public.tipos_categoria_envio where id = %L$q$, pg_temp.id('bano')),
  'envio_categorias_tipo_personalizado_fkey');

-- Archivado, la categoría lo sigue mostrando con el nombre nuevo.
select pg_temp.afirmar(
  (select t.nombre from public.envio_categorias c
     join public.tipos_categoria_envio t on t.id = c.tipo_personalizado_id
    where c.id = pg_temp.id('cat')) = 'Baños',
  'la categoría sigue apuntando al tipo archivado');

-- Uno sin uso sí se puede borrar.
with x as (
  insert into public.tipos_categoria_envio (nombre, color) values ('Temporal', '#57534e') returning id
) select pg_temp.guardar('temporal', id) from x;
select pg_temp.afirmar(
  pg_temp.filas_update(format(
    $q$delete from public.tipos_categoria_envio where id = %L$q$, pg_temp.id('temporal'))) = 1,
  'el admin borra un tipo que nadie usa');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Otra vidriería no lo ve ni lo puede usar
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin2');
set local role authenticated;

select pg_temp.afirmar(
  (select count(*) from public.tipos_categoria_envio where id = pg_temp.id('bano')) = 0,
  'otra vidriería no ve el tipo');

-- Puede tener su propio "Baños": el nombre es único por vidriería.
insert into public.tipos_categoria_envio (nombre, color) values ('Baños', '#be123c');

select pg_temp.debe_fallar(format(
  $q$insert into public.envio_categorias (grupo_id, nombre, tipo, tipo_personalizado_id, orden)
     values (gen_random_uuid(), 'Ajena', 'otro', %L, 0)$q$,
  pg_temp.id('bano')),
  'envio_categorias_tipo_personalizado_fkey');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
\echo 'OK: todas las pruebas de tipos de categoría pasaron'
rollback;
