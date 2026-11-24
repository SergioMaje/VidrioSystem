-- Pruebas de la solicitud de autorización de un anticipo menor al 50%.
--
-- Mismo esquema que autorizacion_anticipo.sql: todo dentro de una transacción
-- que termina en ROLLBACK, con usuarios simulados por `request.jwt.claims`.
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

-- Pide la autorización y devuelve el id de la solicitud.
create function pg_temp.solicitar(k text, p_monto numeric) returns uuid language sql as
  $$ select (public.solicitar_autorizacion_anticipo(pg_temp.id(k), p_monto, 'Cliente frecuente')).id $$;

create function pg_temp.estado(p_id uuid) returns text language sql as
  $$ select estado::text from public.solicitudes_anticipo where id = p_id $$;

do $$ begin
  execute format('grant execute on all functions in schema %I to authenticated', pg_my_temp_schema()::regnamespace);
end $$;

-- ── Datos de prueba ─────────────────────────────────────────────────────────

select pg_temp.guardar('e1', gen_random_uuid()),
       pg_temp.guardar('e2', gen_random_uuid());
insert into public.empresas (id, nombre) values
  (pg_temp.id('e1'), 'Prueba solicitudes'),
  (pg_temp.id('e2'), 'Otra vidriería');

select pg_temp.guardar('admin', gen_random_uuid()),
       pg_temp.guardar('vendedor', gen_random_uuid()),
       pg_temp.guardar('admin2', gen_random_uuid());
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.id('admin'),    'admin.solicitud@test.local',    'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'admin')::jsonb, '{"nombre":"Admin"}'),
  (pg_temp.id('vendedor'), 'vendedor.solicitud@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'vendedor')::jsonb, '{"nombre":"Vendedor"}'),
  (pg_temp.id('admin2'),   'admin.otra@test.local',         'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e2'), 'rol', 'admin')::jsonb, '{"nombre":"Admin otra"}');

select pg_temp.como('admin');
with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Solicitud') returning id
) select pg_temp.guardar('cli', id) from x;

-- Una cotización por caso: un cobro que entra la convierte en venta.
with x as (
  insert into public.cotizaciones (notas, cliente_id, estado, subtotal, total)
  select k, pg_temp.id('cli'), 'enviada', 1000000, 1000000
  from (values ('exacto'), ('mayor'), ('menor'), ('rechazo'), ('total'), ('reemplazo'), ('otra_empresa')) v(k)
  returning id, notas as k
) select pg_temp.guardar(k, id) from x;

with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('admin'), 0) returning id
) select pg_temp.guardar('caja', id) from x;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Validaciones al pedir
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.solicitar_autorizacion_anticipo(%L, 500000, 'x')$q$, pg_temp.id('exacto')),
  'ya cumple el mínimo');
select pg_temp.debe_fallar(format(
  $q$select public.solicitar_autorizacion_anticipo(%L, 0, 'x')$q$, pg_temp.id('exacto')),
  'mayor a cero');
select pg_temp.debe_fallar(format(
  $q$select public.solicitar_autorizacion_anticipo(%L, 300000, '  ')$q$, pg_temp.id('exacto')),
  'motivo');

-- Nadie escribe la tabla directo.
select pg_temp.debe_fallar(format(
  $q$insert into public.solicitudes_anticipo (cotizacion_id, monto_minimo, total_cotizacion, motivo, estado, resuelto_por, resuelto_at)
     values (%L, 100000, 1000000, 'x', 'aprobada', %L, now())$q$,
  pg_temp.id('exacto'), pg_temp.id('admin')),
  'permission denied');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Pendiente no autoriza; el vendedor no puede aprobarse
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.guardar('s_exacto', pg_temp.solicitar('exacto', 300000));
select pg_temp.debe_fallar(format(
  $q$select public.registrar_anticipo_cotizacion(%L, 'efectivo', 300000)$q$, pg_temp.id('exacto')),
  'al menos el 50%');
select pg_temp.debe_fallar(format(
  $q$select public.resolver_solicitud_anticipo(%L, true)$q$, pg_temp.id('s_exacto')),
  'Solo un administrador');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Aprobada: el vendedor cobra el monto aprobado, una sola vez
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;
select public.resolver_solicitud_anticipo(pg_temp.id('s_exacto'), true);
select pg_temp.debe_fallar(format(
  $q$select public.resolver_solicitud_anticipo(%L, false, 'cambio de idea')$q$, pg_temp.id('s_exacto')),
  'ya no está pendiente');
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('exacto'), 'efectivo', 300000);
select pg_temp.afirmar(
  (select autorizado_por = pg_temp.id('admin') and motivo_autorizacion = 'Cliente frecuente'
     from public.ventas where cotizacion_id = pg_temp.id('exacto')),
  'el cobro queda autorizado por el admin que aprobó, con el motivo de la solicitud');
select pg_temp.afirmar(
  pg_temp.estado(pg_temp.id('s_exacto')) = 'usada'
  and (select venta_id from public.solicitudes_anticipo where id = pg_temp.id('s_exacto'))
      = (select id from public.ventas where cotizacion_id = pg_temp.id('exacto')),
  'la solicitud queda usada y apunta al cobro');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. El aprobado es un piso: más sí, menos no
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.guardar('s_mayor', pg_temp.solicitar('mayor', 200000));
select pg_temp.guardar('s_menor', pg_temp.solicitar('menor', 300000));
reset role;
select pg_temp.como('admin');
set local role authenticated;
select public.resolver_solicitud_anticipo(pg_temp.id('s_mayor'), true);
select public.resolver_solicitud_anticipo(pg_temp.id('s_menor'), true);
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('mayor'), 'efectivo', 350000);
select pg_temp.afirmar(pg_temp.estado(pg_temp.id('s_mayor')) = 'usada', 'un monto mayor al aprobado entra');

select pg_temp.debe_fallar(format(
  $q$select public.registrar_anticipo_cotizacion(%L, 'efectivo', 250000)$q$, pg_temp.id('menor')),
  'autorizado es desde');
select pg_temp.afirmar(pg_temp.estado(pg_temp.id('s_menor')) = 'aprobada',
  'el cobro rechazado no gasta la autorización');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Rechazada: no autoriza y exige motivo
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.guardar('s_rechazo', pg_temp.solicitar('rechazo', 100000));
reset role;
select pg_temp.como('admin');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.resolver_solicitud_anticipo(%L, false)$q$, pg_temp.id('s_rechazo')),
  'motivo del rechazo');
select public.resolver_solicitud_anticipo(pg_temp.id('s_rechazo'), false, 'Muy poco anticipo');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.registrar_anticipo_cotizacion(%L, 'efectivo', 100000)$q$, pg_temp.id('rechazo')),
  'al menos el 50%');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Si el total cambió después de aprobar, la solicitud ya no sirve
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.guardar('s_total', pg_temp.solicitar('total', 300000));
reset role;
select pg_temp.como('admin');
set local role authenticated;
select public.resolver_solicitud_anticipo(pg_temp.id('s_total'), true);
reset role;
update public.cotizaciones set subtotal = 1200000, total = 1200000 where id = pg_temp.id('total');
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.registrar_anticipo_cotizacion(%L, 'efectivo', 300000)$q$, pg_temp.id('total')),
  'total de la cotización cambió');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Pedir otra vez cancela la anterior
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.guardar('s_viejo', pg_temp.solicitar('reemplazo', 300000));
select pg_temp.guardar('s_nuevo', pg_temp.solicitar('reemplazo', 200000));
select pg_temp.afirmar(
  pg_temp.estado(pg_temp.id('s_viejo')) = 'cancelada' and pg_temp.estado(pg_temp.id('s_nuevo')) = 'pendiente',
  'la solicitud nueva reemplaza a la anterior');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Otra vidriería no la ve ni la resuelve
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.guardar('s_ajena', pg_temp.solicitar('otra_empresa', 300000));
reset role;
select pg_temp.como('admin2');
set local role authenticated;
select pg_temp.afirmar(
  not exists (select 1 from public.solicitudes_anticipo where id = pg_temp.id('s_ajena')),
  'otra vidriería no ve la solicitud');
select pg_temp.debe_fallar(format(
  $q$select public.resolver_solicitud_anticipo(%L, true)$q$, pg_temp.id('s_ajena')),
  'Solicitud no encontrada');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
\echo 'OK: todas las pruebas de solicitudes de anticipo pasaron'
rollback;
