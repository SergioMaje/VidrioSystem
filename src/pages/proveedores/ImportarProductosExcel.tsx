import { useRef, useState } from 'react'
import { FileSpreadsheet, Download, Upload, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ResultadoImportacionDialog } from '@/components/shared/ResultadoImportacionDialog'
import { ClaseBadge } from '@/components/shared/ClaseBadge'
import { useCategorias, useUnidadesMedida, useCrearItemsMasivo } from '@/hooks/useInventario'
import { useToast } from '@/hooks/useToast'
import { descargarPlantillaProductos, leerProductosExcel, type ResultadoImportacion } from '@/lib/excelProductos'
import { medidasFisicas } from '@/lib/materiales'
import type { ItemInventario, Proveedor } from '@/types/database'

interface ImportarProductosExcelProps {
  proveedor: Proveedor
  itemsExistentes: ItemInventario[]
}

/**
 * Importación de productos con el proveedor ya fijo: la plantilla no lleva
 * columna Proveedor porque todas las filas son de éste. La versión global, con
 * esa columna y con la carga de stock, vive en ExcelInventarioMenu.
 */
export function ImportarProductosExcel({ proveedor, itemsExistentes }: ImportarProductosExcelProps) {
  const { data: categorias } = useCategorias()
  const { data: unidades } = useUnidadesMedida()
  const crearItemsMasivo = useCrearItemsMasivo()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [importando, setImportando] = useState(false)

  const handlePlantilla = async () => {
    if (!categorias || !unidades) return
    await descargarPlantillaProductos(categorias, unidades, proveedor.nombre)
  }

  const handleSeleccionarArchivo = () => {
    fileInputRef.current?.click()
  }

  const handleArchivoElegido = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !categorias || !unidades) return
    setProcesando(true)
    try {
      const codigosExistentes = new Set(itemsExistentes.map((i) => i.codigo.trim().toLowerCase()))
      const res = await leerProductosExcel(file, categorias, unidades, codigosExistentes)
      setResultado(res)
    } catch {
      toast({ title: 'No se pudo leer el archivo', description: 'Verifica que sea un .xlsx válido', variant: 'destructive' })
    } finally {
      setProcesando(false)
    }
  }

  const handleConfirmarImportacion = async () => {
    if (!resultado || resultado.validos.length === 0) return
    setImportando(true)
    try {
      await crearItemsMasivo.mutateAsync(
        resultado.validos.map((p) => ({
          ...p,
          stock_actual: 0,
          // Pisa el proveedor_id null que trae la plantilla sin columna Proveedor.
          proveedor_id: proveedor.id,
          activo: true,
          rol_configurador: null,
          vidrio_tipo: null,
          vidrio_calibre_mm: null,
          vidrio_acabado: null,
        }))
      )
      toast({ title: `${resultado.validos.length} producto(s) importado(s)`, variant: 'success' })
      setResultado(null)
    } catch {
      toast({ title: 'Error al guardar los productos', variant: 'destructive' })
    } finally {
      setImportando(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={procesando}>
            {procesando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Excel
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handlePlantilla}>
            <Download className="mr-2 h-4 w-4" />
            Descargar plantilla
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSeleccionarArchivo}>
            <Upload className="mr-2 h-4 w-4" />
            Importar productos
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={handleArchivoElegido}
      />

      <ResultadoImportacionDialog
        open={!!resultado}
        onClose={() => setResultado(null)}
        titulo="Resultado de la importación"
        resumen={`${resultado?.validos.length ?? 0} producto(s) listos para importar`}
        errores={resultado?.errores ?? []}
        textoConfirmar={`Importar ${resultado?.validos.length ?? 0} producto(s)`}
        puedeConfirmar={(resultado?.validos.length ?? 0) > 0}
        confirmando={importando}
        onConfirmar={handleConfirmarImportacion}
      >
        {resultado && resultado.validos.length > 0 && (
          <div className="rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Clase</th>
                  <th className="px-3 py-2">Lámina</th>
                  <th className="px-3 py-2 text-right">Costo</th>
                  <th className="px-3 py-2 text-right">Venta</th>
                </tr>
              </thead>
              <tbody>
                {resultado.validos.map((p) => (
                  <tr key={p.codigo} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono">{p.codigo}</td>
                    <td className="px-3 py-2">{p.nombre}</td>
                    <td className="px-3 py-2"><ClaseBadge clase={p.clase_inventario} /></td>
                    <td className="px-3 py-2 text-muted-foreground">{medidasFisicas(p) ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{p.precio_costo}</td>
                    <td className="px-3 py-2 text-right">{p.precio_venta}</td>
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
