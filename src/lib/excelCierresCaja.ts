import type ExcelJS from 'exceljs'
import { textoDiferencia } from '@/lib/caja'
import { AZUL_CLARO, AZUL_ENCABEZADO, agregarFilaCebra, bordesCelda, descargarLibro, nuevoLibro } from '@/lib/excel'

/**
 * Historial de cierres de caja como .xlsx: columnas con ancho, encabezado fijo,
 * filtros, montos en pesos, fechas como fechas y una fila de totales. Reemplaza
 * al CSV, que Excel en español abre en una sola columna porque espera `;`.
 */

export type FilaCierreExcel = {
  apertura: string
  cierre: string | null
  duracion: string
  abrio: string
  cerro: string
  base: number
  efectivo: number | null
  transferencia: number | null
  tarjeta: number | null
  /** Efectivo + transferencia + tarjeta, sin anulados. */
  dinero: number | null
  /** Vendido a crédito de financiera: no es dinero recibido. */
  credito: number | null
  anulado: number | null
  gastos: number | null
  esperado: number | null
  contado: number | null
  diferencia: number | null
  observacion: string
}

const PESOS = '"$"#,##0;[Red]-"$"#,##0'
const FECHA_HORA = 'dd/mm/yyyy hh:mm AM/PM'

/**
 * ExcelJS guarda las fechas en UTC y Excel las muestra tal cual, sin zona: se
 * pasa la hora local como si fuera UTC para que se lea la hora de Colombia.
 */
function fechaExcel(iso: string): Date {
  const d = new Date(iso)
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()))
}

const COLUMNAS: { header: string; key: keyof FilaCierreExcel | 'estado'; width: number; formato?: string }[] = [
  { header: 'Apertura', key: 'apertura', width: 20, formato: FECHA_HORA },
  { header: 'Cierre', key: 'cierre', width: 20, formato: FECHA_HORA },
  { header: 'Duración', key: 'duracion', width: 11 },
  { header: 'Abrió', key: 'abrio', width: 18 },
  { header: 'Cerró', key: 'cerro', width: 18 },
  { header: 'Base inicial', key: 'base', width: 14, formato: PESOS },
  { header: 'Efectivo', key: 'efectivo', width: 13, formato: PESOS },
  { header: 'Transferencia', key: 'transferencia', width: 14, formato: PESOS },
  { header: 'Tarjeta', key: 'tarjeta', width: 13, formato: PESOS },
  { header: 'Dinero recibido', key: 'dinero', width: 15, formato: PESOS },
  { header: 'A crédito (financiera)', key: 'credito', width: 15, formato: PESOS },
  { header: 'Anulado', key: 'anulado', width: 13, formato: PESOS },
  { header: 'Gastos', key: 'gastos', width: 13, formato: PESOS },
  { header: 'Efectivo esperado', key: 'esperado', width: 16, formato: PESOS },
  { header: 'Efectivo contado', key: 'contado', width: 16, formato: PESOS },
  { header: 'Diferencia', key: 'diferencia', width: 13, formato: PESOS },
  { header: 'Resultado', key: 'estado', width: 16 },
  { header: 'Observación', key: 'observacion', width: 40 },
]

/** Columnas que se suman en la fila de totales. */
const SUMAN = new Set(['efectivo', 'transferencia', 'tarjeta', 'dinero', 'credito', 'anulado', 'gastos', 'diferencia'])

const letra = (indice: number) => String.fromCharCode(65 + indice)

export async function descargarCierresExcel(filas: FilaCierreExcel[], { desde, hasta }: { desde: string; hasta: string }) {
  const wb = nuevoLibro()
  const hoja = wb.addWorksheet('Cierres de caja', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  hoja.columns = COLUMNAS.map((c) => ({ header: c.header, key: c.key, width: c.width }))

  // Encabezado propio (no estilarEncabezado): los títulos largos van en dos líneas.
  const encabezado = hoja.getRow(1)
  encabezado.eachCell((celda) => {
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_ENCABEZADO } }
    celda.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    celda.border = bordesCelda()
  })
  encabezado.height = 32

  filas.forEach((f, i) => {
    const valores = COLUMNAS.map((c) => {
      if (c.key === 'estado') return f.diferencia == null ? '' : textoDiferencia(f.diferencia)
      if (c.key === 'apertura') return fechaExcel(f.apertura)
      if (c.key === 'cierre') return f.cierre ? fechaExcel(f.cierre) : null
      return f[c.key]
    })
    const fila = agregarFilaCebra(hoja, valores, i, AZUL_CLARO)
    fila.alignment = { vertical: 'top' }
    COLUMNAS.forEach((c, j) => {
      const celda = fila.getCell(j + 1)
      if (c.formato) celda.numFmt = c.formato
      if (c.key === 'observacion') celda.alignment = { vertical: 'top', wrapText: true }
    })
  })

  if (filas.length > 0) {
    const ultima = filas.length + 1
    const totales = hoja.addRow(
      COLUMNAS.map((c, j) => {
        if (j === 0) return 'Totales'
        if (!SUMAN.has(c.key)) return null
        return { formula: `SUM(${letra(j)}2:${letra(j)}${ultima})` } as ExcelJS.CellFormulaValue
      }),
    )
    totales.eachCell({ includeEmpty: true }, (celda, n) => {
      celda.font = { bold: true }
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_CLARO } }
      celda.border = { ...bordesCelda(), top: { style: 'double', color: { argb: 'FF000000' } } }
      const formato = COLUMNAS[n - 1]?.formato
      if (formato === PESOS) celda.numFmt = PESOS
    })
  }

  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNAS.length } }

  await descargarLibro(wb, `cierres-caja-del-${desde}-al-${hasta}`)
}
