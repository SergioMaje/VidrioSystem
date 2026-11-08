-- Pruebas de la anulación de cotizaciones (anular_cotizacion).
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

do $$ begin
  execute format('grant execute on all functions in schema %I to authenticated', pg_my_temp_schema()::regnamespace);
end $$;

-- ── Datos de prueba ─────────────────────────────────────────────────────────

select pg_temp.guardar('e1', gen_random_uuid()), pg_temp.guardar('e2', gen_random_uuid());
insert into public.empresas (id, nombre) values
  (pg_temp.id('e1'), 'Prueba anular cotización 1'),
  (pg_temp.id('e2'), 'Prueba anular cotización 2');

select pg_temp.guardar('admin', gen_random_uuid()),
       pg_temp.guardar('vendedor', gen_random_uuid()),
       pg_temp.guardar('admin2', gen_random_uuid());
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.id('admin'),    'admin.anularcot@test.local',    'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'admin')::jsonb, '{"nombre":"Admin"}'),
  (pg_temp.id('vendedor'), 'vendedor.anularcot@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'vendedor')::jsonb, '{"nombre":"Vendedor"}'),
  (pg_temp.id('admin2'),   'admin2.anularcot@test.local',   'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e2'), 'rol', 'admin')::jsonb, '{"nombre":"Otra"}');

select pg_temp.como('admin');

with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Prueba') returning id
) select pg_temp.guardar('cliente', id) from x;

-- Cotizaciones de 1.000 en 'enviada'.
with x as (
  insert into public.cotizaciones (numero, cliente_id, estado, subtotal, total)
  select 'COT-TESTA-' || k, pg_temp.id('cliente'), 'enviada', 1000, 1000
  from (values ('desist'), ('error'), ('prod'), ('consumo'), ('nunca')) v(k)
  returning id, substring(numero from 11) as k
) select pg_temp.guardar(k, id) from x;

with x as (
  insert into public.items_inventario (codigo, nombre, stock_actual, precio_venta)
  values ('TEST-ANULCOT-1', 'Vidrio de prueba', 10, 50) returning id
) select pg_temp.guardar('item', id) from x;

with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('admin'), 100000) returning id
) select pg_temp.guardar('caja1', id) from x;

-- Anticipos del día 1, en efectivo: 600 + 600 + 500 + 500.
select pg_temp.como('vendedor');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('desist'),  'efectivo', 600);
select public.registrar_anticipo_cotizacion(pg_temp.id('error'),   'efectivo', 600);
select public.registrar_anticipo_cotizacion(pg_temp.id('prod'),    'efectivo', 500);
select public.registrar_anticipo_cotizacion(pg_temp.id('consumo'), 'efectivo', 500);
reset role;

-- Cierre del día 1 cuadrado, y caja del día 2.
select pg_temp.como('admin');
set local role authenticated;
select pg_temp.afirmar(
  (public.cerrar_caja(pg_temp.id('caja1'), 100000 + 2200)).difference = 0,
  'la caja del día 1 cierra cuadrada');
reset role;

select pg_temp.como('admin');
with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('admin'), 1000) returning id
) select pg_temp.guardar('caja2', id) from x;

-- Abono del día 2 a 'desist': su cotización queda con un cobro en cada caja.
select pg_temp.como('vendedor');
set local role authenticated;
insert into public.ventas (cotizacion_id, session_id, metodo_pago, monto, tipo, usuario_id)
values (pg_temp.id('desist'), pg_temp.id('caja2'), 'efectivo', 400, 'saldo_final', pg_temp.id('vendedor'));
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Permisos y validaciones
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.anular_cotizacion(%L, 'El cliente desistió de la obra', 'desistimiento')$q$,
  pg_temp.id('desist')), 'Solo un administrador');
reset role;

select pg_temp.como('admin2');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.anular_cotizacion(%L, 'El cliente desistió de la obra', 'desistimiento')$q$,
  pg_temp.id('desist')), 'no existe');
reset role;

select pg_temp.como('admin');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.anular_cotizacion(%L, 'corto', 'desistimiento')$q$, pg_temp.id('desist')),
  'mínimo 10 caracteres');
select pg_temp.debe_fallar(format(
  $q$select public.anular_cotizacion(%L, 'El cliente desistió de la obra', 'otro')$q$, pg_temp.id('desist')),
  'desistió o si fue un error');
select pg_temp.debe_fallar(format(
  $q$select public.anular_cotizacion(%L, 'Nunca se le cobró nada', 'error')$q$, pg_temp.id('nunca')),
  'Solo se anula una cotización vendida');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Desistimiento: un cobro en la caja cerrada y otro en la abierta
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;
select pg_temp.afirmar(
  (public.anular_cotizacion(pg_temp.id('desist'), 'El cliente desistió de la obra', 'desistimiento')).estado = 'anulada',
  'la cotización queda anulada');
reset role;

select pg_temp.afirmar(
  (select anulado_at is not null and anulado_por = pg_temp.id('admin') and tipo_anulacion = 'desistimiento'
          and motivo_anulacion = 'El cliente desistió de la obra' and estado_previo_venta is null
     from public.cotizaciones where id = pg_temp.id('desist')),
  'la cotización guarda quién, cuándo, el tipo y el motivo');
select pg_temp.afirmar(
  (select count(*) = 2 and bool_and(anulado_at is not null)
     from public.ventas where cotizacion_id = pg_temp.id('desist')),
  'los dos cobros quedan anulados');
select pg_temp.afirmar(
  (select count(*) = 2 and bool_and(m.session_id = pg_temp.id('caja2') and m.afecta_efectivo)
     from public.caja_movimientos m join public.ventas v on v.id = m.venta_id
    where v.cotizacion_id = pg_temp.id('desist') and m.categoria = 'reverso_anulacion'),
  'dos reversos en la caja de hoy, los dos sacan efectivo');
select pg_temp.afirmar(
  public.efectivo_disponible_caja(pg_temp.id('caja2')) = 1000 + 400 - 400 - 600,
  'el esperado de hoy baja por el abono y por la devolución del anticipo');
select pg_temp.afirmar(
  (select status = 'closed' and expected_amount = 100000 + 2200
     from public.cash_register_sessions where id = pg_temp.id('caja1')),
  'la caja cerrada no se modifica');
select pg_temp.afirmar(
  (select bool_and(estado = 'cancelada') from public.ordenes_trabajo where cotizacion_id = pg_temp.id('desist')),
  'la orden pendiente se cancela');
select pg_temp.afirmar(
  (select saldo = 1000 from public.cotizaciones_saldo where cotizacion_id = pg_temp.id('desist')),
  'ya no hay nada abonado');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Error de registro: el dinero de la caja cerrada nunca entró
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;
select public.anular_cotizacion(pg_temp.id('error'), 'Cotización duplicada por error', 'error');
reset role;

select pg_temp.afirmar(
  (select m.session_id = pg_temp.id('caja2') and not m.afecta_efectivo
     from public.caja_movimientos m join public.ventas v on v.id = m.venta_id
    where v.cotizacion_id = pg_temp.id('error')),
  'el reverso va a la caja de hoy sin salida de efectivo');
select pg_temp.afirmar(
  public.efectivo_disponible_caja(pg_temp.id('caja2')) = 400,
  'un error de registro no cambia el esperado de hoy');
select pg_temp.afirmar(
  (select tipo_anulacion = 'error' from public.cotizaciones where id = pg_temp.id('error')),
  'queda registrado como error');

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Bloqueos por la orden: no deja cambios
-- ════════════════════════════════════════════════════════════════════════════
update public.ordenes_trabajo set estado = 'en_produccion' where cotizacion_id = pg_temp.id('prod');

select pg_temp.como('admin');
with m as (
  insert into public.movimientos_inventario (item_id, tipo, cantidad, cantidad_anterior, cantidad_posterior, motivo, usuario_id)
  values (pg_temp.id('item'), 'salida', 1, 10, 9, 'Consumo de prueba', pg_temp.id('admin'))
  returning id
)
insert into public.orden_materiales (orden_id, item_id, origen, cantidad_requerida, cantidad_asignada, estado, movimiento_id)
select o.id, pg_temp.id('item'), 'stock_normal', 1, 1, 'consumido', m.id
  from public.ordenes_trabajo o, m
 where o.cotizacion_id = pg_temp.id('consumo');

set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.anular_cotizacion(%L, 'El cliente desistió de la obra', 'desistimiento')$q$,
  pg_temp.id('prod')), 'resuelve la orden');
select pg_temp.debe_fallar(format(
  $q$select public.anular_cotizacion(%L, 'El cliente desistió de la obra', 'desistimiento')$q$,
  pg_temp.id('consumo')), 'consumió material');
reset role;

select pg_temp.afirmar(
  (select bool_and(anulado_at is null) from public.ventas
    where cotizacion_id in (pg_temp.id('prod'), pg_temp.id('consumo'))),
  'si se bloquea, ningún cobro queda anulado');
select pg_temp.afirmar(
  (select bool_and(estado = 'vendida') from public.cotizaciones
    where id in (pg_temp.id('prod'), pg_temp.id('consumo'))),
  'si se bloquea, las cotizaciones siguen vendidas');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Una cotización anulada es final
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.anular_cotizacion(%L, 'Otra vez la misma anulación', 'error')$q$, pg_temp.id('desist')),
  'ya fue anulada');
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.registrar_anticipo_cotizacion(%L, 'efectivo', 600)$q$, pg_temp.id('desist')),
  'está anulada');
select pg_temp.debe_fallar(format(
  $q$insert into public.ventas (cotizacion_id, session_id, metodo_pago, monto, tipo, usuario_id)
     values (%L, %L, 'efectivo', 100, 'abono', %L)$q$,
  pg_temp.id('desist'), pg_temp.id('caja2'), pg_temp.id('vendedor')),
  'está anulada');
-- Desde el navegador no se puede saltar el RPC.
select pg_temp.debe_fallar(format(
  $q$update public.cotizaciones set estado = 'anulada' where id = %L$q$, pg_temp.id('nunca')),
  'solo se anula con');
reset role;

-- Ni siquiera postgres edita o borra una anulada.
select pg_temp.debe_fallar(format(
  $q$update public.cotizaciones set notas = 'cambio' where id = %L$q$, pg_temp.id('desist')),
  'no se puede modificar');
select pg_temp.debe_fallar(format(
  $q$delete from public.cotizaciones where id = %L$q$, pg_temp.id('desist')),
  'no se puede borrar');

-- ════════════════════════════════════════════════════════════════════════════
\echo 'OK: todas las pruebas de anulación de cotizaciones pasaron'
rollback;
