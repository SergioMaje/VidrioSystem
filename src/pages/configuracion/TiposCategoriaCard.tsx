import { useState } from 'react'
import { Archive, ArchiveRestore, Pencil, Plus, Tag } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useActualizarTipoCategoria, useTiposCategoria } from '@/hooks/useTiposCategoria'
import { useToast } from '@/hooks/useToast'
import { fondoDeColor } from '@/lib/cotizaciones'
import { TipoCategoriaDialog } from '@/pages/cotizaciones/TipoCategoriaDialog'
import type { TipoCategoriaEnvio } from '@/types/database'

/**
 * Tipos de categoría propios de la vidriería. Se crean también desde la
 * cotización; aquí el admin los renombra, les cambia el color o los archiva.
 * No se borran: los envíos viejos los siguen mostrando.
 */
export function TiposCategoriaCard({ esAdmin }: { esAdmin: boolean }) {
  const { data: tipos, isLoading } = useTiposCategoria()
  const actualizar = useActualizarTipoCategoria()
  const { toast } = useToast()
  const [dialogo, setDialogo] = useState<{ tipo: TipoCategoriaEnvio | null } | null>(null)

  const cambiarActivo = async (tipo: TipoCategoriaEnvio) => {
    try {
      await actualizar.mutateAsync({ id: tipo.id, activo: !tipo.activo })
      toast({ title: tipo.activo ? `"${tipo.nombre}" archivado` : `"${tipo.nombre}" reactivado`, variant: 'success' })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'No se pudo guardar', variant: 'destructive' })
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Tag className="h-4 w-4 text-muted-foreground" />
            Tipos de categoría
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Además de Puerta, Ventana, División, Espejo y Otro, para dividir un envío por categorías.
            Los archivados ya no se ofrecen, pero los envíos que los usan los siguen mostrando.
          </p>
        </div>
        <Button size="sm" onClick={() => setDialogo({ tipo: null })}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo tipo
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : !tipos || tipos.length === 0 ? (
          <EmptyState
            icon={Tag}
            title="Sin tipos propios"
            description='Crea uno aquí o desde la cotización con "Nuevo tipo…"'
          />
        ) : (
          <ul className="divide-y">
            {tipos.map((tipo) => (
              <li key={tipo.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
                  style={{ backgroundColor: fondoDeColor(tipo.color), borderColor: tipo.color }}
                >
                  <Tag className="h-3.5 w-3.5" color={tipo.color} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{tipo.nombre}</span>
                {!tipo.activo && <Badge variant="secondary">Archivado</Badge>}
                {esAdmin && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" title="Editar" aria-label={`Editar ${tipo.nombre}`} onClick={() => setDialogo({ tipo })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title={tipo.activo ? 'Archivar' : 'Reactivar'}
                      aria-label={`${tipo.activo ? 'Archivar' : 'Reactivar'} ${tipo.nombre}`}
                      disabled={actualizar.isPending}
                      onClick={() => cambiarActivo(tipo)}
                    >
                      {tipo.activo ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <TipoCategoriaDialog
        open={dialogo !== null}
        onOpenChange={(abierto) => !abierto && setDialogo(null)}
        tipo={dialogo?.tipo}
      />
    </Card>
  )
}
