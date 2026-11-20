import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, FileText, ImageDown, Loader2, Printer, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useCajaActual } from '@/hooks/useCajaSesiones'
import { useRegistrarAnticipo, useRegistrarAbono, useSaldoCotizacion } from '@/hooks/useVentasCaja'
import { useAuth } from '@/hooks/useAuth'
import { useFinancieras } from '@/hooks/useFinancieras'
import { useConfiguracionEmpresa, useLogoEmpresaDataUri } from '@/hooks/useConfiguracionEmpresa'
import { cobroPorClave } from '@/hooks/useRecibos'
import { cuentaCobroVigente, useAprobarCredito } from '@/hooks/useCartera'
import { useCuentasPagoEmpresa } from '@/hooks/useCuentasPagoEmpresa'
import { descargarReciboImagen, imprimirRecibo } from '@/lib/imprimirRecibo'
import { descargarCuentaCobroImagen, imprimirCuentaCobro } from '@/lib/imprimirCuentaCobro'
import { useToast } from '@/hooks/useToast'
import { useAtajoConfirmar } from '@/hooks/useAtajoConfirmar'
import { PistaConfirmar } from '@/components/shared/Kbd'
import { CamposFinanciera } from '@/components/shared/CamposFinanciera'
import { InputDinero } from '@/components/shared/InputDinero'
import { cajaVencida } from '@/lib/caja'
import { METODO_PAGO_LABEL, anticipoMinimo, anticipoSolicitado, cumpleAnticipoMinimo, esVentaCredito, excedeSaldo } from '@/lib/pagos'
import { formatCOP, formatFecha, mensajeError } from '@/lib/utils'
import type { Cotizacion, MetodoPago, Venta } from '@/types/database'

type Props = {
  cotizacion: Cotizacion
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Opciones del mismo envío que quedarán descartadas al cobrar el anticipo de esta. */
  opcionesADescartar?: string[]
}

/**
 * Cobra un pago de la cotización. El primer pago es el anticipo —cierra la venta,
 * crea la orden y exige el mínimo del 50%—; los siguientes son abonos libres.
 * Cuál de los dos es no lo decide quien abre el diálogo sino lo ya abonado, para
 * que la regla del mínimo no dependa del punto de entrada.
 *
 * Un admin puede registrar el anticipo en $0: la venta se cierra a crédito, sin
 * caja, y en lugar del recibo queda la cuenta de cobro por el total, que el
 * cliente paga después de la entrega (aprobar_cotizacion_credito).
 */
export function RegistrarPagoDialog({ cotizacion, open, onOpenChange, opcionesADescartar = [] }: Props) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { usuario } = useAuth()
  const { data: sesionCaja } = useCajaActual()
  const { data: saldoInfo, isSuccess: saldoListo } = useSaldoCotizacion(cotizacion.id)
  const registrarAnticipo = useRegistrarAnticipo()
  const registrarAbono = useRegistrarAbono()
  const aprobarCredito = useAprobarCredito()

  const total = cotizacion.total
  const abonado = saldoInfo?.total_abonado ?? 0
  const saldo = saldoInfo?.saldo ?? total
  const minimo = anticipoMinimo(total)
  // Lo que dice la cotización (Configuración). Es solo el monto sugerido: el
  // cobro sigue aceptando desde el mínimo.
  // isFetched y no isSuccess: si la consulta falla, se precarga el mínimo igual.
  const { data: empresa, isFetched: empresaLista } = useConfiguracionEmpresa()
  const pctSolicitado = empresa?.anticipo_solicitado_pct
  const sugeridoAnticipo = pctSolicitado ? Math.max(minimo, anticipoSolicitado(pctSolicitado, total)) : minimo
  const esAdmin = usuario?.rol === 'admin'
  // Mientras el saldo no ha cargado se asume anticipo: es el lado que exige el
  // mínimo, así nunca se ofrece un cobro más laxo del que corresponde. Una venta
  // a crédito ya está vendida y produciendo: todo lo que paga es abono.
  const esAnticipo = abonado <= 0 && !esVentaCredito(cotizacion)
  // Pago en $0 = cuenta de cobro. Solo el primer pago y solo un admin; las
  // opciones de un envío por categorías se aprueban desde su pedido.
  const puedeCuentaCobro = esAdmin && esAnticipo && !cotizacion.categoria_id

  const [monto, setMonto] = useState('')
  const [ordenCompra, setOrdenCompra] = useState('')
  const [metodoPago, setMetodoPago] = useState<Venta['metodo_pago']>('efectivo')
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [autorizar, setAutorizar] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [financieraId, setFinancieraId] = useState('')
  const [referencia, setReferencia] = useState('')
  const [inicializado, setInicializado] = useState(false)
  // Una clave por apertura del diálogo: si el mismo cobro llega dos veces (doble
  // clic antes de que se deshabilite el botón, reintento tras un corte de red),
  // la base lo reconoce y no cobra de nuevo. Se renueva al reabrir.
  const [claveIdempotencia, setClaveIdempotencia] = useState(() => crypto.randomUUID())
  // `isPending` tarda un render en deshabilitar el botón; este ref corta el
  // segundo clic en el mismo instante.
  const enviando = useRef(false)
  // Tras cobrar, el diálogo no se cierra: muestra el número de recibo para
  // imprimirlo en el acto. id null = el cobro entró pero no se pudo releer.
  // Con pago en $0 lo registrado es la cuenta de cobro, no un recibo.
  const [registrado, setRegistrado] = useState<{
    tipo: 'recibo' | 'cuenta_cobro'
    id: string | null
    numero: string | null
    monto: number
  } | null>(null)
  const { data: logoEmpresa } = useLogoEmpresaDataUri()
  const { data: cuentasPago } = useCuentasPagoEmpresa(true)
  const [descargando, setDescargando] = useState(false)
  const descargarImagen = async (id: string, tipo: 'recibo' | 'cuenta_cobro') => {
    setDescargando(true)
    try {
      if (tipo === 'cuenta_cobro') {
        await descargarCuentaCobroImagen(id, { empresa, logo: logoEmpresa, cuentas: cuentasPago ?? [] })
      } else {
        await descargarReciboImagen(id, { empresa, logo: logoEmpresa })
      }
    } catch (err) {
      toast({ title: mensajeError(err, 'No se pudo descargar el documento'), variant: 'destructive' })
    } finally {
      setDescargando(false)
    }
  }
  const imprimir = (id: string, tipo: 'recibo' | 'cuenta_cobro') =>
    tipo === 'cuenta_cobro'
      ? imprimirCuentaCobro(id, { empresa, logo: logoEmpresa, cuentas: cuentasPago ?? [] })
      : imprimirRecibo(id, { empresa, logo: logoEmpresa })

  const { data: financieras } = useFinancieras(true)
  // El crédito cubre el total y no se combina: solo se ofrece como primer pago.
  const metodosDisponibles = (Object.keys(METODO_PAGO_LABEL) as MetodoPago[]).filter(
    (m) => m !== 'financiera' || (esAnticipo && (financieras?.length ?? 0) > 0)
  )
  const esFinanciera = metodoPago === 'financiera'
  const financiera = financieras?.find((f) => f.id === financieraId)

  // Al abrir se precarga el monto habitual: el anticipo que pide la cotización
  // (o el mínimo, si la vidriería no lo configuró) en el anticipo, el saldo
  // completo cuando se viene a liquidar. Se espera a conocer lo abonado —de eso
  // depende cuál de los dos es— y se hace una sola vez por apertura para no
  // pisar lo que el usuario escriba.
  useEffect(() => {
    if (!open) {
      setInicializado(false)
      setRegistrado(null)
      return
    }
    if (inicializado || !saldoListo || !empresaLista) return
    setMonto(String(esAnticipo ? sugeridoAnticipo : Math.round(saldo)))
    setMetodoPago('efectivo')
    setFechaEntrega('')
    setOrdenCompra('')
    setAutorizar(false)
    setMotivo('')
    setFinancieraId('')
    setReferencia('')
    setClaveIdempotencia(crypto.randomUUID())
    setInicializado(true)
  }, [open, inicializado, esAnticipo, sugeridoAnticipo, saldo, saldoListo, empresaLista])

  const cambiarMetodo = (metodo: MetodoPago) => {
    setMetodoPago(metodo)
    if (metodo === 'financiera') {
      // El monto deja de ser editable: la financiera paga la venta completa.
      setMonto(String(Math.round(total)))
      setAutorizar(false)
      if (!financieraId && financieras?.length === 1) setFinancieraId(financieras[0].id)
    } else if (esFinanciera) {
      setMonto(String(esAnticipo ? sugeridoAnticipo : Math.round(saldo)))
    }
  }

  const montoNum = Number(monto) || 0
  const modoCuentaCobro = puedeCuentaCobro && !esFinanciera && monto.trim() !== '' && montoNum === 0
  const bajoMinimo = !modoCuentaCobro && !esFinanciera && esAnticipo && !cumpleAnticipoMinimo(montoNum, total)
  // Siempre contra el saldo, nunca contra el total: si la cotización ya tiene
  // abonos, el total es más de lo que se puede cobrar y el trigger rechazaría el
  // pago con un saldo que la pantalla no estaba mostrando.
  const sobrepasa = excedeSaldo(montoNum, saldo)
  const requiereAutorizacion = bajoMinimo && !(esAdmin && autorizar && motivo.trim().length > 0)
  const pendiente = registrarAnticipo.isPending || registrarAbono.isPending || aprobarCredito.isPending
  const cajaLista = !!sesionCaja && !cajaVencida(sesionCaja.opened_at)
  // Sin el saldo cargado, `saldo` cae a `total` y se ofrecería cobrar de más.
  // El pago en $0 no pasa por caja: no la exige.
  const puedeConfirmar =
    saldoListo &&
    !pendiente &&
    (modoCuentaCobro ||
      (cajaLista &&
        montoNum > 0 &&
        !sobrepasa &&
        !requiereAutorizacion &&
        (!esFinanciera || (esAnticipo && !!financieraId))))

  const confirmarCuentaCobro = async () => {
    await aprobarCredito.mutateAsync({
      cotizacionId: cotizacion.id,
      fechaEntrega: fechaEntrega || null,
      ordenCompra: ordenCompra.trim() || null,
    })
    toast({ title: 'Aprobada con pago en $0 — la producción ya puede iniciar', variant: 'success' })
    // La cuenta nace en la misma transacción; si no se puede releer, igual
    // quedó y se imprime desde la cotización.
    const cc = await cuentaCobroVigente(cotizacion.id).catch(() => null)
    setRegistrado({ tipo: 'cuenta_cobro', id: cc?.id ?? null, numero: cc?.numero ?? null, monto: cc?.monto ?? total })
  }

  const handleConfirmar = async () => {
    if (!usuario || enviando.current) return
    enviando.current = true
    try {
      if (modoCuentaCobro) {
        await confirmarCuentaCobro()
        return
      }
      if (esAnticipo) {
        await registrarAnticipo.mutateAsync({
          cotizacion,
          sessionId: sesionCaja?.id,
          metodoPago,
          monto: montoNum,
          fechaEntregaEstimada: fechaEntrega || undefined,
          autorizadoPor: bajoMinimo ? usuario.id : undefined,
          motivoAutorizacion: bajoMinimo ? motivo : undefined,
          financieraId: esFinanciera ? financieraId : undefined,
          referenciaFinanciera: esFinanciera ? referencia : undefined,
          idempotencyKey: claveIdempotencia,
        })
        toast({
          title: esFinanciera
            ? 'Venta a crédito registrada — la producción ya puede iniciar'
            : 'Anticipo registrado — la producción ya puede iniciar',
          variant: 'success',
        })
      } else {
        await registrarAbono.mutateAsync({
          cotizacionId: cotizacion.id,
          sessionId: sesionCaja?.id,
          metodoPago,
          monto: montoNum,
          usuarioId: usuario.id,
          idempotencyKey: claveIdempotencia,
        })
        toast({ title: 'Abono registrado', variant: 'success' })
      }
      // El anticipo devuelve la orden y el abono no devuelve nada: el cobro se
      // busca por la clave con que entró. Si falla, el pago igual quedó; el
      // recibo se reimprime desde la tabla de pagos.
      const cobro = await cobroPorClave(claveIdempotencia).catch(() => null)
      setRegistrado({ tipo: 'recibo', id: cobro?.id ?? null, numero: cobro?.numero_recibo ?? null, monto: montoNum })
    } catch (err) {
      toast({
        title: mensajeError(err, 'Error al registrar el pago'),
        variant: 'destructive',
      })
    } finally {
      enviando.current = false
    }
  }

  const saldoResultante = Math.max(0, saldo - montoNum)
  const atajo = useAtajoConfirmar(handleConfirmar, { habilitado: !registrado && puedeConfirmar, conCtrl: true })
  const esCuentaCobro = registrado?.tipo === 'cuenta_cobro'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" onKeyDown={atajo}>
        <DialogHeader>
          <DialogTitle>
            {registrado
              ? esCuentaCobro ? 'Cuenta de cobro emitida' : 'Pago registrado'
              : modoCuentaCobro ? 'Pago en $0 — cuenta de cobro'
              : esFinanciera ? 'Venta a crédito de financiera' : esAnticipo ? 'Registrar anticipo' : 'Registrar abono'}
          </DialogTitle>
        </DialogHeader>

        {registrado ? (
          <div className="space-y-4">
            {esCuentaCobro ? (
              <div className="flex flex-col items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-4 text-center">
                <FileText className="h-6 w-6 text-amber-600" />
                <p className="font-mono text-lg font-bold">{registrado.numero ?? 'Cuenta de cobro'}</p>
                <p className="text-sm text-amber-800">{formatCOP(registrado.monto)} por cobrar</p>
                <p className="text-xs text-amber-800">El plazo de pago empieza a contar cuando se entrega el trabajo.</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-4 text-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                <p className="font-mono text-lg font-bold">{registrado.numero ?? 'Recibo'}</p>
                <p className="text-sm text-emerald-800">{formatCOP(registrado.monto)} recibidos</p>
              </div>
            )}
            {!registrado.id && (
              <p className="text-xs text-muted-foreground">
                {esCuentaCobro
                  ? 'La venta quedó aprobada. Puedes imprimir la cuenta de cobro desde la cotización.'
                  : 'El pago quedó registrado. Puedes imprimir el recibo desde la tabla de pagos.'}
              </p>
            )}
            {registrado.id && (
              <div className="grid grid-cols-2 gap-2">
                <Button autoFocus onClick={() => imprimir(registrado.id!, registrado.tipo)}>
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir / PDF
                </Button>
                <Button variant="outline" disabled={descargando} onClick={() => descargarImagen(registrado.id!, registrado.tipo)}>
                  {descargando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageDown className="mr-2 h-4 w-4" />}
                  Descargar imagen
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cerrar</Button>
            </DialogFooter>
          </div>
        ) : !cajaLista && !puedeCuentaCobro ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {sesionCaja
                ? `La caja está abierta desde el ${formatFecha(sesionCaja.opened_at)}. Ciérrala y abre la de hoy antes de registrar un pago.`
                : 'Debes abrir caja antes de registrar un pago.'}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={() => navigate('/caja')}>Ir a Caja</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {!cajaLista && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {sesionCaja
                  ? 'La caja es de otro día: solo puedes aprobar con pago en $0 (cuenta de cobro).'
                  : 'La caja está cerrada: solo puedes aprobar con pago en $0 (cuenta de cobro).'}
              </div>
            )}
            {esAnticipo && opcionesADescartar.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  El cliente elige la opción {cotizacion.opcion_etiqueta}.{' '}
                  {opcionesADescartar.length === 1
                    ? `La opción ${opcionesADescartar[0]} quedará descartada.`
                    : `Las opciones ${opcionesADescartar.join(', ')} quedarán descartadas.`}
                </span>
              </div>
            )}
            <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total cotización</span>
                <span className="font-mono">{formatCOP(total)}</span>
              </div>
              {abonado > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Abonado</span>
                  <span className="font-mono">{formatCOP(abonado)}</span>
                </div>
              )}
              <div className="flex justify-between font-medium">
                <span>Saldo pendiente</span>
                <span className="font-mono">{formatCOP(saldo)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Monto a recibir</Label>
              <InputDinero value={monto} onChange={setMonto} disabled={esFinanciera} inputClassName="text-base" />
              <div className={`flex flex-wrap gap-2 pt-0.5 ${esFinanciera ? 'hidden' : ''}`}>
                {esAnticipo && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setMonto(String(minimo))}>
                    50% ({formatCOP(minimo)})
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMonto(String(Math.round(saldo)))}
                >
                  {esAnticipo ? 'Total' : 'Saldo completo'}
                </Button>
                {puedeCuentaCobro && (
                  <Button
                    type="button"
                    variant={modoCuentaCobro ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMonto('0')}
                    title="Sin pago ahora: se emite la cuenta de cobro y el cliente paga después de la entrega"
                  >
                    $0 · Cuenta de cobro
                  </Button>
                )}
              </div>
              {modoCuentaCobro ? (
                <p className="text-xs text-muted-foreground">
                  No entra dinero a caja. Se emite la cuenta de cobro por{' '}
                  <span className="font-mono">{formatCOP(saldo)}</span>, que vence a los días de plazo del cliente
                  contados desde la entrega.
                </p>
              ) : sobrepasa ? (
                <p className="text-xs text-destructive">
                  El monto excede el saldo pendiente ({formatCOP(saldo)}).
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Queda un saldo de <span className="font-mono">{formatCOP(saldoResultante)}</span>
                </p>
              )}
            </div>

            {bajoMinimo && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    El anticipo mínimo es el 50% del total (<span className="font-mono">{formatCOP(minimo)}</span>).
                    {!esAdmin && ' Pide a un administrador que autorice un monto menor.'}
                  </span>
                </div>
                {esAdmin && (
                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-amber-400 accent-amber-600"
                        checked={autorizar}
                        onChange={(e) => setAutorizar(e.target.checked)}
                      />
                      Autorizar anticipo menor al 50%
                    </label>
                    {autorizar && (
                      <textarea
                        className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        rows={2}
                        placeholder="Motivo de la autorización..."
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {modoCuentaCobro && (
              <div className="space-y-1.5">
                <Label htmlFor="orden-compra">Orden de compra (opcional)</Label>
                <Input
                  id="orden-compra"
                  maxLength={60}
                  placeholder="Ej: OC-2026-0142"
                  value={ordenCompra}
                  onChange={(e) => setOrdenCompra(e.target.value)}
                />
              </div>
            )}

            <div className={`space-y-1.5 ${modoCuentaCobro ? 'hidden' : ''}`}>
              <Label>Método de pago</Label>
              <Select value={metodoPago} onValueChange={(v) => cambiarMetodo(v as MetodoPago)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {metodosDisponibles.map((m) => (
                    <SelectItem key={m} value={m}>{METODO_PAGO_LABEL[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {esFinanciera && (
              <CamposFinanciera
                financieras={financieras ?? []}
                financieraId={financieraId}
                onFinanciera={setFinancieraId}
                referencia={referencia}
                onReferencia={setReferencia}
                monto={montoNum}
                financiera={financiera}
              />
            )}

            {esAnticipo && (
              <div className="space-y-1.5">
                <Label>Fecha de entrega estimada</Label>
                <Input type="date" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleConfirmar} disabled={!puedeConfirmar}>
                {pendiente && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {modoCuentaCobro
                  ? 'Aprobar en $0'
                  : esFinanciera ? 'Confirmar venta a crédito' : esAnticipo ? 'Confirmar anticipo' : 'Confirmar abono'}
                <PistaConfirmar conCtrl />
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
