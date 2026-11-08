-- Pruebas de las opciones de cotización (un envío con varias opciones).
--
-- Mismo esquema que anulacion_ventas.sql: todo dentro de una transacción que
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

create function pg_temp.estado(k text) returns text language sql as
  $$ select estado::text from public.cotizaciones where id = pg_temp.id(k) $$;

do $$ begin
  execute format('grant execute on all functions in schema %I to authenticated', pg_my_temp_schema()::regnamespace);
end $$;

-- ── Datos de prueba ─────────────────────────────────────────────────────────

select pg_temp.guardar('e1', gen_random_uuid());
insert into public.empresas (id, nombre) values (pg_temp.id('e1'), 'Prueba opciones de cotización');

select pg_temp.guardar('admin', gen_random_uuid()),
       pg_temp.guardar('vendedor', gen_random_uuid());
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.id('admin'),    'admin.opciones@test.local',    'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'admin')::jsonb, '{"nombre":"Admin"}'),
  (pg_temp.id('vendedor'), 'vendedor.opciones@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'vendedor')::jsonb, '{"nombre":"Vendedor"}');

select pg_temp.como('admin');

with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Opciones') returning id
) select pg_temp.guardar('cliente', id) from x;

select pg_temp.guardar('grupo', gen_random_uuid());

-- Envío con cuatro opciones: A, B y C enviadas; D ya rechazada.
with x as (
  insert into public.cotizaciones
    (numero, cliente_id, estado, subtotal, total, grupo_id, opcion_etiqueta, opcion_nombre)
  select 'COT-TESTOP-' || k, pg_temp.id('cliente'), e::public.estado_cotizacion, t, t,
         pg_temp.id('grupo'), k, 'Opción ' || k
  from (values ('A', 'enviada', 1000), ('B', 'enviada', 1500),
               ('C', 'enviada', 2000), ('D', 'rechazada', 900)) v(k, e, t)
  returning id, opcion_etiqueta as k
) select pg_temp.guardar(k, id) from x;

-- Cotización suelta: debe seguir funcionando como antes.
with x as (
  insert into public.cotizaciones (numero, cliente_id, estado, subtotal, total)
  values ('COT-TESTOP-SUELTA', pg_temp.id('cliente'), 'enviada', 800, 800)
  returning id
) select pg_temp.guardar('suelta', id) from x;

with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('admin'), 100000) returning id
) select pg_temp.guardar('caja', id) from x;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Restricciones de las columnas
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.debe_fallar(format(
  $q$insert into public.cotizaciones (numero, cliente_id, subtotal, total, opcion_etiqueta)
     values ('COT-TESTOP-X', %L, 1, 1, 'A')$q$, pg_temp.id('cliente')),
  'cotizaciones_opcion_completa');
select pg_temp.debe_fallar(format(
  $q$insert into public.cotizaciones (numero, cliente_id, subtotal, total, grupo_id, opcion_etiqueta)
     values ('COT-TESTOP-Y', %L, 1, 1, %L, 'A')$q$, pg_temp.id('cliente'), pg_temp.id('grupo')),
  'cotizaciones_grupo_etiqueta_unica');
select pg_temp.debe_fallar(format(
  $q$insert into public.cotizaciones (numero, cliente_id, subtotal, total, grupo_id, opcion_etiqueta)
     values ('COT-TESTOP-Z', %L, 1, 1, %L, 'ab')$q$, pg_temp.id('cliente'), pg_temp.id('grupo')),
  'cotizaciones_opcion_etiqueta_formato');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Cobrar una opción descarta las demás
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('B'), 'efectivo', 750);
reset role;

select pg_temp.afirmar(pg_temp.estado('B') = 'vendida', 'la opción cobrada queda vendida');
select pg_temp.afirmar(pg_temp.estado('A') = 'descartada', 'la opción A queda descartada');
select pg_temp.afirmar(pg_temp.estado('C') = 'descartada', 'la opción C queda descartada');
select pg_temp.afirmar(pg_temp.estado('D') = 'rechazada', 'una opción rechazada no cambia');
select pg_temp.afirmar(
  (select count(*) from public.ordenes_trabajo
    where cotizacion_id in (pg_temp.id('A'), pg_temp.id('B'), pg_temp.id('C'), pg_temp.id('D'))) = 1,
  'solo la opción elegida tiene orden de trabajo');
select pg_temp.afirmar(
  exists (select 1 from public.ordenes_trabajo where cotizacion_id = pg_temp.id('B')),
  'la orden es de la opción elegida');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. No se cobra otra opción del mismo envío
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.registrar_anticipo_cotizacion(%L, 'efectivo', 500)$q$, pg_temp.id('A')),
  'ya eligió la opción B');
select pg_temp.debe_fallar(format(
  $q$insert into public.ventas (cotizacion_id, session_id, metodo_pago, monto, tipo, usuario_id)
     values (%L, %L, 'efectivo', 100, 'abono', %L)$q$,
  pg_temp.id('C'), pg_temp.id('caja'), pg_temp.id('vendedor')),
  'está descartada');
-- La opción elegida sí acepta abonos.
insert into public.ventas (cotizacion_id, session_id, metodo_pago, monto, tipo, usuario_id)
values (pg_temp.id('B'), pg_temp.id('caja'), 'efectivo', 250, 'abono', pg_temp.id('vendedor'));
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Anular la venta elegida no revive las descartadas
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;
select public.anular_venta(v.id, 'Prueba de anulación del abono')
  from public.ventas v where v.cotizacion_id = pg_temp.id('B') and v.tipo = 'abono';
select public.anular_venta(v.id, 'Prueba de anulación del anticipo')
  from public.ventas v where v.cotizacion_id = pg_temp.id('B') and v.tipo = 'anticipo';
reset role;

select pg_temp.afirmar(pg_temp.estado('B') = 'enviada', 'la opción elegida vuelve a enviada');
select pg_temp.afirmar(pg_temp.estado('A') = 'descartada', 'A sigue descartada');
select pg_temp.afirmar(pg_temp.estado('C') = 'descartada', 'C sigue descartada');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Una cotización suelta se cobra igual que antes
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('suelta'), 'efectivo', 400);
reset role;
select pg_temp.afirmar(pg_temp.estado('suelta') = 'vendida', 'la cotización suelta queda vendida');

-- ════════════════════════════════════════════════════════════════════════════
\echo 'OK: todas las pruebas de opciones de cotización pasaron'
rollback;
