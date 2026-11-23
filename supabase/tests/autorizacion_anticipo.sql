-- Pruebas de la autorización de un anticipo menor al 50%.
--
-- Mismo esquema que credito_clientes.sql: todo dentro de una transacción que
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

do $$ begin
  execute format('grant execute on all functions in schema %I to authenticated', pg_my_temp_schema()::regnamespace);
end $$;

-- ── Datos de prueba ─────────────────────────────────────────────────────────

select pg_temp.guardar('e1', gen_random_uuid());
insert into public.empresas (id, nombre) values (pg_temp.id('e1'), 'Prueba autorización');

select pg_temp.guardar('admin', gen_random_uuid()),
       pg_temp.guardar('vendedor', gen_random_uuid());
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.id('admin'),    'admin.autoriza@test.local',    'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'admin')::jsonb, '{"nombre":"Admin"}'),
  (pg_temp.id('vendedor'), 'vendedor.autoriza@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'vendedor')::jsonb, '{"nombre":"Vendedor"}');

select pg_temp.como('admin');
with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Anticipo') returning id
) select pg_temp.guardar('cli', id) from x;

-- Una cotización por caso: un cobro que entra la convierte en venta.
with x as (
  insert into public.cotizaciones (notas, cliente_id, estado, subtotal, total)
  select k, pg_temp.id('cli'), 'enviada', 1000000, 1000000
  from (values ('falsa'), ('directo'), ('admin_bajo'), ('vendedor_ok')) v(k)
  returning id, notas as k
) select pg_temp.guardar(k, id) from x;

with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('admin'), 0) returning id
) select pg_temp.guardar('caja', id) from x;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Sin autorización, el vendedor no cobra menos del 50%
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.registrar_anticipo_cotizacion(%L, 'efectivo', 100000)$q$, pg_temp.id('falsa')),
  'al menos el 50%');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. El vendedor no puede poner el id del admin como autorizador (RPC)
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.debe_fallar(format(
  $q$select public.registrar_anticipo_cotizacion(%L, 'efectivo', 100000, null, %L, 'motivo inventado')$q$,
  pg_temp.id('falsa'), pg_temp.id('admin')),
  'Solo el administrador que registra el cobro');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Tampoco con un INSERT directo en ventas
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.debe_fallar(format(
  $q$insert into public.ventas (cotizacion_id, session_id, metodo_pago, monto, tipo, usuario_id, autorizado_por, motivo_autorizacion)
     values (%L, %L, 'efectivo', 100000, 'anticipo', %L, %L, 'motivo inventado')$q$,
  pg_temp.id('directo'), pg_temp.id('caja'), pg_temp.id('vendedor'), pg_temp.id('admin')),
  'Solo el administrador que registra el cobro');

select pg_temp.afirmar(
  not exists (select 1 from public.ventas where cotizacion_id in (pg_temp.id('falsa'), pg_temp.id('directo'))),
  'ningún cobro del vendedor bajo el mínimo debió entrar');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. El admin sí autoriza su propio cobro bajo el mínimo
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;
select public.registrar_anticipo_cotizacion(
  pg_temp.id('admin_bajo'), 'efectivo', 100000, null, pg_temp.id('admin'), 'Cliente de confianza');
select pg_temp.afirmar(
  (select autorizado_por from public.ventas where cotizacion_id = pg_temp.id('admin_bajo')) = pg_temp.id('admin'),
  'el cobro del admin queda autorizado por él mismo');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Sin regresión: el vendedor cobra el 50% o más sin autorización
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('vendedor_ok'), 'efectivo', 500000);
select pg_temp.afirmar(
  (select autorizado_por is null from public.ventas where cotizacion_id = pg_temp.id('vendedor_ok')),
  'el anticipo del 50% entra sin autorización');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
\echo 'OK: todas las pruebas de autorización de anticipo pasaron'
rollback;
