-- Pruebas de las categorías de gasto 'nomina' y 'prestamo'.
--
-- Corre dentro de una transacción que termina en ROLLBACK: no deja datos en la
-- base local. Mismo esquema de utilidades que anulacion_ventas.sql.
--
--   npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;

begin;

create function pg_temp.id(k text) returns uuid language sql as
  $$ select current_setting('t.' || k)::uuid $$;

create function pg_temp.guardar(k text, v uuid) returns uuid language sql as
  $$ select set_config('t.' || k, v::text, true)::uuid $$;

create function pg_temp.como(k text) returns void language sql as
  $$ select set_config('request.jwt.claims',
       json_build_object('sub', current_setting('t.' || k), 'role', 'authenticated')::text, true) $$;

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
insert into public.empresas (id, nombre) values (pg_temp.id('e1'), 'Prueba categorías gasto');

select pg_temp.guardar('vendedor', gen_random_uuid());
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.id('vendedor'), 'vendedor.gastos@test.local', 'authenticated', 'authenticated',
   json_build_object('empresa_id', pg_temp.id('e1'), 'rol', 'vendedor')::jsonb, '{"nombre":"Vendedor"}');

select pg_temp.como('vendedor');
with x as (
  insert into public.cash_register_sessions (opened_by, opening_amount)
  values (pg_temp.id('vendedor'), 500000) returning id
) select pg_temp.guardar('caja', id) from x;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Un vendedor registra nómina y préstamo en efectivo
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.afirmar(
  (public.registrar_gasto_caja('nomina', 'Juan Pérez – quincena', 300000, 'efectivo')).categoria = 'nomina',
  'se registra un gasto de nómina');
select pg_temp.afirmar(
  (public.registrar_gasto_caja('prestamo', 'Juan Pérez – adelanto', 50000, 'efectivo')).categoria = 'prestamo',
  'se registra un préstamo a empleado');
-- Por transferencia queda registrado pero no toca el cajón.
select pg_temp.afirmar(
  (public.registrar_gasto_caja('nomina', 'Ana Gómez – quincena', 400000, 'transferencia')).metodo_pago = 'transferencia',
  'la nómina por transferencia también se registra');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Ambas cuentan como gasto y bajan el efectivo esperado
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.afirmar(
  public.efectivo_disponible_caja(pg_temp.id('caja')) = 500000 - 300000 - 50000,
  'nómina y préstamo en efectivo descuentan del cajón');

select pg_temp.afirmar(
  (select total_gastos = 750000 and total_gastos_efectivo = 350000 and num_gastos = 3
     from public.caja_sesiones_resumen where session_id = pg_temp.id('caja')),
  'el resumen del turno suma nómina y préstamo como gastos');

set local role authenticated;
select pg_temp.afirmar(
  (public.cerrar_caja(pg_temp.id('caja'), 150000)).difference = 0,
  'el cierre espera fondo − nómina − préstamo en efectivo');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
\echo 'OK: todas las pruebas de categorías de gasto pasaron'
rollback;
