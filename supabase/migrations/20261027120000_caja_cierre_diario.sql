-- Cierre de caja obligatorio cada día.
--
-- Hasta ahora un turno podía quedar abierto varios días y se seguía vendiendo,
-- cobrando y registrando gastos sobre él: el arqueo terminaba mezclando días y
-- dejaba de servir como control diario. Desde aquí, una caja abierta en un día
-- anterior solo admite cerrarse.
--
-- El día se corta a medianoche hora Colombia, mismo criterio que la cartera de
-- financieras (20260916090100_financieras.sql).

create or replace function public.caja_es_del_dia(p_opened_at timestamptz)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select (p_opened_at at time zone 'America/Bogota')::date
       = (now() at time zone 'America/Bogota')::date;
$$;

grant execute on function public.caja_es_del_dia(timestamptz) to authenticated;

-- Trigger aparte y no dentro de cada RPC: todo cobro (mostrador, anticipo,
-- abono) termina en un insert a `ventas` y todo gasto en `caja_movimientos`, así
-- que dos triggers cubren todos los caminos sin reescribir esas funciones. Si
-- falla, la transacción entera se revierte, cabecera de mostrador incluida.
-- `cerrar_caja` y la anulación de gastos no insertan aquí: cerrar una caja
-- vencida sigue funcionando.
create or replace function public.exigir_caja_del_dia()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_opened_at timestamptz;
begin
  select opened_at into v_opened_at
    from public.cash_register_sessions
   where id = new.session_id and empresa_id = new.empresa_id;

  if v_opened_at is not null and not public.caja_es_del_dia(v_opened_at) then
    raise exception 'La caja está abierta desde el %: ciérrala antes de seguir registrando movimientos',
      to_char(v_opened_at at time zone 'America/Bogota', 'DD/MM/YYYY');
  end if;

  return new;
end;
$$;

drop trigger if exists exigir_caja_del_dia on public.ventas;
create trigger exigir_caja_del_dia
  before insert on public.ventas
  for each row execute function public.exigir_caja_del_dia();

drop trigger if exists exigir_caja_del_dia on public.caja_movimientos;
create trigger exigir_caja_del_dia
  before insert on public.caja_movimientos
  for each row execute function public.exigir_caja_del_dia();
