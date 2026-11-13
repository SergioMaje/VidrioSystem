-- Numeración consecutiva de cotizaciones: COT-00001, COT-00002… por vidriería.
--
-- Hasta ahora el navegador armaba el número con la hora (COT-<milisegundos>).
-- Desde esta migración lo asigna la base. Las cotizaciones anteriores conservan
-- su número: ya están en PDFs, imágenes y recibos que tienen los clientes.
--
-- También corrige el tope de los consecutivos con relleno de ceros: lpad corta
-- en lugar de alargar (lpad('10000', 4, '0') = '1000'), así que el recibo 10.000
-- habría salido como RC-1000 y chocado con el existente.

-- ── 1. Formato sin tope ─────────────────────────────────────────────────────
create or replace function public.formato_consecutivo(p_prefijo text, p_n bigint, p_ancho int)
returns text
language sql
immutable
set search_path to 'public'
as $$
  -- Rellena con ceros hasta p_ancho, pero un número más largo sale completo:
  -- COT-99999 → COT-100000.
  select p_prefijo || case
    when length(p_n::text) >= p_ancho then p_n::text
    else lpad(p_n::text, p_ancho, '0')
  end
$$;

comment on function public.formato_consecutivo(text, bigint, int) is
  'Prefijo + número con relleno de ceros hasta p_ancho, sin cortar nunca un número más largo.';

-- Recibos: mismo trigger de 20261111120000, ahora sin tope.
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

  new.numero_recibo := public.formato_consecutivo('RC-', v_n, 4);
  return new;
end;
$$;

revoke execute on function public.ventas_asignar_recibo() from public, anon, authenticated;

-- Ventas de mostrador: el mismo default de 20261015120000, sin tope.
alter table public.ventas_mostrador
  alter column numero set default public.formato_consecutivo('VD-', public.siguiente_consecutivo('venta_mostrador'), 6);

-- ── 2. El consecutivo como número ───────────────────────────────────────────
alter table public.cotizaciones
  add column if not exists consecutivo bigint check (consecutivo > 0);

comment on column public.cotizaciones.consecutivo is
  'Número del envío (el 18 de COT-00018-B), consecutivo por vidriería. Lo comparten las opciones de un envío y su pedido. Null en las cotizaciones anteriores a 20261113120000, que conservan su número COT-<milisegundos>.';

-- Para buscar y ordenar por número: el texto "COT-100000" quedaría antes que "COT-99999".
create index if not exists idx_cotizaciones_consecutivo
  on public.cotizaciones (empresa_id, consecutivo)
  where consecutivo is not null;

-- ── 3. Asignación del número ────────────────────────────────────────────────
-- El contador es empresa_consecutivos con la clave 'cotizacion' (como
-- venta_mostrador). Está en la misma transacción que el insert: si la
-- cotización falla, el contador se revierte y no quedan huecos. La fila
-- bloqueada serializa dos cotizaciones simultáneas de la misma vidriería.
--
-- Usa new.empresa_id y no current_empresa_id(): así también sirve sin sesión.
create or replace function public.cotizaciones_asignar_numero()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sufijo text;
  v_base   text;
  v_n      bigint;
  v_hallada boolean;
begin
  if new.empresa_id is null then
    raise exception 'La cotización necesita empresa_id para recibir su número';
  end if;

  -- Sufijo de la opción: B, o 2B si está en la segunda categoría.
  if new.opcion_etiqueta is not null then
    if new.categoria_id is not null then
      select (c.orden + 1)::text into v_sufijo
        from public.envio_categorias c where c.id = new.categoria_id;
    end if;
    v_sufijo := coalesce(v_sufijo, '') || new.opcion_etiqueta;
  end if;

  -- a) Otra opción del mismo envío: hereda su número base, sea nuevo o viejo.
  --    Cubre la opción agregada después y las filas 2, 3… del insert de un envío
  --    nuevo (un trigger BEFORE ROW ve las filas ya insertadas por el mismo comando).
  if new.grupo_id is not null then
    select regexp_replace(c.numero, '-[0-9]*[A-Z]$', ''), c.consecutivo, true
      into v_base, v_n, v_hallada
      from public.cotizaciones c
     where c.grupo_id = new.grupo_id and c.empresa_id = new.empresa_id
     order by c.created_at
     limit 1;
    if v_hallada then
      -- La letra repetida chocaría con el número de la otra opción; mejor decirlo claro.
      if exists (
        select 1 from public.cotizaciones c
         where c.grupo_id = new.grupo_id
           and c.categoria_id is not distinct from new.categoria_id
           and c.opcion_etiqueta = new.opcion_etiqueta
      ) then
        raise exception 'El envío ya tiene la opción %', v_sufijo;
      end if;
      new.numero := v_base || coalesce('-' || v_sufijo, '');
      new.consecutivo := v_n;
      return new;
    end if;
  end if;

  -- b) El pedido que arma consolidar_eleccion_envio: lleva el número base de su
  --    envío por categorías.
  if new.numero is not null and new.grupo_id is null then
    select c.consecutivo, true into v_n, v_hallada
      from public.cotizaciones c
     where c.empresa_id = new.empresa_id
       and c.categoria_id is not null
       and regexp_replace(c.numero, '-[0-9]*[A-Z]$', '') = new.numero
     limit 1;
    if v_hallada then
      new.consecutivo := v_n;
      return new;
    end if;
  end if;

  -- c) Número con el formato anterior: una pestaña abierta desde antes de esta
  --    migración. Se respeta para que sus ítems, que empareja por número, no se
  --    pierdan. Trece dígitos nunca chocan con el consecutivo.
  if new.numero ~ '^COT-[0-9]{13}(-[0-9]*[A-Z])?$' then
    new.consecutivo := null;
    return new;
  end if;

  -- d) Todo lo demás toma el siguiente consecutivo. Lo que mande el navegador se
  --    ignora: nadie puede adelantarse al contador.
  insert into public.empresa_consecutivos as ec (empresa_id, clave, ultimo)
  values (new.empresa_id, 'cotizacion', 1)
  on conflict (empresa_id, clave) do update set ultimo = ec.ultimo + 1
  returning ec.ultimo into v_n;

  new.consecutivo := v_n;
  new.numero := public.formato_consecutivo('COT-', v_n, 5) || coalesce('-' || v_sufijo, '');
  return new;
end;
$$;

revoke execute on function public.cotizaciones_asignar_numero() from public, anon, authenticated;

comment on function public.cotizaciones_asignar_numero() is
  'Asigna el número de la cotización: hereda el del envío, respeta el del pedido y el formato anterior, o toma el siguiente consecutivo.';

-- Los triggers BEFORE corren en orden alfabético: trg_zz queda después de
-- trg_00_forzar_empresa_id, que fija empresa_id.
drop trigger if exists trg_zz_asignar_numero_cotizacion on public.cotizaciones;
create trigger trg_zz_asignar_numero_cotizacion
  before insert on public.cotizaciones
  for each row execute function public.cotizaciones_asignar_numero();

-- ── 4. El número no se edita ────────────────────────────────────────────────
create or replace function public.cotizaciones_numero_inmutable()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.numero is distinct from old.numero or new.consecutivo is distinct from old.consecutivo then
    raise exception 'El número de la cotización % no se puede cambiar', old.numero;
  end if;
  return new;
end;
$$;

revoke execute on function public.cotizaciones_numero_inmutable() from public, anon, authenticated;

drop trigger if exists trg_cotizaciones_numero_inmutable on public.cotizaciones;
create trigger trg_cotizaciones_numero_inmutable
  before update of numero, consecutivo on public.cotizaciones
  for each row execute function public.cotizaciones_numero_inmutable();
