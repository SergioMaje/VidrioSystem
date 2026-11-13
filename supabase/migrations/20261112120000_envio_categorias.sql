-- Categorías dentro de un envío de cotización.
--
-- Un envío (grupo_id) puede dividir sus opciones en categorías: "Puerta
-- principal" con las opciones A, B y C, y "Ventana cocina" con A y B. El
-- cliente elige como máximo una opción por categoría y puede omitir
-- categorías.
--
-- Al elegir, `consolidar_eleccion_envio` arma un pedido: una cotización suelta
-- nueva con los ítems de las opciones elegidas. El anticipo se cobra sobre ese
-- pedido con el `registrar_anticipo_cotizacion` de siempre, así que el recibo,
-- los abonos, el saldo, la orden de trabajo y la anulación no cambian.
--
-- Los envíos sin categorías (categoria_id nulo) siguen funcionando como antes.

-- ── 1. Categorías ───────────────────────────────────────────────────────────

create table if not exists public.envio_categorias (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.current_empresa_id() references public.empresas(id),
  grupo_id   uuid not null,
  nombre     text not null,
  tipo       public.tipo_producto_enum not null default 'otro',
  orden      integer not null,
  created_at timestamptz not null default now(),
  constraint envio_categorias_nombre_valido check (length(btrim(nombre)) between 1 and 60),
  constraint envio_categorias_orden_valido check (orden >= 0),
  constraint envio_categorias_empresa_id_id_key unique (empresa_id, id),
  -- Destino del FK compuesto de cotizaciones: la categoría debe ser del mismo envío.
  constraint envio_categorias_empresa_grupo_id_key unique (empresa_id, grupo_id, id),
  constraint envio_categorias_orden_unico unique (empresa_id, grupo_id, orden)
);

comment on table public.envio_categorias is
  'Partes de un envío de cotización (p. ej. "Puerta principal"). Cada una agrupa opciones alternativas.';
comment on column public.envio_categorias.tipo is
  'Tipo de producto de la parte; define el ícono y el color en el documento.';
comment on column public.envio_categorias.orden is
  'Posición de la categoría en el envío, desde 0. El número de la opción usa orden + 1 (COT-…-1A).';

create or replace trigger trg_00_forzar_empresa_id
  before insert or update or delete on public.envio_categorias
  for each row execute function public.forzar_empresa_id();

alter table public.envio_categorias enable row level security;

create policy autenticados_select_envio_categorias on public.envio_categorias
  for select using (empresa_id = (select public.current_empresa_id()) and auth.uid() is not null);
create policy autenticados_insert_envio_categorias on public.envio_categorias
  for insert with check (empresa_id = (select public.current_empresa_id()) and auth.uid() is not null);
create policy autenticados_update_envio_categorias on public.envio_categorias
  for update using (empresa_id = (select public.current_empresa_id()) and auth.uid() is not null);
create policy admin_delete_envio_categorias on public.envio_categorias
  for delete using (empresa_id = (select public.current_empresa_id()) and public.get_user_rol() = 'admin'::public.rol_usuario);

-- ── 2. Columnas en cotizaciones ─────────────────────────────────────────────

alter table public.cotizaciones
  add column if not exists categoria_id uuid,
  add column if not exists recomendada  boolean not null default false,
  add column if not exists pedido_id    uuid;

comment on column public.cotizaciones.categoria_id is
  'Categoría del envío a la que pertenece la opción. Null en un envío sin categorías y en una cotización suelta.';
comment on column public.cotizaciones.recomendada is
  'La vidriería recomienda esta opción dentro de su categoría. Solo se muestra en el documento.';
comment on column public.cotizaciones.pedido_id is
  'Pedido armado cuando el cliente eligió (consolidar_eleccion_envio). Lo llevan todas las opciones que estaban abiertas.';

-- La categoría tiene que ser del mismo envío que la opción.
alter table public.cotizaciones drop constraint if exists cotizaciones_categoria_id_fkey;
alter table public.cotizaciones add constraint cotizaciones_categoria_id_fkey
  foreign key (empresa_id, grupo_id, categoria_id)
  references public.envio_categorias (empresa_id, grupo_id, id) on delete restrict;

alter table public.cotizaciones drop constraint if exists cotizaciones_pedido_id_fkey;
alter table public.cotizaciones add constraint cotizaciones_pedido_id_fkey
  foreign key (empresa_id, pedido_id) references public.cotizaciones (empresa_id, id) on delete restrict;

alter table public.cotizaciones drop constraint if exists cotizaciones_categoria_en_grupo;
alter table public.cotizaciones add constraint cotizaciones_categoria_en_grupo
  check (categoria_id is null or grupo_id is not null);

create index if not exists cotizaciones_pedido_id_idx
  on public.cotizaciones (pedido_id) where pedido_id is not null;

-- Las letras se repiten entre categorías: la A de las puertas y la A de las
-- ventanas. Son únicas dentro de cada categoría (o del envío, si no tiene).
drop index if exists public.cotizaciones_grupo_etiqueta_unica;
create unique index cotizaciones_grupo_etiqueta_unica
  on public.cotizaciones (grupo_id, coalesce(categoria_id, '00000000-0000-0000-0000-000000000000'::uuid), opcion_etiqueta)
  where grupo_id is not null;

-- ── 3. Las opciones con categoría no se cobran directo ──────────────────────
-- El cobro va sobre el pedido. Se amplía el trigger que ya rechaza los cobros
-- sobre una anulada o una descartada.
create or replace function public.ventas_rechazar_cotizacion_anulada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cot public.cotizaciones;
begin
  if new.cotizacion_id is null then
    return new;
  end if;

  select * into v_cot from public.cotizaciones where id = new.cotizacion_id;
  if not found then
    return new;
  end if;

  if v_cot.estado = 'anulada'::public.estado_cotizacion then
    raise exception 'La cotización % está anulada: no se le pueden registrar cobros', v_cot.numero;
  end if;
  if v_cot.estado = 'descartada'::public.estado_cotizacion then
    raise exception 'La cotización % está descartada: el cliente eligió otra opción del envío', v_cot.numero;
  end if;
  if v_cot.categoria_id is not null then
    raise exception 'La cotización % es una opción de un envío por categorías: el cobro se hace sobre el pedido que arma la elección del cliente', v_cot.numero;
  end if;

  return new;
end;
$$;

revoke execute on function public.ventas_rechazar_cotizacion_anulada() from public, anon, authenticated;

-- ── 4. consolidar_eleccion_envio ────────────────────────────────────────────
-- El cliente eligió una opción por categoría (o menos, si omite alguna). Crea
-- el pedido con los ítems de las elegidas, pasa las elegidas a 'aprobada' y
-- descarta el resto de opciones abiertas del envío. Todas quedan apuntando al
-- pedido.
create or replace function public.consolidar_eleccion_envio(
  p_grupo_id uuid,
  p_opciones uuid[]
) returns public.cotizaciones
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario  uuid := auth.uid();
  v_empresa  uuid := public.current_empresa_id();
  v_elegidas public.cotizaciones[];
  v_primera  public.cotizaciones;
  v_previo   public.cotizaciones;
  v_mal      public.cotizaciones;
  v_cantidad integer;
  v_subtotal numeric;
  v_base     numeric;
  v_pedido   public.cotizaciones;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar la elección del cliente';
  end if;

  if p_grupo_id is null then
    raise exception 'Falta el envío';
  end if;

  v_cantidad := coalesce(cardinality(array(select distinct unnest(p_opciones))), 0);
  if v_cantidad = 0 then
    raise exception 'El cliente debe elegir al menos una opción';
  end if;
  if v_cantidad <> cardinality(p_opciones) then
    raise exception 'Hay opciones repetidas en la elección';
  end if;

  -- Mismo bloqueo que registrar_anticipo_cotizacion: el grupo completo, por id.
  perform 1 from public.cotizaciones
   where grupo_id = p_grupo_id and empresa_id = v_empresa
   order by id
   for update;
  if not found then
    raise exception 'Envío no encontrado';
  end if;

  select * into v_previo from public.cotizaciones
   where grupo_id = p_grupo_id and empresa_id = v_empresa and pedido_id is not null
   limit 1;
  if found then
    select * into v_previo from public.cotizaciones where id = v_previo.pedido_id;
    raise exception 'El cliente ya eligió en este envío: pedido %', v_previo.numero;
  end if;

  select * into v_previo from public.cotizaciones
   where grupo_id = p_grupo_id and empresa_id = v_empresa and estado = 'vendida'
   limit 1;
  if found then
    raise exception 'El envío ya tiene una opción vendida (%)', v_previo.numero;
  end if;

  select array_agg(c order by cat.orden, c.opcion_etiqueta) into v_elegidas
    from public.cotizaciones c
    left join public.envio_categorias cat on cat.id = c.categoria_id
   where c.id = any(p_opciones) and c.grupo_id = p_grupo_id and c.empresa_id = v_empresa;

  if coalesce(cardinality(v_elegidas), 0) <> v_cantidad then
    raise exception 'Alguna de las opciones elegidas no pertenece a este envío';
  end if;

  select * into v_mal from unnest(v_elegidas) e where e.categoria_id is null limit 1;
  if found then
    raise exception 'El envío no está dividido por categorías: cobra directamente la opción elegida';
  end if;

  select * into v_mal from unnest(v_elegidas) e where e.estado <> 'enviada' limit 1;
  if found then
    raise exception 'La opción % no está enviada (estado: %)', v_mal.numero, v_mal.estado;
  end if;

  if (select count(distinct e.categoria_id) from unnest(v_elegidas) e) <> v_cantidad then
    raise exception 'Solo se puede elegir una opción por categoría';
  end if;

  v_primera := v_elegidas[1];
  if exists (
    select 1 from unnest(v_elegidas) e
     where e.descuento_pct is distinct from v_primera.descuento_pct
        or e.iva_pct is distinct from v_primera.iva_pct
        or e.cliente_id is distinct from v_primera.cliente_id
  ) then
    raise exception 'Las opciones elegidas tienen distinto cliente, descuento o IVA: revisa el envío';
  end if;

  -- Misma fórmula que calcularTotales (src/lib/cotizaciones.ts).
  select coalesce(sum(i.precio_total), 0) into v_subtotal
    from public.cotizacion_items i
   where i.cotizacion_id = any(p_opciones);
  v_base := v_subtotal - v_subtotal * (coalesce(v_primera.descuento_pct, 0) / 100);

  insert into public.cotizaciones
    (numero, cliente_id, usuario_id, estado, fecha_emision, fecha_vencimiento,
     subtotal, descuento_pct, iva_pct, total, notas, fecha_aprobacion)
  values
    (regexp_replace(v_primera.numero, '-[0-9]*[A-Z]$', ''),
     v_primera.cliente_id, v_usuario, 'aprobada',
     (now() at time zone 'America/Bogota')::date, v_primera.fecha_vencimiento,
     v_subtotal, v_primera.descuento_pct, v_primera.iva_pct,
     v_base + v_base * (coalesce(v_primera.iva_pct, 0) / 100),
     v_primera.notas, now())
  returning * into v_pedido;

  -- Los ítems, en el orden de las categorías.
  insert into public.cotizacion_items
    (cotizacion_id, plantilla_id, descripcion, ancho_cm, alto_cm, area_m2, cantidad,
     precio_unitario, precio_total, notas, referencia_id, color_perfil, opciones,
     lado_medicion, lado_corredizo, medidas_irregulares, alto_izq_cm, alto_der_cm,
     ancho_sup_cm, ancho_inf_cm)
  select v_pedido.id, i.plantilla_id, i.descripcion, i.ancho_cm, i.alto_cm, i.area_m2, i.cantidad,
         i.precio_unitario, i.precio_total, i.notas, i.referencia_id, i.color_perfil, i.opciones,
         i.lado_medicion, i.lado_corredizo, i.medidas_irregulares, i.alto_izq_cm, i.alto_der_cm,
         i.ancho_sup_cm, i.ancho_inf_cm
    from unnest(array(select e.id from unnest(v_elegidas) e)) with ordinality o(cotizacion_id, pos)
    join public.cotizacion_items i on i.cotizacion_id = o.cotizacion_id
   order by o.pos, i.id;

  update public.cotizaciones
     set estado = 'aprobada',
         fecha_aprobacion = coalesce(fecha_aprobacion, now()),
         pedido_id = v_pedido.id
   where id = any(p_opciones);

  -- Lo demás que seguía abierto queda descartado, también las categorías que
  -- el cliente no tomó. Las rechazadas y las anuladas se dejan como están.
  update public.cotizaciones
     set estado = 'descartada',
         pedido_id = v_pedido.id
   where grupo_id = p_grupo_id and empresa_id = v_empresa
     and id <> all(p_opciones)
     and estado in ('borrador', 'enviada', 'vencida', 'aprobada');

  return v_pedido;
end;
$function$;

revoke execute on function public.consolidar_eleccion_envio(uuid, uuid[]) from public, anon;
grant execute on function public.consolidar_eleccion_envio(uuid, uuid[]) to authenticated;
