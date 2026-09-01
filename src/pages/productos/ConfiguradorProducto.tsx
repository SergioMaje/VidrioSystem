import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { Calculator, ShoppingCart, Printer, Scissors, AlertCircle, ImagePlus, X, Check, Pencil } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { PreviewProducto } from './PreviewProducto'
import { usePlantillas } from '@/hooks/useProductos'
import { useReferencias } from '@/hooks/useReferencias'
import { useItems } from '@/hooks/useInventario'
import {
  altoNominal,
  anchoNominal,
  areaM2,
  calcularCortes,
  calcularMateriales,
  esRegular,
  detalleMedidasPorLado,
  medidasDeItem,
  medidasRegulares,
  nombrePiezaConLado,
  COLORES_PERFIL,
  TIPO_LABELS,
  type Medidas,
} from '@/lib/produccion'
import {
  calcularOpciones,
  catalogoOpciones,
  crearOpcion,
  esComponenteDeVidrio,
  etiquetaOpcion,
  resumenOpciones,
  ROL_LABELS,
  type OpcionDisponible,
} from '@/lib/opciones'
import {
  LADO_CORREDIZO_LABELS,
  LADO_MEDICION_LABELS,
  etiquetaLadoCorredizo,
  ladoCorredizoExterior,
  textoLadoCorredizo,
} from '@/lib/lados'
import type { LadoCorredizo, LadoMedicion, OpcionCotizacion } from '@/types/database'
import type { ItemCotizacion } from './PanelCotizacion'

const MARGEN_VENTA = 1.35

/** Valor centinela de los selects: Radix no admite un SelectItem con value vacío. */
const NINGUNO = 'ninguno'
const SIN_DATO = 'sin-especificar'

interface SeleccionVidrio {
  tipo: string
  calibre: string
  acabado: string
}

const VIDRIO_VACIO: SeleccionVidrio = { tipo: '', calibre: '', acabado: '' }

// Los tres selects de vidrio se filtran en cascada sobre estas claves. Los ítems sin
// atributo quedan bajo "Sin especificar" para que ninguno del inventario sea inalcanzable.
const claveTipo = (o: OpcionDisponible) => o.vidrio.tipo ?? SIN_DATO
const claveCalibre = (o: OpcionDisponible) =>
  o.vidrio.calibre_mm != null ? String(o.vidrio.calibre_mm) : SIN_DATO
const claveAcabado = (o: OpcionDisponible) => o.vidrio.acabado ?? SIN_DATO

const etiquetaTipo = (clave: string) => (clave === SIN_DATO ? 'Sin especificar' : clave)
const etiquetaCalibre = (clave: string) => (clave === SIN_DATO ? 'Sin especificar' : `${clave} mm`)
const etiquetaAcabado = (clave: string) => (clave === SIN_DATO ? 'Sin especificar' : clave)

function clavesUnicas(opciones: OpcionDisponible[], clave: (o: OpcionDisponible) => string): string[] {
  return [...new Set(opciones.map(clave))]
}

/** Los cuatro campos de medida, en el orden en que se dibujan y se validan. */
const LADOS_MEDIDA: { campo: keyof Medidas; label: string }[] = [
  { campo: 'anchoSuperiorCm', label: 'Ancho superior (cm)' },
  { campo: 'anchoInferiorCm', label: 'Ancho inferior (cm)' },
  { campo: 'altoIzquierdoCm', label: 'Alto izquierdo (cm)' },
  { campo: 'altoDerechoCm',   label: 'Alto derecho (cm)' },
]

export interface EdicionItem {
  idx: number
  item: ItemCotizacion
}

interface ConfiguradorProductoProps {
  onAgregarItem: (item: ItemCotizacion) => void
  edicion?: EdicionItem | null
  onActualizarItem?: (idx: number, item: ItemCotizacion) => void
  onCancelarEdicion?: () => void
}

export function ConfiguradorProducto({
  onAgregarItem,
  edicion,
  onActualizarItem,
  onCancelarEdicion,
}: ConfiguradorProductoProps) {
  // Las cuatro medidas son la fuente de verdad; ancho y alto se derivan de ellas.
  // Se piden siempre las cuatro: quien mide en obra las toma todas, y con dos inputs
  // producción terminaba cortando a la medida nominal aunque el vano no lo fuera.
  // El 0 es el centinela de "sin capturar"; ninguna medida real vale 0.
  const [medidas, setMedidas] = useState<Medidas>(() => medidasRegulares(0, 0))
  const anchoCm = anchoNominal(medidas)
  const altoCm = altoNominal(medidas)
  const medidasCompletas = LADOS_MEDIDA.every(({ campo }) => medidas[campo] > 0)

  const setLado = (lado: keyof Medidas, v: number) =>
    setMedidas((m) => ({ ...m, [lado]: v }))

  const [colorPerfil, setColorPerfil] = useState('#9CA3AF')
  const [referenciaId, setReferenciaId] = useState<string>('')
  const [especificaciones, setEspecificaciones] = useState('')

  // Se guardan crudos, tal como los dicta quien mide. La normalización al marco
  // canónico (exterior) ocurre solo al dibujar, en ladoCorredizoExterior().
  const [ladoMedicion, setLadoMedicion] = useState<LadoMedicion>('exterior')
  const [ladoCorredizo, setLadoCorredizo] = useState<LadoCorredizo>('derecha')

  const [vidrioSel, setVidrioSel] = useState<SeleccionVidrio>(VIDRIO_VACIO)
  const [chapaItemId, setChapaItemId] = useState(NINGUNO)
  const [peliculaItemId, setPeliculaItemId] = useState(NINGUNO)

  const [imagenFicha, setImagenFicha] = useState<string | null>(null)
  const imagenInputRef = useRef<HTMLInputElement>(null)

  const previewRef = useRef<HTMLDivElement>(null)

  const { data: plantillas } = usePlantillas()
  const { data: referencias } = useReferencias()
  const { data: items } = useItems()

  const referenciaSeleccionada = referencias?.find((r) => r.id === referenciaId) ?? null

  // Todo se deriva de la referencia: tipo, plantilla, materiales y cortes
  const tipoActivo = referenciaSeleccionada?.tipo_producto?.nombre ?? 'ventana'
  const plantillaSeleccionada = plantillas?.find((p) => p.id === referenciaSeleccionada?.plantilla_id) ?? null

  const esCorrediza = referenciaSeleccionada?.es_corrediza ?? false
  const ladoVista = ladoCorredizoExterior(ladoCorredizo, ladoMedicion)

  const referenciasPorTipo = useMemo(() => {
    const grupos = new Map<string, NonNullable<typeof referencias>>()
    for (const ref of referencias ?? []) {
      const tipo = ref.tipo_producto?.nombre ?? 'otro'
      if (!grupos.has(tipo)) grupos.set(tipo, [])
      grupos.get(tipo)!.push(ref)
    }
    return grupos
  }, [referencias])

  const handleImagenChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setImagenFicha(ev.target?.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [])

  const catalogo = useMemo(() => catalogoOpciones(items), [items])
  const itemsPorId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items])

  // El vidrio "fijo" de la plantilla es el valor por defecto de los selects; deja de
  // contarse como material estructural y pasa a cotizarse como opción.
  const componenteVidrio = useMemo(
    () => plantillaSeleccionada?.componentes?.find(esComponenteDeVidrio) ?? null,
    [plantillaSeleccionada]
  )

  /** Vidrio a restaurar al precargar un ítem; se consume una sola vez, cuando el
   *  catálogo ya tiene con qué resolverlo. null = sin precarga pendiente. */
  const vidrioPendienteRef = useRef<{ itemId: string | null } | null>(null)

  useEffect(() => {
    const pendiente = vidrioPendienteRef.current
    const objetivoId = pendiente ? pendiente.itemId : componenteVidrio?.item_id ?? null
    const preseleccion = objetivoId
      ? catalogo.vidrios.find((o) => o.item.id === objetivoId)
      : undefined
    // El catálogo llega async: si hay precarga pendiente sin resolver, esperar.
    if (pendiente && objetivoId && !preseleccion) return
    vidrioPendienteRef.current = null
    setVidrioSel(
      preseleccion
        ? {
            tipo: claveTipo(preseleccion),
            calibre: claveCalibre(preseleccion),
            acabado: claveAcabado(preseleccion),
          }
        : VIDRIO_VACIO
    )
  }, [componenteVidrio, catalogo])

  useEffect(() => {
    if (!edicion) return
    const it = edicion.item
    setReferenciaId(it.referencia_id ?? '')
    setMedidas(medidasDeItem(it))
    setColorPerfil(it.color_perfil ?? '#9CA3AF')
    if (it.lado_medicion) setLadoMedicion(it.lado_medicion)
    if (it.lado_corredizo) setLadoCorredizo(it.lado_corredizo)
    setEspecificaciones(it.notas ?? '')
    setChapaItemId(it.opciones?.find((o) => o.rol === 'chapa')?.item_id ?? NINGUNO)
    setPeliculaItemId(it.opciones?.find((o) => o.rol === 'pelicula')?.item_id ?? NINGUNO)
    vidrioPendienteRef.current = {
      itemId: it.opciones?.find((o) => o.rol === 'vidrio')?.item_id ?? null,
    }
  }, [edicion])

  const vidriosPorTipo = catalogo.vidrios.filter((o) => claveTipo(o) === vidrioSel.tipo)
  const vidriosPorCalibre = vidriosPorTipo.filter((o) => claveCalibre(o) === vidrioSel.calibre)
  const vidrioItem =
    vidriosPorCalibre.find((o) => claveAcabado(o) === vidrioSel.acabado)?.item ?? null

  // Al cambiar un nivel, los inferiores se reajustan a la primera combinación válida.
  const ajustarVidrio = (cambio: Partial<SeleccionVidrio>) => {
    setVidrioSel((prev) => {
      const sel = { ...prev, ...cambio }
      const porTipo = catalogo.vidrios.filter((o) => claveTipo(o) === sel.tipo)
      if (!porTipo.some((o) => claveCalibre(o) === sel.calibre)) {
        sel.calibre = porTipo[0] ? claveCalibre(porTipo[0]) : ''
      }
      const porCalibre = porTipo.filter((o) => claveCalibre(o) === sel.calibre)
      if (!porCalibre.some((o) => claveAcabado(o) === sel.acabado)) {
        sel.acabado = porCalibre[0] ? claveAcabado(porCalibre[0]) : ''
      }
      return sel
    })
  }

  const opciones = useMemo<OpcionCotizacion[]>(() => {
    const lista: OpcionCotizacion[] = []
    if (vidrioItem) lista.push(crearOpcion('vidrio', vidrioItem, componenteVidrio))

    const chapa = catalogo.chapas.find((o) => o.item.id === chapaItemId)?.item
    if (chapa) lista.push(crearOpcion('chapa', chapa))

    const pelicula = catalogo.peliculas.find((o) => o.item.id === peliculaItemId)?.item
    if (pelicula) lista.push(crearOpcion('pelicula', pelicula))

    return lista
  }, [vidrioItem, componenteVidrio, catalogo, chapaItemId, peliculaItemId])

  const materiales = useMemo(() => {
    const componentes = (plantillaSeleccionada?.componentes ?? []).filter(
      (c) => !(vidrioItem && esComponenteDeVidrio(c))
    )
    return calcularMateriales(componentes, medidas).map((comp) => ({
      ...comp,
      costo_total: comp.cantidad_calculada * (comp.item?.precio_costo ?? 0),
      stock_ok: (comp.item?.stock_actual ?? 0) >= comp.cantidad_calculada,
    }))
  }, [plantillaSeleccionada, medidas, vidrioItem])

  const opcionesCalculadas = useMemo(
    () =>
      calcularOpciones(opciones, medidas).map((calc) => ({
        ...calc,
        stock_ok:
          (itemsPorId.get(calc.opcion.item_id)?.stock_actual ?? 0) >= calc.cantidad_calculada,
      })),
    [opciones, medidas, itemsPorId]
  )

  const cortesCalculados = useMemo(() => {
    if (!referenciaSeleccionada?.cortes?.length) return []
    return calcularCortes(referenciaSeleccionada.cortes, medidas)
  }, [referenciaSeleccionada, medidas])

  const costoTotal =
    materiales.reduce((s, m) => s + m.costo_total, 0) +
    opcionesCalculadas.reduce((s, o) => s + o.costo_total, 0)
  const precioSugerido = costoTotal * MARGEN_VENTA

  const construirItem = (): ItemCotizacion | null => {
    if (!referenciaSeleccionada) return null
    const tipoLabel = TIPO_LABELS[tipoActivo] ?? tipoActivo
    const colorLabel = COLORES_PERFIL.find((c) => c.value === colorPerfil)?.label ?? colorPerfil
    const detalles = [
      colorLabel,
      ...resumenOpciones(opciones),
      esCorrediza ? etiquetaLadoCorredizo(ladoCorredizo, ladoMedicion) : null,
    ]
      .filter(Boolean)
      .join(', ')
    // Ya no es un modo que se elija: es el dato de si el vano quedó fuera de escuadra.
    const irregular = !esRegular(medidas)
    const sufijoMedidas = irregular ? ' (irregular)' : ''
    const descripcion = `${referenciaSeleccionada.nombre} (${tipoLabel}) ${anchoCm}×${altoCm}cm${sufijoMedidas} — ${detalles}`
    const precioRedondeado = Math.round(precioSugerido)

    return {
      plantilla_id: referenciaSeleccionada.plantilla_id,
      referencia_id: referenciaSeleccionada.id,
      descripcion,
      // ancho_cm y alto_cm son las medidas nominales: el rectángulo que contiene al
      // vano. El detalle por lado va aparte y solo cuando de verdad difiere.
      ancho_cm: anchoCm,
      alto_cm: altoCm,
      area_m2: areaM2(medidas),
      medidas_irregulares: irregular,
      // Las cuatro se guardan siempre, aunque el vano haya salido a escuadra: son las
      // medidas que se tomaron en obra y las que producción necesita para cortar.
      ancho_sup_cm: medidas.anchoSuperiorCm,
      ancho_inf_cm: medidas.anchoInferiorCm,
      alto_izq_cm: medidas.altoIzquierdoCm,
      alto_der_cm: medidas.altoDerechoCm,
      cantidad: 1,
      precio_unitario: precioRedondeado,
      precio_total: precioRedondeado,
      color_perfil: colorPerfil,
      lado_medicion: esCorrediza ? ladoMedicion : null,
      lado_corredizo: esCorrediza ? ladoCorredizo : null,
      opciones,
      notas: especificaciones.trim() || null,
    }
  }

  const guardarItem = () => {
    const item = construirItem()
    if (!item) return
    if (edicion && onActualizarItem) {
      onActualizarItem(edicion.idx, item)
    } else {
      onAgregarItem(item)
    }
    // Los lados no se resetean: el lado de medición es constante para una obra
    // entera, y mantenerlo pegajoso entre ítems evita errores de reingreso.
    setEspecificaciones('')
  }

  const imprimir = () => {
    const svgEl = previewRef.current?.querySelector('svg')
    const svgHtml = svgEl ? new XMLSerializer().serializeToString(svgEl) : ''
    const tipoLabel = TIPO_LABELS[tipoActivo] ?? tipoActivo
    const plantillaNombre = plantillaSeleccionada?.nombre ?? '—'
    const referenciaNombre = referenciaSeleccionada?.nombre ?? null
    const colorLabel = COLORES_PERFIL.find((c) => c.value === colorPerfil)?.label ?? colorPerfil
    const areaTexto = areaM2(medidas).toFixed(2)
    const perimetroMl = (
      (medidas.anchoSuperiorCm + medidas.anchoInferiorCm + medidas.altoIzquierdoCm + medidas.altoDerechoCm) / 100
    ).toFixed(2)
    const detalleLados = detalleMedidasPorLado(medidas)
    const fecha = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })

    const filasMateriales = [
      ...materiales.map((m) => ({
        nombre: m.item?.nombre ?? '—',
        cantidad: m.cantidad_calculada,
        simbolo: m.item?.unidad_medida?.simbolo ?? '—',
        stock_ok: m.stock_ok,
        opcion: false,
      })),
      ...opcionesCalculadas.map((o) => ({
        nombre: o.opcion.nombre,
        cantidad: o.cantidad_calculada,
        simbolo: o.opcion.unidad_simbolo ?? '—',
        stock_ok: o.stock_ok,
        opcion: true,
      })),
    ]

    const materialesHtml = filasMateriales.length === 0 ? '' : `
      <div class="section">
        <h2>Materiales</h2>
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Cantidad</th>
              <th>Unidad</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>
            ${filasMateriales.map((m) => `
              <tr>
                <td>${m.nombre}${m.opcion ? ' <span class="badge opcion">Opción</span>' : ''}</td>
                <td>${m.cantidad.toFixed(2)}</td>
                <td>${m.simbolo}</td>
                <td><span class="badge ${m.stock_ok ? 'ok' : 'no'}">${m.stock_ok ? 'Disponible' : 'Sin stock'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`

    const opcionesHtml = opciones.length === 0 ? '' : `
      <div class="section">
        <h2>Opciones adicionales</h2>
        <div class="grid2">
          ${opciones.map((o) => `
            <div class="kv"><span>${ROL_LABELS[o.rol]}</span><strong>${etiquetaOpcion(o)}</strong></div>
          `).join('')}
        </div>
      </div>`

    const imagenHtml = imagenFicha ? `
      <div class="section">
        <h2>Imagen de referencia</h2>
        <div class="img-wrap"><img src="${imagenFicha}" alt="Imagen de referencia" /></div>
      </div>` : ''

    const specsHtml = especificaciones.trim() ? `
      <div class="section">
        <h2>Especificaciones adicionales</h2>
        <div class="specs">${especificaciones.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</div>
      </div>` : ''

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Ficha de Producto — ${tipoLabel}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;padding:2cm}
    h1{font-size:20px;font-weight:700;margin-bottom:2px}
    .sub{color:#666;font-size:12px;margin-bottom:24px}
    .section{margin-bottom:22px}
    h2{font-size:11px;text-transform:uppercase;color:#888;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:10px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px}
    .kv{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f3f4f6;font-size:13px}
    .kv strong{font-weight:600}
    .preview{display:flex;justify-content:center;padding:12px 0}
    table{width:100%;border-collapse:collapse}
    th{text-align:left;padding:5px 4px;font-size:11px;text-transform:uppercase;color:#6b7280;border-bottom:2px solid #e5e7eb}
    td{padding:5px 4px;border-bottom:1px solid #f3f4f6}
    tfoot td{border-top:2px solid #e5e7eb;border-bottom:none;padding-top:8px}
    .right{text-align:right}
    .badge{display:inline-block;padding:1px 7px;border-radius:3px;font-size:11px;font-weight:600}
    .badge.ok{background:#dcfce7;color:#166534}
    .badge.no{background:#fee2e2;color:#991b1b}
    .badge.opcion{background:#ede9fe;color:#5b21b6}
    .cost-box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;margin-top:10px}
    .cost-row{display:flex;justify-content:space-between;padding:3px 0;font-size:13px}
    .cost-row.accent{font-weight:700;font-size:15px;color:#1d4ed8;border-top:1px solid #e5e7eb;margin-top:6px;padding-top:6px}
    .specs{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;line-height:1.6;color:#374151}
    .img-wrap{text-align:center;padding:8px 0}.img-wrap img{max-width:100%;max-height:260px;object-fit:contain;border:1px solid #e5e7eb;border-radius:6px}
    @media print{body{padding:1cm}}
  </style>
</head>
<body>
  <h1>Ficha de Producto — ${tipoLabel}</h1>
  <div class="sub">Generada el ${fecha} · VidrioSystem</div>

  <div class="section">
    <h2>Datos generales</h2>
    <div class="grid2">
      <div class="kv"><span>Tipo</span><strong>${tipoLabel}</strong></div>
      <div class="kv"><span>Plantilla</span><strong>${plantillaNombre}</strong></div>
      ${referenciaNombre ? `<div class="kv"><span>Referencia</span><strong>${referenciaNombre}</strong></div>` : ''}
      ${referenciaSeleccionada ? `<div class="kv"><span>Apertura</span><strong>${esCorrediza ? 'Corrediza' : 'Fija'}</strong></div>` : ''}
      ${esCorrediza ? `
      <div class="kv"><span>Medida tomada desde</span><strong>${LADO_MEDICION_LABELS[ladoMedicion]}</strong></div>
      <div class="kv"><span>Hoja que corre</span><strong>${textoLadoCorredizo(ladoCorredizo, ladoMedicion)}</strong></div>` : ''}
      <div class="kv"><span>Color perfil</span><strong>${colorLabel}</strong></div>
      <div class="kv"><span>Ancho</span><strong>${anchoCm} cm</strong></div>
      <div class="kv"><span>Alto</span><strong>${altoCm} cm</strong></div>
      <div class="kv"><span>Área</span><strong>${areaTexto} m²</strong></div>
      <div class="kv"><span>Perímetro</span><strong>${perimetroMl} ml</strong></div>
      ${detalleLados ? `
      <div class="kv"><span>Ancho superior</span><strong>${medidas.anchoSuperiorCm} cm</strong></div>
      <div class="kv"><span>Ancho inferior</span><strong>${medidas.anchoInferiorCm} cm</strong></div>
      <div class="kv"><span>Alto izquierdo</span><strong>${medidas.altoIzquierdoCm} cm</strong></div>
      <div class="kv"><span>Alto derecho</span><strong>${medidas.altoDerechoCm} cm</strong></div>` : ''}
    </div>
    ${detalleLados ? '<div class="sub">Vano fuera de escuadra: cada corte usa la medida de su lado.</div>' : ''}
  </div>

  ${opcionesHtml}

  <div class="section">
    <h2>Vista previa</h2>
    <div class="preview">${svgHtml}</div>
  </div>

  ${imagenHtml}
  ${materialesHtml}
  ${specsHtml}
</body>
</html>`

    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 400)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        {edicion && (
          <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm text-primary">
            <span className="flex items-center gap-1.5 font-medium">
              <Pencil className="h-3.5 w-3.5" />
              Editando ítem {edicion.idx + 1}
            </span>
          </div>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Producto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Referencia <span className="text-destructive">*</span></Label>
              {!referencias || referencias.length === 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  No hay referencias configuradas. Un administrador debe crearlas en la pestaña Referencias.
                </div>
              ) : (
                <Select value={referenciaId || undefined} onValueChange={setReferenciaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona una referencia..." />
                  </SelectTrigger>
                  <SelectContent>
                    {[...referenciasPorTipo.entries()].map(([tipo, refs]) => (
                      <SelectGroup key={tipo}>
                        <SelectLabel>{TIPO_LABELS[tipo] ?? tipo}</SelectLabel>
                        {refs.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.nombre}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {referenciaSeleccionada && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Badge variant="secondary" className="capitalize text-xs">
                    {TIPO_LABELS[tipoActivo] ?? tipoActivo}
                  </Badge>
                  {plantillaSeleccionada && (
                    <Badge variant="outline" className="text-xs">
                      Plantilla: {plantillaSeleccionada.nombre}
                    </Badge>
                  )}
                  {referenciaSeleccionada.descripcion && (
                    <span className="text-xs text-muted-foreground">{referenciaSeleccionada.descripcion}</span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                {LADOS_MEDIDA.map(({ campo, label }) => (
                  <div key={campo} className="space-y-2">
                    <Label>
                      {label} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="number"
                      min={10}
                      max={500}
                      placeholder="—"
                      value={medidas[campo] || ''}
                      onChange={(e) => setLado(campo, Number(e.target.value))}
                    />
                  </div>
                ))}
              </div>

              {medidasCompletas ? (
                <p className="text-xs text-muted-foreground">
                  El despiece usa la medida de cada lado. El material se calcula sobre el
                  rectángulo mayor: {anchoCm} × {altoCm} cm.
                </p>
              ) : (
                <p className="text-xs text-amber-700">
                  Escribe las cuatro medidas del vano: de ahí salen las medidas de corte
                  para producción.
                </p>
              )}

            </div>

            <div className="space-y-2">
              <Label>Color del perfil</Label>
              <Select value={colorPerfil} onValueChange={setColorPerfil}>
                <SelectTrigger>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: colorPerfil }} />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {COLORES_PERFIL.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full border" style={{ backgroundColor: value }} />
                        {label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {esCorrediza && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Medida tomada desde</Label>
                    <Select
                      value={ladoMedicion}
                      onValueChange={(v) => setLadoMedicion(v as LadoMedicion)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(LADO_MEDICION_LABELS) as LadoMedicion[]).map((clave) => (
                          <SelectItem key={clave} value={clave}>
                            {LADO_MEDICION_LABELS[clave]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Hoja que corre</Label>
                    <Select
                      value={ladoCorredizo}
                      onValueChange={(v) => setLadoCorredizo(v as LadoCorredizo)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(LADO_CORREDIZO_LABELS) as LadoCorredizo[]).map((clave) => (
                          <SelectItem key={clave} value={clave}>
                            {LADO_CORREDIZO_LABELS[clave]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Responde "hoja que corre" tal como se ve{' '}
                  <strong>desde {ladoMedicion === 'interior' ? 'el interior' : 'el exterior'}</strong>.
                  El dibujo siempre se muestra desde el exterior:{' '}
                  <strong>{textoLadoCorredizo(ladoCorredizo, ladoMedicion)}</strong>.
                </p>
              </div>
            )}

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Opciones adicionales</Label>
                {componenteVidrio && (
                  <span className="text-xs text-muted-foreground">
                    Vidrio por defecto: {componenteVidrio.item?.nombre}
                  </span>
                )}
              </div>

              {catalogo.vidrios.length === 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  No hay vidrios en el inventario. Agrégalos en Inventario y márcalos con el rol
                  "Vidrio" para poder elegirlos aquí.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Tipo de vidrio</Label>
                    <Select
                      value={vidrioSel.tipo || undefined}
                      onValueChange={(v) => ajustarVidrio({ tipo: v })}
                    >
                      <SelectTrigger className="h-8 text-sm capitalize">
                        <SelectValue placeholder="Sin vidrio" />
                      </SelectTrigger>
                      <SelectContent>
                        {clavesUnicas(catalogo.vidrios, claveTipo).map((clave) => (
                          <SelectItem key={clave} value={clave} className="capitalize">
                            {etiquetaTipo(clave)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Calibre</Label>
                    <Select
                      value={vidrioSel.calibre || undefined}
                      onValueChange={(v) => ajustarVidrio({ calibre: v })}
                      disabled={vidriosPorTipo.length === 0}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {clavesUnicas(vidriosPorTipo, claveCalibre).map((clave) => (
                          <SelectItem key={clave} value={clave}>{etiquetaCalibre(clave)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Color / acabado</Label>
                    <Select
                      value={vidrioSel.acabado || undefined}
                      onValueChange={(v) => ajustarVidrio({ acabado: v })}
                      disabled={vidriosPorCalibre.length === 0}
                    >
                      <SelectTrigger className="h-8 text-sm capitalize">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {clavesUnicas(vidriosPorCalibre, claveAcabado).map((clave) => (
                          <SelectItem key={clave} value={clave} className="capitalize">
                            {etiquetaAcabado(clave)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Chapa / cerradura</Label>
                  <Select value={chapaItemId} onValueChange={setChapaItemId}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NINGUNO}>Sin chapa</SelectItem>
                      {catalogo.chapas.map(({ item }) => (
                        <SelectItem key={item.id} value={item.id}>{item.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Película de seguridad</Label>
                  <Select value={peliculaItemId} onValueChange={setPeliculaItemId}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NINGUNO}>Sin película</SelectItem>
                      {catalogo.peliculas.map(({ item }) => (
                        <SelectItem key={item.id} value={item.id}>{item.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Imagen de referencia</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={imagenInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImagenChange}
            />
            {imagenFicha ? (
              <div className="relative">
                <img
                  src={imagenFicha}
                  alt="Imagen de referencia"
                  className="max-h-48 w-full rounded-md border object-contain bg-muted/30"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute right-2 top-2 h-6 w-6"
                  onClick={() => setImagenFicha(null)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => imagenInputRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-md border-2 border-dashed border-input py-6 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <ImagePlus className="h-8 w-8" />
                <span>Haz clic para subir una imagen</span>
                <span className="text-xs">PNG, JPG, WEBP — la imagen se incluirá en la ficha impresa</span>
              </button>
            )}
            {imagenFicha && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => imagenInputRef.current?.click()}
              >
                <ImagePlus className="mr-2 h-4 w-4" />
                Cambiar imagen
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Especificaciones adicionales</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={especificaciones}
              onChange={(e) => setEspecificaciones(e.target.value)}
              placeholder="Ej: Vidrio templado 6mm, bisagras ocultas, sellado con silicona neutra, acabado satinado..."
              rows={4}
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </CardContent>
        </Card>

      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Vista previa en tiempo real</CardTitle>
              <Button variant="outline" size="sm" onClick={imprimir} disabled={!referenciaSeleccionada}>
                <Printer className="mr-2 h-4 w-4" />
                Imprimir ficha
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4" ref={previewRef}>
            <PreviewProducto
              tipo={tipoActivo}
              anchoCm={anchoCm}
              altoCm={altoCm}
              colorPerfil={colorPerfil}
              esCorrediza={esCorrediza}
              ladoCorredizoVista={ladoVista ?? 'derecha'}
              cortes={cortesCalculados}
              medidas={medidas}
            />
            <Separator />
            <div className="w-full space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Dimensiones</span>
                <span className="font-medium">{anchoCm} × {altoCm} cm</span>
              </div>
              {detalleMedidasPorLado(medidas) && (
                <p className="text-xs text-amber-700">{detalleMedidasPorLado(medidas)}</p>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Área</span>
                <span className="font-medium">{areaM2(medidas).toFixed(2)} m²</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Perímetro</span>
                <span className="font-medium">
                  {(
                    (medidas.anchoSuperiorCm + medidas.anchoInferiorCm + medidas.altoIzquierdoCm + medidas.altoDerechoCm) / 100
                  ).toFixed(2)} ml
                </span>
              </div>
              {referenciaSeleccionada && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Apertura</span>
                  <span className="font-medium">{esCorrediza ? 'Corrediza' : 'Fija'}</span>
                </div>
              )}
              {/* Se muestra el dato crudo y el normalizado juntos para que el admin
                  pueda verificar la conversión en vez de confiar en ella. */}
              {esCorrediza && ladoVista && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Medida tomada desde</span>
                    <span className="font-medium">{LADO_MEDICION_LABELS[ladoMedicion]}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Hoja que corre</span>
                    <span className="font-medium">{LADO_CORREDIZO_LABELS[ladoVista]} (ext.)</span>
                  </div>
                </>
              )}
            </div>
            {edicion ? (
              <div className="flex w-full gap-2">
                <Button variant="outline" className="flex-1" onClick={onCancelarEdicion}>
                  Cancelar
                </Button>
                <Button
                  className="flex-1"
                  onClick={guardarItem}
                  disabled={!referenciaSeleccionada || !medidasCompletas}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Guardar cambios
                </Button>
              </div>
            ) : (
              <Button
                className="w-full"
                onClick={guardarItem}
                disabled={!referenciaSeleccionada || !medidasCompletas}
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                Agregar a cotización
              </Button>
            )}
          </CardContent>
        </Card>

        {(materiales.length > 0 || opcionesCalculadas.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Materiales calculados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {opcionesCalculadas.map(({ opcion, cantidad_calculada, stock_ok }) => (
                  <div
                    key={`${opcion.rol}-${opcion.item_id}`}
                    className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium">{opcion.nombre}</p>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {ROL_LABELS[opcion.rol]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {cantidad_calculada.toFixed(2)} {opcion.unidad_simbolo ?? ''}
                        {opcion.desperdicio_pct > 0 && ` (inc. ${opcion.desperdicio_pct}% desperdicio)`}
                      </p>
                    </div>
                    <Badge variant={stock_ok ? 'success' : 'destructive'} className="text-xs">
                      {stock_ok ? 'OK' : 'Sin stock'}
                    </Badge>
                  </div>
                ))}
                {materiales.map((mat) => (
                  <div key={mat.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <div className="flex-1">
                      <p className="font-medium">{mat.item?.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {mat.cantidad_calculada.toFixed(2)} {mat.item?.unidad_medida?.simbolo}
                        {mat.desperdicio_pct > 0 && ` (inc. ${mat.desperdicio_pct}% desperdicio)`}
                      </p>
                    </div>
                    <Badge variant={mat.stock_ok ? 'success' : 'destructive'} className="text-xs">
                      {mat.stock_ok ? 'OK' : 'Sin stock'}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {cortesCalculados.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scissors className="h-5 w-5" />
                Medidas de corte
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {cortesCalculados.map((c) => (
                  <div key={c.key} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <div className="flex-1">
                      <p className="font-medium">{nombrePiezaConLado(c)}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.cantidad_piezas} {c.cantidad_piezas === 1 ? 'pieza' : 'piezas'}
                      </p>
                    </div>
                    <span className="font-mono font-semibold">{c.valor_cm.toFixed(1)} cm</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
