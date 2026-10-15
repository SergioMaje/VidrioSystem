-- Multi-tenant, paso 1 de 3: cada fila de negocio pasa a pertenecer a una empresa.
--
-- Hasta ahora la base era de una sola vidrieria. Esta migracion crea `empresas`, cuelga
-- de ella a los usuarios y a todas las tablas de negocio, y mete en la empresa actual
-- todo lo que ya existe. Las politicas RLS y las RPC todavia no filtran por empresa:
-- eso va en el paso 2. Aqui solo se deja la estructura para que la app actual siga
-- funcionando sin cambios:
--   * `empresa_id` tiene DEFAULT current_empresa_id(), asi los INSERT del front que no
--     lo mandan quedan en la empresa del usuario.
--   * El trigger `trg_00_forzar_empresa_id` ignora el `empresa_id` que mande el cliente
--     y rechaza escribir o borrar filas de otra empresa, aunque sea desde una RPC
--     SECURITY DEFINER.
--   * Los FK pasan a ser compuestos (empresa_id, x_id): la base no deja enlazar una
--     cotizacion con un cliente o un item de otra empresa.

-- ── Empresas ────────────────────────────────────────────────────────────────

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.empresas enable row level security;

-- La vidrieria que ya existe. El nombre sale del membrete para no inventar uno.
insert into public.empresas (nombre)
select coalesce((select nombre from public.configuracion_empresa limit 1), 'VidrioSystem')
where not exists (select 1 from public.empresas);

-- ── Usuarios ────────────────────────────────────────────────────────────────

alter table public.usuarios add column if not exists empresa_id uuid references public.empresas(id);

update public.usuarios set empresa_id = (select id from public.empresas order by created_at limit 1)
where empresa_id is null;

alter table public.usuarios alter column empresa_id set not null;

-- Empresa del usuario en sesion. SECURITY DEFINER por la misma razon que get_user_rol():
-- las politicas de `usuarios` la van a usar y leerla con RLS seria recursivo. Un usuario
-- inactivo o de una empresa inactiva no tiene empresa, y por lo tanto no ve nada.
create or replace function public.current_empresa_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select u.empresa_id
  from public.usuarios u
  join public.empresas e on e.id = u.empresa_id
  where u.id = auth.uid() and u.activo and e.activa;
$$;

-- Cada uno ve solo su empresa. Escribir en `empresas` es solo de service_role: las
-- vidrierias las da de alta el dueno del sistema, no los usuarios.
create policy "autenticados_select_empresa_propia" on public.empresas
  for select using (id = (select public.current_empresa_id()));

revoke insert, update, delete, truncate on public.empresas from anon, authenticated;

-- ── Trigger que fija la empresa ─────────────────────────────────────────────

-- Con usuario en sesion (app o RPC) la empresa la decide la base: el INSERT queda en la
-- empresa del usuario y nadie puede tocar ni mover filas de otra. Sin usuario en sesion
-- (service_role, migraciones, el alta de usuarios de Auth) se respeta lo que venga, que
-- es como se siembran empresas nuevas.
create or replace function public.forzar_empresa_id()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_empresa := public.current_empresa_id();
  if v_empresa is null then
    raise exception 'Tu usuario no pertenece a ninguna empresa activa';
  end if;

  if tg_op = 'INSERT' then
    new.empresa_id := v_empresa;
    return new;
  end if;

  if old.empresa_id <> v_empresa then
    raise exception 'Registro no encontrado';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.empresa_id is distinct from old.empresa_id then
    raise exception 'No se puede cambiar la empresa de un registro';
  end if;
  return new;
end;
$$;

revoke execute on function public.forzar_empresa_id() from public, anon, authenticated;

-- ── empresa_id en todas las tablas de negocio ───────────────────────────────

do $$
declare
  v_empresa uuid := (select id from public.empresas order by created_at limit 1);
  t text;
begin
  foreach t in array array[
    'categorias', 'unidades_medida', 'tipos_producto', 'proveedores', 'proveedor_cuentas_pago',
    'items_inventario', 'movimientos_inventario', 'referencias_producto', 'referencia_cortes',
    'plantillas_producto', 'plantilla_componentes', 'clientes', 'cotizaciones', 'cotizacion_items',
    'ordenes_trabajo', 'orden_materiales', 'ventas', 'ventas_mostrador', 'ventas_mostrador_items',
    'cash_register_sessions', 'caja_movimientos', 'cuentas_pago_empresa', 'configuracion_empresa',
    'financieras', 'financiera_desembolsos'
  ] loop
    execute format('alter table public.%I add column if not exists empresa_id uuid references public.empresas(id)', t);
    execute format('update public.%I set empresa_id = %L where empresa_id is null', t, v_empresa);
    execute format('alter table public.%I alter column empresa_id set not null', t);
    execute format('alter table public.%I alter column empresa_id set default public.current_empresa_id()', t);
  end loop;

  -- (empresa_id, id) unico en todas, usuarios incluido: es el destino de los FK
  -- compuestos y, de paso, el indice por empresa que van a usar las politicas.
  foreach t in array array[
    'usuarios',
    'categorias', 'unidades_medida', 'tipos_producto', 'proveedores', 'proveedor_cuentas_pago',
    'items_inventario', 'movimientos_inventario', 'referencias_producto', 'referencia_cortes',
    'plantillas_producto', 'plantilla_componentes', 'clientes', 'cotizaciones', 'cotizacion_items',
    'ordenes_trabajo', 'orden_materiales', 'ventas', 'ventas_mostrador', 'ventas_mostrador_items',
    'cash_register_sessions', 'caja_movimientos', 'cuentas_pago_empresa', 'configuracion_empresa',
    'financieras', 'financiera_desembolsos'
  ] loop
    execute format('alter table public.%I add constraint %I unique (empresa_id, id)', t, t || '_empresa_id_id_key');
    execute format(
      'create or replace trigger trg_00_forzar_empresa_id before insert or update or delete on public.%I '
      'for each row execute function public.forzar_empresa_id()', t);
  end loop;
end $$;

-- ── FK compuestos ───────────────────────────────────────────────────────────

-- Todos los FK entre tablas de public son de una columna contra `id`. Se recrean con el
-- mismo nombre y la misma accion ON DELETE, pero contra (empresa_id, id). Las columnas
-- nullable siguen funcionando igual: con MATCH SIMPLE un x_id nulo no se verifica.
do $$
declare
  r record;
  v_accion text;
begin
  for r in
    select c.conname,
           c.conrelid::regclass as hija,
           c.confrelid::regclass as padre,
           a.attname as columna,
           c.confdeltype
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and array_length(c.conkey, 1) = 1
      and c.confrelid <> 'public.empresas'::regclass
      and c.confrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  loop
    v_accion := case r.confdeltype
      when 'c' then 'on delete cascade'
      when 'r' then 'on delete restrict'
      when 'a' then ''
      else null
    end;
    if v_accion is null then
      raise exception 'FK % con ON DELETE % no contemplado', r.conname, r.confdeltype;
    end if;

    execute format('alter table %s drop constraint %I', r.hija, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (empresa_id, %I) references %s (empresa_id, id) %s',
      r.hija, r.conname, r.columna, r.padre, v_accion);
  end loop;
end $$;

-- ── UNIQUE de negocio pasan a ser por empresa ───────────────────────────────

-- Mismos nombres: el front reconoce los duplicados por el codigo 23505, no por el nombre.
alter table public.categorias drop constraint categorias_nombre_key,
  add constraint categorias_nombre_key unique (empresa_id, nombre);
alter table public.unidades_medida drop constraint unidades_medida_nombre_key,
  add constraint unidades_medida_nombre_key unique (empresa_id, nombre);
alter table public.tipos_producto drop constraint tipos_producto_nombre_key,
  add constraint tipos_producto_nombre_key unique (empresa_id, nombre);
alter table public.financieras drop constraint financieras_nombre_key,
  add constraint financieras_nombre_key unique (empresa_id, nombre);
alter table public.proveedores drop constraint proveedores_nit_key,
  add constraint proveedores_nit_key unique (empresa_id, nit);
alter table public.clientes drop constraint clientes_documento_key,
  add constraint clientes_documento_key unique (empresa_id, documento);
alter table public.items_inventario drop constraint items_inventario_codigo_key,
  add constraint items_inventario_codigo_key unique (empresa_id, codigo);
alter table public.cotizaciones drop constraint cotizaciones_numero_key,
  add constraint cotizaciones_numero_key unique (empresa_id, numero);
alter table public.ordenes_trabajo drop constraint ordenes_trabajo_numero_key,
  add constraint ordenes_trabajo_numero_key unique (empresa_id, numero);
alter table public.ventas_mostrador drop constraint ventas_mostrador_numero_key,
  add constraint ventas_mostrador_numero_key unique (empresa_id, numero);

-- Una caja abierta por empresa, no una en todo el sistema.
drop index public.cash_register_sessions_one_open_idx;
create unique index cash_register_sessions_one_open_idx
  on public.cash_register_sessions (empresa_id) where status = 'open';

-- Un membrete por empresa, en lugar de una fila en toda la base.
drop index public.idx_configuracion_empresa_fila_unica;
alter table public.configuracion_empresa
  add constraint configuracion_empresa_empresa_id_key unique (empresa_id);

-- ── Consecutivos por empresa ────────────────────────────────────────────────

-- Las secuencias de Postgres son globales: con dos empresas, cada una veria huecos en
-- su numeracion. El contador va en una fila por (empresa, clave); el UPDATE bloquea la
-- fila hasta el commit, asi dos ventas simultaneas no sacan el mismo numero, y si la
-- transaccion falla el contador vuelve atras sin dejar hueco.
create table if not exists public.empresa_consecutivos (
  empresa_id uuid not null references public.empresas(id),
  clave text not null,
  ultimo bigint not null default 0,
  primary key (empresa_id, clave)
);

alter table public.empresa_consecutivos enable row level security;
revoke all on public.empresa_consecutivos from anon, authenticated;

create or replace function public.siguiente_consecutivo(p_clave text)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid := public.current_empresa_id();
  v_numero bigint;
begin
  if v_empresa is null then
    raise exception 'Tu usuario no pertenece a ninguna empresa activa';
  end if;

  insert into public.empresa_consecutivos as c (empresa_id, clave, ultimo)
  values (v_empresa, p_clave, 1)
  on conflict (empresa_id, clave) do update set ultimo = c.ultimo + 1
  returning c.ultimo into v_numero;

  return v_numero;
end;
$$;

revoke execute on function public.siguiente_consecutivo(text) from public, anon;

-- La empresa actual sigue la numeracion donde la dejo la secuencia.
insert into public.empresa_consecutivos (empresa_id, clave, ultimo)
select (select id from public.empresas order by created_at limit 1), 'venta_mostrador',
       coalesce((select last_value from pg_sequences
                 where schemaname = 'public' and sequencename = 'ventas_mostrador_numero_seq'), 0)
on conflict do nothing;

alter table public.ventas_mostrador
  alter column numero set default 'VD-' || lpad(public.siguiente_consecutivo('venta_mostrador')::text, 6, '0');

drop sequence public.ventas_mostrador_numero_seq;

-- `items_recorte_codigo_seq` se reemplaza en el paso 2, junto con la reescritura de
-- registrar_recorte().

-- ── Alta de usuarios ────────────────────────────────────────────────────────

-- `usuarios.empresa_id` es obligatorio, asi que el usuario nuevo tiene que llegar con
-- su empresa en `raw_app_meta_data` (solo el servidor puede escribirlo; los metadatos
-- de usuario los edita el propio usuario y no sirven para esto).
-- Transicion: mientras haya una sola empresa, un usuario creado desde el dashboard sin
-- metadatos cae en ella. El paso 3 quita este atajo.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid := nullif(new.raw_app_meta_data->>'empresa_id', '')::uuid;
begin
  if v_empresa is null and (select count(*) from public.empresas) = 1 then
    select id into v_empresa from public.empresas;
  end if;

  if v_empresa is null then
    raise exception 'El usuario nuevo debe traer empresa_id en app_metadata';
  end if;

  insert into public.usuarios (id, nombre, apellido, email, rol, activo, empresa_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', 'Sin nombre'),
    coalesce(new.raw_user_meta_data->>'apellido', ''),
    new.email,
    'vendedor',
    true,
    v_empresa
  );
  return new;
end;
$$;
