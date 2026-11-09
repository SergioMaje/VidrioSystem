import { useState } from 'react'
import { ImageDown, Loader2, Printer } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useConfiguracionEmpresa, useLogoEmpresaDataUri } from '@/hooks/useConfiguracionEmpresa'
import { useToast } from '@/hooks/useToast'
import { descargarReciboImagen, imprimirRecibo } from '@/lib/imprimirRecibo'
import { cn, mensajeError } from '@/lib/utils'

/**
 * El número de recibo de un cobro como menú: imprimirlo (o guardarlo como PDF)
 * o descargarlo como imagen para mandarlo por WhatsApp.
 */
export function AccionesRecibo({
  ventaId,
  numero,
  anulado = false,
  className,
}: {
  ventaId: string
  numero: string
  anulado?: boolean
  className?: string
}) {
  // Ya están en caché: los usan las demás impresiones.
  const { data: empresa } = useConfiguracionEmpresa()
  const { data: logo } = useLogoEmpresaDataUri()
  const { toast } = useToast()
  const [descargando, setDescargando] = useState(false)

  const descargar = async () => {
    setDescargando(true)
    try {
      await descargarReciboImagen(ventaId, { empresa, logo })
    } catch (err) {
      toast({ title: mensajeError(err, 'No se pudo descargar el recibo'), variant: 'destructive' })
    } finally {
      setDescargando(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex items-center gap-1 font-mono text-xs font-medium text-primary underline-offset-2 hover:underline',
          className
        )}
        title={`Recibo ${numero}${anulado ? ' (anulado)' : ''}`}
      >
        {descargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5 print:hidden" />}
        {numero}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => imprimirRecibo(ventaId, { empresa, logo })}>
          <Printer className="mr-2 h-4 w-4" />
          Imprimir / PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={descargar} disabled={descargando}>
          <ImageDown className="mr-2 h-4 w-4" />
          Descargar imagen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
