-- Pruebas de la venta a crédito con cuenta de cobro.
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

create function pg_temp.estado_cartera(k text) returns text language sql as
  $$ select estado from public.cartera where cotizacion_id = pg_temp.id(k) $$;

do $$ begin
  execute format('grant execute on all functions in schema %I to authenticated', pg_my_temp_schema()::regnamespace);
end $$;

-- ── Datos de prueba ─────────────────────────────────────────────────────────

select pg_temp.guardar('e1', gen_random_uuid()), pg_temp.guardar('e2', gen_random_uuid());
insert into public.empresas (id, nombre) values
  (pg_temp.id('e1'), 'Prueba crédito 1'),
  (pg_temp.id('e2'), 'Prueba crédito 2');

select pg_temp.guardar('admin', gen_random_uuid()),
       pg_temp.guardar('vendedor', gen_random_uuid()),
       pg_temp.guardar('admin2', gen_random_uuid());
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.id('admin'),    'admin.credito@test.local',    'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'admin')::jsonb, '{"nombre":"Admin"}'),
  (pg_temp.id('vendedor'), 'vendedor.credito@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'vendedor')::jsonb, '{"nombre":"Vendedor"}'),
  (pg_temp.id('admin2'),   'admin2.credito@test.local',   'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e2'), 'rol', 'admin')::jsonb, '{"nombre":"Otra"}');

-- Empresa 1: una constructora (con crédito) y un cliente de contado.
select pg_temp.como('admin');
with x as (
  insert into public.clientes (nombre, apellido, tipo, empresa, documento)
  values ('Compras', 'Constructora', 'juridico', 'Constructora S.A.S.', '900123456') returning id
) select pg_temp.guardar('empresa_cli', id) from x;
with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Contado') returning id
) select pg_temp.guardar('contado_cli', id) from x;

with x as (
  insert into public.cotizaciones (notas, cliente_id, estado, subtotal, total)
  select k, pg_temp.id(c), 'enviada', t, t
  from (values ('obra', 'empresa_cli', 1000), ('obra2', 'empresa_cli', 1000),
               ('grande', 'empresa_cli', 5000), ('contado', 'contado_cli', 1000),
               ('anular', 'empresa_cli', 300), ('libre', 'contado_cli', 400)) v(k, c, t)
  returning id, notas as k
) select pg_temp.guardar(k, id) from x;

with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('admin'), 100000) returning id
) select pg_temp.guardar('caja1', id) from x;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Las condiciones de crédito del cliente solo las cambia el admin
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$update public.clientes set cupo_credito = 9000 where id = %L$q$, pg_temp.id('empresa_cli')),
  'Solo un administrador puede cambiar el crédito');
-- Editar otros datos sí puede.
update public.clientes set telefono = '3001234567' where id = pg_temp.id('empresa_cli');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Pago en $0: solo admin, cualquier cliente, y emite la cuenta de cobro
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;
update public.clientes
   set dias_credito = 30, cupo_credito = 2500
 where id = pg_temp.id('empresa_cli');
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.aprobar_cotizacion_credito(%L)$q$, pg_temp.id('obra')),
  'Solo un administrador');
-- Tampoco puede marcarla a mano.
select pg_temp.debe_fallar(format(
  $q$update public.cotizaciones set condicion_pago = 'credito' where id = %L$q$, pg_temp.id('obra')),
  'pago en $0');
reset role;

select pg_temp.como('admin');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.aprobar_cotizacion_credito(%L)$q$, pg_temp.id('grande')),
  'cupo de crédito');
select public.aprobar_cotizacion_credito(pg_temp.id('obra'), null, 'OC-7781');
reset role;

select pg_temp.afirmar(
  (select estado = 'vendida' and condicion_pago = 'credito' and orden_compra = 'OC-7781'
     and credito_autorizado_por = pg_temp.id('admin')
     from public.cotizaciones where id = pg_temp.id('obra')),
  'la cotización queda vendida a crédito con su OC');
select pg_temp.afirmar(
  not exists (select 1 from public.ventas where cotizacion_id = pg_temp.id('obra')),
  'el pago en $0 no registra ningún cobro');
select pg_temp.guardar('ot', (select id from public.ordenes_trabajo where cotizacion_id = pg_temp.id('obra')));
select pg_temp.afirmar(pg_temp.id('ot') is not null, 'se crea la orden de trabajo');
select pg_temp.guardar('cc1', (select id from public.cuentas_cobro where cotizacion_id = pg_temp.id('obra')));
select pg_temp.afirmar(
  (select numero = 'CC-0001' and monto = 1000 and orden_compra = 'OC-7781' and dias_plazo = 30
          and fecha_vencimiento is null and orden_id = pg_temp.id('ot')
     from public.cuentas_cobro where id = pg_temp.id('cc1')),
  'el pago en $0 emite CC-0001 por el total, con la OC, 30 días de plazo y sin vencimiento aún');
select pg_temp.afirmar(pg_temp.estado_cartera('obra') = 'pendiente', 'en cartera: pendiente');
select pg_temp.afirmar(
  (select dias_mora = 0 from public.cartera where cotizacion_id = pg_temp.id('obra')),
  'sin entregar no hay mora');

-- Cualquier cliente, aunque no tenga nada configurado: plazo por defecto.
select pg_temp.como('admin');
set local role authenticated;
select public.aprobar_cotizacion_credito(pg_temp.id('libre'));
reset role;
select pg_temp.afirmar(
  (select numero = 'CC-0002' and monto = 400 and dias_plazo = 30
     from public.cuentas_cobro where cotizacion_id = pg_temp.id('libre')),
  'un cliente sin condiciones configuradas también: CC-0002 a 30 días');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Produce sin anticipo; sin cuenta de cobro vigente no se entrega con saldo
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
update public.ordenes_trabajo set estado = 'en_produccion' where id = pg_temp.id('ot');
update public.ordenes_trabajo set estado = 'lista' where id = pg_temp.id('ot');
select pg_temp.debe_fallar(format(
  $q$select public.anular_cuenta_cobro(%L, 'La OC estaba equivocada')$q$, pg_temp.id('cc1')),
  'Solo un administrador');
reset role;

select pg_temp.como('admin');
set local role authenticated;
select public.anular_cuenta_cobro(pg_temp.id('cc1'), 'La OC estaba equivocada');
reset role;
select pg_temp.afirmar(pg_temp.estado_cartera('obra') = 'sin_emitir', 'anulada: cartera sin emitir');

select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$update public.ordenes_trabajo set estado = 'entregada' where id = %L$q$, pg_temp.id('ot')),
  'no tiene cuenta de cobro vigente');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Se reemplaza la anulada; al entregar, el plazo empieza a contar
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;
select pg_temp.guardar('cc', (public.emitir_cuenta_cobro(pg_temp.id('obra'))).id);
reset role;
select pg_temp.afirmar(
  (select fecha_vencimiento is null from public.cuentas_cobro where id = pg_temp.id('cc')),
  'la nueva, emitida antes de entregar, aún no vence');

select pg_temp.como('vendedor');
set local role authenticated;
update public.ordenes_trabajo
   set estado = 'entregada', fecha_entrega_real = (now() at time zone 'America/Bogota')::date
 where id = pg_temp.id('ot');
reset role;

select pg_temp.afirmar(
  (select cc.numero = 'CC-0003' and cc.monto = 1000
          and cc.fecha_vencimiento = o.fecha_entrega_real + 30
     from public.cuentas_cobro cc join public.ordenes_trabajo o on o.id = cc.orden_id
    where cc.id = pg_temp.id('cc')),
  'CC-0003 reemplaza la anulada y vence 30 días después de la entrega');
select pg_temp.afirmar(
  (select estado = 'entregada' and fecha_entrega_real is not null
     from public.ordenes_trabajo where id = pg_temp.id('ot')),
  'la orden queda entregada');
select pg_temp.afirmar(pg_temp.estado_cartera('obra') = 'pendiente', 'cartera: pendiente');

-- Inmutable y sin escritura directa.
select pg_temp.como('admin');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$update public.cuentas_cobro set monto = 1 where id = %L$q$, pg_temp.id('cc')),
  'permission denied');
select pg_temp.debe_fallar(format(
  $q$select public.emitir_cuenta_cobro(%L)$q$, pg_temp.id('obra')),
  'ya tiene la cuenta de cobro CC-0003');
reset role;
select pg_temp.debe_fallar(format(
  $q$update public.cuentas_cobro set monto = 1 where id = %L$q$, pg_temp.id('cc')),
  'no se modifica');
select pg_temp.debe_fallar(format(
  $q$update public.cuentas_cobro set fecha_vencimiento = fecha_vencimiento + 5 where id = %L$q$, pg_temp.id('cc')),
  'no se modifica');

-- La entrega normal (sin el RPC) también fija el vencimiento.
select pg_temp.guardar('ot_libre', (select id from public.ordenes_trabajo where cotizacion_id = pg_temp.id('libre')));
select pg_temp.como('vendedor');
set local role authenticated;
update public.ordenes_trabajo set estado = 'en_produccion' where id = pg_temp.id('ot_libre');
update public.ordenes_trabajo set estado = 'lista' where id = pg_temp.id('ot_libre');
update public.ordenes_trabajo
   set estado = 'entregada', fecha_entrega_real = (now() at time zone 'America/Bogota')::date
 where id = pg_temp.id('ot_libre');
reset role;
select pg_temp.afirmar(
  (select fecha_vencimiento = (now() at time zone 'America/Bogota')::date + 30
     from public.cuentas_cobro where cotizacion_id = pg_temp.id('libre')),
  'entregar por la vía normal también pone el vencimiento');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Los pagos son abonos, sin mínimo del 50%
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
insert into public.ventas (cotizacion_id, session_id, metodo_pago, monto, tipo, usuario_id)
values (pg_temp.id('obra'), pg_temp.id('caja1'), 'transferencia', 100, 'anticipo', pg_temp.id('vendedor'));
reset role;

select pg_temp.afirmar(
  (select tipo = 'abono' and numero_recibo is not null from public.ventas where cotizacion_id = pg_temp.id('obra')),
  'el primer pago (10%) entra como abono, con recibo');
select pg_temp.afirmar(pg_temp.estado_cartera('obra') = 'parcial', 'cartera: parcial');

-- Vencida: se adelanta la fecha de la cuenta (como dueño, sin el trigger).
alter table public.cuentas_cobro disable trigger cuentas_cobro_inmutable;
update public.cuentas_cobro
   set fecha_emision = fecha_emision - 40, fecha_vencimiento = fecha_vencimiento - 40
 where id = pg_temp.id('cc');
alter table public.cuentas_cobro enable trigger cuentas_cobro_inmutable;
select pg_temp.afirmar(pg_temp.estado_cartera('obra') = 'vencida', 'cartera: vencida');
select pg_temp.afirmar(
  (select dias_mora = 10 from public.cartera where cotizacion_id = pg_temp.id('obra')),
  '10 días de mora');

select pg_temp.como('vendedor');
set local role authenticated;
insert into public.ventas (cotizacion_id, session_id, metodo_pago, monto, tipo, usuario_id)
values (pg_temp.id('obra'), pg_temp.id('caja1'), 'transferencia', 900, 'saldo_final', pg_temp.id('vendedor'));
reset role;
select pg_temp.afirmar(pg_temp.estado_cartera('obra') = 'pagada', 'cartera: pagada');

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Anular el único cobro no deshace la venta a crédito
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;
select public.aprobar_cotizacion_credito(pg_temp.id('obra2'));
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
insert into public.ventas (cotizacion_id, session_id, metodo_pago, monto, tipo, usuario_id)
values (pg_temp.id('obra2'), pg_temp.id('caja1'), 'transferencia', 200, 'abono', pg_temp.id('vendedor'));
reset role;
select pg_temp.como('admin');
set local role authenticated;
select public.anular_venta(
  (select id from public.ventas where cotizacion_id = pg_temp.id('obra2')),
  'Transferencia registrada dos veces', true);
reset role;
select pg_temp.afirmar(
  (select estado = 'vendida' from public.cotizaciones where id = pg_temp.id('obra2')),
  'la cotización sigue vendida a crédito');
select pg_temp.afirmar(
  (select estado = 'pendiente' from public.ordenes_trabajo where cotizacion_id = pg_temp.id('obra2')),
  'la orden no se cancela');

-- El cupo cuenta lo que debe: 1.000 de obra2 + 300 caben en 2.500; 5.000 no.
select pg_temp.como('admin');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.aprobar_cotizacion_credito(%L)$q$, pg_temp.id('grande')),
  'debe 1000');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Anular una venta a crédito sin cobros
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;
select public.aprobar_cotizacion_credito(pg_temp.id('anular'));
select public.anular_cotizacion(pg_temp.id('anular'), 'La constructora canceló la obra', 'desistimiento');
reset role;
select pg_temp.afirmar(
  (select estado = 'anulada' from public.cotizaciones where id = pg_temp.id('anular')),
  'la cotización queda anulada');
select pg_temp.afirmar(
  (select estado = 'cancelada' from public.ordenes_trabajo where cotizacion_id = pg_temp.id('anular')),
  'su orden se cancela');
select pg_temp.afirmar(
  (select numero = 'CC-0005' and anulado_at is not null from public.cuentas_cobro where cotizacion_id = pg_temp.id('anular')),
  'su cuenta de cobro (CC-0005) queda anulada');
select pg_temp.afirmar(pg_temp.estado_cartera('anular') is null, 'sale de la cartera');

-- ════════════════════════════════════════════════════════════════════════════
-- 8. La venta normal no cambia
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.registrar_anticipo_cotizacion(%L, 'efectivo', 100)$q$, pg_temp.id('contado')),
  'al menos el 50');
select public.registrar_anticipo_cotizacion(pg_temp.id('contado'), 'efectivo', 600);
select pg_temp.debe_fallar(format(
  $q$select public.emitir_cuenta_cobro(%L)$q$, pg_temp.id('contado')),
  'Solo una venta a crédito');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Otra vidriería no ve ni numera lo de la primera
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin2');
set local role authenticated;
select pg_temp.afirmar((select count(*) = 0 from public.cuentas_cobro), 'admin2 no ve cuentas de cobro ajenas');
select pg_temp.afirmar((select count(*) = 0 from public.cartera), 'admin2 no ve la cartera ajena');
with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Otra') returning id
) select pg_temp.guardar('cliente2', id) from x;
with x as (
  insert into public.cotizaciones (numero, cliente_id, estado, subtotal, total)
  values ('COT-TESTCC-OTRA', pg_temp.id('cliente2'), 'enviada', 500, 500) returning id
) select pg_temp.guardar('otra', id) from x;
select public.aprobar_cotizacion_credito(pg_temp.id('otra'));
select pg_temp.afirmar(
  (select numero = 'CC-0001' from public.cuentas_cobro where cotizacion_id = pg_temp.id('otra')),
  'la otra vidriería empieza su propia numeración');
select pg_temp.debe_fallar(format(
  $q$select public.emitir_cuenta_cobro(%L)$q$, pg_temp.id('obra2')),
  'Cotización no encontrada');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
\echo 'OK: todas las pruebas de crédito y cuenta de cobro pasaron'
rollback;
