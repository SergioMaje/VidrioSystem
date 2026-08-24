import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Banknote, Download, FileSpreadsheet, Landmark, TrendingUp } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { supabase } from '@/lib/supabase'
import { fechaISOLocal, finDeDia, formatCOP, formatDuracion, formatFecha, formatFechaHora, formatHora } from '@/lib/utils'
import { useHistorialCaja, useResumenSesiones } from '@/hooks/useCajaSesiones'
import type { SesionCajaHistorial } from '@/hooks/useCajaSesiones'
import { useVentasPeriodo } from '@/hooks/useVentasCaja'
import { ResumenVentasSesion } from '@/pages/caja/CajaPage'
import { TIPO_PAGO_LABEL, origenDeVenta } from '@/lib/pagos'
import type { Venta } from '@/types/database'

type ItemValorizado = {
  id: string
  nombre: string
  codigo: string
  stock_actual: number
  precio_costo: number
  valor_total: number
  categoria: string
  unidad: string
}

type CotizacionReporte = {
  id: string
  numero: string
  created_at: string
  estado: string
  total: number
  cliente: string
  items_count: number
}

/** Debe cubrir el enum `estado_cotizacion` completo, o el estado cae al fallback gris. */
const ESTADO_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline'> = {
  borrador: 'secondary',
  enviada: 'default',
  aprobada: 'success',
  rechazada: 'destructive',
  vencida: 'warning',
  vendida: 'success',
}

type MetodoPago = Venta['metodo_pago']

const METODO_LABEL: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
}

const METODO_VARIANTS: Record<MetodoPago, 'default' | 'secondary' | 'success'> = {
  efectivo: 'success',
  transferencia: 'default',
  tarjeta: 'secondary',
}

type ResumenDia = {
  fecha: string
  efectivo: number
  transferencia: number
  tarjeta: number
  total: number
}

function exportarCSV(filas: string[][], nombreArchivo: string) {
  const contenido = filas.map((fila) => fila.map((celda) => `"${String(celda).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  a.click()
  URL.revokeObjectURL(url)
}

export function ReportesPage() {
  // Fecha local, no UTC: `toISOString()` ya adelanta el día a las 7 p.m. en Colombia.
  const hoy = fechaISOLocal(new Date())
  const hace30 = fechaISOLocal(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))

  const [desde, setDesde] = useState(hace30)
  const [hasta, setHasta] = useState(hoy)
  const [sesionDetalle, setSesionDetalle] = useState<SesionCajaHistorial | null>(null)

  const { data: historialCaja, isLoading: loadingCaja } = useHistorialCaja()
  const { data: resumenSesiones } = useResumenSesiones()

  const { data: inventario, isLoading: loadingInv } = useQuery({
    queryKey: ['reporte_inventario'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items_inventario')
        .select('id, nombre, codigo, stock_actual, precio_costo, categoria:categorias(nombre), unidad_medida:unidades_medida(simbolo)')
        .eq('activo', true)
        .order('nombre')
      if (error) throw error

      return (data ?? []).map((item) => ({
        id: item.id,
        nombre: item.nombre,
        codigo: item.codigo,
        stock_actual: item.stock_actual,
        precio_costo: item.precio_costo,
        valor_total: item.stock_actual * item.precio_costo,
        categoria: (item.categoria as unknown as { nombre: string } | null)?.nombre ?? '—',
        unidad: (item.unidad_medida as unknown as { simbolo: string } | null)?.simbolo ?? '—',
      })) as ItemValorizado[]
    },
  })

  const { data: ventas, isLoading: loadingVentas } = useQuery({
    queryKey: ['reporte_ventas', desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cotizaciones')
        .select('id, numero, created_at, estado, total, cliente:clientes(nombre, apellido), cotizacion_items(id)')
        .gte('created_at', desde)
        .lt('created_at', finDeDia(hasta))
        .order('created_at', { ascending: false })
      if (error) throw error

      return (data ?? []).map((c) => {
        const cliente = c.cliente as unknown as { nombre: string; apellido: string } | null
        const items = c.cotizacion_items as { id: string }[] | null
        return {
          id: c.id,
          numero: c.numero,
          created_at: c.created_at,
          estado: c.estado,
          total: c.total ?? 0,
          cliente: cliente ? `${cliente.nombre} ${cliente.apellido}` : '—',
          items_count: items?.length ?? 0,
        } as CotizacionReporte
      })
    },
    enabled: !!desde && !!hasta,
  })

  const { data: ingresos, isLoading: loadingIngresos } = useVentasPeriodo(desde, hasta)

  // Ingresos separados por destino del dinero: efectivo = cajón físico, bancario = cuentas
  const totalesMetodo: Record<MetodoPago, number> = { efectivo: 0, tarjeta: 0, transferencia: 0 }
  for (const v of ingresos ?? []) totalesMetodo[v.metodo_pago] += v.monto
  const totalBancario = totalesMetodo.transferencia + totalesMetodo.tarjeta
  const totalIngresos = totalesMetodo.efectivo + totalBancario

  const resumenPorDia: ResumenDia[] = (() => {
    const mapa = new Map<string, ResumenDia>()
    for (const v of ingresos ?? []) {
      // Fecha local (no UTC): una venta de la tarde no debe contarse en el día siguiente
      const fecha = fechaISOLocal(v.created_at)
      const dia = mapa.get(fecha) ?? { fecha, efectivo: 0, transferencia: 0, tarjeta: 0, total: 0 }
      dia[v.metodo_pago] += v.monto
      dia.total += v.monto
      mapa.set(fecha, dia)
    }
    return Array.from(mapa.values()).sort((a, b) => b.fecha.localeCompare(a.fecha))
  })()

  const totalInventario = inventario?.reduce((acc, item) => acc + item.valor_total, 0) ?? 0
  const totalVentas = ventas?.reduce((acc, cot) => acc + cot.total, 0) ?? 0
  const totalVendidas = ventas?.filter((c) => c.estado === 'vendida').reduce((acc, c) => acc + c.total, 0) ?? 0

  const exportarInventario = () => {
    if (!inventario) return
    const encabezado = ['Código', 'Nombre', 'Categoría', 'Unidad', 'Stock', 'Costo unitario', 'Valor total']
    const filas = inventario.map((item) => [
      item.codigo,
      item.nombre,
      item.categoria,
      item.unidad,
      String(item.stock_actual),
      String(item.precio_costo),
      String(item.valor_total),
    ])
    exportarCSV([encabezado, ...filas], `inventario_valorizado_${hoy}.csv`)
  }

  const exportarVentas = () => {
    if (!ventas) return
    const encabezado = ['N° Cotización', 'Fecha', 'Cliente', 'Estado', 'Items', 'Total COP']
    const filas = ventas.map((c) => [
      c.numero,
      formatFecha(c.created_at),
      c.cliente,
      c.estado,
      String(c.items_count),
      String(c.total),
    ])
    exportarCSV([encabezado, ...filas], `ventas_${desde}_${hasta}.csv`)
  }

  const exportarResumenIngresos = () => {
    if (!resumenPorDia.length) return
    const encabezado = ['Fecha', 'Efectivo COP', 'Transferencia COP', 'Tarjeta COP', 'Total COP']
    const filas = resumenPorDia.map((d) => [
      d.fecha,
      String(d.efectivo),
      String(d.transferencia),
      String(d.tarjeta),
      String(d.total),
    ])
    const totales = ['TOTAL', String(totalesMetodo.efectivo), String(totalesMetodo.transferencia), String(totalesMetodo.tarjeta), String(totalIngresos)]
    exportarCSV([encabezado, ...filas, totales], `ingresos-resumen-${desde}_${hasta}.csv`)
  }

  const exportarDetalleIngresos = () => {
    if (!ingresos?.length) return
    const encabezado = ['Fecha y hora', 'N° Documento', 'Cliente', 'Tipo', 'Método', 'Destino', 'Vendedor', 'Monto COP']
    const filas = ingresos.map((v) => {
      const origen = origenDeVenta(v)
      return [
        formatFechaHora(v.created_at),
        origen.numero,
        origen.cliente,
        TIPO_PAGO_LABEL[v.tipo],
        METODO_LABEL[v.metodo_pago],
        v.metodo_pago === 'efectivo' ? 'Caja' : 'Cuentas',
        v.usuario ? `${v.usuario.nombre} ${v.usuario.apellido}` : '—',
        String(v.monto),
      ]
    })
    exportarCSV([encabezado, ...filas], `ingresos-detalle-${desde}_${hasta}.csv`)
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="inventario">
        <TabsList>
          <TabsTrigger value="inventario">Inventario valorizado</TabsTrigger>
          <TabsTrigger value="ventas">Ventas por período</TabsTrigger>
          <TabsTrigger value="ingresos">Ingresos</TabsTrigger>
          <TabsTrigger value="caja">Caja</TabsTrigger>
        </TabsList>

        {/* ── Tab Inventario ────────────────────────────────────── */}
        <TabsContent value="inventario" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                Valor total en stock:{' '}
                <span className="font-semibold text-foreground">{formatCOP(totalInventario)}</span>
              </p>
            </div>
            <Button variant="outline" onClick={exportarInventario} disabled={!inventario}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {loadingInv ? (
                <LoadingSpinner className="py-12" />
              ) : !inventario || inventario.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">No hay items en inventario</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-xs font-medium uppercase text-muted-foreground">
                        <th className="px-4 py-3 text-left">Código</th>
                        <th className="px-4 py-3 text-left">Nombre</th>
                        <th className="px-4 py-3 text-left">Categoría</th>
                        <th className="px-4 py-3 text-right">Stock</th>
                        <th className="px-4 py-3 text-right">Costo unit.</th>
                        <th className="px-4 py-3 text-right">Valor total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventario.map((item) => (
                        <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.codigo}</td>
                          <td className="px-4 py-3 font-medium">{item.nombre}</td>
                          <td className="px-4 py-3 text-muted-foreground">{item.categoria}</td>
                          <td className="px-4 py-3 text-right font-mono">
                            {item.stock_actual} {item.unidad}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{formatCOP(item.precio_costo)}</td>
                          <td className="px-4 py-3 text-right font-semibold">{formatCOP(item.valor_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/50">
                        <td colSpan={5} className="px-4 py-3 text-right text-xs font-semibold uppercase text-muted-foreground">
                          Total valorizado
                        </td>
                        <td className="px-4 py-3 text-right font-bold">{formatCOP(totalInventario)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab Ventas ────────────────────────────────────────── */}
        <TabsContent value="ventas" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Filtrar por período</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Desde</Label>
                  <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hasta</Label>
                  <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
                </div>
              </div>
            </CardContent>
          </Card>

          {ventas && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="flex items-center gap-4 p-5">
                  <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="text-2xl font-bold">{ventas.length}</p>
                    <p className="text-xs text-muted-foreground">Cotizaciones en el período</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex items-center gap-4 p-5">
                  <TrendingUp className="h-8 w-8 text-green-600" />
                  <div>
                    <p className="text-2xl font-bold">{formatCOP(totalVendidas)}</p>
                    <p className="text-xs text-muted-foreground">Ventas concretadas</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex items-center gap-4 p-5">
                  <FileSpreadsheet className="h-8 w-8 text-blue-600" />
                  <div>
                    <p className="text-2xl font-bold">{formatCOP(totalVentas)}</p>
                    <p className="text-xs text-muted-foreground">Total facturado (todas)</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {ventas ? `${ventas.length} cotizaciones encontradas` : ''}
            </p>
            <Button variant="outline" onClick={exportarVentas} disabled={!ventas || ventas.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {loadingVentas ? (
                <LoadingSpinner className="py-12" />
              ) : !ventas || ventas.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No hay cotizaciones en el período seleccionado
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-xs font-medium uppercase text-muted-foreground">
                        <th className="px-4 py-3 text-left">N° Cotización</th>
                        <th className="px-4 py-3 text-left">Fecha</th>
                        <th className="px-4 py-3 text-left">Cliente</th>
                        <th className="px-4 py-3 text-center">Estado</th>
                        <th className="px-4 py-3 text-right">Items</th>
                        <th className="px-4 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ventas.map((cot) => (
                        <tr key={cot.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3 font-mono text-xs font-medium">{cot.numero}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatFecha(cot.created_at)}</td>
                          <td className="px-4 py-3">{cot.cliente}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant={ESTADO_VARIANTS[cot.estado] ?? 'secondary'} className="capitalize">
                              {cot.estado}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{cot.items_count}</td>
                          <td className="px-4 py-3 text-right font-semibold">{formatCOP(cot.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/50">
                        <td colSpan={5} className="px-4 py-3 text-right text-xs font-semibold uppercase text-muted-foreground">
                          Total vendidas
                        </td>
                        <td className="px-4 py-3 text-right font-bold">{formatCOP(totalVendidas)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab Ingresos ──────────────────────────────────────── */}
        <TabsContent value="ingresos" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Filtrar por período</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Desde</Label>
                  <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hasta</Label>
                  <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="flex items-start gap-4 p-5">
                <Banknote className="h-8 w-8 shrink-0 text-emerald-600" />
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase text-muted-foreground">En caja — Efectivo</p>
                  <p className="text-3xl font-bold">{formatCOP(totalesMetodo.efectivo)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Debe estar físicamente en la caja</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-start gap-4 p-5">
                <Landmark className="h-8 w-8 shrink-0 text-blue-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase text-muted-foreground">En cuentas — Bancario</p>
                  <p className="text-3xl font-bold">{formatCOP(totalBancario)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Debe estar en las cuentas bancarias</p>
                  <div className="mt-2 space-y-0.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Transferencia</span>
                      <span className="font-mono">{formatCOP(totalesMetodo.transferencia)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tarjeta</span>
                      <span className="font-mono">{formatCOP(totalesMetodo.tarjeta)}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-sm text-muted-foreground">
            Total de ingresos del período:{' '}
            <span className="font-semibold text-foreground">{formatCOP(totalIngresos)}</span>
            {' · '}
            {ingresos?.length ?? 0} ventas
          </p>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Resumen por día</h3>
            <Button variant="outline" onClick={exportarResumenIngresos} disabled={resumenPorDia.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {loadingIngresos ? (
                <LoadingSpinner className="py-12" />
              ) : resumenPorDia.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No hay ingresos en el período seleccionado
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-xs font-medium uppercase text-muted-foreground">
                        <th className="px-4 py-3 text-left">Fecha</th>
                        <th className="px-4 py-3 text-right">Efectivo</th>
                        <th className="px-4 py-3 text-right">Transferencia</th>
                        <th className="px-4 py-3 text-right">Tarjeta</th>
                        <th className="px-4 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumenPorDia.map((dia) => (
                        <tr key={dia.fecha} className="border-b last:border-0 hover:bg-muted/30">
                          {/* 'T00:00:00' fuerza interpretación local; sin él se parsea como UTC */}
                          <td className="px-4 py-3 font-medium">{formatFecha(dia.fecha + 'T00:00:00')}</td>
                          <td className="px-4 py-3 text-right font-mono">{formatCOP(dia.efectivo)}</td>
                          <td className="px-4 py-3 text-right font-mono">{formatCOP(dia.transferencia)}</td>
                          <td className="px-4 py-3 text-right font-mono">{formatCOP(dia.tarjeta)}</td>
                          <td className="px-4 py-3 text-right font-semibold">{formatCOP(dia.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/50">
                        <td className="px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Total</td>
                        <td className="px-4 py-3 text-right font-bold">{formatCOP(totalesMetodo.efectivo)}</td>
                        <td className="px-4 py-3 text-right font-bold">{formatCOP(totalesMetodo.transferencia)}</td>
                        <td className="px-4 py-3 text-right font-bold">{formatCOP(totalesMetodo.tarjeta)}</td>
                        <td className="px-4 py-3 text-right font-bold">{formatCOP(totalIngresos)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Detalle de ingresos</h3>
            <Button variant="outline" onClick={exportarDetalleIngresos} disabled={!ingresos || ingresos.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {loadingIngresos ? (
                <LoadingSpinner className="py-12" />
              ) : !ingresos || ingresos.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No hay ingresos en el período seleccionado
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-xs font-medium uppercase text-muted-foreground">
                        <th className="px-4 py-3 text-left">Fecha y hora</th>
                        <th className="px-4 py-3 text-left">N° Documento</th>
                        <th className="px-4 py-3 text-left">Cliente</th>
                        <th className="px-4 py-3 text-left">Tipo</th>
                        <th className="px-4 py-3 text-center">Método</th>
                        <th className="px-4 py-3 text-left">Vendedor</th>
                        <th className="px-4 py-3 text-right">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ingresos.map((v) => {
                        const origen = origenDeVenta(v)
                        return (
                        <tr key={v.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3 text-muted-foreground">{formatFechaHora(v.created_at)}</td>
                          <td className="px-4 py-3 font-mono text-xs font-medium">{origen.numero}</td>
                          <td className="px-4 py-3">{origen.cliente}</td>
                          <td className="px-4 py-3 text-muted-foreground">{TIPO_PAGO_LABEL[v.tipo]}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant={METODO_VARIANTS[v.metodo_pago]}>{METODO_LABEL[v.metodo_pago]}</Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {v.usuario ? `${v.usuario.nombre} ${v.usuario.apellido}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">{formatCOP(v.monto)}</td>
                        </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/50">
                        <td colSpan={6} className="px-4 py-3 text-right text-xs font-semibold uppercase text-muted-foreground">
                          Total ingresos
                        </td>
                        <td className="px-4 py-3 text-right font-bold">{formatCOP(totalIngresos)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab Caja ──────────────────────────────────────────── */}
        <TabsContent value="caja" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Historial de cierres de caja</CardTitle>
              <p className="text-xs text-muted-foreground">
                Abre <span className="font-medium">Ver detalle</span> para el desglose por método de pago,
                los pagos del turno y el arqueo completo.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {loadingCaja ? (
                <LoadingSpinner className="py-12" />
              ) : !historialCaja || historialCaja.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">Aún no hay cierres de caja registrados</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
                        <th className="px-4 py-3">Apertura</th>
                        <th className="px-4 py-3 text-right">Duración</th>
                        <th className="px-4 py-3">Cerró</th>
                        <th className="px-4 py-3 text-right">Total cobrado</th>
                        <th className="px-4 py-3 text-right">Diferencia</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {historialCaja.map((sesion) => {
                        const resumen = resumenSesiones?.get(sesion.id)
                        return (
                        <tr key={sesion.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3 text-muted-foreground">{formatFechaHora(sesion.opened_at)}</td>
                          <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                            {sesion.closed_at ? formatDuracion(sesion.opened_at, sesion.closed_at) : '—'}
                          </td>
                          <td className="px-4 py-3">{sesion.cerrada_por ? `${sesion.cerrada_por.nombre} ${sesion.cerrada_por.apellido}` : '—'}</td>
                          <td className="px-4 py-3 text-right font-semibold">{resumen ? formatCOP(resumen.total_cobrado) : '—'}</td>
                          <td className="px-4 py-3 text-right font-mono">
                            {sesion.difference != null ? (
                              <span className={sesion.difference === 0 ? '' : sesion.difference > 0 ? 'text-emerald-600' : 'text-destructive'}>
                                {formatCOP(sesion.difference)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button size="sm" variant="outline" onClick={() => setSesionDetalle(sesion)}>Ver detalle</Button>
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
        </TabsContent>
      </Tabs>

      <Dialog open={!!sesionDetalle} onOpenChange={(o) => !o && setSesionDetalle(null)}>
        <DialogContent className="max-w-2xl">
          {sesionDetalle && (
            <>
              <DialogHeader>
                <DialogTitle>Turno del {formatFecha(sesionDetalle.opened_at)}</DialogTitle>
                <p className="text-sm text-muted-foreground">
                  {formatHora(sesionDetalle.opened_at)}
                  {' → '}
                  {sesionDetalle.closed_at ? formatHora(sesionDetalle.closed_at) : '—'}
                  {sesionDetalle.closed_at && ` · ${formatDuracion(sesionDetalle.opened_at, sesionDetalle.closed_at)}`}
                </p>
              </DialogHeader>

              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className="text-muted-foreground">
                  Abrió:{' '}
                  <span className="text-foreground">
                    {sesionDetalle.abierta_por
                      ? `${sesionDetalle.abierta_por.nombre} ${sesionDetalle.abierta_por.apellido}`
                      : '—'}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Cerró:{' '}
                  <span className="text-foreground">
                    {sesionDetalle.cerrada_por
                      ? `${sesionDetalle.cerrada_por.nombre} ${sesionDetalle.cerrada_por.apellido}`
                      : '—'}
                  </span>
                </span>
              </div>

              <ResumenVentasSesion
                sessionId={sesionDetalle.id}
                openingAmount={sesionDetalle.opening_amount}
                arqueo={sesionDetalle}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
