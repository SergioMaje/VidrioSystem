-- Pruebas de la anulación de ventas y de la prevención de duplicados.
--
-- Corre todo dentro de una transacción que termina en ROLLBACK: no deja datos en
-- la base local. Crea dos empresas de prueba con sus usuarios y simula a cada
-- usuario con `request.jwt.claims` + `set role authenticated`, como lo haría
-- PostgREST, para que el RLS y los permisos sean los reales.
--
--   npm run test:db
--
-- Si una afirmación falla, psql se detiene con el mensaje (ON_ERROR_STOP).

\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;

begin;

-- ── Utilidades ──────────────────────────────────────────────────────────────
-- Los ids se pasan entre pasos con GUCs de transacción (`t.*`): psql no
-- interpola sus variables dentro de los bloques $$.

create function pg_temp.id(k text) returns uuid language sql as
  $$ select current_setting('t.' || k)::uuid $$;

create function pg_temp.guardar(k text, v uuid) returns uuid language sql as
  $$ select set_config('t.' || k, v::text, true)::uuid $$;

-- Actúa como el usuario `k` (sin cambiar de rol de base).
create function pg_temp.como(k text) returns void language sql as
  $$ select set_config('request.jwt.claims',
       json_build_object('sub', current_setting('t.' || k), 'role', 'authenticated')::text, true) $$;

-- Ejecuta `p_sql` y exige que falle con un mensaje que contenga `p_patron`.
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

-- `pg_temp` es un alias: el GRANT necesita el nombre real del esquema temporal.
do $$ begin
  execute format('grant execute on all functions in schema %I to authenticated', pg_my_temp_schema()::regnamespace);
end $$;

-- ── Datos de prueba ─────────────────────────────────────────────────────────

select pg_temp.guardar('e1', gen_random_uuid()), pg_temp.guardar('e2', gen_random_uuid());
insert into public.empresas (id, nombre) values
  (pg_temp.id('e1'), 'Prueba anulación 1'),
  (pg_temp.id('e2'), 'Prueba anulación 2');

-- handle_new_user crea la fila de `usuarios` a partir de app_metadata.
select pg_temp.guardar('admin', gen_random_uuid()),
       pg_temp.guardar('vendedor', gen_random_uuid()),
       pg_temp.guardar('admin2', gen_random_uuid());
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.id('admin'),    'admin.anulacion@test.local',    'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'admin')::jsonb, '{"nombre":"Admin"}'),
  (pg_temp.id('vendedor'), 'vendedor.anulacion@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'vendedor')::jsonb, '{"nombre":"Vendedor"}'),
  (pg_temp.id('admin2'),   'admin2.anulacion@test.local',   'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e2'), 'rol', 'admin')::jsonb, '{"nombre":"Otra"}');

-- Como postgres pero con los claims del admin: el trigger de empresa y los
-- defaults resuelven la empresa 1 sin pasarla a mano.
select pg_temp.como('admin');

with x as (
  insert into public.clientes (nombre, apellido) values ('Cliente', 'Prueba') returning id
) select pg_temp.guardar('cliente', id) from x;

-- Cotizaciones de 1.000 (o 2.000 las de financiera), en 'enviada'.
with x as (
  insert into public.cotizaciones (notas, cliente_id, estado, subtotal, total)
  select k, pg_temp.id('cliente'), 'enviada', t, t
  from (values ('dup', 1000), ('fin_desemb', 2000), ('fin_pend', 2000),
               ('prod', 1000), ('cerrada_a', 1000), ('cerrada_b', 1000)) v(k, t)
  returning id, notas as k
) select pg_temp.guardar(k, id) from x;

with x as (
  insert into public.financieras (nombre, comision_pct, dias_desembolso)
  values ('Sistecrédito prueba', 5, 30) returning id
) select pg_temp.guardar('financiera', id) from x;

with x as (
  insert into public.items_inventario (codigo, nombre, stock_actual, precio_venta)
  values ('TEST-ANUL-1', 'Espejo de prueba', 10, 50) returning id
) select pg_temp.guardar('item', id) from x;

with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('admin'), 100000) returning id
) select pg_temp.guardar('caja1', id) from x;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Prevención de duplicados al convertir una cotización
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;

select pg_temp.guardar('clave1', gen_random_uuid());
select pg_temp.guardar('ot_dup', (public.registrar_anticipo_cotizacion(
  pg_temp.id('dup'), 'efectivo', 500, p_idempotency_key => pg_temp.id('clave1'))).id);

-- Reintento con la misma clave: devuelve la misma orden y no cobra otra vez.
select pg_temp.afirmar(
  (public.registrar_anticipo_cotizacion(pg_temp.id('dup'), 'efectivo', 500,
     p_idempotency_key => pg_temp.id('clave1'))).id = pg_temp.id('ot_dup'),
  'la misma clave de idempotencia debe devolver la misma orden');
select pg_temp.afirmar(
  (select count(*) from public.ventas where cotizacion_id = pg_temp.id('dup')) = 1,
  'el reintento idempotente no debe crear un segundo cobro');

-- Segundo clic con otra clave (o sin clave): se rechaza.
select pg_temp.debe_fallar(format(
  $q$select public.registrar_anticipo_cotizacion(%L, 'efectivo', 500)$q$, pg_temp.id('dup')),
  'ya fue convertida en venta');

-- Insert directo de un segundo 'anticipo': lo frena el índice único parcial.
select pg_temp.debe_fallar(format(
  $q$insert into public.ventas (cotizacion_id, session_id, metodo_pago, monto, tipo, usuario_id)
     values (%L, %L, 'efectivo', 100, 'anticipo', %L)$q$,
  pg_temp.id('dup'), pg_temp.id('caja1'), pg_temp.id('vendedor')),
  'ventas_una_conversion_por_cotizacion');

select pg_temp.afirmar(
  (select estado_previo_venta from public.cotizaciones where id = pg_temp.id('dup')) = 'enviada',
  'convertir debe guardar el estado previo de la cotización');

-- El duplicado tal como ocurrió: el segundo cobro entra por el camino del
-- abono como saldo_final, por el mismo valor.
with x as (
  insert into public.ventas (cotizacion_id, session_id, metodo_pago, monto, tipo, usuario_id, idempotency_key)
  values (pg_temp.id('dup'), pg_temp.id('caja1'), 'efectivo', 500, 'saldo_final', pg_temp.id('vendedor'), gen_random_uuid())
  returning id
) select pg_temp.guardar('venta_dup', id) from x;
select pg_temp.guardar('venta_valida', id) from public.ventas
 where cotizacion_id = pg_temp.id('dup') and tipo = 'anticipo';

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Intento sin permisos (vendedor) y desde otra empresa
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.anular_venta(%L, 'Cobro duplicado por doble clic')$q$, pg_temp.id('venta_dup')),
  'Solo un administrador');
reset role;

select pg_temp.como('admin2');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.anular_venta(%L, 'Cobro duplicado por doble clic')$q$, pg_temp.id('venta_dup')),
  'La venta no existe');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Anulación exitosa (caja original abierta)
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;

select pg_temp.debe_fallar(format(
  $q$select public.anular_venta(%L, 'corto')$q$, pg_temp.id('venta_dup')),
  'mínimo 10 caracteres');

select public.anular_venta(pg_temp.id('venta_dup'), 'Cobro duplicado por doble clic');
reset role;

select pg_temp.afirmar(
  (select anulado_at is not null and anulado_por = pg_temp.id('admin')
          and motivo_anulacion = 'Cobro duplicado por doble clic'
     from public.ventas where id = pg_temp.id('venta_dup')),
  'la venta debe quedar anulada con usuario y motivo');
select pg_temp.afirmar(
  (select count(*) = 1 and bool_and(session_id = pg_temp.id('caja1') and monto = 500
          and metodo_pago = 'efectivo' and afecta_efectivo)
     from public.caja_movimientos where venta_id = pg_temp.id('venta_dup')
      and categoria = 'reverso_anulacion'),
  'debe existir un reverso en efectivo por 500 en la misma caja');
select pg_temp.afirmar(
  public.efectivo_disponible_caja(pg_temp.id('caja1')) = 100000 + 500,
  'el efectivo esperado debe quedar como si el duplicado no hubiera entrado');
select pg_temp.afirmar(
  (select saldo from public.cotizaciones_saldo where cotizacion_id = pg_temp.id('dup')) = 500,
  'el saldo de la cotización debe reaparecer');
select pg_temp.afirmar(
  (select estado from public.cotizaciones where id = pg_temp.id('dup')) = 'vendida',
  'con otro cobro activo, la cotización sigue vendida');
select pg_temp.afirmar(
  (select estado from public.ordenes_trabajo where id = pg_temp.id('ot_dup')) = 'pendiente',
  'con otro cobro activo, la orden no se toca');
select pg_temp.afirmar(
  (select total_reversos = 500 and total_gastos = 0 and total_anulado = 500
     from public.caja_sesiones_resumen where session_id = pg_temp.id('caja1')),
  'el resumen de caja separa reversos de gastos');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Doble anulación, edición y borrado de un cobro
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('admin');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.anular_venta(%L, 'Otra vez el mismo duplicado')$q$, pg_temp.id('venta_dup')),
  'ya fue anulada');
-- Desde el navegador ya no hay DELETE (se quitó admin_delete_ventas).
select pg_temp.debe_fallar(format(
  $q$delete from public.ventas where id = %L$q$, pg_temp.id('venta_valida')),
  'permission denied');
-- Un reverso no se anula, y un gasto manual no puede hacerse pasar por reverso.
select pg_temp.debe_fallar(format(
  $q$select public.anular_movimiento_caja(%L, 'Deshacer el reverso')$q$,
  (select id from public.caja_movimientos where venta_id = pg_temp.id('venta_dup'))),
  'no se puede anular');
select pg_temp.debe_fallar(
  $q$select public.registrar_gasto_caja('reverso_anulacion', 'Falso reverso', 10, 'efectivo')$q$,
  'solo los genera la anulación');
reset role;

-- Ni siquiera un RPC (o postgres) puede borrar o reescribir un cobro.
select pg_temp.debe_fallar(format(
  $q$delete from public.ventas where id = %L$q$, pg_temp.id('venta_valida')),
  'no se puede borrar');
select pg_temp.debe_fallar(format(
  $q$update public.ventas set monto = 1 where id = %L$q$, pg_temp.id('venta_valida')),
  'no se pueden modificar');
select pg_temp.debe_fallar(format(
  $q$update public.ventas set motivo_anulacion = 'Reescribir el motivo de la anulación' where id = %L$q$,
  pg_temp.id('venta_dup')),
  'está anulado');

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Financiera (Sistecrédito)
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('fin_desemb'), 'financiera', 2000,
  p_financiera_id => pg_temp.id('financiera'));
select public.registrar_anticipo_cotizacion(pg_temp.id('fin_pend'), 'financiera', 2000,
  p_financiera_id => pg_temp.id('financiera'));
reset role;
select pg_temp.guardar('venta_fin_desemb', id) from public.ventas where cotizacion_id = pg_temp.id('fin_desemb');
select pg_temp.guardar('venta_fin_pend', id) from public.ventas where cotizacion_id = pg_temp.id('fin_pend');

select pg_temp.como('admin');
set local role authenticated;
select public.registrar_desembolso_financiera(pg_temp.id('financiera'), current_date, 1900,
  array[pg_temp.id('venta_fin_desemb')]);

-- 4a. Ya desembolsada: bloqueada.
select pg_temp.debe_fallar(format(
  $q$select public.anular_venta(%L, 'El cliente desistió de la compra')$q$, pg_temp.id('venta_fin_desemb')),
  'gestión manual');

-- 4b. Pendiente de desembolso: se anula sin egreso en caja.
select public.anular_venta(pg_temp.id('venta_fin_pend'), 'El cliente desistió de la compra');
reset role;

select pg_temp.afirmar(
  not exists (select 1 from public.caja_movimientos where venta_id = pg_temp.id('venta_fin_pend')),
  'una venta con financiera no genera egreso en caja');
select pg_temp.afirmar(
  not exists (select 1 from public.financieras_por_cobrar where venta_id = pg_temp.id('venta_fin_pend')),
  'la venta anulada sale de la cartera por desembolsar');
select pg_temp.afirmar(
  (select estado from public.cotizaciones where id = pg_temp.id('fin_pend')) = 'enviada',
  'sin cobros activos, la cotización vuelve a su estado previo');
select pg_temp.afirmar(
  (select bool_and(estado = 'cancelada') from public.ordenes_trabajo where cotizacion_id = pg_temp.id('fin_pend')),
  'sin cobros activos, la orden pendiente se cancela');

-- No se puede conciliar un desembolso sobre una venta anulada.
select pg_temp.como('admin');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.registrar_desembolso_financiera(%L, current_date, 100, array[%L]::uuid[])$q$,
  pg_temp.id('financiera'), pg_temp.id('venta_fin_pend')),
  'fueron anuladas');

-- Reconvertir la cotización después de anular reactiva la orden cancelada.
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.afirmar(
  (public.registrar_anticipo_cotizacion(pg_temp.id('fin_pend'), 'efectivo', 1000)).estado = 'pendiente',
  'reconvertir debe reactivar la orden');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- Orden ya en producción: bloqueo
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('prod'), 'efectivo', 500);
reset role;
update public.ordenes_trabajo set estado = 'en_produccion' where cotizacion_id = pg_temp.id('prod');

select pg_temp.como('admin');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.anular_venta(%L, 'Cliente canceló el pedido')$q$,
  (select id from public.ventas where cotizacion_id = pg_temp.id('prod'))),
  'requiere gestión manual');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- Venta de mostrador: reintegro de inventario
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select pg_temp.guardar('vm', (public.registrar_venta_mostrador(null, 'efectivo',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('item'), 'cantidad', 2, 'precio_unitario', 50)))).id);
reset role;

select pg_temp.afirmar(
  (select stock_actual from public.items_inventario where id = pg_temp.id('item')) = 8,
  'la venta de mostrador descuenta 2');

select pg_temp.como('admin');
set local role authenticated;
select public.anular_venta(
  (select id from public.ventas where venta_mostrador_id = pg_temp.id('vm')),
  'Producto con defecto, se devolvió');
reset role;

select pg_temp.afirmar(
  (select stock_actual from public.items_inventario where id = pg_temp.id('item')) = 10,
  'la anulación reintegra lo que la venta descontó');
select pg_temp.afirmar(
  (select count(*) = 1 and bool_and(cantidad = 2 and cantidad_anterior = 8 and cantidad_posterior = 10)
     from public.movimientos_inventario
    where item_id = pg_temp.id('item') and tipo = 'reintegro_anulacion'),
  'el reintegro es un movimiento de inventario nuevo');
select pg_temp.afirmar(
  (select anulado_at is not null from public.ventas_mostrador where id = pg_temp.id('vm')),
  'la cabecera de mostrador queda anulada');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Caja original cerrada
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.como('vendedor');
set local role authenticated;
select public.registrar_anticipo_cotizacion(pg_temp.id('cerrada_a'), 'efectivo', 600);
select public.registrar_anticipo_cotizacion(pg_temp.id('cerrada_b'), 'efectivo', 600);
reset role;
select pg_temp.guardar('venta_cerrada_a', id) from public.ventas where cotizacion_id = pg_temp.id('cerrada_a');
select pg_temp.guardar('venta_cerrada_b', id) from public.ventas where cotizacion_id = pg_temp.id('cerrada_b');

select pg_temp.como('admin');
set local role authenticated;

-- El esperado del cierre ignora el cobro anulado (su reverso lo compensa).
-- Cobros vivos en efectivo: 500 (dup) + 1000 (fin_pend) + 500 (prod) + 600 + 600.
select pg_temp.afirmar(
  (public.cerrar_caja(pg_temp.id('caja1'), 100000 + 3200)).difference = 0,
  'la caja cuadra al cerrar con el duplicado anulado');

-- 5a. Sin caja abierta: no se puede anular.
select pg_temp.debe_fallar(format(
  $q$select public.anular_venta(%L, 'Cobro registrado por error')$q$, pg_temp.id('venta_cerrada_a')),
  'No hay caja abierta');
reset role;

select pg_temp.como('admin');
with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('admin'), 1000) returning id
) select pg_temp.guardar('caja2', id) from x;

set local role authenticated;
-- 5b. El dinero nunca entró: el reverso queda en la caja de hoy sin restar efectivo.
select public.anular_venta(pg_temp.id('venta_cerrada_a'), 'Cobro registrado por error', false);
reset role;
select pg_temp.afirmar(
  (select session_id = pg_temp.id('caja2') and not afecta_efectivo
     from public.caja_movimientos where venta_id = pg_temp.id('venta_cerrada_a')),
  'el reverso va a la caja abierta de hoy, sin afectar efectivo');
select pg_temp.afirmar(
  public.efectivo_disponible_caja(pg_temp.id('caja2')) = 1000,
  'un reverso sin salida de efectivo no cambia el esperado');
select pg_temp.afirmar(
  (select status = 'closed' and expected_amount = 100000 + 3200
     from public.cash_register_sessions where id = pg_temp.id('caja1')),
  'la caja cerrada no se modifica');

-- 5c. Devolución real: sale efectivo de la caja de hoy.
select pg_temp.como('admin');
set local role authenticated;
select public.anular_venta(pg_temp.id('venta_cerrada_b'), 'Devolución del anticipo al cliente', true);
reset role;
select pg_temp.afirmar(
  public.efectivo_disponible_caja(pg_temp.id('caja2')) = 1000 - 600,
  'una devolución en efectivo resta del esperado de hoy');

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Observación obligatoria al cerrar con descuadre (tolerancia $2.000)
-- ════════════════════════════════════════════════════════════════════════════
-- caja2 espera 400. Sobran 12.000 → fuera de tolerancia.
select pg_temp.como('admin');
set local role authenticated;
select pg_temp.debe_fallar(format(
  $q$select public.cerrar_caja(%L, 400 + 12000)$q$, pg_temp.id('caja2')), 'observación');
select pg_temp.debe_fallar(format(
  $q$select public.cerrar_caja(%L, 400 + 12000, '   ')$q$, pg_temp.id('caja2')), 'observación');
select pg_temp.afirmar(
  (public.cerrar_caja(pg_temp.id('caja2'), 400 + 12000, 'Abono sin registrar del señor Pérez')).difference = 12000,
  'con observación, el cierre con sobrante fuera de tolerancia pasa');
reset role;
select pg_temp.afirmar(
  (select observacion_cierre = 'Abono sin registrar del señor Pérez'
     from public.cash_register_sessions where id = pg_temp.id('caja2')),
  'la observación queda guardada en el turno');

-- Dentro de la tolerancia cierra sin observación.
select pg_temp.como('admin');
with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('admin'), 5000) returning id
) select pg_temp.guardar('caja3', id) from x;
set local role authenticated;
select pg_temp.afirmar(
  (public.cerrar_caja(pg_temp.id('caja3'), 5000 - 1500)).difference = -1500,
  'un faltante dentro de la tolerancia cierra sin observación');
reset role;
select pg_temp.afirmar(
  (select observacion_cierre is null from public.cash_register_sessions where id = pg_temp.id('caja3')),
  'sin observación, la columna queda vacía');

-- ════════════════════════════════════════════════════════════════════════════
\echo 'OK: todas las pruebas de anulación de ventas pasaron'
rollback;
