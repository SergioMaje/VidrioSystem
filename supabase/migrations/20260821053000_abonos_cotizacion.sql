-- Abonos: una cotización se paga en varios pagos, con anticipo mínimo del 50%.
--
-- `ventas` deja de ser "una venta por el total" y pasa a ser el libro de pagos:
-- cada fila es un cobro parcial. Se mantiene el nombre de la tabla para que el
-- cierre de caja y el reporte de ingresos (que suman ventas.monto por sesión y
-- por período) sigan cuadrando sin cambios. El saldo nunca se almacena: se
-- deriva en la vista cotizaciones_saldo.

-- ── 1. Varios pagos por cotización ──────────────────────────────────────────

alter table public.ventas drop constraint if exists ventas_cotizacion_id_key;
create index if not exists ventas_cotizacion_id_idx on public.ventas (cotizacion_id);

do $$ begin
  create type public.tipo_pago as enum ('anticipo', 'abono', 'saldo_final');
exception when duplicate_object then null;
end $$;

alter table public.ventas
  add column if not exists tipo public.tipo_pago not null default 'abono',
  add column if not exists autorizado_por uuid references public.usuarios(id),
  add column if not exists motivo_autorizacion text;

alter table public.ventas drop constraint if exists ventas_monto_positivo;
alter table public.ventas add constraint ventas_monto_positivo check (monto > 0);

-- Las ventas históricas eran el pago completo: son el anticipo de su cotización.
update public.ventas set tipo = 'anticipo';

-- ── 2. Vista de saldos: fuente única de verdad ──────────────────────────────

create or replace view public.cotizaciones_saldo as
select
  c.id                                as cotizacion_id,
  c.total                             as total,
  coalesce(sum(v.monto), 0)           as total_abonado,
  c.total - coalesce(sum(v.monto), 0) as saldo,
  case when c.total > 0
       then round(coalesce(sum(v.monto), 0) / c.total * 100, 2)
       else 0 end                     as pct_abonado
from public.cotizaciones c
left join public.ventas v on v.cotizacion_id = c.id
group by c.id, c.total;

-- security_invoker: la vista respeta las RLS de las tablas base en vez de
-- ejecutarse con los permisos del owner.
alter view public.cotizaciones_saldo set (security_invoker = on);
grant select on public.cotizaciones_saldo to authenticated;

-- ── 3. Reglas de cobro ──────────────────────────────────────────────────────
-- El `for update` sobre la cotización serializa inserts concurrentes: sin él,
-- dos pagos simultáneos podrían leer el mismo abonado y sobrepasar el total.

create or replace function public.validar_pago_cotizacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_abonado numeric;
begin
  select total into v_total from public.cotizaciones where id = new.cotizacion_id for update;
  if v_total is null then
    raise exception 'Cotización no encontrada';
  end if;

  if (select status from public.cash_register_sessions where id = new.session_id) <> 'open' then
    raise exception 'La sesión de caja está cerrada';
  end if;

  select coalesce(sum(monto), 0) into v_abonado
    from public.ventas where cotizacion_id = new.cotizacion_id;

  -- Tolerancia de $1 por el redondeo del IVA.
  if v_abonado + new.monto > v_total + 1 then
    raise exception 'El pago excede el saldo pendiente (saldo: %)', v_total - v_abonado;
  end if;

  if v_abonado = 0 and new.monto < v_total * 0.5 then
    if new.autorizado_por is null then
      raise exception 'El anticipo debe ser al menos el 50%% del total (mínimo: %)', round(v_total * 0.5);
    end if;
    if (select rol from public.usuarios where id = new.autorizado_por) <> 'admin'::rol_usuario then
      raise exception 'Solo un administrador puede autorizar un anticipo menor al 50%%';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists ventas_validar_pago on public.ventas;
create trigger ventas_validar_pago before insert on public.ventas
  for each row execute function public.validar_pago_cotizacion();

-- ── 4. No se entrega con saldo pendiente ────────────────────────────────────

create or replace function public.validar_entrega_orden()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_saldo numeric;
begin
  if new.estado = 'entregada'
     and old.estado is distinct from 'entregada'
     and new.cotizacion_id is not null then
    select saldo into v_saldo from public.cotizaciones_saldo where cotizacion_id = new.cotizacion_id;
    if coalesce(v_saldo, 0) > 1 then
      raise exception 'No se puede entregar: la cotización tiene un saldo pendiente de %', v_saldo;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ordenes_validar_entrega on public.ordenes_trabajo;
create trigger ordenes_validar_entrega before update on public.ordenes_trabajo
  for each row execute function public.validar_entrega_orden();
