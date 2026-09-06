export interface Usuario {
  id: string
  nombre: string
  apellido: string
  email: string
  rol: 'admin' | 'vendedor' | 'bodega'
  activo: boolean
  created_at: string
  updated_at: string
}

export interface Categoria {
  id: string
  nombre: string
  descripcion: string | null
  icono: string | null
  activa: boolean
  created_at: string
}

export interface UnidadMedida {
  id: string
  nombre: string
  simbolo: string
  tipo: 'area' | 'longitud' | 'unidad' | 'peso' | 'volumen'
  created_at: string
}

export interface Proveedor {
  id: string
  nombre: string
  contacto: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  nit: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export interface ProveedorCuentaPago {
  id: string
  proveedor_id: string
  alias: string | null
  banco: string
  tipo_cuenta: string
  numero_cuenta: string
  titular: string
  created_at: string
  updated_at: string
}

/** Cuenta propia de la vidrieria, la que se le muestra al cliente para que transfiera. */
export interface CuentaPagoEmpresa {
  id: string
  alias: string | null
  banco: string
  tipo_cuenta: string
  numero_cuenta: string
  titular: string
  activo: boolean
  orden: number
  created_at: string
  updated_at: string
}

/** Rol de un item de inventario dentro de las opciones adicionales del configurador. */
export type RolConfigurador = 'vidrio' | 'chapa' | 'pelicula'

export type VidrioTipo = 'crudo' | 'templado' | 'laminado'

/** De dónde sale el material: bodega, retal recuperado, o se compra sobre pedido. */
export type ClaseInventario = 'stock_normal' | 'desperdicio' | 'sobre_pedido'

export interface ItemInventario {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  categoria_id: string
  unidad_medida_id: string
  proveedor_id: string | null
  stock_actual: number
  stock_minimo: number
  precio_costo: number
  precio_venta: number
  activo: boolean
  /** Si es null, se infiere de la categoria y del nombre (ver src/lib/opciones.ts). */
  rol_configurador: RolConfigurador | null
  vidrio_tipo: VidrioTipo | null
  vidrio_calibre_mm: number | null
  vidrio_acabado: string | null
  clase_inventario: ClaseInventario
  /** Lámina/item raíz del que salió este recorte. Nunca apunta a otro recorte. */
  item_origen_id: string | null
  /** Medidas del recorte. Null en cualquier item que no sea 'desperdicio'. */
  ancho_cm: number | null
  alto_cm: number | null
  created_at: string
  updated_at: string
  categoria?: Categoria
  unidad_medida?: UnidadMedida
  proveedor?: Proveedor
  item_origen?: ItemInventario
}

export interface MovimientoInventario {
  id: string
  item_id: string
  tipo: 'entrada' | 'salida' | 'ajuste' | 'produccion'
  cantidad: number
  cantidad_anterior: number
  cantidad_posterior: number
  motivo: string | null
  referencia: string | null
  usuario_id: string
  created_at: string
  item?: ItemInventario
}

export interface TipoProducto {
  id: string
  nombre: 'ventana' | 'puerta' | 'division' | 'espejo' | 'otro'
  descripcion: string | null
  activo: boolean
}

export interface PlantillaProducto {
  id: string
  tipo_producto_id: string
  nombre: string
  descripcion: string | null
  requiere_medidas: boolean
  activa: boolean
  created_at: string
  updated_at: string
  tipo_producto?: TipoProducto
  componentes?: PlantillaComponente[]
}

export interface PlantillaComponente {
  id: string
  plantilla_id: string
  item_id: string
  formula: 'area' | 'perimetro' | 'ancho' | 'alto' | 'fijo'
  cantidad_fija: number | null
  desperdicio_pct: number
  obligatorio: boolean
  item?: ItemInventario
}

export interface Cliente {
  id: string
  nombre: string
  apellido: string
  empresa: string | null
  tipo: 'natural' | 'juridico'
  documento: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  ciudad: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export interface Cotizacion {
  id: string
  numero: string
  cliente_id: string
  usuario_id: string
  estado: 'borrador' | 'enviada' | 'aprobada' | 'rechazada' | 'vencida' | 'vendida'
  fecha_emision: string
  fecha_vencimiento: string | null
  /** Cuándo el cliente aprobó (pagó el anticipo y pasó a 'vendida'). Null hasta entonces. */
  fecha_aprobacion: string | null
  subtotal: number
  descuento_pct: number
  iva_pct: number
  total: number
  notas: string | null
  created_at: string
  updated_at: string
  cliente?: Cliente
}

/**
 * Opcion adicional elegida al cotizar (vidrio, chapa/cerradura, pelicula). Guarda un
 * snapshot del item de inventario para que la ficha impresa y el recalculo de
 * produccion no cambien si despues se edita el inventario.
 */
export interface OpcionCotizacion {
  rol: RolConfigurador
  item_id: string
  nombre: string
  unidad_simbolo: string | null
  formula: PlantillaComponente['formula']
  cantidad_fija: number | null
  desperdicio_pct: number
  precio_costo: number
  vidrio_tipo: VidrioTipo | null
  vidrio_calibre_mm: number | null
  vidrio_acabado: string | null
}

/** Desde qué lado de la construcción se tomó la medida. */
export type LadoMedicion = 'interior' | 'exterior'

/** Qué hoja corre, expresada desde el lado en que se midió. */
export type LadoCorredizo = 'izquierda' | 'derecha'

export interface CotizacionItem {
  id: string
  cotizacion_id: string
  plantilla_id: string | null
  referencia_id: string | null
  descripcion: string
  /** Ancho nominal (bounding box): max(ancho_sup_cm, ancho_inf_cm). */
  ancho_cm: number | null
  /** Alto nominal (bounding box): max(alto_izq_cm, alto_der_cm). */
  alto_cm: number | null
  area_m2: number | null
  /** El vano esta fuera de escuadra y manda el detalle por lado. */
  medidas_irregulares: boolean
  alto_izq_cm: number | null
  alto_der_cm: number | null
  ancho_sup_cm: number | null
  ancho_inf_cm: number | null
  cantidad: number
  precio_unitario: number
  precio_total: number
  color_perfil: string | null
  lado_medicion: LadoMedicion | null
  lado_corredizo: LadoCorredizo | null
  opciones: OpcionCotizacion[]
  notas: string | null
  plantilla?: PlantillaProducto
  referencia?: ReferenciaProducto
}

export interface OrdenTrabajo {
  id: string
  numero: string
  cotizacion_id: string | null
  cliente_id: string
  estado: 'pendiente' | 'en_produccion' | 'lista' | 'entregada' | 'cancelada'
  fecha_inicio: string | null
  fecha_entrega_estimada: string | null
  fecha_entrega_real: string | null
  notas: string | null
  created_at: string
  updated_at: string
  cliente?: Cliente
}

export type OrigenMaterial = 'desperdicio' | 'stock_normal' | 'sobre_pedido'
export type EstadoMaterialOrden = 'pendiente' | 'asignado' | 'consumido'

/**
 * Una línea de material de la orden. `item_requerido_id` es lo que pidió el BOM y
 * `item_id` lo que se usó de verdad; difieren cuando un recorte cubrió la necesidad.
 * `costo_unitario_real` en null es lo que bloquea el paso a 'lista' cuando el
 * origen es 'sobre_pedido'.
 */
export interface OrdenMaterial {
  id: string
  orden_id: string
  item_id: string
  item_requerido_id: string | null
  origen: OrigenMaterial
  cantidad_requerida: number
  cantidad_asignada: number
  costo_unitario_real: number | null
  proveedor_id: string | null
  estado: EstadoMaterialOrden
  movimiento_id: string | null
  notas: string | null
  created_at: string
  updated_at: string
  item?: ItemInventario
  item_requerido?: ItemInventario
  proveedor?: Proveedor
}

/** Fila de la función `sugerir_materiales`, ya ordenada por prioridad por la base. */
export interface SugerenciaMaterial {
  item_id: string
  codigo: string
  nombre: string
  origen: OrigenMaterial
  clase: ClaseInventario
  stock_actual: number
  ancho_cm: number | null
  alto_cm: number | null
  cubre: boolean
  prioridad: number
}

export type FormulaCorte =
  | 'ancho'
  | 'alto'
  | 'ancho_menos_margen'
  | 'alto_menos_margen'
  | 'mitad_ancho'
  | 'mitad_alto'
  | 'fijo'
  // Medidas por lado, para vanos fuera de escuadra. margen_cm se resta siempre
  // (default 0), por eso no tienen variante "_menos_margen".
  | 'alto_izquierdo'
  | 'alto_derecho'
  | 'ancho_superior'
  | 'ancho_inferior'

export interface ReferenciaCorte {
  id: string
  referencia_id: string
  nombre_pieza: string
  formula: FormulaCorte
  /** Descuento base. Un valor negativo suma en vez de restar. */
  margen_cm: number
  /** Descuentos por lado. NULL = usa margen_cm. Solo aplican en vanos fuera de escuadra. */
  margen_izq_cm: number | null
  margen_der_cm: number | null
  margen_sup_cm: number | null
  margen_inf_cm: number | null
  cantidad_fija_cm: number | null
  cantidad_piezas: number
  orden: number
  created_at: string
}

export interface ReferenciaProducto {
  id: string
  nombre: string
  descripcion: string | null
  tipo_producto_id: string
  plantilla_id: string
  activa: boolean
  es_corrediza: boolean
  created_at: string
  updated_at: string
  tipo_producto?: TipoProducto
  plantilla?: PlantillaProducto
  cortes?: ReferenciaCorte[]
}

export interface CashRegisterSession {
  id: string
  opened_at: string
  closed_at: string | null
  opened_by: string
  closed_by: string | null
  opening_amount: number
  expected_amount: number | null
  counted_amount: number | null
  difference: number | null
  status: 'open' | 'closed'
  created_at: string
  opened_by_usuario?: Usuario
  closed_by_usuario?: Usuario
}

export type TipoPago = 'anticipo' | 'abono' | 'saldo_final' | 'contado'

export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia'

/**
 * Un pago. La tabla se sigue llamando `ventas`, pero es un libro de cobros:
 * desde los abonos hay varias filas por cotización (anticipo del 50% y abonos
 * hasta liquidar), y desde la venta de mostrador un pago puede venir de una
 * cotización o de una `ventas_mostrador` — exactamente uno de los dos, garantía
 * del check `ventas_origen_unico`.
 */
export interface Venta {
  id: string
  cotizacion_id: string | null
  venta_mostrador_id: string | null
  session_id: string
  metodo_pago: MetodoPago
  monto: number
  tipo: TipoPago
  /** Admin que autorizó un anticipo menor al 50%. */
  autorizado_por: string | null
  motivo_autorizacion: string | null
  usuario_id: string
  created_at: string
  cotizacion?: Cotizacion
}

/** Venta directa de mostrador: productos que salen del inventario tal cual. */
export interface VentaMostrador {
  id: string
  numero: string
  /** Nullable: puede ser una venta a público general. */
  cliente_id: string | null
  session_id: string
  usuario_id: string
  total: number
  created_at: string
  cliente?: Cliente | null
  items?: VentaMostradorItem[]
}

export interface VentaMostradorItem {
  id: string
  venta_id: string
  item_id: string
  /** Snapshot del nombre al momento de vender. */
  descripcion: string
  cantidad: number
  precio_unitario: number
  precio_total: number
}

export type CategoriaGasto =
  | 'domicilio'
  | 'transporte'
  | 'papeleria'
  | 'servicios'
  | 'refrigerio'
  | 'proveedor'
  | 'retiro'
  | 'otro'

/**
 * Salida de dinero del turno. Anular no borra la fila (`anulado_at`): un
 * movimiento de efectivo borrado es evidencia perdida. Un movimiento vivo —el
 * que cuenta para el arqueo— es el que tiene `anulado_at` en null.
 */
export interface MovimientoCaja {
  id: string
  session_id: string
  categoria: CategoriaGasto
  concepto: string
  monto: number
  metodo_pago: MetodoPago
  usuario_id: string
  created_at: string
  anulado_at: string | null
  anulado_por: string | null
  motivo_anulacion: string | null
}

export type MovimientoCajaConUsuario = MovimientoCaja & {
  usuario: Pick<Usuario, 'nombre' | 'apellido'> | null
  anulado_por_usuario: Pick<Usuario, 'nombre' | 'apellido'> | null
}

/** Vista `cotizaciones_saldo`: el saldo se deriva, nunca se almacena. */
export interface CotizacionSaldo {
  cotizacion_id: string
  total: number
  total_abonado: number
  saldo: number
  pct_abonado: number
}
