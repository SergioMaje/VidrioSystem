import { useEffect, useState } from 'react'
import { Check, Loader2, Tag } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useActualizarTipoCategoria, useCrearTipoCategoria } from '@/hooks/useTiposCategoria'
import { fondoDeColor, PALETA_TIPOS_CATEGORIA } from '@/lib/cotizaciones'
import { cn } from '@/lib/utils'
import type { TipoCategoriaEnvio } from '@/types/database'

const MAX_NOMBRE = 30

interface TipoCategoriaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Si viene, se edita; si no, se crea uno nuevo. */
  tipo?: TipoCategoriaEnvio | null
  /** Al crear: recibe el tipo nuevo para dejarlo elegido. */
  onCreado?: (tipo: TipoCategoriaEnvio) => void
}

/** Crear o editar un tipo de categoría propio: nombre y color. */
export function TipoCategoriaDialog({ open, onOpenChange, tipo, onCreado }: TipoCategoriaDialogProps) {
  const crear = useCrearTipoCategoria()
  const actualizar = useActualizarTipoCategoria()
  const [nombre, setNombre] = useState('')
  const [color, setColor] = useState(PALETA_TIPOS_CATEGORIA[0].color)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setNombre(tipo?.nombre ?? '')
    setColor(tipo?.color ?? PALETA_TIPOS_CATEGORIA[0].color)
    setError(null)
  }, [open, tipo])

  const guardando = crear.isPending || actualizar.isPending
  const nombreLimpio = nombre.trim()
  // Un color guardado que ya no está en la paleta se sigue ofreciendo.
  const colores = PALETA_TIPOS_CATEGORIA.some((p) => p.color === color)
    ? PALETA_TIPOS_CATEGORIA
    : [{ color, fondo: fondoDeColor(color) }, ...PALETA_TIPOS_CATEGORIA]

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!nombreLimpio) {
      setError('Escribe un nombre')
      return
    }
    try {
      if (tipo) {
        await actualizar.mutateAsync({ id: tipo.id, nombre: nombreLimpio, color })
      } else {
        const nuevo = await crear.mutateAsync({ nombre: nombreLimpio, color })
        onCreado?.(nuevo)
      }
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el tipo')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{tipo ? 'Editar tipo de categoría' : 'Nuevo tipo de categoría'}</DialogTitle>
          <DialogDescription>
            Le da el color y la etiqueta a las partes del envío, p. ej. "Baño" o "Fachada".
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={guardar} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="tipo-categoria-nombre">Nombre</Label>
            <Input
              id="tipo-categoria-nombre"
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value)
                setError(null)
              }}
              maxLength={MAX_NOMBRE}
              placeholder="Ej.: Baño"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label id="tipo-categoria-color">Color</Label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="tipo-categoria-color">
              {colores.map((p) => (
                <button
                  key={p.color}
                  type="button"
                  role="radio"
                  aria-checked={p.color === color}
                  aria-label={`Color ${p.color}`}
                  onClick={() => setColor(p.color)}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border-2 transition-transform',
                    p.color === color ? 'scale-110 border-foreground' : 'border-transparent hover:scale-105'
                  )}
                  style={{ backgroundColor: p.color }}
                >
                  {p.color === color && <Check className="h-3.5 w-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>

          <div
            className="flex items-center gap-1.5 rounded-md border border-l-4 px-2.5 py-2 text-sm"
            style={{ borderLeftColor: color, backgroundColor: `${fondoDeColor(color)}66` }}
            aria-label="Vista previa"
          >
            <Tag className="h-4 w-4" color={color} aria-hidden />
            <span className={cn(!nombreLimpio && 'text-muted-foreground')}>{nombreLimpio || 'Vista previa'}</span>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={guardando || !nombreLimpio}>
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tipo ? 'Guardar cambios' : 'Crear tipo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
