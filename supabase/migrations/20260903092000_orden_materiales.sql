-- Lista de materiales de una orden de producción.
--
-- Hoy la orden no sabe con qué se hizo. La lista de materiales se recalculaba
-- desde la cotización cada vez que alguien abría la pantalla, y el consumo se
-- hacía en el navegador al marcar la orden como entregada — sin registro de qué
-- se decidió usar (un recorte concreto, o el stock de bodega), ni de a qué
-- proveedor se le compró el material sobre pedido. Una orden necesita una lista
-- congelada y decidida: qué pidió el BOM, qué se usó realmente (que puede ser un
-- retal en vez del item original), de dónde salió y cuánto costó.

do $$ begin
  create type public.origen_material as enum ('desperdicio', 'stock_normal', 'sobre_pedido');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_material_orden as enum ('pendiente', 'asignado', 'consumido');
exception when duplicate_object then null; end $$;

create table if not exists public.orden_materiales (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_trabajo(id) on delete cascade,
  item_id uuid not null references public.items_inventario(id),
  -- El item del catálogo que pidió el BOM. Distinto de item_id solo cuando se
  -- resolvió con un recorte; se conserva para poder auditar la sustitución.
  item_requerido_id uuid references public.items_inventario(id),
  origen public.origen_material not null,
  cantidad_requerida numeric(10,3) not null check (cantidad_requerida > 0),
  cantidad_asignada  numeric(10,3) not null default 0 check (cantidad_asignada >= 0),
  -- NULL = pendiente de capturar. Solo se exige antes de cerrar cuando origen = sobre_pedido.
  costo_unitario_real numeric(12,2) check (costo_unitario_real >= 0),
  proveedor_id uuid references public.proveedores(id),
  estado public.estado_material_orden not null default 'pendiente',
  -- El movimiento que descontó esta línea: trazabilidad exacta, mejor que un boolean.
  movimiento_id uuid references public.movimientos_inventario(id),
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orden_materiales_consumido_con_movimiento
    check (estado <> 'consumido' or movimiento_id is not null)
);

create index if not exists idx_orden_materiales_orden on public.orden_materiales(orden_id);
create index if not exists idx_orden_materiales_item  on public.orden_materiales(item_id);
create index if not exists idx_orden_materiales_costo_pendiente
  on public.orden_materiales(orden_id)
  where origen = 'sobre_pedido' and costo_unitario_real is null;

create or replace trigger trg_orden_materiales_updated_at
  before update on public.orden_materiales
  for each row execute function public.set_updated_at();

-- Una vez consumida, la línea es historia: el cierre ya movió el inventario a
-- partir de ella. Comparar OLD (no NEW) es lo que deja pasar la propia
-- actualización del cierre, que escribe estado = 'consumido' en el mismo
-- statement en que aplica el resto de la fila.
--
-- Solo se protege UPDATE, no DELETE: si se protegiera el delete también,
-- borrar la orden (on delete cascade) fallaría en cuanto tocara su primera
-- línea consumida, y la cascada quedaría inservible para cualquier orden ya
-- cerrada. Borrar una línea suelta ya está detrás de admin_delete_orden_materiales;
-- el movimiento que la respalda sigue vivo en movimientos_inventario de todas
-- formas, así que no se pierde trazabilidad de stock.
create or replace function public.orden_materiales_bloquear_consumidas()
returns trigger language plpgsql as $$
begin
  if old.estado = 'consumido' then
    raise exception 'Este material ya se descontó del inventario y no se puede modificar';
  end if;
  return new;
end;
$$;

drop trigger if exists orden_materiales_inmutable on public.orden_materiales;
create trigger orden_materiales_inmutable
  before update on public.orden_materiales
  for each row execute function public.orden_materiales_bloquear_consumidas();

alter table public.orden_materiales enable row level security;

drop policy if exists autenticados_select_orden_materiales on public.orden_materiales;
create policy autenticados_select_orden_materiales on public.orden_materiales
  for select using (auth.role() = 'authenticated');

drop policy if exists autenticados_insert_orden_materiales on public.orden_materiales;
create policy autenticados_insert_orden_materiales on public.orden_materiales
  for insert with check (auth.role() = 'authenticated');

drop policy if exists autenticados_update_orden_materiales on public.orden_materiales;
create policy autenticados_update_orden_materiales on public.orden_materiales
  for update using (auth.role() = 'authenticated');

drop policy if exists admin_delete_orden_materiales on public.orden_materiales;
create policy admin_delete_orden_materiales on public.orden_materiales
  for delete using (public.get_user_rol() = 'admin'::public.rol_usuario);

grant select, insert, update on public.orden_materiales to authenticated;

-- A diferencia de caja_movimientos (sin INSERT/UPDATE porque toda la validación
-- vive en el RPC), aquí sí se abren porque la lista es un plan editable desde la
-- UI. Lo que no se puede corromper desde el navegador es lo que importa: el
-- stock solo lo mueve cerrar_produccion_orden, y el bloqueo por costo pendiente
-- lo aplica el trigger de ordenes_trabajo, no esta tabla. El trigger de
-- inmutabilidad de arriba cierra el único hueco real: reescribir una línea que
-- ya se usó para descontar inventario.

comment on table public.orden_materiales is
  'Lista de materiales de una orden de producción: qué pidió el BOM, qué se usó (recorte, stock o compra sobre pedido) y su costo real cuando aplica.';
comment on column public.orden_materiales.item_requerido_id is
  'Item que pidió el BOM. Difiere de item_id cuando un recorte cubrió la necesidad.';
comment on column public.orden_materiales.costo_unitario_real is
  'NULL bloquea el cierre de producción cuando origen = sobre_pedido.';
