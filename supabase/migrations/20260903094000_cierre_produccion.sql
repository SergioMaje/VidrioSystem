-- Cierre de producción: descontar inventario deja de pasar en 'entregada' y por
-- el navegador, y pasa a 'lista' y a un RPC en la base.
--
-- Hoy el descuento ocurría al marcar la orden como entregada, en un bucle en
-- src/pages/ordenes/OrdenDetalle.tsx que leía stock_actual, calculaba el
-- posterior, insertaba el movimiento Y ADEMÁS hacía un UPDATE directo de
-- stock_actual — la escritura que la carga masiva de stock ya declaró
-- prohibida, porque deja el número bien pero dos movimientos "verdaderos" en
-- pugna por el mismo valor. Sin lock, sin transacción: si la conexión se caía
-- entre dos materiales, la orden quedaba a medio descontar y no había forma de
-- saber dónde. Y conceptualmente 'entregada' es un acto comercial (el cliente
-- se llevó el producto), no el momento en que se gastó el material — eso pasa
-- cuando termina la producción, es decir al llegar a 'lista'.
--
-- Se reemplaza por cuatro RPC (armar la lista, elegir con qué material se cubre
-- cada línea, capturar el costo de lo comprado sobre pedido, y cerrar) más una
-- reescritura del trigger de avance que bloquea 'lista' si queda un costo sin
-- capturar — nombrando el material, no un error genérico.

-- ── 1. Sembrar la lista de materiales desde el BOM calculado en el cliente ──
--
-- La matemática de producción (medidas por lado, fórmulas del BOM, el jsonb de
-- opciones de vidrio/chapa/película) solo existe en TypeScript
-- (src/lib/produccion.ts, src/lib/opciones.ts). Reimplementarla en plpgsql sería
-- un segundo motor de cálculo que se desincroniza en el primer cambio. El
-- cliente calcula qué se necesita, el RPC valida y escribe todo o nada — mismo
-- patrón que registrar_entradas_inventario.

create or replace function public.registrar_materiales_orden(
  p_orden_id uuid,
  p_materiales jsonb
) returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $$
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

  select * into v_orden from public.ordenes_trabajo where id = p_orden_id for update;
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

    select * into v_item from public.items_inventario where id = v_item_requerido_id;
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
$$;

comment on function public.registrar_materiales_orden(uuid, jsonb) is
  'Siembra orden_materiales desde el BOM calculado en el cliente. Reemplaza el plan completo; falla si ya hay líneas consumidas.';

grant execute on function public.registrar_materiales_orden(uuid, jsonb) to authenticated;

-- ── 2. Elegir con qué material se cubre cada línea (incluye el flujo sobre pedido) ──

create or replace function public.asignar_material_orden(
  p_material_id uuid,
  p_item_id uuid,
  p_origen public.origen_material,
  p_cantidad numeric,
  p_proveedor_id uuid default null,
  p_notas text default null
) returns public.orden_materiales
  language plpgsql
  security definer
  set search_path to 'public'
as $$
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

  select * into v_material from public.orden_materiales where id = p_material_id;
  if not found then
    raise exception 'La línea de materiales no existe';
  end if;

  if v_material.estado = 'consumido' then
    raise exception 'Este material ya se descontó del inventario y no se puede cambiar';
  end if;

  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad asignada debe ser mayor a cero';
  end if;

  select * into v_elegido from public.items_inventario where id = p_item_id;
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
$$;

comment on function public.asignar_material_orden(uuid, uuid, public.origen_material, numeric, uuid, text) is
  'Elige qué item cubre una línea de materiales (un recorte, stock, o la cantidad real de un sobre pedido). El sobre pedido exige rol admin y no captura costo.';

grant execute on function public.asignar_material_orden(uuid, uuid, public.origen_material, numeric, uuid, text) to authenticated;

-- ── 3. Capturar el costo real de un material sobre pedido ──

create or replace function public.capturar_costo_material(
  p_material_id uuid,
  p_costo_unitario numeric,
  p_proveedor_id uuid default null
) returns public.orden_materiales
  language plpgsql
  security definer
  set search_path to 'public'
as $$
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

  select * into v_material from public.orden_materiales where id = p_material_id;
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
$$;

comment on function public.capturar_costo_material(uuid, numeric, uuid) is
  'Registra el costo real de un material sobre pedido, sin mover inventario todavía. Solo admin.';

grant execute on function public.capturar_costo_material(uuid, numeric, uuid) to authenticated;

-- ── 4. Cerrar la producción: descuenta inventario y pasa la orden a 'lista' ──

create or replace function public.cerrar_produccion_orden(p_orden_id uuid)
returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $$
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

  select * into v_orden from public.ordenes_trabajo where id = p_orden_id for update;
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
$$;

comment on function public.cerrar_produccion_orden(uuid) is
  'Descuenta stock normal/desperdicio, registra la compra y el costo de lo sobre pedido, y pasa la orden a lista. Reemplaza el descuento que hacía el navegador al entregar.';

grant execute on function public.cerrar_produccion_orden(uuid) to authenticated;

-- ── 5. validar_avance_orden: añade el bloqueo de cierre de producción ──
--
-- El `if new.cotizacion_id is null then return new` de la versión anterior
-- estaba en la primera línea. Las reglas de material valen también para
-- órdenes sin cotización (manuales), así que el bloqueo de 'lista' va ANTES de
-- ese early-return — moverlo después dejaría cerrar sin validar costos
-- cualquier orden que no venga de una cotización.

create or replace function public.validar_avance_orden()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_abonado numeric;
  v_saldo numeric;
  v_faltantes text;
  v_sin_consumir integer;
begin
  if new.estado = 'lista' and old.estado is distinct from 'lista' then
    select string_agg(i.nombre, ', ' order by i.nombre) into v_faltantes
      from public.orden_materiales om
      join public.items_inventario i on i.id = om.item_id
     where om.orden_id = new.id and om.origen = 'sobre_pedido'
       and om.estado <> 'consumido' and om.costo_unitario_real is null;

    if v_faltantes is not null then
      raise exception 'No se puede cerrar la producción: falta registrar el costo de %', v_faltantes;
    end if;

    select count(*) into v_sin_consumir
      from public.orden_materiales
     where orden_id = new.id and estado <> 'consumido';

    if v_sin_consumir > 0 then
      raise exception 'No se puede marcar lista: quedan % materiales sin descontar del inventario. Usa "Cerrar producción".',
        v_sin_consumir;
    end if;
  end if;

  if new.cotizacion_id is null then
    return new;
  end if;

  if new.estado = 'en_produccion' and old.estado is distinct from 'en_produccion' then
    select total, total_abonado into v_total, v_abonado
      from public.cotizaciones_saldo where cotizacion_id = new.cotizacion_id;
    if v_total is not null and not public.cumple_anticipo_minimo(coalesce(v_abonado, 0), v_total) then
      raise exception 'No se puede iniciar producción: falta cobrar el anticipo (mínimo: %)',
        public.anticipo_minimo(v_total);
    end if;
  end if;

  if new.estado = 'entregada' and old.estado is distinct from 'entregada' then
    select saldo into v_saldo from public.cotizaciones_saldo where cotizacion_id = new.cotizacion_id;
    if coalesce(v_saldo, 0) > 1 then
      raise exception 'No se puede entregar: la cotización tiene un saldo pendiente de %', v_saldo;
    end if;
  end if;

  return new;
end $$;
