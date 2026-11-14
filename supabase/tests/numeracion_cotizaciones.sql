-- Pruebas de la numeración consecutiva de cotizaciones (COT-00001…).
--
-- Mismo esquema que recibos_pago.sql: todo dentro de una transacción que
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

create function pg_temp.numero(k text) returns text language sql as
  $$ select numero from public.cotizaciones where id = pg_temp.id(k) $$;

create function pg_temp.consecutivo(k text) returns bigint language sql as
  $$ select consecutivo from public.cotizaciones where id = pg_temp.id(k) $$;

-- Una cotización suelta; `p_numero` es lo que mandaría el navegador.
create function pg_temp.suelta(k text, p_numero text default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.cotizaciones (numero, cliente_id, estado, subtotal, total)
  values (p_numero, pg_temp.id('cliente'), 'enviada', 1000, 1000)
  returning id into v;
  return pg_temp.guardar(k, v);
end $$;

-- Una opción de un envío, con un ítem para que se pueda consolidar.
create function pg_temp.opcion(k text, p_grupo text, p_cat text, p_etiqueta text, p_numero text default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.cotizaciones
    (numero, cliente_id, estado, subtotal, total, grupo_id, categoria_id, opcion_etiqueta)
  values
    (p_numero, pg_temp.id('cliente'), 'enviada', 1000, 1190, pg_temp.id(p_grupo),
     case when p_cat is null then null else pg_temp.id(p_cat) end, p_etiqueta)
  returning id into v;
  insert into public.cotizacion_items (cotizacion_id, descripcion, cantidad, precio_unitario, precio_total)
  values (v, 'Ítem ' || k, 1, 1000, 1000);
  return pg_temp.guardar(k, v);
end $$;

create function pg_temp.categoria(k text, p_grupo text, p_orden int) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.envio_categorias (grupo_id, nombre, tipo, orden)
  values (pg_temp.id(p_grupo), 'Categoría ' || k, 'ventana', p_orden)
  returning id into v;
  return pg_temp.guardar(k, v);
end $$;

do $$ begin
  execute format('grant execute on all functions in schema %I to authenticated', pg_my_temp_schema()::regnamespace);
end $$;

-- ── Datos de prueba ─────────────────────────────────────────────────────────

select pg_temp.guardar('e1', gen_random_uuid()), pg_temp.guardar('e2', gen_random_uuid());
insert into public.empresas (id, nombre) values
  (pg_temp.id('e1'), 'Prueba numeración 1'),
  (pg_temp.id('e2'), 'Prueba numeración 2');

select pg_temp.guardar('admin', gen_random_uuid()),
       pg_temp.guardar('vendedor', gen_random_uuid()),
       pg_temp.guardar('admin2', gen_random_uuid());
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.id('admin'),    'admin.numeracion@test.local',    'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'admin')::jsonb, '{"nombre":"Admin"}'),
  (pg_temp.id('vendedor'), 'vendedor.numeracion@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'vendedor')::jsonb, '{"nombre":"Vendedor"}'),
  (pg_temp.id('admin2'),   'admin2.numeracion@test.local',   'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e2'), 'rol', 'admin')::jsonb, '{"nombre":"Otra"}');

select pg_temp.como('admin');
with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Numeración') returning id
) select pg_temp.guardar('cliente', id) from x;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Cotizaciones sueltas: la serie empieza en 1 por vidriería
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.suelta('s1');
select pg_temp.suelta('s2');
select pg_temp.afirmar(pg_temp.numero('s1') = 'COT-00001', 'la primera es COT-00001: ' || pg_temp.numero('s1'));
select pg_temp.afirmar(pg_temp.numero('s2') = 'COT-00002', 'la segunda es COT-00002: ' || pg_temp.numero('s2'));
select pg_temp.afirmar(pg_temp.consecutivo('s2') = 2, 'el consecutivo se guarda como número');

-- La otra vidriería tiene su propia serie.
select pg_temp.como('admin2');
with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Otra') returning id
) select pg_temp.guardar('cliente2', id) from x;
with x as (
  insert into public.cotizaciones (cliente_id, estado, subtotal, total)
  values (pg_temp.id('cliente2'), 'enviada', 1000, 1000) returning id
) select pg_temp.guardar('otra', id) from x;
select pg_temp.afirmar(pg_temp.numero('otra') = 'COT-00001', 'otra vidriería empieza en COT-00001');
select pg_temp.como('admin');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Lo que mande el navegador no cuenta, salvo el formato anterior
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.suelta('inventado', 'COT-00050');
select pg_temp.afirmar(pg_temp.numero('inventado') = 'COT-00003', 'un número inventado se ignora: ' || pg_temp.numero('inventado'));

select pg_temp.suelta('vieja', 'COT-1794000000001');
select pg_temp.afirmar(pg_temp.numero('vieja') = 'COT-1794000000001', 'el formato anterior se respeta');
select pg_temp.afirmar(pg_temp.consecutivo('vieja') is null, 'el formato anterior no tiene consecutivo');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Envío con opciones en un solo insert: comparten el número
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.guardar('g1', gen_random_uuid());
with x as (
  insert into public.cotizaciones (numero, cliente_id, estado, subtotal, total, grupo_id, opcion_etiqueta)
  select 'COT-' || k, pg_temp.id('cliente'), 'enviada', 1000, 1000, pg_temp.id('g1'), k
  from (values ('A'), ('B'), ('C')) v(k)
  returning id, opcion_etiqueta as k
) select pg_temp.guardar('g1' || k, id) from x;
select pg_temp.afirmar(pg_temp.numero('g1A') = 'COT-00004-A', 'opción A: ' || pg_temp.numero('g1A'));
select pg_temp.afirmar(pg_temp.numero('g1B') = 'COT-00004-B', 'opción B: ' || pg_temp.numero('g1B'));
select pg_temp.afirmar(pg_temp.numero('g1C') = 'COT-00004-C', 'opción C: ' || pg_temp.numero('g1C'));
select pg_temp.afirmar(pg_temp.consecutivo('g1C') = 4, 'las opciones comparten el consecutivo');

-- Una opción agregada después hereda la base.
select pg_temp.opcion('g1D', 'g1', null, 'D', 'COT-99999-D');
select pg_temp.afirmar(pg_temp.numero('g1D') = 'COT-00004-D', 'la opción agregada hereda la base: ' || pg_temp.numero('g1D'));

-- Una letra repetida se rechaza con un mensaje claro.
select pg_temp.debe_fallar(format(
  $q$insert into public.cotizaciones (cliente_id, subtotal, total, grupo_id, opcion_etiqueta)
     values (%L, 1, 1, %L, 'B')$q$, pg_temp.id('cliente'), pg_temp.id('g1')),
  'ya tiene la opción B');

-- Una suelta convertida en opción A conserva su número; la B toma su base.
select pg_temp.guardar('g2', gen_random_uuid());
update public.cotizaciones set grupo_id = pg_temp.id('g2'), opcion_etiqueta = 'A' where id = pg_temp.id('s1');
select pg_temp.opcion('g2B', 'g2', null, 'B');
select pg_temp.afirmar(pg_temp.numero('s1') = 'COT-00001', 'la suelta convertida conserva su número');
select pg_temp.afirmar(pg_temp.numero('g2B') = 'COT-00001-B', 'la nueva opción toma su base: ' || pg_temp.numero('g2B'));

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Envío por categorías y su pedido
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.guardar('g3', gen_random_uuid());
select pg_temp.categoria('c1', 'g3', 0);
select pg_temp.categoria('c2', 'g3', 1);
select pg_temp.opcion('g3_1A', 'g3', 'c1', 'A');
select pg_temp.opcion('g3_1B', 'g3', 'c1', 'B');
select pg_temp.opcion('g3_2A', 'g3', 'c2', 'A');
select pg_temp.afirmar(pg_temp.numero('g3_1A') = 'COT-00005-1A', 'categoría 1, opción A: ' || pg_temp.numero('g3_1A'));
select pg_temp.afirmar(pg_temp.numero('g3_1B') = 'COT-00005-1B', 'categoría 1, opción B: ' || pg_temp.numero('g3_1B'));
select pg_temp.afirmar(pg_temp.numero('g3_2A') = 'COT-00005-2A', 'categoría 2, opción A: ' || pg_temp.numero('g3_2A'));

select pg_temp.como('vendedor');
set local role authenticated;
with x as (
  select (public.consolidar_eleccion_envio(pg_temp.id('g3'), array[pg_temp.id('g3_1B'), pg_temp.id('g3_2A')])).id
) select pg_temp.guardar('pedido', id) from x;
reset role;
select pg_temp.afirmar(pg_temp.numero('pedido') = 'COT-00005', 'el pedido lleva la base del envío: ' || pg_temp.numero('pedido'));
select pg_temp.afirmar(pg_temp.consecutivo('pedido') = 5, 'el pedido comparte el consecutivo');

-- Envío por categorías con el formato anterior: todo conserva la base vieja.
select pg_temp.como('admin');
select pg_temp.guardar('g4', gen_random_uuid());
select pg_temp.categoria('c3', 'g4', 0);
select pg_temp.opcion('g4_1A', 'g4', 'c3', 'A', 'COT-1794000000002-1A');
select pg_temp.opcion('g4_1B', 'g4', 'c3', 'B');
select pg_temp.afirmar(pg_temp.numero('g4_1B') = 'COT-1794000000002-1B', 'la opción nueva de un envío viejo hereda la base vieja');
select pg_temp.como('vendedor');
set local role authenticated;
with x as (
  select (public.consolidar_eleccion_envio(pg_temp.id('g4'), array[pg_temp.id('g4_1A')])).id
) select pg_temp.guardar('pedido_viejo', id) from x;
reset role;
select pg_temp.afirmar(pg_temp.numero('pedido_viejo') = 'COT-1794000000002', 'el pedido de un envío viejo lleva la base vieja');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Un insert que falla no gasta número
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
select pg_temp.debe_fallar(format(
  $q$insert into public.cotizaciones (cliente_id, subtotal, total, grupo_id, opcion_etiqueta)
     values (%L, 1, 1, gen_random_uuid(), 'ab')$q$, pg_temp.id('cliente')),
  'cotizaciones_opcion_etiqueta_formato');
select pg_temp.suelta('s6');
select pg_temp.afirmar(pg_temp.numero('s6') = 'COT-00006', 'sin huecos tras un insert fallido: ' || pg_temp.numero('s6'));

-- ════════════════════════════════════════════════════════════════════════════
-- 6. El número no se edita
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.debe_fallar(format(
  $q$update public.cotizaciones set numero = 'COT-00099' where id = %L$q$, pg_temp.id('s2')),
  'no se puede cambiar');
select pg_temp.debe_fallar(format(
  $q$update public.cotizaciones set consecutivo = 99 where id = %L$q$, pg_temp.id('s2')),
  'no se puede cambiar');
update public.cotizaciones set notas = 'editar otras columnas sí se puede' where id = pg_temp.id('s2');

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Sin tope de dígitos
-- ════════════════════════════════════════════════════════════════════════════
update public.empresa_consecutivos set ultimo = 99998
 where empresa_id = pg_temp.id('e1') and clave = 'cotizacion';
select pg_temp.suelta('s99999');
select pg_temp.suelta('s100000');
select pg_temp.afirmar(pg_temp.numero('s99999') = 'COT-99999', 'COT-99999: ' || pg_temp.numero('s99999'));
select pg_temp.afirmar(pg_temp.numero('s100000') = 'COT-100000', 'después de 99.999 sigue COT-100000: ' || pg_temp.numero('s100000'));

select pg_temp.afirmar(public.formato_consecutivo('RC-', 9999, 4) = 'RC-9999', 'RC-9999');
select pg_temp.afirmar(public.formato_consecutivo('RC-', 10000, 4) = 'RC-10000', 'el recibo 10.000 no se corta');
select pg_temp.afirmar(public.formato_consecutivo('VD-', 1000000, 6) = 'VD-1000000', 'la venta 1.000.000 no se corta');
select pg_temp.afirmar(
  (select prosrc like '%formato_consecutivo%' from pg_proc where proname = 'ventas_asignar_recibo'),
  'el recibo usa formato_consecutivo');

-- ════════════════════════════════════════════════════════════════════════════
\echo 'OK: todas las pruebas de numeración de cotizaciones pasaron'
rollback;
