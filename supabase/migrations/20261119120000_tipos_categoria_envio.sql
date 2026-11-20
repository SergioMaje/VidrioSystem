-- Tipos de categoría propios de cada vidriería.
--
-- Una categoría de un envío ("Puerta principal") tiene un tipo que le da el
-- ícono y el color: Puerta, Ventana, División, Espejo u Otro. Esos tipos son el
-- enum `tipo_producto_enum`, el mismo del catálogo, y no se tocan. Aquí cada
-- vidriería puede crear los suyos ("Baño", "Fachada") con su color.
--
-- Una categoría con tipo propio guarda `tipo = 'otro'` y además
-- `tipo_personalizado_id`, que es el que manda al mostrarla. Las categorías
-- que ya existen no cambian.

-- ── 1. Tipos propios ────────────────────────────────────────────────────────

create table if not exists public.tipos_categoria_envio (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.current_empresa_id() references public.empresas(id),
  nombre     text not null,
  color      text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint tipos_categoria_envio_nombre_valido check (length(btrim(nombre)) between 1 and 30),
  constraint tipos_categoria_envio_color_valido check (color ~ '^#[0-9a-f]{6}$'),
  constraint tipos_categoria_envio_empresa_id_id_key unique (empresa_id, id)
);

comment on table public.tipos_categoria_envio is
  'Tipos de categoría de envío creados por la vidriería (además de Puerta, Ventana, División, Espejo y Otro).';
comment on column public.tipos_categoria_envio.color is
  'Color del ícono y del borde, en hex minúscula (#rrggbb). El fondo se aclara a partir de él.';
comment on column public.tipos_categoria_envio.activo is
  'Archivado = false: deja de ofrecerse al armar un envío, pero los envíos que lo usan lo siguen mostrando.';

-- El nombre no se repite dentro de la vidriería, sin importar mayúsculas ni espacios.
create unique index if not exists tipos_categoria_envio_nombre_unico
  on public.tipos_categoria_envio (empresa_id, lower(btrim(nombre)));

create or replace trigger trg_00_forzar_empresa_id
  before insert or update or delete on public.tipos_categoria_envio
  for each row execute function public.forzar_empresa_id();

alter table public.tipos_categoria_envio enable row level security;

-- Cualquiera de la vidriería lo crea mientras arma una cotización; renombrarlo,
-- cambiarle el color o archivarlo es del admin.
create policy autenticados_select_tipos_categoria_envio on public.tipos_categoria_envio
  for select using (empresa_id = (select public.current_empresa_id()) and auth.uid() is not null);
create policy autenticados_insert_tipos_categoria_envio on public.tipos_categoria_envio
  for insert with check (empresa_id = (select public.current_empresa_id()) and auth.uid() is not null);
create policy admin_update_tipos_categoria_envio on public.tipos_categoria_envio
  for update using (empresa_id = (select public.current_empresa_id()) and public.get_user_rol() = 'admin'::public.rol_usuario);
create policy admin_delete_tipos_categoria_envio on public.tipos_categoria_envio
  for delete using (empresa_id = (select public.current_empresa_id()) and public.get_user_rol() = 'admin'::public.rol_usuario);

-- ── 2. La categoría del envío apunta a su tipo propio ───────────────────────

alter table public.envio_categorias
  add column if not exists tipo_personalizado_id uuid;

comment on column public.envio_categorias.tipo_personalizado_id is
  'Tipo propio de la vidriería. Si está, `tipo` es ''otro'' y el ícono y el color salen de aquí.';

alter table public.envio_categorias drop constraint if exists envio_categorias_tipo_personalizado_fkey;
alter table public.envio_categorias add constraint envio_categorias_tipo_personalizado_fkey
  foreign key (empresa_id, tipo_personalizado_id)
  references public.tipos_categoria_envio (empresa_id, id) on delete restrict;

alter table public.envio_categorias drop constraint if exists envio_categorias_tipo_personalizado_otro;
alter table public.envio_categorias add constraint envio_categorias_tipo_personalizado_otro
  check (tipo_personalizado_id is null or tipo = 'otro'::public.tipo_producto_enum);

create index if not exists envio_categorias_tipo_personalizado_idx
  on public.envio_categorias (tipo_personalizado_id) where tipo_personalizado_id is not null;
