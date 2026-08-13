-- Cuentas de pago (datos bancarios) asociadas a un proveedor. Un proveedor puede
-- tener varias cuentas (ej. varios bancos o billeteras digitales); el responsable
-- de proveedores las anexa manualmente desde la ficha del proveedor.

create table if not exists public.proveedor_cuentas_pago (
  id uuid primary key default uuid_generate_v4(),
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  alias text,
  banco text not null,
  tipo_cuenta text not null,
  numero_cuenta text not null,
  titular text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_proveedor_cuentas_pago_proveedor on public.proveedor_cuentas_pago(proveedor_id);

alter table public.proveedor_cuentas_pago enable row level security;

create policy autenticados_select_cuentas_pago on public.proveedor_cuentas_pago
  for select using (auth.uid() is not null);
create policy autenticados_insert_cuentas_pago on public.proveedor_cuentas_pago
  for insert with check (auth.uid() is not null);
create policy autenticados_update_cuentas_pago on public.proveedor_cuentas_pago
  for update using (auth.uid() is not null);
create policy admin_delete_cuentas_pago on public.proveedor_cuentas_pago
  for delete using (get_user_rol() = 'admin'::rol_usuario);
