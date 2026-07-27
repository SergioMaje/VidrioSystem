-- referencias_producto y referencia_cortes quedaron sin RLS al crearse, a diferencia
-- del resto de tablas. Con la clave anon (pública en el bundle) cualquiera podía leer
-- y modificar referencias y medidas de corte.
--
-- Se replica el mismo patrón de plantillas_producto / plantilla_componentes:
--   select/insert/update -> cualquier usuario autenticado
--   delete               -> solo admin
-- El editor de referencias ya está restringido a admin en la UI, y su flujo de edición
-- (borrar cortes + reinsertar) corre como admin, igual que el de plantillas.

alter table public.referencias_producto enable row level security;
alter table public.referencia_cortes    enable row level security;

create policy autenticados_select_referencias on public.referencias_producto
  for select using (auth.uid() is not null);
create policy autenticados_insert_referencias on public.referencias_producto
  for insert with check (auth.uid() is not null);
create policy autenticados_update_referencias on public.referencias_producto
  for update using (auth.uid() is not null);
create policy admin_delete_referencias on public.referencias_producto
  for delete using (get_user_rol() = 'admin'::rol_usuario);

create policy autenticados_select_ref_cortes on public.referencia_cortes
  for select using (auth.uid() is not null);
create policy autenticados_insert_ref_cortes on public.referencia_cortes
  for insert with check (auth.uid() is not null);
create policy autenticados_update_ref_cortes on public.referencia_cortes
  for update using (auth.uid() is not null);
create policy admin_delete_ref_cortes on public.referencia_cortes
  for delete using (get_user_rol() = 'admin'::rol_usuario);
