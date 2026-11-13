-- Pruebas de las categorías de un envío (una opción por categoría y pedido combinado).
--
-- Mismo esquema que opciones_cotizacion.sql: todo dentro de una transacción que
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

create function pg_temp.categoria(p_nombre text, p_tipo text, p_orden int) returns uuid language sql as $$
  insert into public.envio_categorias (grupo_id, nombre, tipo, orden)
  values (pg_temp.id('grupo'), p_nombre, p_tipo::public.tipo_producto_enum, p_orden)
  returning id
$$;

-- Una opción enviada con un solo ítem del valor dado, 10 % de descuento e IVA 19 %.
create function pg_temp.opcion(k text, p_cat text, p_etiqueta text, p_valor numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.cotizaciones
    (numero, cliente_id, estado, subtotal, descuento_pct, iva_pct, total, grupo_id,
     categoria_id, opcion_etiqueta, opcion_nombre)
  values
    ('COT-TESTCAT-' || k, pg_temp.id('cliente'), 'enviada', p_valor, 10, 19,
     p_valor * 0.9 * 1.19, pg_temp.id('grupo'), pg_temp.id(p_cat), p_etiqueta, 'Opción ' || k)
  returning id into v;
  insert into public.cotizacion_items (cotizacion_id, descripcion, cantidad, precio_unitario, precio_total)
  values (v, 'Ítem ' || k, 1, p_valor, p_valor);
  return pg_temp.guardar('o' || k, v);
end $$;

do $$ begin
  execute format('grant execute on all functions in schema %I to authenticated', pg_my_temp_schema()::regnamespace);
end $$;

-- ── Datos de prueba ─────────────────────────────────────────────────────────

select pg_temp.guardar('e1', gen_random_uuid());
insert into public.empresas (id, nombre) values (pg_temp.id('e1'), 'Prueba categorías de envío');

select pg_temp.guardar('admin', gen_random_uuid()),
       pg_temp.guardar('vendedor', gen_random_uuid());
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.id('admin'),    'admin.categorias@test.local',    'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'admin')::jsonb, '{"nombre":"Admin"}'),
  (pg_temp.id('vendedor'), 'vendedor.categorias@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'vendedor')::jsonb, '{"nombre":"Vendedor"}');

select pg_temp.como('admin');

with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Categorías') returning id
) select pg_temp.guardar('cliente', id) from x;

select pg_temp.guardar('grupo', gen_random_uuid());
select pg_temp.guardar('puerta',  pg_temp.categoria('Puerta principal', 'puerta', 0));
select pg_temp.guardar('ventana', pg_temp.categoria('Ventana cocina', 'ventana', 1));
select pg_temp.guardar('espejo',  pg_temp.categoria('Espejo baño', 'espejo', 2));

-- Puerta: 1A, 1B, 1C. Ventana: 2A, 2B. Espejo: 3A.
select pg_temp.opcion('1A', 'puerta', 'A', 850000);
select pg_temp.opcion('1B', 'puerta', 'B', 980000);
select pg_temp.opcion('1C', 'puerta', 'C', 1100000);
select pg_temp.opcion('2A', 'ventana', 'A', 420000);
select pg_temp.opcion('2B', 'ventana', 'B', 465000);
select pg_temp.opcion('3A', 'espejo', 'A', 200000);

with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('admin'), 100000) returning id
) select pg_temp.guardar('caja', id) from x;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Restricciones
-- ════════════════════════════════════════════════════════════════════════════
-- La misma letra en otra categoría sí se puede (ya existen 1A y 2A); en la misma, no.
select pg_temp.debe_fallar(format(
  $q$insert into public.cotizaciones (numero, cliente_id, subtotal, total, grupo_id, categoria_id, opcion_etiqueta)
     values ('COT-TESTCAT-X', %L, 1, 1, %L, %L, 'A')$q$,
  pg_temp.id('cliente'), pg_temp.id('grupo'), pg_temp.id('puerta')),
  'cotizaciones_grupo_etiqueta_unica');
-- La categoría tiene que ser del mismo envío.
select pg_temp.debe_fallar(format(
  $q$insert into public.cotizaciones (numero, cliente_id, subtotal, total, grupo_id, categoria_id, opcion_etiqueta)
     values ('COT-TESTCAT-Y', %L, 1, 1, %L, %L, 'Z')$q$,
  pg_temp.id('cliente'), gen_random_uuid(), pg_temp.id('puerta')),
  'cotizaciones_categoria_id_fkey');
select pg_temp.debe_fallar(
  $q$insert into public.envio_categorias (grupo_id, nombre, orden) values (gen_random_uuid(), '  ', 0)$q$,
  'envio_categorias_nombre_valido');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Una opción con categoría no se cobra directo
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.registrar_anticipo_cotizacion(%L, 'efectivo', 500000)$q$, pg_temp.id('o1B')),
  'el cobro se hace sobre el pedido');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Elecciones inválidas
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.debe_fallar(format(
  $q$select public.consolidar_eleccion_envio(%L, array[%L, %L]::uuid[])$q$,
  pg_temp.id('grupo'), pg_temp.id('o1A'), pg_temp.id('o1B')),
  'una opción por categoría');
select pg_temp.debe_fallar(format(
  $q$select public.consolidar_eleccion_envio(%L, array[%L, %L]::uuid[])$q$,
  pg_temp.id('grupo'), pg_temp.id('o1A'), pg_temp.id('o1A')),
  'repetidas');
select pg_temp.debe_fallar(format(
  $q$select public.consolidar_eleccion_envio(%L, array[]::uuid[])$q$, pg_temp.id('grupo')),
  'al menos una opción');
select pg_temp.debe_fallar(format(
  $q$select public.consolidar_eleccion_envio(%L, array[%L]::uuid[])$q$,
  gen_random_uuid(), pg_temp.id('o1A')),
  'Envío no encontrado');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Puerta B + ventana A, sin espejo: arma el pedido
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
with x as (
  select (public.consolidar_eleccion_envio(pg_temp.id('grupo'), array[pg_temp.id('o2A'), pg_temp.id('o1B')])).id
) select pg_temp.guardar('pedido', id) from x;
reset role;

select pg_temp.afirmar(
  (select numero from public.cotizaciones where id = pg_temp.id('pedido')) = 'COT-TESTCAT',
  'el pedido toma el número base del envío');
select pg_temp.afirmar(pg_temp.estado('pedido') = 'aprobada', 'el pedido queda aprobado');
select pg_temp.afirmar(
  (select grupo_id is null and categoria_id is null from public.cotizaciones where id = pg_temp.id('pedido')),
  'el pedido es una cotización suelta');
select pg_temp.afirmar(
  (select subtotal = 1400000 and descuento_pct = 10 and iva_pct = 19 and total = 1400000 * 0.9 * 1.19
     from public.cotizaciones where id = pg_temp.id('pedido')),
  'el pedido suma las elegidas con el descuento y el IVA del envío');
select pg_temp.afirmar(
  (select array_agg(descripcion order by descripcion) from public.cotizacion_items
    where cotizacion_id = pg_temp.id('pedido')) = array['Ítem 1B', 'Ítem 2A'],
  'el pedido lleva los ítems de las opciones elegidas');
select pg_temp.afirmar(pg_temp.estado('o1B') = 'aprobada', '1B elegida queda aprobada');
select pg_temp.afirmar(pg_temp.estado('o2A') = 'aprobada', '2A elegida queda aprobada');
select pg_temp.afirmar(pg_temp.estado('o1A') = 'descartada', '1A queda descartada');
select pg_temp.afirmar(pg_temp.estado('o1C') = 'descartada', '1C queda descartada');
select pg_temp.afirmar(pg_temp.estado('o2B') = 'descartada', '2B queda descartada');
select pg_temp.afirmar(pg_temp.estado('o3A') = 'descartada', 'el espejo omitido queda descartado');
select pg_temp.afirmar(
  (select count(*) from public.cotizaciones
    where grupo_id = pg_temp.id('grupo') and pedido_id = pg_temp.id('pedido')) = 6,
  'todas las opciones apuntan al pedido');

-- No se elige dos veces.
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.consolidar_eleccion_envio(%L, array[%L]::uuid[])$q$,
  pg_temp.id('grupo'), pg_temp.id('o2B')),
  'ya eligió en este envío');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. El pedido se cobra como una cotización suelta, sin tocar las opciones
-- ════════════════════════════════════════════════════════════════════════════
select public.registrar_anticipo_cotizacion(pg_temp.id('pedido'), 'efectivo', 800000);
reset role;

select pg_temp.afirmar(pg_temp.estado('pedido') = 'vendida', 'el pedido queda vendido');
select pg_temp.afirmar(pg_temp.estado('o1B') = 'aprobada', 'la opción elegida no cambia al cobrar');
select pg_temp.afirmar(
  (select count(*) from public.ordenes_trabajo where cotizacion_id = pg_temp.id('pedido')) = 1,
  'el pedido tiene una orden de trabajo');
select pg_temp.afirmar(
  (select count(*) from public.ventas
    where cotizacion_id = pg_temp.id('pedido') and numero_recibo is not null) = 1,
  'un solo cobro con su recibo');

-- ════════════════════════════════════════════════════════════════════════════
\echo 'OK: todas las pruebas de categorías de envío pasaron'
rollback;
