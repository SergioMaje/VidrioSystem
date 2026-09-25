-- Cierra una escalada de privilegios en `usuarios`.
--
-- La politica vieja `usuario_update_propio` era `FOR UPDATE USING (auth.uid() = id)`
-- sin `WITH CHECK` ni restriccion de columna: cualquier autenticado podia hacer
-- UPDATE sobre su propia fila y cambiarse `rol` a 'admin' (o reactivarse con
-- `activo`) directamente contra la API REST, sin pasar por la app. Se verifico
-- que un 'vendedor' lograba ponerse 'admin' asi.
--
-- La app nunca escribe en `usuarios` (solo la lee en useAuth), y las cuentas se
-- crean desde Supabase, no por registro publico. Asi que restringir el UPDATE a
-- administradores no rompe ninguna pantalla. Los cambios desde el panel de
-- Supabase o el SQL editor siguen funcionando: ahi se actua como `postgres`, que
-- no pasa por RLS.

drop policy if exists "usuario_update_propio" on public.usuarios;

create policy "admin_update_usuarios" on public.usuarios
  for update
  using (public.get_user_rol() = 'admin'::public.rol_usuario)
  with check (public.get_user_rol() = 'admin'::public.rol_usuario);

-- Endurece el INSERT propio: seguia permitiendo insertar la fila propia con
-- cualquier `rol`. handle_new_user() ya crea la fila como 'vendedor' al darse de
-- alta (corre como definer, no necesita esta politica), pero si la fila no
-- existiera un usuario podria insertarse a si mismo como 'admin'. Se fuerza el
-- rol de menor privilegio.
drop policy if exists "usuario_insert_propio" on public.usuarios;

create policy "usuario_insert_propio" on public.usuarios
  for insert
  with check (auth.uid() = id and rol = 'vendedor'::public.rol_usuario);
