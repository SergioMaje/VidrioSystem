-- Pruebas de actualizar_envio: editar un envío completo en una transacción.
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

create function pg_temp.cot(k text) returns public.cotizaciones language sql as
  $$ select * from public.cotizaciones where id = pg_temp.id(k) $$;

-- Un ítem libre de un solo valor.
create function pg_temp.item(p_valor numeric) returns jsonb language sql as
  $$ select jsonb_build_object('descripcion', 'Ítem ' || p_valor, 'cantidad', 1,
                               'precio_unitario', p_valor, 'precio_total', p_valor) $$;

-- Una opción para p_datos. p_id null = opción nueva.
create function pg_temp.op(p_id uuid, p_valor numeric, p_cat int default null,
                           p_desc numeric default 0, p_iva numeric default 0,
                           p_recomendada boolean default false) returns jsonb language sql as
  $$ select jsonb_build_object('id', p_id, 'categoria', p_cat, 'nombre', 'Opción ' || p_valor,
                               'descuento_pct', p_desc, 'iva_pct', p_iva, 'recomendada', p_recomendada,
                               'items', jsonb_build_array(pg_temp.item(p_valor))) $$;

create function pg_temp.datos(p_opciones jsonb, p_categorias jsonb default '[]') returns jsonb language sql as
  $$ select jsonb_build_object('cliente_id', pg_temp.id('cliente'), 'fecha_vencimiento', '2026-12-31',
                               'notas', 'Notas nuevas', 'categorias', p_categorias, 'opciones', p_opciones) $$;

-- Una opción enviada, con número asignado por la base.
create function pg_temp.opcion(k text, p_grupo text, p_etiqueta text, p_valor numeric,
                               p_cat text default null, p_desc numeric default 0) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.cotizaciones
    (cliente_id, estado, subtotal, descuento_pct, total, grupo_id, categoria_id, opcion_etiqueta, opcion_nombre)
  values
    (pg_temp.id('cliente'), 'enviada', p_valor, p_desc, p_valor * (1 - p_desc / 100),
     case when p_grupo is not null then pg_temp.id(p_grupo) end,
     case when p_cat is not null then pg_temp.id(p_cat) end,
     p_etiqueta, case when p_etiqueta is not null then 'Opción ' || p_etiqueta end)
  returning id into v;
  insert into public.cotizacion_items (cotizacion_id, descripcion, cantidad, precio_unitario, precio_total)
  values (v, 'Original', 1, p_valor, p_valor);
  return pg_temp.guardar(k, v);
end $$;

create function pg_temp.editar(k text, p_datos jsonb) returns public.cotizaciones language sql as
  $$ select public.actualizar_envio(pg_temp.id(k), p_datos) $$;

do $$ begin
  execute format('grant execute on all functions in schema %I to authenticated', pg_my_temp_schema()::regnamespace);
end $$;

-- ── Datos de prueba ─────────────────────────────────────────────────────────

select pg_temp.guardar('e1', gen_random_uuid()), pg_temp.guardar('e2', gen_random_uuid());
insert into public.empresas (id, nombre) values
  (pg_temp.id('e1'), 'Prueba edición de envío'),
  (pg_temp.id('e2'), 'Otra vidriería');

select pg_temp.guardar('vendedor', gen_random_uuid()), pg_temp.guardar('ajeno', gen_random_uuid());
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.id('vendedor'), 'vendedor.edicion@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'vendedor')::jsonb, '{"nombre":"Vendedor"}'),
  (pg_temp.id('ajeno'), 'ajeno.edicion@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e2'), 'rol', 'admin')::jsonb, '{"nombre":"Ajeno"}');

select pg_temp.como('vendedor');

with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Edición') returning id
) select pg_temp.guardar('cliente', id) from x;

-- Envío sin categorías: A, B y C enviadas.
select pg_temp.guardar('g1', gen_random_uuid());
select pg_temp.opcion('A', 'g1', 'A', 1000);
select pg_temp.opcion('B', 'g1', 'B', 1500);
select pg_temp.opcion('C', 'g1', 'C', 1800);

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Editar varias opciones a la vez, agregar una y quitar otra
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.guardar('ret', (pg_temp.editar('B', pg_temp.datos(jsonb_build_array(
  pg_temp.op(pg_temp.id('A'), 2000),
  pg_temp.op(pg_temp.id('B'), 3000, null, 10, 19, true),
  pg_temp.op(null, 500)
)))).id);
reset role;

select pg_temp.afirmar(pg_temp.id('ret') = pg_temp.id('B'), 'devuelve la opción desde la que se editó');
select pg_temp.afirmar((pg_temp.cot('A')).total = 2000 and (pg_temp.cot('A')).estado = 'borrador', 'A actualizada y en borrador');
select pg_temp.afirmar((pg_temp.cot('B')).total = round(3000 * 0.9 * 1.19, 2), 'B con descuento e IVA');
select pg_temp.afirmar((pg_temp.cot('B')).estado = 'borrador' and (pg_temp.cot('B')).recomendada, 'B en borrador y recomendada');
select pg_temp.afirmar((pg_temp.cot('A')).notas = 'Notas nuevas'
  and (pg_temp.cot('A')).fecha_vencimiento = '2026-12-31', 'datos comunes en todas las opciones');
select pg_temp.afirmar(
  (select string_agg(descripcion, ',') from public.cotizacion_items where cotizacion_id = pg_temp.id('A')) = 'Ítem 2000',
  'los ítems de A se reemplazaron');

-- C, que no vino, quedó anulada con su número intacto.
select pg_temp.afirmar((pg_temp.cot('C')).estado = 'anulada', 'C anulada');
select pg_temp.afirmar((pg_temp.cot('C')).motivo_anulacion = 'Opción quitada al editar el envío'
  and (pg_temp.cot('C')).tipo_anulacion = 'error'
  and (pg_temp.cot('C')).anulado_por = pg_temp.id('vendedor'), 'C con los datos de anulación');
select pg_temp.afirmar((pg_temp.cot('C')).numero like '%-C', 'C conserva su número');

-- La nueva toma la D (la C ya existe, aunque esté anulada) y el número del envío.
select pg_temp.guardar('D', (select id from public.cotizaciones where grupo_id = pg_temp.id('g1') and opcion_etiqueta = 'D'));
select pg_temp.afirmar((pg_temp.cot('D')).numero = regexp_replace((pg_temp.cot('A')).numero, '-A$', '-D'), 'D con el número del envío');
select pg_temp.afirmar((pg_temp.cot('D')).estado = 'borrador' and (pg_temp.cot('D')).usuario_id = pg_temp.id('vendedor'), 'D en borrador');

-- Una anulada no se vuelve a tocar.
set local role authenticated;
select pg_temp.debe_fallar(format('select pg_temp.editar(%L, %L::jsonb)', 'A', pg_temp.datos(jsonb_build_array(
  pg_temp.op(pg_temp.id('A'), 2000), pg_temp.op(pg_temp.id('C'), 1)))), 'anulada');
-- Dos recomendadas en el mismo envío.
select pg_temp.debe_fallar(format('select pg_temp.editar(%L, %L::jsonb)', 'A', pg_temp.datos(jsonb_build_array(
  pg_temp.op(pg_temp.id('A'), 1, null, 0, 0, true), pg_temp.op(pg_temp.id('B'), 1, null, 0, 0, true)))), 'recomendada');
-- Opción sin productos.
select pg_temp.debe_fallar(format('select pg_temp.editar(%L, %L::jsonb)', 'A', pg_temp.datos(jsonb_build_array(
  jsonb_build_object('id', pg_temp.id('A'), 'items', '[]'::jsonb)))), 'al menos un producto');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Todo o nada: si una opción falla, las anteriores no cambian
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.guardar('g2', gen_random_uuid());
select pg_temp.opcion('X', 'g2', 'A', 700);

set local role authenticated;
select pg_temp.debe_fallar(format('select pg_temp.editar(%L, %L::jsonb)', 'A', pg_temp.datos(jsonb_build_array(
  pg_temp.op(pg_temp.id('A'), 9999), pg_temp.op(pg_temp.id('X'), 1)))), 'no pertenece');
reset role;
select pg_temp.afirmar((pg_temp.cot('A')).total = 2000, 'A no cambió tras el error');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Un envío que ya no está abierto no se edita
-- ════════════════════════════════════════════════════════════════════════════
update public.cotizaciones set estado = 'rechazada' where id = pg_temp.id('X');
set local role authenticated;
select pg_temp.debe_fallar(format('select pg_temp.editar(%L, %L::jsonb)', 'X', pg_temp.datos(jsonb_build_array(
  pg_temp.op(pg_temp.id('X'), 1)))), 'ya no se puede editar');
reset role;

-- Otra vidriería no ve el envío.
select pg_temp.como('ajeno');
set local role authenticated;
select pg_temp.debe_fallar(format('select pg_temp.editar(%L, %L::jsonb)', 'A', pg_temp.datos(jsonb_build_array(
  pg_temp.op(pg_temp.id('A'), 1)))), 'no existe');
reset role;
select pg_temp.como('vendedor');

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Una cotización suelta a la que se le agrega una opción pasa a ser la A
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.opcion('S', null, null, 800);
select set_config('t.numero_s', (pg_temp.cot('S')).numero, true);

set local role authenticated;
select pg_temp.editar('S', pg_temp.datos(jsonb_build_array(pg_temp.op(pg_temp.id('S'), 900), pg_temp.op(null, 1200))));
reset role;

select pg_temp.afirmar((pg_temp.cot('S')).grupo_id is not null and (pg_temp.cot('S')).opcion_etiqueta = 'A', 'la suelta es la A');
select pg_temp.afirmar((pg_temp.cot('S')).numero = current_setting('t.numero_s'), 'la suelta conserva su número');
select pg_temp.afirmar(
  (select numero from public.cotizaciones where grupo_id = (pg_temp.cot('S')).grupo_id and opcion_etiqueta = 'B')
    = current_setting('t.numero_s') || '-B', 'la nueva es la B del mismo número');

-- Una suelta no se divide por categorías al editarla.
select pg_temp.opcion('S2', null, null, 300);
set local role authenticated;
select pg_temp.debe_fallar(format('select pg_temp.editar(%L, %L::jsonb)', 'S2', pg_temp.datos(
  jsonb_build_array(pg_temp.op(pg_temp.id('S2'), 300, 0)),
  '[{"nombre": "Puerta", "tipo": "otro"}]'::jsonb)), 'dividir ni unir');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Envío por categorías: renombrar, quitar y agregar categorías
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.guardar('g3', gen_random_uuid());
with x as (
  insert into public.envio_categorias (grupo_id, nombre, tipo, orden)
  values (pg_temp.id('g3'), 'Puerta', 'otro', 0) returning id
) select pg_temp.guardar('puerta', id) from x;
with x as (
  insert into public.envio_categorias (grupo_id, nombre, tipo, orden)
  values (pg_temp.id('g3'), 'Ventana', 'otro', 1) returning id
) select pg_temp.guardar('ventana', id) from x;
select pg_temp.opcion('P1', 'g3', 'A', 1000, 'puerta', 10);
select pg_temp.opcion('P2', 'g3', 'B', 1100, 'puerta', 10);
select pg_temp.opcion('V1', 'g3', 'A', 500, 'ventana', 10);

-- Descuento distinto entre opciones: no.
set local role authenticated;
select pg_temp.debe_fallar(format('select pg_temp.editar(%L, %L::jsonb)', 'P1', pg_temp.datos(
  jsonb_build_array(pg_temp.op(pg_temp.id('P1'), 1000, 0, 10), pg_temp.op(pg_temp.id('V1'), 500, 1, 5)),
  jsonb_build_array(jsonb_build_object('id', pg_temp.id('puerta'), 'nombre', 'Puerta'),
                    jsonb_build_object('id', pg_temp.id('ventana'), 'nombre', 'Ventana')))), 'mismos para todo el envío');
-- Una opción no se cambia de categoría.
select pg_temp.debe_fallar(format('select pg_temp.editar(%L, %L::jsonb)', 'P1', pg_temp.datos(
  jsonb_build_array(pg_temp.op(pg_temp.id('P1'), 1000, 1, 10), pg_temp.op(pg_temp.id('V1'), 500, 0, 10)),
  jsonb_build_array(jsonb_build_object('id', pg_temp.id('puerta'), 'nombre', 'Puerta'),
                    jsonb_build_object('id', pg_temp.id('ventana'), 'nombre', 'Ventana')))), 'otra categoría');

-- Se renombra la puerta, se quita la ventana y se agrega un baño.
select pg_temp.editar('P2', pg_temp.datos(
  jsonb_build_array(
    pg_temp.op(pg_temp.id('P1'), 1000, 0, 15, 19),
    pg_temp.op(pg_temp.id('P2'), 1200, 0, 15, 19),
    pg_temp.op(null, 300, 1, 15, 19),
    pg_temp.op(null, 350, 1, 15, 19)),
  jsonb_build_array(
    jsonb_build_object('id', pg_temp.id('puerta'), 'nombre', 'Puerta principal', 'tipo', 'otro'),
    jsonb_build_object('nombre', 'Baño', 'tipo', 'otro'))));
reset role;

select pg_temp.afirmar((select nombre from public.envio_categorias where id = pg_temp.id('puerta')) = 'Puerta principal', 'categoría renombrada');
select pg_temp.afirmar((pg_temp.cot('V1')).estado = 'anulada', 'la opción de la categoría quitada quedó anulada');
select pg_temp.afirmar((pg_temp.cot('P2')).descuento_pct = 15 and (pg_temp.cot('P2')).iva_pct = 19, 'descuento e IVA del envío');
select pg_temp.afirmar(
  (select orden from public.envio_categorias where grupo_id = pg_temp.id('g3') and nombre = 'Baño') = 2,
  'la categoría nueva va al final');
select pg_temp.afirmar(
  (select string_agg(c.numero, ',' order by c.opcion_etiqueta)
     from public.cotizaciones c join public.envio_categorias e on e.id = c.categoria_id
    where e.nombre = 'Baño')
  = regexp_replace((pg_temp.cot('P1')).numero, '-1A$', '-3A') || ',' || regexp_replace((pg_temp.cot('P1')).numero, '-1A$', '-3B'),
  'las opciones del baño son 3A y 3B');
select pg_temp.afirmar(
  (select count(*) from public.cotizaciones where grupo_id = pg_temp.id('g3') and estado = 'borrador') = 4,
  'todo el envío en borrador');

\echo 'OK: todas las pruebas de edición de envío pasaron'
rollback;
