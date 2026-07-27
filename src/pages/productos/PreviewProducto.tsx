interface PreviewProductoProps {
  tipo: 'ventana' | 'puerta' | 'division' | 'espejo' | 'otro'
  anchoCm: number
  altoCm: number
  colorPerfil?: string
  esCorrediza?: boolean
}

const CANVAS_W = 280
const CANVAS_H = 220
const MARCO_W = 12

export function PreviewProducto({ tipo, anchoCm, altoCm, colorPerfil = '#9CA3AF', esCorrediza = false }: PreviewProductoProps) {
  const maxDim = Math.max(anchoCm, altoCm, 1)
  const pad = 20

  const w = ((anchoCm / maxDim) * (CANVAS_W - pad * 2))
  const h = ((altoCm / maxDim) * (CANVAS_H - pad * 2))
  const x = (CANVAS_W - w) / 2
  const y = (CANVAS_H - h) / 2

  const frameColor = colorPerfil

  return (
    <svg
      width={CANVAS_W}
      height={CANVAS_H}
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      className="rounded-md border bg-slate-50"
    >
      <defs>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(200,235,255,0.6)" />
          <stop offset="100%" stopColor="rgba(140,195,230,0.35)" />
        </linearGradient>
        <linearGradient id="mirror" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(220,235,250,0.9)" />
          <stop offset="50%" stopColor="rgba(180,210,240,0.7)" />
          <stop offset="100%" stopColor="rgba(200,225,245,0.85)" />
        </linearGradient>
        <pattern id="hatching" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
        </pattern>
        <marker id="arrowStart" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto">
          <path d="M7,1 L1,4 L7,7 Z" fill="#1d4ed8" />
        </marker>
        <marker id="arrowEnd" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M1,1 L7,4 L1,7 Z" fill="#1d4ed8" />
        </marker>
      </defs>

      {tipo === 'ventana' && (() => {
        const panelW = (w - MARCO_W * 3) / 2
        const leftCx = x + MARCO_W + panelW / 2
        const rightCx = x + MARCO_W + panelW + MARCO_W + panelW / 2
        const cy = y + h / 2
        return (
          <g>
            <rect x={x} y={y} width={w} height={h} fill={frameColor} rx={2} />
            <rect x={x + MARCO_W} y={y + MARCO_W} width={panelW} height={h - MARCO_W * 2} fill="url(#glass)" stroke={frameColor} strokeWidth={2} />
            <rect x={x + MARCO_W + panelW + MARCO_W} y={y + MARCO_W} width={panelW} height={h - MARCO_W * 2} fill="url(#glass)" stroke={frameColor} strokeWidth={2} />
            <rect x={x + MARCO_W} y={y + 4} width={w - MARCO_W * 2} height={4} fill="rgba(0,0,0,0.1)" />
            <rect x={x + MARCO_W} y={y + h - 8} width={w - MARCO_W * 2} height={4} fill="rgba(0,0,0,0.1)" />
            {esCorrediza && (
              <>
                <circle cx={leftCx} cy={cy} r={11} fill="rgba(255,255,255,0.85)" stroke="#374151" strokeWidth={1.5} />
                <text x={leftCx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="#374151">F</text>
                <circle cx={rightCx} cy={cy} r={11} fill="rgba(255,255,255,0.85)" stroke="#1d4ed8" strokeWidth={1.5} />
                <text x={rightCx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="#1d4ed8">C</text>
                <line
                  x1={rightCx - panelW * 0.28} y1={cy + 22} x2={rightCx + panelW * 0.28} y2={cy + 22}
                  stroke="#1d4ed8" strokeWidth={2}
                  markerStart="url(#arrowStart)" markerEnd="url(#arrowEnd)"
                />
              </>
            )}
          </g>
        )
      })()}

      {tipo === 'puerta' && (() => {
        const cx = x + w / 2
        const cy = y + MARCO_W + (h - MARCO_W * 2) * 0.32
        return (
          <g>
            <rect x={x} y={y} width={w} height={h} fill={frameColor} rx={2} />
            <rect x={x + MARCO_W} y={y + MARCO_W} width={w - MARCO_W * 2} height={(h - MARCO_W * 2) * 0.65} fill="url(#glass)" />
            <rect x={x + MARCO_W} y={y + MARCO_W + (h - MARCO_W * 2) * 0.65 + MARCO_W / 2} width={w - MARCO_W * 2} height={(h - MARCO_W * 2) * 0.3} fill={frameColor} opacity={0.7} />
            <rect x={x + w - MARCO_W - 16} y={y + h / 2 - 18} width={5} height={36} rx={2} fill="rgba(100,100,100,0.7)" />
            <circle cx={x + w - MARCO_W - 13.5} cy={y + h / 2 - 18} r={4} fill="rgba(80,80,80,0.8)" />
            {esCorrediza && (
              <>
                <circle cx={cx} cy={cy} r={11} fill="rgba(255,255,255,0.85)" stroke="#1d4ed8" strokeWidth={1.5} />
                <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="#1d4ed8">C</text>
                <line
                  x1={x + w * 0.25} y1={cy + 22} x2={x + w * 0.6} y2={cy + 22}
                  stroke="#1d4ed8" strokeWidth={2}
                  markerStart="url(#arrowStart)" markerEnd="url(#arrowEnd)"
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
                fill="url(#glass)"
              />
            ))}
            {esCorrediza && (
              <>
                <circle cx={panelCx(0)} cy={cy} r={11} fill="rgba(255,255,255,0.85)" stroke="#374151" strokeWidth={1.5} />
                <text x={panelCx(0)} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="#374151">F</text>
                <circle cx={panelCx(2)} cy={cy} r={11} fill="rgba(255,255,255,0.85)" stroke="#1d4ed8" strokeWidth={1.5} />
                <text x={panelCx(2)} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={700} fill="#1d4ed8">C</text>
                <line
                  x1={panelCx(2) - panelW * 0.35} y1={cy + 22} x2={panelCx(2) + panelW * 0.35} y2={cy + 22}
                  stroke="#1d4ed8" strokeWidth={2}
                  markerStart="url(#arrowStart)" markerEnd="url(#arrowEnd)"
                />
              </>
            )}
          </g>
        )
      })()}

      {tipo === 'espejo' && (
        <g>
          <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} fill={frameColor} rx={4} />
          <rect x={x} y={y} width={w} height={h} fill="url(#mirror)" />
          <rect x={x} y={y} width={w} height={h} fill="url(#hatching)" opacity={0.3} />
          <ellipse cx={x + w * 0.3} cy={y + h * 0.3} rx={w * 0.08} ry={h * 0.12} fill="rgba(255,255,255,0.4)" />
        </g>
      )}

      {tipo === 'otro' && (
        <g>
          <rect x={x} y={y} width={w} height={h} fill={frameColor} rx={2} />
          <rect x={x + MARCO_W} y={y + MARCO_W} width={w - MARCO_W * 2} height={h - MARCO_W * 2} fill="url(#glass)" />
        </g>
      )}

      <text x={CANVAS_W / 2} y={y - 6} textAnchor="middle" fontSize={10} fill="#6B7280">{anchoCm} cm</text>
      <text x={x - 6} y={CANVAS_H / 2} textAnchor="middle" fontSize={10} fill="#6B7280" transform={`rotate(-90, ${x - 6}, ${CANVAS_H / 2})`}>{altoCm} cm</text>
    </svg>
  )
}
