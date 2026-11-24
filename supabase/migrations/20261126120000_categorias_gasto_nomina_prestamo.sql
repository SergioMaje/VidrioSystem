-- Categorías de gasto para la nómina y los préstamos a empleados.
--
-- Hasta ahora ambos se anotaban como 'otro' y se perdían en los reportes.
-- 'prestamo' es plata que se le presta a un empleado y se le descuenta de la
-- nómina a fin de mes: cuenta como gasto normal, porque la nómina de ese mes se
-- registra ya con el descuento (préstamo + nómina neta = costo del salario).
--
-- Va solo en su archivo a propósito: Postgres no permite usar un valor de enum
-- en la misma transacción en que se añade, y la CLI corre cada migración dentro
-- de una transacción. Mismo caso que 20261106120000_anulacion_ventas_enums.sql.
--
-- No hace falta tocar registrar_gasto_caja, anular_movimiento_caja, cerrar_caja
-- ni caja_sesiones_resumen: aceptan cualquier categoría salvo el reverso.
alter type public.categoria_gasto add value if not exists 'nomina';
alter type public.categoria_gasto add value if not exists 'prestamo';
