-- Recibo de pago por cada cobro.
--
-- Cada fila de `ventas` (anticipo, abono, saldo final o venta de mostrador)
-- recibe un número de recibo consecutivo por vidriería: RC-0001, RC-0002…
-- El recibo es la versión imprimible de ese cobro; no se guarda aparte.
--
-- La numeración empieza con esta migración: los cobros anteriores quedan con
-- numero_recibo null y no tienen recibo.

-- ── 1. Contador por vidriería ───────────────────────────────────────────────
-- Una tabla y no una sequence: si el cobro falla, la transacción revierte
-- también el contador y no quedan huecos. La fila bloqueada por el UPDATE
-- serializa dos cobros simultáneos de la misma vidriería.
create table if not exists public.recibos_consecutivo (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ultimo     integer not null default 0 check (ultimo >= 0)
);

comment on table public.recibos_consecutivo is
  'Último número de recibo emitido por vidriería. Solo lo escribe el trigger ventas_zz_asignar_recibo.';

-- RLS sin políticas: nadie la lee ni la escribe desde el navegador.
alter table public.recibos_consecutivo enable row level security;
revoke all on public.recibos_consecutivo from public, anon, authenticated;

-- ── 2. Número en cada cobro ─────────────────────────────────────────────────

alter table public.ventas
  add column if not exists numero_recibo text;

comment on column public.ventas.numero_recibo is
  'Número del recibo de pago (RC-0001…), consecutivo por vidriería. Null en los cobros anteriores a 20261111120000.';

alter table public.ventas drop constraint if exists ventas_numero_recibo_unico;
alter table public.ventas add constraint ventas_numero_recibo_unico
  unique (empresa_id, numero_recibo);

-- Siempre pisa lo que venga en el insert: el abono se inserta directo desde el
-- navegador y no debe poder elegir su número. Cubre también los RPC
-- registrar_anticipo_cotizacion y registrar_venta_mostrador sin tocarlos.
--
-- Los triggers BEFORE corren por orden alfabético: el prefijo `zz` lo deja al
-- final, después de trg_00_forzar_empresa_id (que fija empresa_id) y de las
-- validaciones. Un cobro rechazado ni siquiera toca el contador.
create or replace function public.ventas_asignar_recibo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n integer;
begin
  insert into public.recibos_consecutivo as rc (empresa_id, ultimo)
  values (new.empresa_id, 1)
  on conflict (empresa_id) do update set ultimo = rc.ultimo + 1
  returning ultimo into v_n;

  new.numero_recibo := 'RC-' || lpad(v_n::text, 4, '0');
  return new;
end;
$$;

revoke execute on function public.ventas_asignar_recibo() from public, anon, authenticated;

drop trigger if exists ventas_zz_asignar_recibo on public.ventas;
create trigger ventas_zz_asignar_recibo
  before insert on public.ventas
  for each row execute function public.ventas_asignar_recibo();

-- numero_recibo no está entre las columnas mutables de ventas_inmutable
-- (20261106120100), así que después del insert no se puede cambiar.

-- ── 3. Mensaje de agradecimiento del recibo ─────────────────────────────────
-- Null = el texto por defecto ("¡Gracias por confiar en {empresa}!", en
-- src/lib/recibos.ts). {empresa} se reemplaza por el nombre de la vidriería.
alter table public.configuracion_empresa
  add column if not exists mensaje_recibo text;

alter table public.configuracion_empresa
  drop constraint if exists configuracion_empresa_mensaje_recibo_check;
alter table public.configuracion_empresa
  add constraint configuracion_empresa_mensaje_recibo_check
  check (mensaje_recibo is null or char_length(mensaje_recibo) between 1 and 200);
