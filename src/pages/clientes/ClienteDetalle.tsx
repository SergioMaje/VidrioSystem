import { useState } from 'react'
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Building2, User, Pencil, FileText, ClipboardList, ShoppingBag } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { EmptyState } from '@/components/shared/EmptyState'
import type { OrigenNavegacion } from '@/components/shared/EnlaceDocumento'
import { BadgeAnulada } from '@/pages/caja/AnularVentaDialog'
import { ClienteFormDialog } from './ClienteFormDialog'
import { useCliente } from '@/hooks/useClientes'
import {
  useCotizacionesDeCliente,
  useOrdenesDeCliente,
  useSaldosDeCotizaciones,
  useVentasMostradorDeCliente,
  type OrdenDeCliente,
} from '@/hooks/useHistorialCliente'
import { ESTADOS_COTIZACION_CONFIG, textoOpcion } from '@/lib/cotizaciones'
import { ESTADOS_ORDEN_CONFIG, ESTADOS_ACTIVOS } from '@/lib/estadosOrden'
import { etiquetaDocumento } from '@/lib/imprimirCotizacion'
import { estaLiquidada } from '@/lib/pagos'
import { formatCOP, formatFecha } from '@/lib/utils'
import type { Cotizacion, CotizacionSaldo, VentaMostrador } from '@/types/database'
import { FILA_NAVEGABLE, filaNavegableClase } from '@/lib/navegacionTeclado'

const TABS = ['cotizaciones', 'trabajos', 'mostrador']

const TH = 'px-4 py-3'
const THEAD_ROW = 'border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground'

export function ClienteDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // La pestaña va en la URL: al volver de una cotización u orden se abre la misma.
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = TABS.includes(searchParams.get('tab') ?? '') ? (searchParams.get('tab') as string) : 'cotizaciones'
  const cambiarTab = (t: string) => setSearchParams(t === 'cotizaciones' ? {} : { tab: t }, { replace: true })
  const [editarOpen, setEditarOpen] = useState(false)

  const { data: cliente, isLoading } = useCliente(id!)
  const { data: cotizaciones, isLoading: cargandoCot } = useCotizacionesDeCliente(id!)
  const { data: ordenes, isLoading: cargandoOrdenes } = useOrdenesDeCliente(id!)
  const { data: ventasMostrador } = useVentasMostradorDeCliente(id!)

  const vendidas = cotizaciones?.filter((c) => c.estado === 'vendida') ?? []
  const { data: saldos } = useSaldosDeCotizaciones((cotizaciones ?? []).map((c) => c.id))

  if (isLoading) return <LoadingSpinner className="py-12" />
  if (!cliente) {
    return <EmptyState icon={User} title="Cliente no encontrado" description="Vuelve a la lista de clientes" />
  }

  // Lo que el cliente ha comprado de verdad: cotizaciones vendidas (una anulada
  // ya no cuenta) y ventas de mostrador no anuladas.
  const mostradorVigente = ventasMostrador?.filter((v) => !v.anulado_at) ?? []
  const totalComprado =
    vendidas.reduce((s, c) => s + c.total, 0) + mostradorVigente.reduce((s, v) => s + v.total, 0)
  const saldoPendiente = vendidas.reduce((s, c) => {
    const saldo = saldos?.get(c.id)?.saldo ?? 0
    return estaLiquidada(saldo) ? s : s + saldo
  }, 0)
  const entregados = ordenes?.filter((o) => o.estado === 'entregada').length ?? 0
  const enCurso = ordenes?.filter((o) => ESTADOS_ACTIVOS.includes(o.estado)).length ?? 0

  const origen: OrigenNavegacion = { desde: location.pathname + location.search, desdeEtiqueta: 'Cliente' }
  const tieneMostrador = (ventasMostrador?.length ?? 0) > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button data-volver variant="ghost" size="sm" onClick={() => navigate('/clientes')} title="Volver a clientes">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              {cliente.tipo === 'juridico'
                ? <Building2 className="h-5 w-5 text-muted-foreground" />
                : <User className="h-5 w-5 text-muted-foreground" />}
              <div>
                <h2 className="text-xl font-bold">{cliente.nombre} {cliente.apellido}</h2>
                {cliente.empresa && <p className="text-sm text-muted-foreground">{cliente.empresa}</p>}
              </div>
              <Badge variant="secondary" className="capitalize">{cliente.tipo}</Badge>
              {!cliente.activo && <Badge variant="destructive">Inactivo</Badge>}
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditarOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Editar ficha
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Dato titulo={etiquetaDocumento(cliente.tipo)} valor={cliente.documento} />
            <Dato titulo="Teléfono" valor={cliente.telefono} />
            <Dato titulo="Correo" valor={cliente.email} />
            <Dato titulo="Ciudad" valor={cliente.ciudad} />
            <div className="sm:col-span-2 lg:col-span-4">
              <Dato titulo="Dirección" valor={cliente.direccion} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Resumen
          titulo="Cotizaciones"
          valor={String(cotizaciones?.length ?? 0)}
          detalle={`${vendidas.length} vendida${vendidas.length === 1 ? '' : 's'}`}
        />
        <Resumen titulo="Trabajos entregados" valor={String(entregados)} detalle={`${enCurso} en curso`} />
        <Resumen titulo="Total comprado" valor={formatCOP(totalComprado)} />
        <Resumen
          titulo="Saldo pendiente"
          valor={formatCOP(saldoPendiente)}
          destacado={saldoPendiente > 0}
        />
      </div>

      <Tabs value={tab} onValueChange={cambiarTab}>
        <TabsList data-pestanas-flechas>
          <TabsTrigger value="cotizaciones">Cotizaciones</TabsTrigger>
          <TabsTrigger value="trabajos">Trabajos</TabsTrigger>
          {tieneMostrador && <TabsTrigger value="mostrador">Mostrador</TabsTrigger>}
        </TabsList>

        <TabsContent value="cotizaciones">
          <TablaCotizaciones
            cotizaciones={cotizaciones}
            cargando={cargandoCot}
            saldos={saldos}
            onAbrir={(cotId) => navigate(`/cotizaciones/${cotId}`, { state: origen })}
          />
        </TabsContent>
        <TabsContent value="trabajos">
          <TablaTrabajos
            ordenes={ordenes}
            cargando={cargandoOrdenes}
            onAbrir={(ordenId) => navigate(`/ordenes/${ordenId}`, { state: origen })}
          />
        </TabsContent>
        <TabsContent value="mostrador">
          <TablaMostrador ventas={ventasMostrador} />
        </TabsContent>
      </Tabs>

      <ClienteFormDialog open={editarOpen} onOpenChange={setEditarOpen} cliente={cliente} />
    </div>
  )
}

function Dato({ titulo, valor }: { titulo: string; valor: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p>{valor || '—'}</p>
    </div>
  )
}

function Resumen({ titulo, valor, detalle, destacado }: { titulo: string; valor: string; detalle?: string; destacado?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
        <p className={`mt-1 text-lg font-bold tabular-nums ${destacado ? 'text-amber-700' : ''}`}>{valor}</p>
        {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
      </CardContent>
    </Card>
  )
}

function TablaCotizaciones({
  cotizaciones,
  cargando,
  saldos,
  onAbrir,
}: {
  cotizaciones: Cotizacion[] | undefined
  cargando: boolean
  saldos: Map<string, CotizacionSaldo> | undefined
  onAbrir: (id: string) => void
}) {
  return (
    <Card>
      <CardContent className="p-0">
        {cargando ? (
          <LoadingSpinner className="py-12" />
        ) : !cotizaciones?.length ? (
          <EmptyState icon={FileText} title="Sin cotizaciones" description="Este cliente aún no tiene cotizaciones" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={TH}>Número</th>
                  <th className={TH}>Fecha</th>
                  <th className={TH}>Estado</th>
                  <th className={`${TH} text-right`}>Total</th>
                  <th className={`${TH} text-right`}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {cotizaciones.map((c) => {
                  const estado = ESTADOS_COTIZACION_CONFIG[c.estado]
                  const opcion = textoOpcion(c)
                  // Solo una vendida tiene un saldo que el cliente deba.
                  const saldo = c.estado === 'vendida' ? saldos?.get(c.id)?.saldo : undefined
                  return (
                    <tr key={c.id} {...FILA_NAVEGABLE} className={`cursor-pointer border-b transition-colors hover:bg-muted/30 ${filaNavegableClase}`} onClick={() => onAbrir(c.id)}>
                      <td className={TH}>
                        <p className="font-medium text-primary">{c.numero}</p>
                        {opcion && <p className="text-xs text-muted-foreground">{opcion}</p>}
                      </td>
                      <td className={`${TH} text-muted-foreground`}>{formatFecha(c.fecha_emision)}</td>
                      <td className={TH}><Badge variant={estado.variant}>{estado.label}</Badge></td>
                      <td className={`${TH} text-right tabular-nums`}>{formatCOP(c.total)}</td>
                      <td className={`${TH} text-right tabular-nums`}>
                        {saldo === undefined
                          ? <span className="text-muted-foreground">—</span>
                          : estaLiquidada(saldo)
                            ? <span className="text-green-700">Pagada</span>
                            : <span className="text-amber-700">{formatCOP(saldo)}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

type FiltroTrabajos = 'todos' | 'en_curso' | 'entregados'

function TablaTrabajos({
  ordenes,
  cargando,
  onAbrir,
}: {
  ordenes: OrdenDeCliente[] | undefined
  cargando: boolean
  onAbrir: (id: string) => void
}) {
  const [filtro, setFiltro] = useState<FiltroTrabajos>('todos')
  const filtradas = (ordenes ?? []).filter((o) =>
    filtro === 'todos' ? true : filtro === 'entregados' ? o.estado === 'entregada' : ESTADOS_ACTIVOS.includes(o.estado)
  )

  return (
    <Card>
      <CardContent className="p-0">
        {cargando ? (
          <LoadingSpinner className="py-12" />
        ) : !ordenes?.length ? (
          <EmptyState icon={ClipboardList} title="Sin trabajos" description="Los trabajos aparecen cuando se cobra el anticipo de una cotización" />
        ) : (
          <>
            <div className="flex gap-2 border-b p-3">
              {([['todos', 'Todos'], ['en_curso', 'En curso'], ['entregados', 'Entregados']] as const).map(([valor, label]) => (
                <Button key={valor} size="sm" variant={filtro === valor ? 'default' : 'outline'} onClick={() => setFiltro(valor)}>
                  {label}
                </Button>
              ))}
            </div>
            {filtradas.length === 0 ? (
              <EmptyState icon={ClipboardList} title="Nada en este filtro" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={THEAD_ROW}>
                      <th className={TH}>Orden</th>
                      <th className={TH}>Cotización</th>
                      <th className={TH}>Estado</th>
                      <th className={TH}>Inicio</th>
                      <th className={TH}>Entrega</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtradas.map((o) => {
                      const estado = ESTADOS_ORDEN_CONFIG[o.estado]
                      const entrega = o.fecha_entrega_real ?? o.fecha_entrega_estimada
                      return (
                        <tr key={o.id} {...FILA_NAVEGABLE} className={`cursor-pointer border-b transition-colors hover:bg-muted/30 ${filaNavegableClase}`} onClick={() => onAbrir(o.id)}>
                          <td className={`${TH} font-medium text-primary`}>{o.numero}</td>
                          <td className={`${TH} text-muted-foreground`}>{o.cotizacion?.numero ?? '—'}</td>
                          <td className={TH}><Badge variant={estado.variant}>{estado.label}</Badge></td>
                          <td className={`${TH} text-muted-foreground`}>{o.fecha_inicio ? formatFecha(o.fecha_inicio) : '—'}</td>
                          <td className={TH}>
                            {entrega ? formatFecha(entrega) : '—'}
                            {entrega && !o.fecha_entrega_real && <span className="ml-1 text-xs text-muted-foreground">(estimada)</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TablaMostrador({ ventas }: { ventas: VentaMostrador[] | undefined }) {
  if (!ventas?.length) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState icon={ShoppingBag} title="Sin compras de mostrador" />
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Número</th>
                <th className={TH}>Fecha</th>
                <th className={`${TH} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((v) => (
                <tr key={v.id} className="border-b">
                  <td className={`${TH} font-medium`}>
                    <span className={v.anulado_at ? 'line-through text-muted-foreground' : ''}>{v.numero}</span>
                    {v.anulado_at && <BadgeAnulada motivo={v.motivo_anulacion} />}
                  </td>
                  <td className={`${TH} text-muted-foreground`}>{formatFecha(v.created_at)}</td>
                  <td className={`${TH} text-right tabular-nums`}>{formatCOP(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
