import { useRef, useState } from 'react'
import { FileSpreadsheet, Download, Upload, Loader2, PackagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ResultadoImportacionDialog } from '@/components/shared/ResultadoImportacionDialog'
import {
  useCategorias, useUnidadesMedida, useProveedores,
  useCrearItemsMasivo, useRegistrarEntradasMasivas,
} from '@/hooks/useInventario'
import { useToast } from '@/hooks/useToast'
import { descargarPlantillaProductos, leerProductosExcel, type ResultadoImportacion } from '@/lib/excelProductos'
import { descargarPlantillaStock, leerStockExcel, type ResultadoCargaStock } from '@/lib/excelStock'
import { formatCOP } from '@/lib/utils'
import type { ItemInventario } from '@/types/database'

interface ExcelInventarioMenuProps {
  /** Todos los items activos: son la llave de la plantilla de stock y la lista de códigos ya usados. */
  items: ItemInventario[]
}

/**
 * Las dos operaciones de Excel del inventario completo, en un solo menú:
 *
 * - Productos: crea items. Es la misma plantilla de la ficha del proveedor, pero
 *   con columna Proveedor, porque desde aquí no hay uno de contexto.
 * - Stock: mete cantidades a items que ya existen. No toca items_inventario; cada
 *   fila se registra como movimiento de entrada y el stock lo aplica el trigger.
 *
 * Están juntas porque es el orden natural de trabajo cuando llega un pedido:
 * primero se dan de alta las referencias nuevas, después se carga lo que llegó.
 */
export function ExcelInventarioMenu({ items }: ExcelInventarioMenuProps) {
  const { data: categorias } = useCategorias()
  const { data: unidades } = useUnidadesMedida()
  const { data: proveedores } = useProveedores()
  const crearItemsMasivo = useCrearItemsMasivo()
  const registrarEntradas = useRegistrarEntradasMasivas()
  const { toast } = useToast()

  const inputProductosRef = useRef<HTMLInputElement>(null)
  const inputStockRef = useRef<HTMLInputElement>(null)

  const [resultadoProductos, setResultadoProductos] = useState<ResultadoImportacion | null>(null)
  const [resultadoStock, setResultadoStock] = useState<ResultadoCargaStock | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const catalogosListos = !!categorias && !!unidades && !!proveedores

  // ── Plantillas ────────────────────────────────────────────────────────────
  const handlePlantillaProductos = async () => {
    if (!categorias || !unidades || !proveedores) return
    if (proveedores.length === 0) {
      toast({
        title: 'Registra al menos un proveedor',
        description: 'La plantilla necesita la lista de proveedores válidos',
        variant: 'destructive',
      })
      return
    }
    await descargarPlantillaProductos(categorias, unidades, 'inventario', proveedores)
  }

  const handlePlantillaStock = async () => {
    if (items.length === 0) {
      toast({
        title: 'No hay items en el inventario',
        description: 'Primero importa o crea los productos',
        variant: 'destructive',
      })
      return
    }
    await descargarPlantillaStock(items, 'inventario')
  }

  // ── Lectura de archivos ───────────────────────────────────────────────────
  const handleArchivoProductos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !categorias || !unidades || !proveedores) return
    setProcesando(true)
    try {
      const codigosExistentes = new Set(items.map((i) => i.codigo.trim().toLowerCase()))
      setResultadoProductos(await leerProductosExcel(file, categorias, unidades, codigosExistentes, proveedores))
    } catch {
      toast({ title: 'No se pudo leer el archivo', description: 'Verifica que sea un .xlsx válido', variant: 'destructive' })
    } finally {
      setProcesando(false)
    }
  }

  const handleArchivoStock = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setProcesando(true)
    try {
      setResultadoStock(await leerStockExcel(file, items))
    } catch {
      toast({ title: 'No se pudo leer el archivo', description: 'Verifica que sea un .xlsx válido', variant: 'destructive' })
    } finally {
      setProcesando(false)
    }
  }

  // ── Confirmaciones ────────────────────────────────────────────────────────
  const handleConfirmarProductos = async () => {
    if (!resultadoProductos || resultadoProductos.validos.length === 0) return
    setGuardando(true)
    try {
      await crearItemsMasivo.mutateAsync(
        resultadoProductos.validos.map((p) => ({
          ...p,
          descripcion: null,
          // Los items nacen en cero: el stock entra después por la plantilla de
          // stock, que sí deja rastro en movimientos_inventario.
          stock_actual: 0,
          stock_minimo: 0,
          activo: true,
          rol_configurador: null,
          vidrio_tipo: null,
          vidrio_calibre_mm: null,
          vidrio_acabado: null,
        }))
      )
      toast({ title: `${resultadoProductos.validos.length} producto(s) importado(s)`, variant: 'success' })
      setResultadoProductos(null)
    } catch {
      toast({ title: 'Error al guardar los productos', variant: 'destructive' })
    } finally {
      setGuardando(false)
    }
  }

  const handleConfirmarStock = async () => {
    if (!resultadoStock || resultadoStock.validos.length === 0) return
    setGuardando(true)
    try {
      const registradas = await registrarEntradas.mutateAsync({
        entradas: resultadoStock.validos.map((e) => ({
          item_id: e.item_id,
          cantidad: e.cantidad,
          motivo: e.motivo,
        })),
        referencia: 'Carga masiva Excel',
      })
      toast({ title: `Stock cargado en ${registradas} item(s)`, variant: 'success' })
      setResultadoStock(null)
    } catch (err) {
      // El RPC es todo o nada, así que si falló no se movió nada: se muestra el
      // motivo que dio Postgres para que el usuario corrija el archivo.
      toast({
        title: 'No se cargó el stock',
        description: err instanceof Error ? err.message : 'Error desconocido',
        variant: 'destructive',
      })
    } finally {
      setGuardando(false)
    }
  }

  const totalUnidades = resultadoStock?.validos.reduce((acc, e) => acc + e.cantidad, 0) ?? 0

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={procesando || !catalogosListos}>
            {procesando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Excel
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Productos</DropdownMenuLabel>
          <DropdownMenuItem onClick={handlePlantillaProductos}>
            <Download className="mr-2 h-4 w-4" />
            Descargar plantilla
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => inputProductosRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            Importar productos
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuLabel>Stock</DropdownMenuLabel>
          <DropdownMenuItem onClick={handlePlantillaStock}>
            <Download className="mr-2 h-4 w-4" />
            Descargar plantilla de stock
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => inputStockRef.current?.click()}>
            <PackagePlus className="mr-2 h-4 w-4" />
            Cargar stock (entradas)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input ref={inputProductosRef} type="file" accept=".xlsx" className="hidden" onChange={handleArchivoProductos} />
      <input ref={inputStockRef} type="file" accept=".xlsx" className="hidden" onChange={handleArchivoStock} />

      <ResultadoImportacionDialog
        open={!!resultadoProductos}
        onClose={() => setResultadoProductos(null)}
        titulo="Importar productos"
        resumen={`${resultadoProductos?.validos.length ?? 0} producto(s) listos para importar`}
        errores={resultadoProductos?.errores ?? []}
        textoConfirmar={`Importar ${resultadoProductos?.validos.length ?? 0} producto(s)`}
        puedeConfirmar={(resultadoProductos?.validos.length ?? 0) > 0}
        confirmando={guardando}
        onConfirmar={handleConfirmarProductos}
      >
        {resultadoProductos && resultadoProductos.validos.length > 0 && (
          <div className="rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2 text-right">Costo</th>
                  <th className="px-3 py-2 text-right">Venta</th>
                </tr>
              </thead>
              <tbody>
                {resultadoProductos.validos.map((p) => (
                  <tr key={p.codigo} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono">{p.codigo}</td>
                    <td className="px-3 py-2">{p.nombre}</td>
                    <td className="px-3 py-2 text-right">{formatCOP(p.precio_costo)}</td>
                    <td className="px-3 py-2 text-right">{formatCOP(p.precio_venta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ResultadoImportacionDialog>

      <ResultadoImportacionDialog
        open={!!resultadoStock}
        onClose={() => setResultadoStock(null)}
        titulo="Cargar stock"
        resumen={`${resultadoStock?.validos.length ?? 0} item(s) recibirán entrada, ${totalUnidades} unidad(es) en total`}
        nota={resultadoStock && resultadoStock.omitidas > 0
          ? `${resultadoStock.omitidas} fila(s) sin cantidad: se omiten`
          : undefined}
        errores={resultadoStock?.errores ?? []}
        destinoErrores="hay que corregirlas antes de cargar"
        textoConfirmar={`Registrar ${resultadoStock?.validos.length ?? 0} entrada(s)`}
        // Con errores no se carga nada: la operación es todo o nada, así que
        // confirmar a medias daría la falsa idea de que el archivo quedó aplicado.
        puedeConfirmar={(resultadoStock?.validos.length ?? 0) > 0 && (resultadoStock?.errores.length ?? 0) === 0}
        confirmando={guardando}
        onConfirmar={handleConfirmarStock}
      >
        {resultadoStock && resultadoStock.validos.length > 0 && (
          <div className="rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2 text-right">Stock actual</th>
                  <th className="px-3 py-2 text-right">Entra</th>
                  <th className="px-3 py-2 text-right">Queda en</th>
                </tr>
              </thead>
              <tbody>
                {resultadoStock.validos.map((e) => (
                  <tr key={e.item_id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono">{e.codigo}</td>
                    <td className="px-3 py-2">{e.nombre}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{e.stock_actual}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-600">+{e.cantidad}</td>
                    <td className="px-3 py-2 text-right font-mono font-medium">{e.stock_actual + e.cantidad}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ResultadoImportacionDialog>
    </>
  )
}
