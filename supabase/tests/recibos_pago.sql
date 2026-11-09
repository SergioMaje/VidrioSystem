-- Pruebas del número de recibo de pago (ventas.numero_recibo).
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

-- El recibo de la venta más reciente de una cotización (o de mostrador).
create function pg_temp.recibo_cot(k text) returns text language sql as
  $$ select numero_recibo from public.ventas where cotizacion_id = pg_temp.id(k)
     order by created_at desc, numero_recibo desc limit 1 $$;

do $$ begin
  execute format('grant execute on all functions in schema %I to authenticated', pg_my_temp_schema()::regnamespace);
end $$;

-- ── Datos de prueba ─────────────────────────────────────────────────────────

select pg_temp.guardar('e1', gen_random_uuid()), pg_temp.guardar('e2', gen_random_uuid());
insert into public.empresas (id, nombre) values
  (pg_temp.id('e1'), 'Prueba recibos 1'),
  (pg_temp.id('e2'), 'Prueba recibos 2');

select pg_temp.guardar('admin', gen_random_uuid()),
       pg_temp.guardar('vendedor', gen_random_uuid()),
       pg_temp.guardar('admin2', gen_random_uuid());
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.id('admin'),    'admin.recibos@test.local',    'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'admin')::jsonb, '{"nombre":"Admin"}'),
  (pg_temp.id('vendedor'), 'vendedor.recibos@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'vendedor')::jsonb, '{"nombre":"Vendedor"}'),
  (pg_temp.id('admin2'),   'admin2.recibos@test.local',   'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e2'), 'rol', 'admin')::jsonb, '{"nombre":"Otra"}');

-- Empresa 1: cliente, dos cotizaciones de 1.000, un ítem y caja abierta.
select pg_temp.como('admin');
with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Recibos') returning id
) select pg_temp.guardar('cliente', id) from x;

with x as (
  insert into public.cotizaciones (numero, cliente_id, estado, subtotal, total)
  select 'COT-TESTRC-' || k, pg_temp.id('cliente'), 'enviada', 1000, 1000
  from (values ('uno'), ('dos')) v(k)
  returning id, substring(numero from 12) as k
) select pg_temp.guardar(k, id) from x;

with x as (
  insert into public.items_inventario (codigo, nombre, stock_actual, precio_venta)
  values ('TEST-RECIBO-1', 'Espejo de prueba', 10, 50) returning id
) select pg_temp.guardar('item', id) from x;

with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('admin'), 100000) returning id
) select pg_temp.guardar('caja1', id) from x;

-- Empresa 2: su propia cotización y caja.
select pg_temp.como('admin2');
with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Otra') returning id
) select pg_temp.guardar('cliente2', id) from x;
with x as (
  insert into public.cotizaciones (numero, cliente_id, estado, subtotal, total)
  values ('COT-TESTRC-OTRA', pg_temp.id('cliente2'), 'enviada', 1000, 1000) returning id
) select pg_temp.guardar('otra', id) from x;
with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('admin2'), 1000) returning id
) select pg_temp.guardar('caja2', id) from x;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Un cobro que falla no consume número
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.registrar_anticipo_cotizacion(%L, 'efectivo', 100)$q$, pg_temp.id('uno')),
  'al menos el 50');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Las tres vías de cobro numeran en orden
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('uno'), 'efectivo', 600);
reset role;
select pg_temp.afirmar(pg_temp.recibo_cot('uno') = 'RC-0001',
  'el primer cobro es RC-0001 (el anticipo rechazado no consumió número): ' || coalesce(pg_temp.recibo_cot('uno'), 'null'));

-- Abono directo desde el navegador, intentando elegir su número.
select pg_temp.como('vendedor');
set local role authenticated;
insert into public.ventas (cotizacion_id, session_id, metodo_pago, monto, tipo, usuario_id, numero_recibo)
values (pg_temp.id('uno'), pg_temp.id('caja1'), 'transferencia', 200, 'abono', pg_temp.id('vendedor'), 'RC-9999');
reset role;
select pg_temp.afirmar(pg_temp.recibo_cot('uno') = 'RC-0002', 'el abono es RC-0002 y se ignora el número enviado');
select pg_temp.afirmar(
  not exists (select 1 from public.ventas where numero_recibo = 'RC-9999'),
  'nadie quedó con el número inventado');

select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.guardar('vm', (public.registrar_venta_mostrador(null, 'efectivo',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('item'), 'cantidad', 1, 'precio_unitario', 50)))).id);
reset role;
select pg_temp.afirmar(
  (select numero_recibo from public.ventas where venta_mostrador_id = pg_temp.id('vm')) = 'RC-0003',
  'la venta de mostrador es RC-0003');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Cada vidriería tiene su propia numeración
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin2');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('otra'), 'efectivo', 1000);
reset role;
select pg_temp.afirmar(pg_temp.recibo_cot('otra') = 'RC-0001', 'la otra vidriería arranca en RC-0001');

-- Y la primera sigue donde iba.
select pg_temp.como('vendedor');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('dos'), 'efectivo', 500);
reset role;
select pg_temp.afirmar(pg_temp.recibo_cot('dos') = 'RC-0004', 'la primera vidriería sigue en RC-0004');

-- ════════════════════════════════════════════════════════════════════════════
-- 4. El número no se cambia, y anular el cobro lo conserva
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.debe_fallar(format(
  $q$update public.ventas set numero_recibo = 'RC-0500' where cotizacion_id = %L$q$, pg_temp.id('dos')),
  'no se pueden modificar');

select pg_temp.como('admin');
set local role authenticated;
select public.anular_venta(v.id, 'Prueba de anulación del recibo')
  from public.ventas v where v.cotizacion_id = pg_temp.id('dos');
reset role;
select pg_temp.afirmar(
  (select numero_recibo from public.ventas where cotizacion_id = pg_temp.id('dos')) = 'RC-0004'
  and (select anulado_at from public.ventas where cotizacion_id = pg_temp.id('dos')) is not null,
  'el cobro anulado conserva su número');

-- El siguiente cobro no reutiliza el número del anulado.
select pg_temp.como('vendedor');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('dos'), 'efectivo', 500);
reset role;
select pg_temp.afirmar(pg_temp.recibo_cot('dos') = 'RC-0005', 'el nuevo cobro es RC-0005');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. El contador no se lee desde el navegador
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar('select * from public.recibos_consecutivo', 'permission denied');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Mensaje de agradecimiento: hasta 200 caracteres
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.debe_fallar(format(
  $q$insert into public.configuracion_empresa (empresa_id, nombre, mensaje_recibo) values (%L, 'Prueba', %L)$q$,
  pg_temp.id('e1'), repeat('x', 201)),
  'mensaje_recibo_check');
insert into public.configuracion_empresa (empresa_id, nombre, mensaje_recibo)
values (pg_temp.id('e1'), 'Prueba', '¡Gracias por confiar en {empresa}!');

-- ════════════════════════════════════════════════════════════════════════════
\echo 'OK: todas las pruebas de recibos de pago pasaron'
rollback;
