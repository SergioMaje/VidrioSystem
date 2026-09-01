-- Carga masiva de stock desde Excel.
--
-- El inventario ya se podía llenar de items en bloque (la plantilla de productos
-- del proveedor), pero esos items nacen con stock 0 y después había que abrir la
-- ficha de cada uno y registrar la entrada a mano. Con un pedido de 80 referencias
-- eso son 80 formularios, y en la práctica terminaba en que nadie cargaba el stock.
--
-- La tentación es hacer un UPDATE masivo de items_inventario.stock_actual. No:
-- stock_actual es un valor derivado que mantiene trg_actualizar_stock a partir de
-- movimientos_inventario. Escribirlo directo deja el número bien y el historial
-- mudo — no queda quién lo subió, cuándo, ni desde qué stock. Así que aquí se
-- insertan movimientos de entrada, uno por fila del Excel, y el stock lo mueve el
-- trigger como en cualquier otra operación (venta de mostrador incluida).
--
-- Es un solo RPC y no N inserts desde el navegador porque una carga a medias es
-- peor que ninguna: si la fila 40 falla, las 39 anteriores ya movieron stock y no
-- hay forma de saber dónde se quedó. Dentro de la función todo entra o nada entra.

create or replace function public.registrar_entradas_inventario(
  p_entradas jsonb,
  p_referencia text default null
) returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $$
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
    where id = v_item_id
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
$$;

comment on function public.registrar_entradas_inventario(jsonb, text) is
  'Registra en bloque movimientos de entrada de inventario. El stock lo aplica trg_actualizar_stock; nunca se escribe stock_actual directo.';

grant execute on function public.registrar_entradas_inventario(jsonb, text) to authenticated;
