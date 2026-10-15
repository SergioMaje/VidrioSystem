-- Multi-tenant, paso 3 de 3: dar de alta vidrierias y cerrar los atajos de transicion.
--
--   1. crear_empresa(): crea la empresa con su membrete y sus catalogos base. Solo la
--      ejecuta service_role: las vidrierias las da de alta el dueno del sistema
--      (scripts/alta-vidrieria.mjs).
--   2. handle_new_user(): sin el atajo de "si hay una sola empresa, esa". Todo usuario
--      nuevo trae empresa_id (y opcionalmente rol) en app_metadata.
--   3. Logo en Storage: cada empresa escribe solo en su carpeta `{empresa_id}/`.

-- ── 1. Alta de empresa ──────────────────────────────────────────────────────

-- Corre sin auth.uid(), asi que trg_00_forzar_empresa_id respeta el empresa_id que se
-- pasa explicito en cada insert. Los catalogos son los mismos de
-- 20260831120000_seed_catalogo_base.sql y de financieras: una vidrieria nueva puede
-- crear plantillas y cotizar desde el primer dia. Los consecutivos (VD-, REC-) no se
-- siembran: siguiente_consecutivo() crea la fila la primera vez que se usa.
create or replace function public.crear_empresa(p_nombre text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid;
begin
  if p_nombre is null or length(trim(p_nombre)) = 0 then
    raise exception 'Indica el nombre de la vidrieria';
  end if;

  insert into public.empresas (nombre) values (trim(p_nombre)) returning id into v_empresa;

  insert into public.configuracion_empresa (empresa_id, nombre) values (v_empresa, trim(p_nombre));

  insert into public.tipos_producto (empresa_id, nombre, descripcion, activo) values
    (v_empresa, 'ventana',  'Ventanas de aluminio y vidrio',     true),
    (v_empresa, 'puerta',   'Puertas de aluminio y vidrio',      true),
    (v_empresa, 'division', 'Divisiones y mamparas',             true),
    (v_empresa, 'espejo',   'Espejos decorativos y funcionales', true),
    (v_empresa, 'otro',     'Otros productos personalizados',    true);

  insert into public.unidades_medida (empresa_id, nombre, simbolo, tipo) values
    (v_empresa, 'Metro cuadrado', 'm²',   'area'),
    (v_empresa, 'Metro lineal',   'ml',   'longitud'),
    (v_empresa, 'Unidad',         'und',  'unidad'),
    (v_empresa, 'Tubo',           'tubo', 'unidad'),
    (v_empresa, 'Kilogramo',      'kg',   'peso');

  insert into public.categorias (empresa_id, nombre, descripcion, icono, activa) values
    (v_empresa, 'Perfil de aluminio', 'Perfiles y marcos de aluminio',           'minus',   true),
    (v_empresa, 'Vidrio',             'Láminas y tipos de vidrio',               'square',  true),
    (v_empresa, 'Herrajes',           'Bisagras, cerraduras y accesorios metal', 'tool',    true),
    (v_empresa, 'Sellantes',          'Silicona, sellantes y cintas',            'droplet', true),
    (v_empresa, 'Accesorios',         'Accesorios varios para instalación',      'package', true);

  insert into public.financieras (empresa_id, nombre, comision_pct, dias_desembolso) values
    (v_empresa, 'Addi', 0, 7),
    (v_empresa, 'Sistecrédito', 0, 30);

  return v_empresa;
end;
$$;

revoke execute on function public.crear_empresa(text) from public, anon, authenticated;
grant execute on function public.crear_empresa(text) to service_role;

-- ── 2. Alta de usuarios ─────────────────────────────────────────────────────

-- app_metadata solo lo escribe el servidor (service_role); por eso de ahi, y no de
-- user_metadata, salen la empresa y el rol. Un usuario creado desde el dashboard sin
-- metadatos ya no entra: hay que usar scripts/alta-vidrieria.mjs.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid := nullif(new.raw_app_meta_data->>'empresa_id', '')::uuid;
  v_rol public.rol_usuario := coalesce(nullif(new.raw_app_meta_data->>'rol', ''), 'vendedor')::public.rol_usuario;
begin
  if v_empresa is null or not exists (select 1 from public.empresas where id = v_empresa and activa) then
    raise exception 'El usuario nuevo debe traer en app_metadata el empresa_id de una empresa activa';
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

-- ── 3. Logo por empresa ─────────────────────────────────────────────────────

-- El front sube a `{empresa_id}/logo-<ts>.<ext>`. La lectura sigue publica (es el logo
-- que sale impreso). Escribir y borrar, solo el admin y solo dentro de su carpeta. La
-- unica excepcion es el logo que la empresa tenga hoy en la raiz del bucket, de antes
-- de este cambio: se puede borrar o reemplazar para que no quede huerfano.
-- Antes no habia politica SELECT ("el bucket es publico, no hace falta"). Pero un
-- DELETE o UPDATE con WHERE solo alcanza las filas que el rol puede ver, asi que el
-- remove() del logo viejo afectaba 0 filas sin dar error y dejaba el archivo huerfano.
-- Se agrega, acotada a lo de la propia empresa: listar el bucket no muestra los
-- archivos de las demas.
create policy "autenticados_select_logo_empresa" on storage.objects for select to authenticated
  using (
    bucket_id = 'empresa'
    and (
      (storage.foldername(name))[1] = (select public.current_empresa_id())::text
      or name = (select logo_path from public.configuracion_empresa
                 where empresa_id = (select public.current_empresa_id()))
    )
  );

drop policy "admin_insert_logo_empresa" on storage.objects;
drop policy "admin_update_logo_empresa" on storage.objects;
drop policy "admin_delete_logo_empresa" on storage.objects;

create policy "admin_insert_logo_empresa" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'empresa'
    and public.get_user_rol() = 'admin'::public.rol_usuario
    and (storage.foldername(name))[1] = (select public.current_empresa_id())::text
  );

create policy "admin_update_logo_empresa" on storage.objects for update to authenticated
  using (
    bucket_id = 'empresa'
    and public.get_user_rol() = 'admin'::public.rol_usuario
    and (
      (storage.foldername(name))[1] = (select public.current_empresa_id())::text
      or name = (select logo_path from public.configuracion_empresa
                 where empresa_id = (select public.current_empresa_id()))
    )
  )
  with check (
    bucket_id = 'empresa'
    and public.get_user_rol() = 'admin'::public.rol_usuario
    and (storage.foldername(name))[1] = (select public.current_empresa_id())::text
  );

create policy "admin_delete_logo_empresa" on storage.objects for delete to authenticated
  using (
    bucket_id = 'empresa'
    and public.get_user_rol() = 'admin'::public.rol_usuario
    and (
      (storage.foldername(name))[1] = (select public.current_empresa_id())::text
      or name = (select logo_path from public.configuracion_empresa
                 where empresa_id = (select public.current_empresa_id()))
    )
  );
