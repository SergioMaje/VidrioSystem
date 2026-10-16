-- Alta de vidrierias y usuarios desde el dashboard de Supabase, sin el script.
--
--   1. Empresa: en el SQL Editor, `select crear_empresa('Vidrieria X');` (ya existia).
--   2. Usuario: Authentication > Users > Add user, con correo y contrasena.
--   3. Vinculo: en el SQL Editor,
--      `select vincular_usuario('correo@x.com', '<empresa_id>', 'admin', 'Nombre', 'Apellido');`
--
-- Para eso handle_new_user() deja de rechazar el alta sin empresa: el usuario queda
-- con credenciales pero sin fila en usuarios ("pendiente"). Sin esa fila,
-- current_empresa_id() es null y el RLS no le muestra nada, y forzar_empresa_id()
-- le impide insertarse a si mismo en usuarios. scripts/alta-vidrieria.mjs sigue
-- funcionando igual: si app_metadata trae empresa_id, se vincula en el acto.

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid := nullif(new.raw_app_meta_data->>'empresa_id', '')::uuid;
  v_rol public.rol_usuario := coalesce(nullif(new.raw_app_meta_data->>'rol', ''), 'vendedor')::public.rol_usuario;
begin
  -- Creado desde el dashboard: queda pendiente hasta vincular_usuario().
  if v_empresa is null then
    return new;
  end if;

  if not exists (select 1 from public.empresas where id = v_empresa and activa) then
    raise exception 'El empresa_id de app_metadata no corresponde a una empresa activa';
  end if;

  insert into public.usuarios (id, nombre, apellido, email, rol, activo, empresa_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', 'Sin nombre'),
    coalesce(new.raw_user_meta_data->>'apellido', ''),
    new.email,
    v_rol,
    true,
    v_empresa
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Vincula un usuario pendiente (creado en Authentication > Users) con su vidrieria.
-- Tambien deja empresa y rol en app_metadata, para que el usuario quede igual que si
-- lo hubiera creado el script. Solo para el SQL Editor (postgres) o service_role.
create or replace function public.vincular_usuario(
  p_email text,
  p_empresa_id uuid,
  p_rol public.rol_usuario default 'vendedor',
  p_nombre text default null,
  p_apellido text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user auth.users;
begin
  select * into v_user from auth.users where lower(email) = lower(trim(p_email));
  if not found then
    raise exception 'No hay ningun usuario con el correo %. Crealo primero en Authentication > Users', p_email;
  end if;

  if not exists (select 1 from public.empresas where id = p_empresa_id and activa) then
    raise exception 'La empresa % no existe o esta inactiva', p_empresa_id;
  end if;

  if exists (select 1 from public.usuarios where id = v_user.id) then
    raise exception 'El usuario % ya pertenece a una empresa', p_email;
  end if;

  insert into public.usuarios (id, nombre, apellido, email, rol, activo, empresa_id)
  values (
    v_user.id,
    coalesce(nullif(trim(p_nombre), ''), v_user.raw_user_meta_data->>'nombre', 'Sin nombre'),
    coalesce(nullif(trim(p_apellido), ''), v_user.raw_user_meta_data->>'apellido', ''),
    v_user.email,
    p_rol,
    true,
    p_empresa_id
  );

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('empresa_id', p_empresa_id, 'rol', p_rol)
  where id = v_user.id;

  return v_user.id;
end;
$$;

revoke execute on function public.vincular_usuario(text, uuid, public.rol_usuario, text, text) from public, anon, authenticated;
grant execute on function public.vincular_usuario(text, uuid, public.rol_usuario, text, text) to service_role;
