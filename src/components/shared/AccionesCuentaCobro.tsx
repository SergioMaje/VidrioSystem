import { useState } from 'react'
import { ImageDown, Loader2, Printer } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useConfiguracionEmpresa, useLogoEmpresaDataUri } from '@/hooks/useConfiguracionEmpresa'
import { useCuentasPagoEmpresa } from '@/hooks/useCuentasPagoEmpresa'
import { useToast } from '@/hooks/useToast'
import { descargarCuentaCobroImagen, imprimirCuentaCobro } from '@/lib/imprimirCuentaCobro'
import { cn, mensajeError } from '@/lib/utils'

/**
 * El número de una cuenta de cobro como menú: imprimirla (o guardarla como PDF)
 * o descargarla como imagen. Mismo patrón que AccionesRecibo.
 */
export function AccionesCuentaCobro({
  cuentaId,
  numero,
  className,
}: {
  cuentaId: string
  numero: string
  className?: string
}) {
  const { data: empresa } = useConfiguracionEmpresa()
  const { data: logo } = useLogoEmpresaDataUri()
  const { data: cuentas } = useCuentasPagoEmpresa(true)
  const { toast } = useToast()
  const [descargando, setDescargando] = useState(false)
  const ctx = { empresa, logo, cuentas: cuentas ?? [] }

  const descargar = async () => {
    setDescargando(true)
    try {
      await descargarCuentaCobroImagen(cuentaId, ctx)
    } catch (err) {
      toast({ title: mensajeError(err, 'No se pudo descargar la cuenta de cobro'), variant: 'destructive' })
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
        title={`Cuenta de cobro ${numero}`}
      >
        {descargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
        {numero}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => imprimirCuentaCobro(cuentaId, ctx)}>
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
