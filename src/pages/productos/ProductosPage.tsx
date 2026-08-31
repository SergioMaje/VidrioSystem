import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, BookOpen, Scissors, FileText } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { PlantillaFormDialog } from './PlantillaFormDialog'
import { ReferenciaFormDialog } from './ReferenciaFormDialog'
import { usePlantillas, useEliminarPlantilla } from '@/hooks/useProductos'
import { useReferencias, useEliminarReferencia, useItemsLibres } from '@/hooks/useReferencias'
import { formatCOP } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import type { PlantillaProducto, ReferenciaProducto } from '@/types/database'

export function ProductosPage() {
  const navigate = useNavigate()
  const [editPlantilla, setEditPlantilla] = useState<PlantillaProducto | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [confirmarEliminar, setConfirmarEliminar] = useState<PlantillaProducto | null>(null)

  const [editReferencia, setEditReferencia] = useState<ReferenciaProducto | null>(null)
  const [refFormOpen, setRefFormOpen] = useState(false)
  const [confirmarEliminarRef, setConfirmarEliminarRef] = useState<ReferenciaProducto | null>(null)

  const { data: plantillas, isLoading } = usePlantillas()
  const eliminarPlantilla = useEliminarPlantilla()
  const { data: referencias, isLoading: loadingReferencias } = useReferencias()
  const eliminarReferencia = useEliminarReferencia()
  const { data: itemsLibres } = useItemsLibres()
  const { usuario } = useAuth()
  const esAdmin = usuario?.rol === 'admin'
  const { toast } = useToast()

  const handleEliminar = async () => {
    if (!confirmarEliminar) return
    try {
      await eliminarPlantilla.mutateAsync(confirmarEliminar.id)
      toast({ title: 'Plantilla eliminada' })
    } catch {
      toast({ title: 'Error al eliminar', variant: 'destructive' })
    }
    setConfirmarEliminar(null)
  }

  const handleEliminarReferencia = async () => {
    if (!confirmarEliminarRef) return
    try {
      await eliminarReferencia.mutateAsync(confirmarEliminarRef.id)
      toast({ title: 'Referencia eliminada' })
    } catch {
      toast({ title: 'Error al eliminar', variant: 'destructive' })
    }
    setConfirmarEliminarRef(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Catálogo de plantillas y referencias que alimenta el configurador de cotizaciones.
        </p>
        <Button onClick={() => navigate('/cotizaciones/nueva')}>
          <FileText className="mr-2 h-4 w-4" />
          Nueva cotización
        </Button>
      </div>

      <Tabs defaultValue="plantillas">
        <TabsList>
          <TabsTrigger value="plantillas">Plantillas BOM</TabsTrigger>
          {esAdmin && (
            <TabsTrigger value="referencias">Referencias</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="plantillas" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                Define qué materiales y fórmulas usa cada tipo de producto
              </p>
            </div>
            <Button onClick={() => { setEditPlantilla(null); setFormOpen(true) }}>
              <Plus className="mr-2 h-4 w-4" />
              Nueva plantilla
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <LoadingSpinner className="py-12" />
              ) : !plantillas || plantillas.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title="No hay plantillas"
                  description="Crea una plantilla para empezar a configurar productos"
                />
              ) : (
                <div className="divide-y">
                  {plantillas.map((plantilla) => (
                    <div key={plantilla.id} className="flex items-start justify-between px-4 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{plantilla.nombre}</p>
                          <Badge variant="secondary" className="capitalize text-xs">
                            {plantilla.tipo_producto?.nombre}
                          </Badge>
                          {plantilla.requiere_medidas && (
                            <Badge variant="outline" className="text-xs">Con medidas</Badge>
                          )}
                        </div>
                        {plantilla.descripcion && (
                          <p className="text-xs text-muted-foreground">{plantilla.descripcion}</p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {plantilla.componentes?.map((c) => (
                            <span key={c.id} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {c.item?.nombre ?? 'Material'} · {c.formula}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-4 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setEditPlantilla(plantilla); setFormOpen(true) }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmarEliminar(plantilla)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {esAdmin && (
          <TabsContent value="referencias" className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Presets de corte para los productos más vendidos. Solo visible para administradores.
                </p>
              </div>
              <Button onClick={() => { setEditReferencia(null); setRefFormOpen(true) }}>
                <Plus className="mr-2 h-4 w-4" />
                Nueva referencia
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                {loadingReferencias ? (
                  <LoadingSpinner className="py-12" />
                ) : !referencias || referencias.length === 0 ? (
                  <EmptyState
                    icon={Scissors}
                    title="No hay referencias"
                    description="Crea una referencia para definir las medidas de corte de tus productos más vendidos"
                  />
                ) : (
                  <div className="divide-y">
                    {referencias.map((ref) => (
                      <div key={ref.id} className="flex items-start justify-between px-4 py-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{ref.nombre}</p>
                            <Badge variant="secondary" className="capitalize text-xs">
                              {ref.tipo_producto?.nombre}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {ref.plantilla?.nombre}
                            </Badge>
                            {ref.es_corrediza && (
                              <Badge className="text-xs">Corrediza</Badge>
                            )}
                          </div>
                          {ref.descripcion && (
                            <p className="text-xs text-muted-foreground">{ref.descripcion}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {ref.cortes?.length ?? 0} {(ref.cortes?.length ?? 0) === 1 ? 'corte' : 'cortes'} configurados
                          </p>
                        </div>
                        <div className="flex items-center gap-1 ml-4 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setEditReferencia(ref); setRefFormOpen(true) }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setConfirmarEliminarRef(ref)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Lo que más se cotiza a mano es lo que más urge modelar. La lista se
                vacía sola a medida que se crean las referencias que faltan. */}
            {!!itemsLibres?.length && (
              <Card>
                <CardContent className="p-0">
                  <div className="border-b px-4 py-3">
                    <p className="text-sm font-medium">Ítems cotizados a mano</p>
                    <p className="text-xs text-muted-foreground">
                      Cotizados sin referencia. Ordenados por frecuencia: crear la referencia de
                      los primeros es lo que más trabajo manual ahorra.
                    </p>
                  </div>
                  <div className="divide-y">
                    {itemsLibres.slice(0, 10).map((item) => (
                      <div key={item.descripcion} className="flex items-start justify-between gap-4 px-4 py-3">
                        <p className="text-sm leading-snug">{item.descripcion}</p>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-medium">
                            {item.veces} {item.veces === 1 ? 'vez' : 'veces'}
                          </p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {formatCOP(item.monto_total)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {itemsLibres.length > 10 && (
                    <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                      y {itemsLibres.length - 10} descripciones más
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}
      </Tabs>

      <PlantillaFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        plantilla={editPlantilla}
      />

      <ConfirmDialog
        open={!!confirmarEliminar}
        onOpenChange={(open) => { if (!open) setConfirmarEliminar(null) }}
        title="Eliminar plantilla"
        description={`¿Eliminar "${confirmarEliminar?.nombre}"? Los productos configurados con esta plantilla perderán su receta de materiales.`}
        onConfirm={handleEliminar}
        loading={eliminarPlantilla.isPending}
      />

      <ReferenciaFormDialog
        open={refFormOpen}
        onOpenChange={setRefFormOpen}
        referencia={editReferencia}
      />

      <ConfirmDialog
        open={!!confirmarEliminarRef}
        onOpenChange={(open) => { if (!open) setConfirmarEliminarRef(null) }}
        title="Eliminar referencia"
        description={`¿Eliminar "${confirmarEliminarRef?.nombre}"? Los configuradores que usen esta referencia perderán las medidas de corte.`}
        onConfirm={handleEliminarReferencia}
        loading={eliminarReferencia.isPending}
      />
    </div>
  )
}
