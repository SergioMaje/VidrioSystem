import { useId } from 'react'
import { esRegular, nombrePiezaConLado, type CorteCalculado, type Medidas } from '@/lib/produccion'
import type { FormulaCorte, LadoCorredizo } from '@/types/database'

interface PreviewProductoProps {
  tipo: 'ventana' | 'puerta' | 'division' | 'espejo' | 'otro'
  anchoCm: number
  altoCm: number
  colorPerfil?: string
  esCorrediza?: boolean
  /**
   * Lado que corre YA NORMALIZADO al marco canónico exterior.
   * El componente nunca invierte lados: eso lo hace ladoCorredizoExterior() en lib/lados.ts.
   */
  ladoCorredizoVista?: LadoCorredizo
  /**
   * Piezas de corte ya calculadas. Cuando vienen, el dibujo se rodea de carriles con
   * cada pieza representada a la misma escala que la silueta. Sin esta prop el render
   * es exactamente el de siempre.
   */
  cortes?: CorteCalculado[]
  /**
   * Las cuatro medidas del vano. Solo cambian las cotas: la silueta se sigue dibujando
   * sobre el rectángulo nominal (anchoCm × altoCm), que es el que contiene al vano.
   */
  medidas?: Medidas
}

const CANVAS_W = 280
const CANVAS_H = 220
const MARCO_W = 12

/** Grosor de un carril de anotación: barra (6) + separación + etiqueta (9). */
const LANE = 26
/** Más de dos carriles por lado apiñan el dibujo; el resto se lista en el pie. */
const MAX_CARRILES = 2

/**
 * La fórmula del corte ya dice sobre qué dimensión se mide la pieza, así que basta
 * para colocarla: las de ancho van arriba/abajo y las de alto a los costados. Las
 * `fijo` no se derivan de ninguna dimensión del producto y por eso van al pie.
 */
function orientacion(formula: FormulaCorte): 'h' | 'v' | null {
  switch (formula) {
    case 'ancho':
    case 'ancho_menos_margen':
    case 'mitad_ancho':
    case 'ancho_superior':
    case 'ancho_inferior':
      return 'h'
    case 'alto':
    case 'alto_menos_margen':
    case 'mitad_alto':
    case 'alto_izquierdo':
    case 'alto_derecho':
      return 'v'
    case 'fijo':
      return null
  }
}

function etiquetaCorte(c: CorteCalculado) {
  const veces = c.cantidad_piezas > 1 ? ` ×${c.cantidad_piezas}` : ''
  return `${nombrePiezaConLado(c)} · ${c.valor_cm.toFixed(1)} cm${veces}`
}

export function PreviewProducto({
  tipo,
  anchoCm,
  altoCm,
  colorPerfil = '#9CA3AF',
  esCorrediza = false,
  ladoCorredizoVista = 'derecha',
  cortes,
  medidas,
}: PreviewProductoProps) {
  const irregular = !!medidas && !esRegular(medidas)
  const cotaAncho = irregular
    ? `${medidas!.anchoSuperiorCm} sup / ${medidas!.anchoInferiorCm} inf cm`
    : `${anchoCm} cm`
  const cotaAlto = irregular
    ? `${medidas!.altoIzquierdoCm} izq / ${medidas!.altoDerechoCm} der cm`
    : `${altoCm} cm`

  // useId trae ':' , que rompería las referencias url(#id). Los ids deben ser únicos
  // porque la ficha de producción inlinea varios de estos SVG en un mismo documento:
  // con ids repetidos, todo url(#glass) resolvería contra el primer <defs> del papel.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const ref = (nombre: string) => `url(#${nombre}-${uid})`

  const maxDim = Math.max(anchoCm, altoCm, 1)
  const pad = 20

  const w = ((anchoCm / maxDim) * (CANVAS_W - pad * 2))
  const h = ((altoCm / maxDim) * (CANVAS_H - pad * 2))
  const x = (CANVAS_W - w) / 2
  const y = (CANVAS_H - h) / 2

  const frameColor = colorPerfil

  // Las barras usan la misma escala que la silueta en su propio eje, de modo que una
  // pieza "ancho" mida exactamente lo que el dibujo y una con margen se vea más corta.
  const escalaH = (CANVAS_W - pad * 2) / maxDim
  const escalaV = (CANVAS_H - pad * 2) / maxDim

  const horizontales = (cortes ?? []).filter((c) => orientacion(c.formula) === 'h')
  const verticales = (cortes ?? []).filter((c) => orientacion(c.formula) === 'v')
  const sueltos = (cortes ?? []).filter((c) => orientacion(c.formula) === null)

  // Se alternan lados para que los primeros cortes queden pegados al dibujo.
  const arriba = horizontales.filter((_, i) => i % 2 === 0).slice(0, MAX_CARRILES)
  const abajo = horizontales.filter((_, i) => i % 2 === 1).slice(0, MAX_CARRILES)
  const izquierda = verticales.filter((_, i) => i % 2 === 0).slice(0, MAX_CARRILES)
  const derecha = verticales.filter((_, i) => i % 2 === 1).slice(0, MAX_CARRILES)

  const enCarril = new Set([...arriba, ...abajo, ...izquierda, ...derecha])
  const pie = [...sueltos, ...(cortes ?? []).filter((c) => orientacion(c.formula) !== null && !enCarril.has(c))]

  const offX = izquierda.length * LANE
  const offY = arriba.length * LANE
  const pieAlto = pie.length ? pie.length * 12 + 10 : 0

  const totalW = CANVAS_W + (izquierda.length + derecha.length) * LANE
  const totalH = CANVAS_H + (arriba.length + abajo.length) * LANE + pieAlto

  const barra = (c: CorteCalculado, key: string, cx: number, cy: number, vertical: boolean) => {
    const largo = Math.max(2, (vertical ? c.valor_cm * escalaV : c.valor_cm * escalaH))
    return (
      <g key={key}>
        <rect
          x={vertical ? cx - 3 : cx - largo / 2}
          y={vertical ? cy - largo / 2 : cy - 3}
          width={vertical ? 6 : largo}
          height={vertical ? largo : 6}
          rx={1.5}
          fill={frameColor}
          stroke="#374151"
          strokeWidth={0.75}
        />
      </g>
    )
  }

  const etiqueta = (c: CorteCalculado, key: string, tx: number, ty: number, vertical: boolean) => (
    <text
      key={key}
      x={tx}
      y={ty}
      textAnchor="middle"
      fontSize={8.5}
      fill="#374151"
      transform={vertical ? `rotate(-90, ${tx}, ${ty})` : undefined}
    >
      {etiquetaCorte(c)}
    </text>
  )

  return (
    <svg
      width={totalW}
      height={totalH}
      viewBox={`0 0 ${totalW} ${totalH}`}
      className="rounded-md border"
    >
      <defs>
        <linearGradient id={`glass-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(200,235,255,0.6)" />
          <stop offset="100%" stopColor="rgba(140,195,230,0.35)" />
        </linearGradient>
        <linearGradient id={`mirror-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(220,235,250,0.9)" />
          <stop offset="50%" stopColor="rgba(180,210,240,0.7)" />
          <stop offset="100%" stopColor="rgba(200,225,245,0.85)" />
        </linearGradient>
        <pattern id={`hatching-${uid}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
        </pattern>
        <marker id={`arrowStart-${uid}`} markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto">
          <path d="M7,1 L1,4 L7,7 Z" fill="#1d4ed8" />
        </marker>
        <marker id={`arrowEnd-${uid}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M1,1 L7,4 L1,7 Z" fill="#1d4ed8" />
        </marker>
      </defs>

      {/* Fondo como elemento del SVG y no como clase Tailwind: la ficha impresa serializa
          solo el <svg> a una ventana sin hojas de estilo, donde bg-slate-50 no existiría. */}
      <rect x={0} y={0} width={totalW} height={totalH} rx={6} fill="#f8fafc" />

      {/* Carriles de anotación, en coordenadas del lienzo exterior. */}
      {arriba.map((c, k) => {
        const cy = offY - LANE * k - LANE / 2
        return (
          <g key={`t${c.key}`}>
            {barra(c, `tb${c.key}`, offX + CANVAS_W / 2, cy + 3, false)}
            {etiqueta(c, `tt${c.key}`, offX + CANVAS_W / 2, cy - 5, false)}
          </g>
        )
      })}
      {abajo.map((c, k) => {
        const cy = offY + CANVAS_H + LANE * k + LANE / 2
        return (
          <g key={`b${c.key}`}>
            {barra(c, `bb${c.key}`, offX + CANVAS_W / 2, cy - 5, false)}
            {etiqueta(c, `bt${c.key}`, offX + CANVAS_W / 2, cy + 9, false)}
          </g>
        )
      })}
      {izquierda.map((c, k) => {
        const cx = offX - LANE * k - LANE / 2
        return (
          <g key={`l${c.key}`}>
            {barra(c, `lb${c.key}`, cx + 3, offY + CANVAS_H / 2, true)}
            {etiqueta(c, `lt${c.key}`, cx - 6, offY + CANVAS_H / 2, true)}
          </g>
        )
      })}
      {derecha.map((c, k) => {
        const cx = offX + CANVAS_W + LANE * k + LANE / 2
        return (
          <g key={`r${c.key}`}>
            {barra(c, `rb${c.key}`, cx - 3, offY + CANVAS_H / 2, true)}
            {etiqueta(c, `rt${c.key}`, cx + 8, offY + CANVAS_H / 2, true)}
          </g>
        )
      })}

      <g transform={`translate(${offX}, ${offY})`}>
        {tipo === 'ventana' && (() => {
          const panelW = (w - MARCO_W * 3) / 2
          const leftCx = x + MARCO_W + panelW / 2
          const rightCx = x + MARCO_W + panelW + MARCO_W + panelW / 2
          const cy = y + h / 2
          const corredizoCx = ladoCorredizoVista === 'izquierda' ? leftCx : rightCx
          const fijoCx = ladoCorredizoVista === 'izquierda' ? rightCx : leftCx
          return (
            <g>
              <rect x={x} y={y} width={w} height={h} fill={frameColor} rx={2} />
              <rect x={x + MARCO_W} y={y + MARCO_W} width={panelW} height={h - MARCO_W * 2} fill={ref('glass')} stroke={frameColor} strokeWidth={2} />
              <rect x={x + MARCO_W + panelW + MARCO_W} y={y + MARCO_W} width={panelW} height={h - MARCO_W * 2} fill={ref('glass')} stroke={frameColor} strokeWidth={2} />
              <rect x={x + MARCO_W} y={y + 4} width={w - MARCO_W * 2} height={4} fill="rgba(0,0,0,0.1)" />
              <rect x={x + MARCO_W} y={y + h - 8} width={w - MARCO_W * 2} height={4} fill="rgba(0,0,0,0.1)" />
              {esCorrediza && (
                <>
                  <circle cx={fijoCx} cy={cy} r={11} fill="rgba(255,255,255,0.85)" stroke="#374151" strokeWidth={1.5} />
                  <text x={fijoCx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="#374151">F</text>
                  <circle cx={corredizoCx} cy={cy} r={11} fill="rgba(255,255,255,0.85)" stroke="#1d4ed8" strokeWidth={1.5} />
                  <text x={corredizoCx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="#1d4ed8">C</text>
                  <line
                    x1={corredizoCx - panelW * 0.28} y1={cy + 22} x2={corredizoCx + panelW * 0.28} y2={cy + 22}
                    stroke="#1d4ed8" strokeWidth={2}
                    markerStart={ref('arrowStart')} markerEnd={ref('arrowEnd')}
                  />
                </>
              )}
            </g>
          )
        })()}

        {tipo === 'puerta' && (() => {
          const cx = x + w / 2
          const cy = y + MARCO_W + (h - MARCO_W * 2) * 0.32
          // La manija acompaña a la hoja que corre: es el elemento asimétrico del dibujo.
          const aDerecha = ladoCorredizoVista !== 'izquierda'
          const manijaX = aDerecha ? x + w - MARCO_W - 16 : x + MARCO_W + 11
          const flechaX1 = aDerecha ? x + w * 0.25 : x + w * 0.75
          const flechaX2 = aDerecha ? x + w * 0.6 : x + w * 0.4
          return (
            <g>
              <rect x={x} y={y} width={w} height={h} fill={frameColor} rx={2} />
              <rect x={x + MARCO_W} y={y + MARCO_W} width={w - MARCO_W * 2} height={(h - MARCO_W * 2) * 0.65} fill={ref('glass')} />
              <rect x={x + MARCO_W} y={y + MARCO_W + (h - MARCO_W * 2) * 0.65 + MARCO_W / 2} width={w - MARCO_W * 2} height={(h - MARCO_W * 2) * 0.3} fill={frameColor} opacity={0.7} />
              <rect x={manijaX} y={y + h / 2 - 18} width={5} height={36} rx={2} fill="rgba(100,100,100,0.7)" />
              <circle cx={manijaX + 2.5} cy={y + h / 2 - 18} r={4} fill="rgba(80,80,80,0.8)" />
              {esCorrediza && (
                <>
                  <circle cx={cx} cy={cy} r={11} fill="rgba(255,255,255,0.85)" stroke="#1d4ed8" strokeWidth={1.5} />
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="#1d4ed8">C</text>
                  <line
                    x1={flechaX1} y1={cy + 22} x2={flechaX2} y2={cy + 22}
                    stroke="#1d4ed8" strokeWidth={2}
                    markerStart={ref('arrowStart')} markerEnd={ref('arrowEnd')}
                  />
                </>
              )}
            </g>
          )
        })()}

        {tipo === 'division' && (() => {
          const panelW = (w - MARCO_W * 4) / 3
          const panelCx = (i: number) => x + MARCO_W + i * (panelW + MARCO_W) + panelW / 2
          const cy = y + h / 2
          const iCorredizo = ladoCorredizoVista === 'izquierda' ? 0 : 2
          const iFijo = ladoCorredizoVista === 'izquierda' ? 2 : 0
          return (
            <g>
              <rect x={x} y={y} width={w} height={h} fill={frameColor} rx={2} />
              {[0, 1, 2].map((i) => (
                <rect
                  key={i}
                  x={x + MARCO_W + i * (panelW + MARCO_W)}
                  y={y + MARCO_W}
                  width={panelW}
                  height={h - MARCO_W * 2}
                  fill={ref('glass')}
                />
              ))}
              {esCorrediza && (
                <>
                  <circle cx={panelCx(iFijo)} cy={cy} r={11} fill="rgba(255,255,255,0.85)" stroke="#374151" strokeWidth={1.5} />
                  <text x={panelCx(iFijo)} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="#374151">F</text>
                  <circle cx={panelCx(iCorredizo)} cy={cy} r={11} fill="rgba(255,255,255,0.85)" stroke="#1d4ed8" strokeWidth={1.5} />
                  <text x={panelCx(iCorredizo)} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="#1d4ed8">C</text>
                  <line
                    x1={panelCx(iCorredizo) - panelW * 0.35} y1={cy + 22} x2={panelCx(iCorredizo) + panelW * 0.35} y2={cy + 22}
                    stroke="#1d4ed8" strokeWidth={2}
                    markerStart={ref('arrowStart')} markerEnd={ref('arrowEnd')}
                  />
                </>
              )}
            </g>
          )
        })()}

        {tipo === 'espejo' && (
          <g>
            <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} fill={frameColor} rx={4} />
            <rect x={x} y={y} width={w} height={h} fill={ref('mirror')} />
            <rect x={x} y={y} width={w} height={h} fill={ref('hatching')} opacity={0.3} />
            <ellipse cx={x + w * 0.3} cy={y + h * 0.3} rx={w * 0.08} ry={h * 0.12} fill="rgba(255,255,255,0.4)" />
          </g>
        )}

        {tipo === 'otro' && (
          <g>
            <rect x={x} y={y} width={w} height={h} fill={frameColor} rx={2} />
            <rect x={x + MARCO_W} y={y + MARCO_W} width={w - MARCO_W * 2} height={h - MARCO_W * 2} fill={ref('glass')} />
          </g>
        )}

        <text x={CANVAS_W / 2} y={y - 6} textAnchor="middle" fontSize={irregular ? 8.5 : 10} fill={irregular ? '#B45309' : '#6B7280'}>{cotaAncho}</text>
        <text x={x - 6} y={CANVAS_H / 2} textAnchor="middle" fontSize={irregular ? 8.5 : 10} fill={irregular ? '#B45309' : '#6B7280'} transform={`rotate(-90, ${x - 6}, ${CANVAS_H / 2})`}>{cotaAlto}</text>
        {irregular && (
          <text x={CANVAS_W / 2} y={y + h + 12} textAnchor="middle" fontSize={8} fill="#B45309">
            Vano fuera de escuadra — silueta al rectángulo mayor
          </text>
        )}

        {/* Marco canónico del dibujo. Va dentro del <svg> porque la ficha impresa
            serializa solo el <svg>: fuera de él desaparecería de todo lo impreso. */}
        <text x={CANVAS_W / 2} y={CANVAS_H - 6} textAnchor="middle" fontSize={9} fontWeight={600} fill="#1d4ed8">
          Vista desde el exterior
        </text>
      </g>

      {/* Piezas sin dimensión propia (fórmula fija) y las que no cupieron en los carriles. */}
      {pie.map((c, k) => (
        <text
          key={`p${c.key}`}
          x={offX + CANVAS_W / 2}
          y={offY + CANVAS_H + abajo.length * LANE + 14 + k * 12}
          textAnchor="middle"
          fontSize={8.5}
          fill="#6B7280"
        >
          {etiquetaCorte(c)}
        </text>
      ))}
    </svg>
  )
}
