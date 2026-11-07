import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { NAV_ITEMS, rutaPadre } from '@/components/layout/navegacion'
import { useNavegarSeguro } from '@/providers/cambiosSinGuardar'

/** Cuánto espera la segunda tecla después de la G. */
const ESPERA_SECUENCIA_MS = 1500

const esEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

/** Diálogo, menú o lista desplegable abiertos: ellos manejan su teclado. */
const hayCapaAbierta = () =>
  !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')

/**
 * Atajos de toda la app (fuera de los diálogos):
 * - G y luego una letra: ir a una sección (ver NAV_ITEMS);
 * - Escape: quita el foco de un campo y, si no hay ninguno, sube al listado.
 *
 * Escucha en fase de captura para ver el estado de la pantalla antes de que
 * Radix cierre un diálogo con ese mismo Escape: así un Escape cierra el
 * diálogo y no navega además.
 *
 * Devuelve true mientras espera la letra después de la G (para el indicador).
 */
export function useAtajosGlobales(esAdmin: boolean) {
  const navegarSeguro = useNavegarSeguro()
  const { pathname } = useLocation()
  const [esperandoLetra, setEsperandoLetra] = useState(false)
  const temporizador = useRef<number>()
  const esperando = useRef(false)

  // Los valores que cambian se leen de una ref: el listener se registra una vez.
  const contexto = useRef({ pathname, esAdmin, navegarSeguro })
  contexto.current = { pathname, esAdmin, navegarSeguro }

  useEffect(() => {
    const terminarEspera = () => {
      esperando.current = false
      setEsperandoLetra(false)
      window.clearTimeout(temporizador.current)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) {
        if (esperando.current) terminarEspera()
        return
      }
      const { pathname, esAdmin, navegarSeguro } = contexto.current

      if (e.key === 'Escape') {
        if (esperando.current) {
          terminarEspera()
          return
        }
        if (hayCapaAbierta()) return
        if (esEditable(e.target)) {
          ;(e.target as HTMLElement).blur()
          return
        }
        const padre = rutaPadre(pathname)
        if (padre) {
          e.preventDefault()
          navegarSeguro(padre)
        }
        return
      }

      if (esEditable(e.target) || hayCapaAbierta() || e.repeat) {
        if (esperando.current) terminarEspera()
        return
      }

      if (esperando.current) {
        e.preventDefault()
        terminarEspera()
        const item = NAV_ITEMS.find((i) => i.atajo === e.key.toUpperCase())
        if (item && (!item.soloAdmin || esAdmin)) navegarSeguro(item.to)
        return
      }

      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault()
        esperando.current = true
        setEsperandoLetra(true)
        temporizador.current = window.setTimeout(terminarEspera, ESPERA_SECUENCIA_MS)
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.clearTimeout(temporizador.current)
    }
  }, [])

  return esperandoLetra
}
