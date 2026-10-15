-- Multi-tenant, paso 2 de 3: el aislamiento entre empresas pasa a ser real.
--
-- El paso 1 dejo empresa_id en todas las tablas y un trigger que impide escribir en
-- otra empresa. Faltaba lo de lectura:
--   1. Politicas RLS: a cada politica existente se le suma
--      `empresa_id = (select current_empresa_id())`, conservando su regla de rol.
--   2. RPC SECURITY DEFINER: se saltan el RLS, asi que cada busqueda por un id que
--      llega como parametro filtra por empresa. Si no esta en la empresa del usuario
--      responde igual que si no existiera.
--   3. Higiene pendiente de la auditoria: EXECUTE revocado a anon y a las funciones
--      trigger, search_path fijo.

-- ── 1. Politicas ────────────────────────────────────────────────────────────

-- ALTER POLICY conserva nombre, comando y roles; solo cambia las expresiones. En
-- UPDATE sin WITH CHECK, Postgres aplica el USING tambien a la fila nueva, asi que el
-- filtro de empresa cubre ambos lados. `(select ...)` hace que la funcion se evalue
-- una vez por consulta y no una vez por fila.
-- Quedan fuera:
--   * empresas: ya filtra por current_empresa_id() desde el paso 1.
--   * usuario_select_propio / usuario_insert_propio: son sobre la fila del propio
--     usuario. La primera debe seguir funcionando aunque el usuario este inactivo,
--     para que la app pueda mostrarle por que no entra.
do $$
declare
  r record;
  v_filtro constant text := '(empresa_id = (select public.current_empresa_id()))';
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename <> 'empresas'
      and policyname not in ('usuario_select_propio', 'usuario_insert_propio')
  loop
    if r.qual is not null and r.with_check is not null then
      execute format('alter policy %I on public.%I using (%s and (%s)) with check (%s and (%s))',
        r.policyname, r.tablename, v_filtro, r.qual, v_filtro, r.with_check);
    elsif r.qual is not null then
      execute format('alter policy %I on public.%I using (%s and (%s))',
        r.policyname, r.tablename, v_filtro, r.qual);
    else
      execute format('alter policy %I on public.%I with check (%s and (%s))',
        r.policyname, r.tablename, v_filtro, r.with_check);
    end if;
  end loop;
end $$;

-- Las politicas del logo en Storage cambian en el paso 3, junto con la ruta
-- `{empresa_id}/...` que tiene que usar el front.

-- ── 2. RPC ──────────────────────────────────────────────────────────────────

-- Mismo cuerpo que antes. Lo unico nuevo es `and empresa_id = public.current_empresa_id()`
-- en las busquedas por parametro y en "la caja abierta", y el consecutivo REC- por
-- empresa en registrar_recorte. Lo que se lee a traves de un FK (la unidad de un item,
-- la sesion de una venta) no necesita filtro: el FK compuesto garantiza que es de la
-- misma empresa.

-- La empresa actual sigue la numeracion REC- donde la dejo la secuencia.
insert into public.empresa_consecutivos (empresa_id, clave, ultimo)
select (select id from public.empresas order by created_at limit 1), 'item_recorte',
       coalesce((select last_value from pg_sequences
                 where schemaname = 'public' and sequencename = 'items_recorte_codigo_seq'), 0)
on conflict do nothing;

CREATE OR REPLACE FUNCTION public.anular_desembolso_financiera(p_desembolso_id uuid, p_motivo text)
 RETURNS financiera_desembolsos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := auth.uid();
  v_desembolso public.financiera_desembolsos;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para anular un desembolso';
  end if;

  -- `is distinct from` por el mismo motivo que en anular_movimiento_caja: un
  -- rol null no debe pasar como admin.
  if public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede anular un desembolso';
  end if;

  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Indica el motivo de la anulación';
  end if;

  select * into v_desembolso
    from public.financiera_desembolsos
   where id = p_desembolso_id and empresa_id = public.current_empresa_id()
   for update;

  if not found then
    raise exception 'El desembolso no existe';
  end if;

  if v_desembolso.anulado_at is not null then
    raise exception 'Este desembolso ya fue anulado';
  end if;

  update public.ventas set desembolso_id = null where desembolso_id = p_desembolso_id;

  update public.financiera_desembolsos
     set anulado_at = now(),
         anulado_por = v_usuario,
         motivo_anulacion = trim(p_motivo)
   where id = p_desembolso_id
  returning * into v_desembolso;

  return v_desembolso;
end;
$function$;

CREATE OR REPLACE FUNCTION public.anular_movimiento_caja(p_movimiento_id uuid, p_motivo text)
 RETURNS caja_movimientos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := auth.uid();
  v_movimiento public.caja_movimientos;
  v_estado public.estado_caja;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para anular un movimiento';
  end if;

  -- `is distinct from` y no `<>`: si el usuario no tiene fila en `usuarios`,
  -- get_user_rol() devuelve null y la comparación normal daría null, que en un
  -- `if` es falso — es decir, dejaría anular a quien no es nadie.
  if public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede anular un movimiento';
  end if;

  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Indica el motivo de la anulación';
  end if;

  select * into v_movimiento
  from public.caja_movimientos
  where id = p_movimiento_id and empresa_id = public.current_empresa_id()
  for update;

  if not found then
    raise exception 'El movimiento no existe';
  end if;

  if v_movimiento.anulado_at is not null then
    raise exception 'Este movimiento ya fue anulado';
  end if;

  select status into v_estado
  from public.cash_register_sessions
  where id = v_movimiento.session_id;

  if v_estado <> 'open'::public.estado_caja then
    raise exception 'No se puede anular un movimiento de un turno ya cerrado';
  end if;

  update public.caja_movimientos
  set anulado_at = now(),
      anulado_por = v_usuario,
      motivo_anulacion = trim(p_motivo)
  where id = p_movimiento_id
  returning * into v_movimiento;

  return v_movimiento;
end;
$function$;

CREATE OR REPLACE FUNCTION public.asignar_material_orden(p_material_id uuid, p_item_id uuid, p_origen origen_material, p_cantidad numeric, p_proveedor_id uuid DEFAULT NULL::uuid, p_notas text DEFAULT NULL::text)
 RETURNS orden_materiales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := auth.uid();
  v_material public.orden_materiales;
  v_requerido public.items_inventario;
  v_elegido public.items_inventario;
  v_resultado public.orden_materiales;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para asignar materiales';
  end if;

  if p_origen = 'sobre_pedido' and public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede pedir material sobre pedido';
  end if;

  select * into v_material from public.orden_materiales where id = p_material_id and empresa_id = public.current_empresa_id();
  if not found then
    raise exception 'La línea de materiales no existe';
  end if;

  if v_material.estado = 'consumido' then
    raise exception 'Este material ya se descontó del inventario y no se puede cambiar';
  end if;

  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad asignada debe ser mayor a cero';
  end if;

  select * into v_elegido from public.items_inventario where id = p_item_id and empresa_id = public.current_empresa_id();
  if not found then
    raise exception 'El material elegido ya no existe en el inventario';
  end if;

  if not v_elegido.activo then
    raise exception 'El material "%" está inactivo', v_elegido.nombre;
  end if;

  select * into v_requerido from public.items_inventario where id = v_material.item_requerido_id;

  if p_origen = 'desperdicio' then
    if v_requerido is null
       or coalesce(v_elegido.item_origen_id, v_elegido.id) <> coalesce(v_requerido.item_origen_id, v_requerido.id) then
      raise exception 'El recorte "%" no salió del material que pide la orden', v_elegido.nombre;
    end if;
  end if;

  if p_origen = 'sobre_pedido' and v_elegido.clase_inventario <> 'sobre_pedido' then
    raise exception '"%" no es un material sobre pedido', v_elegido.nombre;
  end if;

  update public.orden_materiales
     set item_id = p_item_id,
         origen = p_origen,
         cantidad_asignada = p_cantidad,
         proveedor_id = p_proveedor_id,
         notas = coalesce(p_notas, notas),
         estado = 'asignado'
   where id = p_material_id
   returning * into v_resultado;

  return v_resultado;
end;
$function$;

CREATE OR REPLACE FUNCTION public.capturar_costo_material(p_material_id uuid, p_costo_unitario numeric, p_proveedor_id uuid DEFAULT NULL::uuid)
 RETURNS orden_materiales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := auth.uid();
  v_material public.orden_materiales;
  v_resultado public.orden_materiales;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar el costo del material';
  end if;

  if public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede registrar el costo del material';
  end if;

  if p_costo_unitario is null or p_costo_unitario <= 0 then
    raise exception 'El costo del material debe ser mayor a cero';
  end if;

  select * into v_material from public.orden_materiales where id = p_material_id and empresa_id = public.current_empresa_id();
  if not found then
    raise exception 'La línea de materiales no existe';
  end if;

  if v_material.estado = 'consumido' then
    raise exception 'Este material ya se descontó del inventario y no se puede cambiar';
  end if;

  -- No se toca items_inventario.precio_costo aquí: ese salto al catálogo lo da
  -- el cierre, cuando la compra ya es un hecho y no solo una cotización de costo.
  update public.orden_materiales
     set costo_unitario_real = p_costo_unitario,
         proveedor_id = coalesce(p_proveedor_id, proveedor_id)
   where id = p_material_id
   returning * into v_resultado;

  return v_resultado;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cerrar_caja(p_session_id uuid, p_counted_amount numeric)
 RETURNS cash_register_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sesion public.cash_register_sessions;
  v_efectivo numeric;
  v_gastos numeric;
  v_esperado numeric;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para cerrar la caja';
  end if;

  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'El conteo físico no puede ser negativo';
  end if;

  select * into v_sesion
  from public.cash_register_sessions
  where id = p_session_id and empresa_id = public.current_empresa_id()
  for update;

  if not found then
    raise exception 'La sesión de caja no existe';
  end if;

  if v_sesion.status <> 'open'::public.estado_caja then
    raise exception 'Esta caja ya fue cerrada';
  end if;

  select coalesce(sum(monto), 0) into v_efectivo
  from public.ventas
  where session_id = p_session_id and metodo_pago = 'efectivo';

  -- Los gastos anulados no salieron del cajón: no cuentan.
  select coalesce(sum(monto), 0) into v_gastos
  from public.caja_movimientos
  where session_id = p_session_id
    and metodo_pago = 'efectivo'
    and anulado_at is null;

  v_esperado := v_sesion.opening_amount + v_efectivo - v_gastos;

  update public.cash_register_sessions
  set closed_at = now(),
      closed_by = auth.uid(),
      expected_amount = v_esperado,
      counted_amount = p_counted_amount,
      difference = p_counted_amount - v_esperado,
      status = 'closed'::public.estado_caja
  where id = p_session_id
  returning * into v_sesion;

  return v_sesion;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cerrar_produccion_orden(p_orden_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := auth.uid();
  v_orden public.ordenes_trabajo;
  v_faltantes text;
  v_sin_cantidad text;
  v_mat record;
  v_item public.items_inventario;
  v_cantidad numeric;
  v_stock numeric;
  v_movimiento_id uuid;
  v_consumidas integer := 0;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para cerrar la producción';
  end if;

  select * into v_orden from public.ordenes_trabajo where id = p_orden_id and empresa_id = public.current_empresa_id() for update;
  if not found then
    raise exception 'La orden no existe';
  end if;

  if v_orden.estado <> 'en_produccion' then
    raise exception 'Solo se cierra la producción de una orden en producción';
  end if;

  select string_agg(i.nombre, ', ' order by i.nombre) into v_faltantes
    from public.orden_materiales om
    join public.items_inventario i on i.id = om.item_id
   where om.orden_id = p_orden_id and om.origen = 'sobre_pedido'
     and om.estado <> 'consumido' and om.costo_unitario_real is null;

  if v_faltantes is not null then
    raise exception 'No se puede cerrar la producción: falta registrar el costo de %', v_faltantes;
  end if;

  select string_agg(i.nombre, ', ' order by i.nombre) into v_sin_cantidad
    from public.orden_materiales om
    join public.items_inventario i on i.id = om.item_id
   where om.orden_id = p_orden_id and om.origen = 'sobre_pedido'
     and om.estado <> 'consumido' and om.cantidad_asignada = 0;

  if v_sin_cantidad is not null then
    raise exception 'Falta indicar cuánto se pidió de "%"', v_sin_cantidad;
  end if;

  for v_mat in
    select * from public.orden_materiales
    where orden_id = p_orden_id and estado <> 'consumido'
    order by created_at
  loop
    v_cantidad := coalesce(nullif(v_mat.cantidad_asignada, 0), v_mat.cantidad_requerida);

    select * into v_item from public.items_inventario where id = v_mat.item_id for update;

    if v_mat.origen = 'sobre_pedido' then
      -- Primero entra lo comprado (movimiento de trazabilidad), luego se
      -- descuenta como cualquier otro material: así el stock nunca pasa por
      -- negativo y la compra queda en el historial.
      insert into public.movimientos_inventario
        (item_id, tipo, cantidad, cantidad_anterior, cantidad_posterior, motivo, referencia, usuario_id)
      values
        (v_item.id, 'entrada', v_cantidad, v_item.stock_actual, v_item.stock_actual + v_cantidad,
         'Compra sobre pedido — Orden ' || v_orden.numero, p_orden_id::text, v_usuario);

      -- Traza histórica de precio por proveedor, tal como pide el requisito de
      -- costeo: precio_costo no es derivado, escribirlo aquí es legítimo.
      update public.items_inventario
         set precio_costo = v_mat.costo_unitario_real,
             proveedor_id = coalesce(v_mat.proveedor_id, proveedor_id)
       where id = v_item.id;

      v_stock := v_item.stock_actual + v_cantidad;
    else
      if v_item.stock_actual < v_cantidad then
        raise exception 'Stock insuficiente de "%": hay % y se necesitan %. Registra la entrada o elige un recorte.',
          v_item.nombre, v_item.stock_actual, v_cantidad;
      end if;
      v_stock := v_item.stock_actual;
    end if;

    insert into public.movimientos_inventario
      (item_id, tipo, cantidad, cantidad_anterior, cantidad_posterior, motivo, referencia, usuario_id)
    values
      (v_item.id, 'produccion', v_cantidad, v_stock, v_stock - v_cantidad,
       'Orden ' || v_orden.numero, p_orden_id::text, v_usuario)
    returning id into v_movimiento_id;

    update public.orden_materiales
       set estado = 'consumido', cantidad_asignada = v_cantidad, movimiento_id = v_movimiento_id
     where id = v_mat.id;

    v_consumidas := v_consumidas + 1;
  end loop;

  update public.ordenes_trabajo set estado = 'lista' where id = p_orden_id;

  return v_consumidas;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_anticipo_cotizacion(p_cotizacion_id uuid, p_metodo_pago metodo_pago_venta, p_monto numeric, p_fecha_entrega date DEFAULT NULL::date, p_autorizado_por uuid DEFAULT NULL::uuid, p_motivo_autorizacion text DEFAULT NULL::text, p_financiera_id uuid DEFAULT NULL::uuid, p_referencia_financiera text DEFAULT NULL::text)
 RETURNS ordenes_trabajo
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := auth.uid();
  v_session uuid;
  v_cot     public.cotizaciones;
  v_abonado numeric;
  v_orden   public.ordenes_trabajo;
  v_tipo    public.tipo_pago;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar un anticipo';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El anticipo debe ser mayor a cero';
  end if;

  select id into v_session from public.cash_register_sessions where status = 'open' and empresa_id = public.current_empresa_id();
  if v_session is null then
    raise exception 'Debes abrir caja antes de registrar el anticipo';
  end if;

  -- El `for update` serializa contra otro cobro simultaneo sobre la misma
  -- cotizacion: sin el, dos anticipos concurrentes leerian el mismo abonado.
  select * into v_cot from public.cotizaciones where id = p_cotizacion_id and empresa_id = public.current_empresa_id() for update;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;

  select coalesce(sum(monto), 0) into v_abonado
    from public.ventas where cotizacion_id = p_cotizacion_id;

  -- El crédito liquida la venta de una vez: no es un anticipo.
  v_tipo := case
    when p_metodo_pago = 'financiera' then 'contado'::public.tipo_pago
    else public.tipo_de_pago(v_abonado, p_monto, v_cot.total)
  end;

  -- El insert dispara validar_pago_cotizacion, que comprueba saldo, caja
  -- abierta, anticipo minimo y las reglas de financiera. Aqui no se replica.
  insert into public.ventas
    (cotizacion_id, session_id, metodo_pago, monto, tipo, autorizado_por,
     motivo_autorizacion, usuario_id, financiera_id, referencia_financiera)
  values
    (p_cotizacion_id, v_session, p_metodo_pago, p_monto, v_tipo,
     p_autorizado_por,
     nullif(btrim(coalesce(p_motivo_autorizacion, '')), ''),
     v_usuario, p_financiera_id, p_referencia_financiera);

  update public.cotizaciones
     set estado = 'vendida',
         fecha_aprobacion = coalesce(fecha_aprobacion, now())
   where id = p_cotizacion_id;

  select * into v_orden from public.ordenes_trabajo
   where cotizacion_id = p_cotizacion_id
   limit 1;

  if found then
    if p_fecha_entrega is not null then
      update public.ordenes_trabajo
         set fecha_entrega_estimada = p_fecha_entrega
       where id = v_orden.id
      returning * into v_orden;
    end if;
    return v_orden;
  end if;

  insert into public.ordenes_trabajo
    (numero, cotizacion_id, cliente_id, estado, fecha_entrega_estimada, notas)
  values
    ('OT-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text,
     p_cotizacion_id, v_cot.cliente_id, 'pendiente', p_fecha_entrega, v_cot.notas)
  returning * into v_orden;

  return v_orden;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_desembolso_financiera(p_financiera_id uuid, p_fecha date, p_monto_recibido numeric, p_venta_ids uuid[], p_cuenta_id uuid DEFAULT NULL::uuid, p_referencia text DEFAULT NULL::text, p_notas text DEFAULT NULL::text)
 RETURNS financiera_desembolsos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := auth.uid();
  v_ids uuid[];
  v_encontradas integer;
  v_invalidas integer;
  v_total numeric(12,2);
  v_comision numeric(12,2);
  v_desembolso public.financiera_desembolsos;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar un desembolso';
  end if;

  if not exists (select 1 from public.financieras where id = p_financiera_id and empresa_id = public.current_empresa_id()) then
    raise exception 'La financiera no existe';
  end if;

  if p_fecha is null then
    raise exception 'Indica la fecha en que llegó el desembolso';
  end if;

  if p_monto_recibido is null or p_monto_recibido <= 0 then
    raise exception 'El monto recibido debe ser mayor a cero';
  end if;

  select array_agg(distinct id) into v_ids from unnest(p_venta_ids) as id where id is not null;
  if v_ids is null then
    raise exception 'Selecciona las ventas que cubre este desembolso';
  end if;

  -- El lock serializa contra otra conciliación simultánea de las mismas ventas:
  -- sin él, dos desembolsos podrían cubrir la misma venta.
  perform 1 from public.ventas where id = any(v_ids) and empresa_id = public.current_empresa_id() for update;

  select count(*),
         count(*) filter (where metodo_pago <> 'financiera'
                             or financiera_id is distinct from p_financiera_id
                             or desembolso_id is not null),
         coalesce(sum(monto), 0),
         coalesce(sum(comision_estimada), 0)
    into v_encontradas, v_invalidas, v_total, v_comision
    from public.ventas
   where id = any(v_ids) and empresa_id = public.current_empresa_id();

  if v_encontradas <> cardinality(v_ids) then
    raise exception 'Alguna de las ventas seleccionadas ya no existe';
  end if;

  if v_invalidas > 0 then
    raise exception 'Hay ventas que no son de esta financiera o que ya tienen desembolso';
  end if;

  if p_monto_recibido > v_total then
    raise exception 'El monto recibido (%) supera el total de las ventas seleccionadas (%)',
      p_monto_recibido, v_total;
  end if;

  insert into public.financiera_desembolsos
    (financiera_id, fecha, monto_recibido, total_ventas, comision_estimada, num_ventas,
     cuenta_pago_empresa_id, referencia, notas, usuario_id)
  values
    (p_financiera_id, p_fecha, p_monto_recibido, v_total, v_comision, cardinality(v_ids),
     p_cuenta_id,
     nullif(btrim(coalesce(p_referencia, '')), ''),
     nullif(btrim(coalesce(p_notas, '')), ''),
     v_usuario)
  returning * into v_desembolso;

  update public.ventas set desembolso_id = v_desembolso.id where id = any(v_ids);

  return v_desembolso;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_entradas_inventario(p_entradas jsonb, p_referencia text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := auth.uid();
  v_linea jsonb;
  v_item public.items_inventario;
  v_item_id uuid;
  v_cantidad numeric;
  v_motivo text;
  v_registradas integer := 0;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para cargar stock';
  end if;

  if p_entradas is null or jsonb_typeof(p_entradas) <> 'array' then
    raise exception 'No se recibió la lista de entradas';
  end if;

  if jsonb_array_length(p_entradas) = 0 then
    raise exception 'No hay ninguna entrada para registrar';
  end if;

  -- Tope de seguridad: la plantilla trae un renglón por item, y un archivo con
  -- decenas de miles de filas es un error del usuario, no una carga real.
  if jsonb_array_length(p_entradas) > 2000 then
    raise exception 'Demasiadas filas en una sola carga (máximo 2000)';
  end if;

  for v_linea in select * from jsonb_array_elements(p_entradas) loop
    v_item_id := (v_linea->>'item_id')::uuid;
    v_cantidad := (v_linea->>'cantidad')::numeric;
    v_motivo := nullif(trim(coalesce(v_linea->>'motivo', '')), '');

    if v_item_id is null then
      raise exception 'Una de las filas no trae el item';
    end if;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad a ingresar debe ser mayor a cero';
    end if;

    -- El lock serializa contra otro movimiento simultáneo del mismo item: sin él,
    -- dos cargas leerían el mismo cantidad_anterior y una pisaría a la otra.
    -- Se relee en cada vuelta, así que un item repetido en el archivo se acumula
    -- bien en vez de sobrescribirse.
    select * into v_item from public.items_inventario
    where id = v_item_id and empresa_id = public.current_empresa_id()
    for update;

    if not found then
      raise exception 'Un item del archivo ya no existe en el inventario';
    end if;

    if not v_item.activo then
      raise exception 'El item "%" está inactivo y no puede recibir stock', v_item.nombre;
    end if;

    -- El stock lo aplica trg_actualizar_stock a partir de cantidad_posterior.
    insert into public.movimientos_inventario
      (item_id, tipo, cantidad, cantidad_anterior, cantidad_posterior, motivo, referencia, usuario_id)
    values
      (v_item.id, 'entrada', v_cantidad, v_item.stock_actual, v_item.stock_actual + v_cantidad,
       coalesce(v_motivo, 'Carga masiva de stock'), p_referencia, v_usuario);

    v_registradas := v_registradas + 1;
  end loop;

  return v_registradas;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_gasto_caja(p_categoria categoria_gasto, p_concepto text, p_monto numeric, p_metodo_pago metodo_pago_venta)
 RETURNS caja_movimientos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := auth.uid();
  v_sesion public.cash_register_sessions;
  v_ventas numeric;
  v_gastos numeric;
  v_disponible numeric;
  v_movimiento public.caja_movimientos;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar un gasto';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del gasto debe ser mayor a cero';
  end if;

  if p_concepto is null or length(trim(p_concepto)) = 0 then
    raise exception 'Describe el gasto';
  end if;

  -- El lock serializa contra otro gasto simultáneo: sin él, dos retiros podrían
  -- validar cada uno contra el mismo disponible y vaciar el cajón de más.
  select * into v_sesion
  from public.cash_register_sessions
  where status = 'open'::public.estado_caja and empresa_id = public.current_empresa_id()
  for update;

  if not found then
    raise exception 'Debes abrir caja antes de registrar un gasto';
  end if;

  -- Del cajón no puede salir plata que no está. Sin esta validación el efectivo
  -- esperado del cierre podría quedar negativo.
  if p_metodo_pago = 'efectivo'::public.metodo_pago_venta then
    select coalesce(sum(monto), 0) into v_ventas
    from public.ventas
    where session_id = v_sesion.id and metodo_pago = 'efectivo'::public.metodo_pago_venta;

    select coalesce(sum(monto), 0) into v_gastos
    from public.caja_movimientos
    where session_id = v_sesion.id
      and metodo_pago = 'efectivo'::public.metodo_pago_venta
      and anulado_at is null;

    v_disponible := v_sesion.opening_amount + v_ventas - v_gastos;

    if p_monto > v_disponible then
      raise exception 'No hay tanto efectivo en caja: disponible %', v_disponible;
    end if;
  end if;

  insert into public.caja_movimientos (session_id, categoria, concepto, monto, metodo_pago, usuario_id)
  values (v_sesion.id, p_categoria, trim(p_concepto), p_monto, p_metodo_pago, v_usuario)
  returning * into v_movimiento;

  return v_movimiento;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_materiales_orden(p_orden_id uuid, p_materiales jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := auth.uid();
  v_orden public.ordenes_trabajo;
  v_linea jsonb;
  v_item_requerido_id uuid;
  v_cantidad numeric;
  v_item public.items_inventario;
  v_origen public.origen_material;
  v_registradas integer := 0;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar los materiales de la orden';
  end if;

  select * into v_orden from public.ordenes_trabajo where id = p_orden_id and empresa_id = public.current_empresa_id() for update;
  if not found then
    raise exception 'La orden no existe';
  end if;

  if v_orden.estado not in ('pendiente', 'en_produccion') then
    raise exception 'Solo se arma la lista de materiales de una orden pendiente o en producción';
  end if;

  if exists (select 1 from public.orden_materiales where orden_id = p_orden_id and estado = 'consumido') then
    raise exception 'Esta orden ya descontó sus materiales; no se puede recalcular la lista';
  end if;

  if p_materiales is null or jsonb_typeof(p_materiales) <> 'array' then
    raise exception 'No se recibió la lista de materiales';
  end if;

  if jsonb_array_length(p_materiales) = 0 then
    raise exception 'La orden no tiene materiales que registrar';
  end if;

  if jsonb_array_length(p_materiales) > 500 then
    raise exception 'Demasiados materiales en una sola orden (máximo 500)';
  end if;

  -- Re-sembrar reemplaza el plan por completo, incluidas las asignaciones ya
  -- hechas a mano: solo se llega aquí si nada se consumió todavía.
  delete from public.orden_materiales where orden_id = p_orden_id;

  for v_linea in select * from jsonb_array_elements(p_materiales) loop
    v_item_requerido_id := (v_linea->>'item_requerido_id')::uuid;
    v_cantidad := (v_linea->>'cantidad_requerida')::numeric;

    if v_item_requerido_id is null then
      raise exception 'Una de las líneas no trae el item';
    end if;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad requerida de un material debe ser mayor a cero';
    end if;

    select * into v_item from public.items_inventario where id = v_item_requerido_id and empresa_id = public.current_empresa_id();
    if not found then
      raise exception 'Un material de la lista ya no existe en el inventario';
    end if;

    if not v_item.activo then
      raise exception 'El material "%" está inactivo', v_item.nombre;
    end if;

    v_origen := case when v_item.clase_inventario = 'sobre_pedido' then 'sobre_pedido' else 'stock_normal' end;

    insert into public.orden_materiales
      (orden_id, item_id, item_requerido_id, origen, cantidad_requerida, estado)
    values
      (p_orden_id, v_item_requerido_id, v_item_requerido_id, v_origen, v_cantidad, 'pendiente');

    v_registradas := v_registradas + 1;
  end loop;

  return v_registradas;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_recorte(p_item_origen_id uuid, p_ancho_cm numeric, p_alto_cm numeric, p_cantidad numeric DEFAULT NULL::numeric, p_referencia text DEFAULT NULL::text, p_notas text DEFAULT NULL::text)
 RETURNS items_inventario
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := auth.uid();
  v_origen public.items_inventario;
  v_tipo_unidad public.tipo_unidad;
  v_cantidad numeric;
  v_nuevo_id uuid;
  v_resultado public.items_inventario;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar un recorte';
  end if;

  if p_ancho_cm is null or p_ancho_cm <= 0 or p_alto_cm is null or p_alto_cm <= 0 then
    raise exception 'Las medidas del recorte deben ser mayores a cero';
  end if;

  select * into v_origen from public.items_inventario
  where id = p_item_origen_id and empresa_id = public.current_empresa_id()
  for update;

  if not found then
    raise exception 'El item de origen no existe';
  end if;

  if not v_origen.activo then
    raise exception 'El item "%" está inactivo y no puede generar recortes', v_origen.nombre;
  end if;

  if v_origen.clase_inventario = 'sobre_pedido' then
    raise exception 'Un material sobre pedido no deja recortes en bodega';
  end if;

  if v_origen.ancho_cm is not null and v_origen.alto_cm is not null
     and (p_ancho_cm > v_origen.ancho_cm or p_alto_cm > v_origen.alto_cm) then
    raise exception 'El recorte (% × % cm) no cabe en "%"', p_ancho_cm, p_alto_cm, v_origen.nombre;
  end if;

  select tipo into v_tipo_unidad from public.unidades_medida where id = v_origen.unidad_medida_id;

  v_cantidad := case
    when p_cantidad is not null then p_cantidad
    when v_tipo_unidad = 'area' then (p_ancho_cm * p_alto_cm) / 10000
    when v_tipo_unidad = 'longitud' then greatest(p_ancho_cm, p_alto_cm) / 100
    else 1
  end;

  if v_cantidad is null or v_cantidad <= 0 then
    raise exception 'La cantidad recuperada del recorte debe ser mayor a cero';
  end if;

  v_nuevo_id := gen_random_uuid();

  -- stock_actual entra en 0 a propósito: lo aplica trg_actualizar_stock a partir
  -- del movimiento de entrada que se inserta abajo, igual que cualquier otra alta.
  insert into public.items_inventario (
    id, codigo, nombre, descripcion, categoria_id, unidad_medida_id, proveedor_id,
    stock_actual, stock_minimo, precio_costo, precio_venta, activo,
    rol_configurador, vidrio_tipo, vidrio_calibre_mm, vidrio_acabado,
    clase_inventario, item_origen_id, ancho_cm, alto_cm
  ) values (
    v_nuevo_id,
    'REC-' || lpad(public.siguiente_consecutivo('item_recorte')::text, 6, '0'),
    v_origen.nombre || ' — recorte ' || p_ancho_cm || '×' || p_alto_cm || ' cm',
    p_notas,
    v_origen.categoria_id, v_origen.unidad_medida_id, v_origen.proveedor_id,
    0, 0, v_origen.precio_costo, v_origen.precio_venta, true,
    v_origen.rol_configurador, v_origen.vidrio_tipo, v_origen.vidrio_calibre_mm, v_origen.vidrio_acabado,
    'desperdicio', coalesce(v_origen.item_origen_id, v_origen.id), p_ancho_cm, p_alto_cm
  );

  insert into public.movimientos_inventario
    (item_id, tipo, cantidad, cantidad_anterior, cantidad_posterior, motivo, referencia, usuario_id)
  values
    (v_nuevo_id, 'entrada', v_cantidad, 0, v_cantidad,
     'Recorte de ' || v_origen.codigo, p_referencia, v_usuario);

  select * into v_resultado from public.items_inventario where id = v_nuevo_id;
  return v_resultado;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_venta_mostrador(p_cliente_id uuid, p_metodo_pago metodo_pago_venta, p_items jsonb, p_financiera_id uuid DEFAULT NULL::uuid, p_referencia_financiera text DEFAULT NULL::text)
 RETURNS ventas_mostrador
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario uuid := auth.uid();
  v_session uuid;
  v_venta public.ventas_mostrador;
  v_total numeric(12,2) := 0;
  v_linea jsonb;
  v_item public.items_inventario;
  v_cantidad numeric(10,3);
  v_precio numeric(12,2);
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar una venta';
  end if;

  select id into v_session from public.cash_register_sessions where status = 'open' and empresa_id = public.current_empresa_id();
  if v_session is null then
    raise exception 'Debes abrir caja antes de registrar una venta';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;

  insert into public.ventas_mostrador (cliente_id, session_id, usuario_id, total)
  values (p_cliente_id, v_session, v_usuario, 0)
  returning * into v_venta;

  for v_linea in select * from jsonb_array_elements(p_items) loop
    v_cantidad := (v_linea->>'cantidad')::numeric;
    v_precio := (v_linea->>'precio_unitario')::numeric;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad debe ser mayor a cero';
    end if;
    if v_precio is null or v_precio < 0 then
      raise exception 'El precio no puede ser negativo';
    end if;

    select * into v_item from public.items_inventario
    where id = (v_linea->>'item_id')::uuid and empresa_id = public.current_empresa_id()
    for update;

    if not found then
      raise exception 'El producto ya no existe en el inventario';
    end if;

    if v_item.stock_actual < v_cantidad then
      raise exception 'Stock insuficiente de "%": hay % y se piden %',
        v_item.nombre, v_item.stock_actual, v_cantidad;
    end if;

    insert into public.ventas_mostrador_items
      (venta_id, item_id, descripcion, cantidad, precio_unitario, precio_total)
    values
      (v_venta.id, v_item.id, v_item.nombre, v_cantidad, v_precio, round(v_cantidad * v_precio, 2));

    insert into public.movimientos_inventario
      (item_id, tipo, cantidad, cantidad_anterior, cantidad_posterior, motivo, referencia, usuario_id)
    values
      (v_item.id, 'salida', v_cantidad, v_item.stock_actual, v_item.stock_actual - v_cantidad,
       'Venta ' || v_venta.numero, v_venta.id::text, v_usuario);

    v_total := v_total + round(v_cantidad * v_precio, 2);
  end loop;

  update public.ventas_mostrador set total = v_total where id = v_venta.id
  returning * into v_venta;

  -- La financiera y la comisión las valida y calcula validar_pago_cotizacion.
  insert into public.ventas
    (venta_mostrador_id, session_id, metodo_pago, monto, tipo, usuario_id,
     financiera_id, referencia_financiera)
  values
    (v_venta.id, v_session, p_metodo_pago, v_total, 'contado', v_usuario,
     p_financiera_id, p_referencia_financiera);

  return v_venta;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validar_pago_cotizacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total numeric;
  v_abonado numeric;
  v_financiera public.financieras;
begin
  if (select status from public.cash_register_sessions where id = new.session_id and empresa_id = new.empresa_id) is distinct from 'open' then
    raise exception 'La sesión de caja está cerrada';
  end if;

  new.desembolso_id := null;

  if new.metodo_pago = 'financiera' then
    select * into v_financiera from public.financieras where id = new.financiera_id and empresa_id = new.empresa_id;
    if not found then
      raise exception 'Selecciona la financiera que otorgó el crédito';
    end if;
    if not v_financiera.activa then
      raise exception 'La financiera % está desactivada', v_financiera.nombre;
    end if;
    new.referencia_financiera := nullif(btrim(coalesce(new.referencia_financiera, '')), '');
    -- Pesos enteros, igual que comisionEstimada() en src/lib/pagos.ts.
    new.comision_estimada := round(new.monto * v_financiera.comision_pct / 100);
  else
    new.financiera_id := null;
    new.referencia_financiera := null;
    new.comision_estimada := null;
  end if;

  -- Venta de mostrador: se cobra completa en el acto, no hay saldo que validar.
  if new.cotizacion_id is null then
    return new;
  end if;

  select total into v_total from public.cotizaciones where id = new.cotizacion_id and empresa_id = new.empresa_id for update;
  if v_total is null then
    raise exception 'Cotización no encontrada';
  end if;

  select coalesce(sum(monto), 0) into v_abonado
    from public.ventas where cotizacion_id = new.cotizacion_id;

  if new.metodo_pago = 'financiera' then
    if v_abonado > 0 then
      raise exception 'El crédito con financiera cubre el total de la venta: esta cotización ya tiene pagos registrados';
    end if;
    if new.monto < v_total - 1 then
      raise exception 'El crédito con financiera debe cubrir el total de la cotización (%)', v_total;
    end if;
  end if;

  -- Tolerancia de $1 por el redondeo del IVA.
  if v_abonado + new.monto > v_total + 1 then
    raise exception 'El pago excede el saldo pendiente (saldo: %)', v_total - v_abonado;
  end if;

  if v_abonado = 0 and not public.cumple_anticipo_minimo(new.monto, v_total) then
    if new.autorizado_por is null then
      raise exception 'El anticipo debe ser al menos el 50%% del total (mínimo: %)',
        public.anticipo_minimo(v_total);
    end if;
    if (select rol from public.usuarios where id = new.autorizado_por and empresa_id = new.empresa_id) is distinct from 'admin'::rol_usuario then
      raise exception 'Solo un administrador puede autorizar un anticipo menor al 50%%';
    end if;
  end if;

  return new;
end $function$;

drop sequence public.items_recorte_codigo_seq;

-- ── 3. Permisos y search_path ───────────────────────────────────────────────

-- RPC: solo usuarios con sesion. Todas validan auth.uid() adentro, pero no hay razon
-- para exponerlas a anon.
revoke execute on function
  public.anular_desembolso_financiera(uuid, text),
  public.anular_movimiento_caja(uuid, text),
  public.asignar_material_orden(uuid, uuid, public.origen_material, numeric, uuid, text),
  public.capturar_costo_material(uuid, numeric, uuid),
  public.cerrar_caja(uuid, numeric),
  public.cerrar_produccion_orden(uuid),
  public.registrar_anticipo_cotizacion(uuid, public.metodo_pago_venta, numeric, date, uuid, text, uuid, text),
  public.registrar_desembolso_financiera(uuid, date, numeric, uuid[], uuid, text, text),
  public.registrar_entradas_inventario(jsonb, text),
  public.registrar_gasto_caja(public.categoria_gasto, text, numeric, public.metodo_pago_venta),
  public.registrar_materiales_orden(uuid, jsonb),
  public.registrar_recorte(uuid, numeric, numeric, numeric, text, text),
  public.registrar_venta_mostrador(uuid, public.metodo_pago_venta, jsonb, uuid, text),
  public.sugerir_materiales(uuid, numeric)
from public, anon;

-- Funciones trigger: nadie las llama por RPC. Revocar EXECUTE no afecta al trigger:
-- Postgres solo lo exige al crearlo.
revoke execute on function
  public.handle_new_user(),
  public.validar_pago_cotizacion(),
  public.validar_avance_orden(),
  public.actualizar_stock(),
  public.orden_materiales_bloquear_consumidas(),
  public.set_updated_at(),
  public.forzar_empresa_id()
from public, anon, authenticated;

-- El consecutivo solo lo piden los DEFAULT y las RPC, que corren como dueno. Llamarlo
-- por RPC solo serviria para quemar numeros.
revoke execute on function public.siguiente_consecutivo(text) from public, anon, authenticated;

-- get_user_rol() y current_empresa_id() conservan EXECUTE para anon y authenticated:
-- las politicas los evaluan con el rol de quien consulta, y sin permiso anon recibiria
-- un error en vez de cero filas. Para anon devuelven null.

-- Advisor 0011.
alter function public.set_updated_at() set search_path = public;
alter function public.actualizar_stock() set search_path = public;
alter function public.orden_materiales_bloquear_consumidas() set search_path = public;
