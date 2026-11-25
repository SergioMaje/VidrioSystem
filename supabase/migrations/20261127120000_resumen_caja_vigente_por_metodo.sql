-- Cobros vigentes (sin anulados) por método en el resumen de cada turno.
--
-- total_efectivo, total_transferencia, total_tarjeta y total_financiera suman
-- también los cobros anulados después: así los necesita el arqueo, que cuenta
-- el efectivo anulado como entrada y su reverso como egreso. Para reportar lo
-- que de verdad se cobró por método hacen falta las cifras sin anulados.
--
-- Las columnas nuevas van al final (create or replace view solo permite
-- agregar al final) y las existentes no cambian.

create or replace view public.caja_sesiones_resumen
with (security_invoker = on) as
  select
    s.id as session_id,
    coalesce(v.total_efectivo, 0) as total_efectivo,
    coalesce(v.total_transferencia, 0) as total_transferencia,
    coalesce(v.total_tarjeta, 0) as total_tarjeta,
    coalesce(v.total_financiera, 0) as total_financiera,
    coalesce(v.total_cobrado, 0) as total_cobrado,
    coalesce(v.num_pagos, 0) as num_pagos,
    coalesce(g.total_gastos_efectivo, 0) as total_gastos_efectivo,
    coalesce(g.total_gastos, 0) as total_gastos,
    coalesce(g.num_gastos, 0) as num_gastos,
    s.opening_amount + coalesce(v.total_efectivo, 0) - coalesce(g.total_egresos_efectivo, 0) as neto_efectivo,
    coalesce(g.total_reversos_efectivo, 0) as total_reversos_efectivo,
    coalesce(g.total_reversos, 0) as total_reversos,
    coalesce(g.num_reversos, 0) as num_reversos,
    coalesce(v.total_anulado, 0) as total_anulado,
    coalesce(v.num_anulados, 0) as num_anulados,
    coalesce(v.vigente_efectivo, 0) as vigente_efectivo,
    coalesce(v.vigente_transferencia, 0) as vigente_transferencia,
    coalesce(v.vigente_tarjeta, 0) as vigente_tarjeta,
    coalesce(v.vigente_financiera, 0) as vigente_financiera
  from public.cash_register_sessions s
  left join (
    select
      session_id,
      sum(monto) filter (where metodo_pago = 'efectivo') as total_efectivo,
      sum(monto) filter (where metodo_pago = 'transferencia') as total_transferencia,
      sum(monto) filter (where metodo_pago = 'tarjeta') as total_tarjeta,
      sum(monto) filter (where metodo_pago = 'financiera') as total_financiera,
      sum(monto) as total_cobrado,
      count(*) as num_pagos,
      sum(monto) filter (where anulado_at is not null) as total_anulado,
      count(*) filter (where anulado_at is not null) as num_anulados,
      sum(monto) filter (where metodo_pago = 'efectivo' and anulado_at is null) as vigente_efectivo,
      sum(monto) filter (where metodo_pago = 'transferencia' and anulado_at is null) as vigente_transferencia,
      sum(monto) filter (where metodo_pago = 'tarjeta' and anulado_at is null) as vigente_tarjeta,
      sum(monto) filter (where metodo_pago = 'financiera' and anulado_at is null) as vigente_financiera
    from public.ventas
    group by session_id
  ) v on v.session_id = s.id
  left join (
    select
      session_id,
      sum(monto) filter (where metodo_pago = 'efectivo' and categoria <> 'reverso_anulacion') as total_gastos_efectivo,
      sum(monto) filter (where categoria <> 'reverso_anulacion') as total_gastos,
      count(*) filter (where categoria <> 'reverso_anulacion') as num_gastos,
      sum(monto) filter (where metodo_pago = 'efectivo' and categoria = 'reverso_anulacion' and afecta_efectivo) as total_reversos_efectivo,
      sum(monto) filter (where categoria = 'reverso_anulacion') as total_reversos,
      count(*) filter (where categoria = 'reverso_anulacion') as num_reversos,
      sum(monto) filter (where metodo_pago = 'efectivo' and afecta_efectivo) as total_egresos_efectivo
    from public.caja_movimientos
    where anulado_at is null
    group by session_id
  ) g on g.session_id = s.id;

grant select on public.caja_sesiones_resumen to authenticated;
