import { useRef, useState } from 'react'
import { FileSpreadsheet, Download, Upload, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useCategorias, useUnidadesMedida, useCrearItemsMasivo } from '@/hooks/useInventario'
import { useToast } from '@/hooks/useToast'
import { descargarPlantillaProductos, leerProductosExcel, type ResultadoImportacion } from '@/lib/excelProductos'
import type { ItemInventario, Proveedor } from '@/types/database'

interface ImportarProductosExcelProps {
  proveedor: Proveedor
  itemsExistentes: ItemInventario[]
}

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
          descripcion: null,
          stock_actual: 0,
          stock_minimo: 0,
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

      <Dialog open={!!resultado} onOpenChange={(open) => { if (!open) setResultado(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Resultado de la importación</DialogTitle>
          </DialogHeader>

          {resultado && (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>{resultado.validos.length} producto(s) listos para importar</span>
              </div>

              {resultado.errores.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{resultado.errores.length} fila(s) con errores (no se importarán)</span>
                  </div>
                  <div className="rounded-md border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/50 text-left">
                          <th className="px-3 py-2">Fila</th>
                          <th className="px-3 py-2">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultado.errores.map((err) => (
                          <tr key={err.fila} className="border-b last:border-0">
                            <td className="px-3 py-2">{err.fila}</td>
                            <td className="px-3 py-2 text-muted-foreground">{err.motivo}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {resultado.validos.length > 0 && (
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
                      {resultado.validos.map((p) => (
                        <tr key={p.codigo} className="border-b last:border-0">
                          <td className="px-3 py-2 font-mono">{p.codigo}</td>
                          <td className="px-3 py-2">{p.nombre}</td>
                          <td className="px-3 py-2 text-right">{p.precio_costo}</td>
                          <td className="px-3 py-2 text-right">{p.precio_venta}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setResultado(null)}>Cerrar</Button>
            <Button
              onClick={handleConfirmarImportacion}
              disabled={!resultado || resultado.validos.length === 0 || importando}
            >
              {importando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Importar {resultado?.validos.length ?? 0} producto(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
