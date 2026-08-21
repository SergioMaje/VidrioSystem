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

/** Rol de un item de inventario dentro de las opciones adicionales del configurador. */
export type RolConfigurador = 'vidrio' | 'chapa' | 'pelicula'

export type VidrioTipo = 'crudo' | 'templado' | 'laminado'

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
  created_at: string
  updated_at: string
  categoria?: Categoria
  unidad_medida?: UnidadMedida
  proveedor?: Proveedor
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
  ancho_cm: number | null
  alto_cm: number | null
  area_m2: number | null
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

export type FormulaCorte =
  | 'ancho'
  | 'alto'
  | 'ancho_menos_margen'
  | 'alto_menos_margen'
  | 'mitad_ancho'
  | 'mitad_alto'
  | 'fijo'

export interface ReferenciaCorte {
  id: string
  referencia_id: string
  nombre_pieza: string
  formula: FormulaCorte
  margen_cm: number
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

export type TipoPago = 'anticipo' | 'abono' | 'saldo_final'

/**
 * Un pago sobre una cotización. La tabla se sigue llamando `ventas`, pero desde
 * los abonos hay varias filas por cotización: el anticipo (mínimo 50%) y los
 * abonos posteriores hasta liquidar el saldo.
 */
export interface Venta {
  id: string
  cotizacion_id: string
  session_id: string
  metodo_pago: 'efectivo' | 'tarjeta' | 'transferencia'
  monto: number
  tipo: TipoPago
  /** Admin que autorizó un anticipo menor al 50%. */
  autorizado_por: string | null
  motivo_autorizacion: string | null
  usuario_id: string
  created_at: string
  cotizacion?: Cotizacion
}

/** Vista `cotizaciones_saldo`: el saldo se deriva, nunca se almacena. */
export interface CotizacionSaldo {
  cotizacion_id: string
  total: number
  total_abonado: number
  saldo: number
  pct_abonado: number
}
