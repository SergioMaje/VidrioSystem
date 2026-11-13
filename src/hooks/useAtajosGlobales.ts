import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { NAV_ITEMS, rutaPadre } from '@/components/layout/navegacion'
import { useNavegarSeguro } from '@/providers/cambiosSinGuardar'
import {
  botonVolver, buscadorDePagina, cambiarPestana, esEditable, esFila,
  hayCapaAbierta, manejaSusFlechas, moverFila,
} from '@/lib/navegacionTeclado'

/**
 * Atajos de toda la app (fuera de los diálogos):
 * - ↑/↓, Inicio/Fin: recorren las filas del listado; Enter abre la fila;
 * - ←/→: pestaña anterior/siguiente (si la página las marca);
 * - Alt+↑/↓: sección anterior/siguiente del menú lateral;
 * - /: enfoca el buscador; ?: abre la ayuda de atajos;
 * - Escape: quita el foco de un campo o fila y, si no hay ninguno, vuelve
 *   atrás con el botón "volver" de la página (respeta de dónde se vino).
 *
 * Escucha en fase de captura para ver el estado de la pantalla antes de que
 * Radix cierre un diálogo con ese mismo Escape: así un Escape cierra el
 * diálogo y no navega además.
 */
export function useAtajosGlobales(esAdmin: boolean) {
  const navegarSeguro = useNavegarSeguro()
  const { pathname } = useLocation()
  const [ayudaAbierta, setAyudaAbierta] = useState(false)

  // Los valores que cambian se leen de una ref: el listener se registra una vez.
  const contexto = useRef({ pathname, esAdmin, navegarSeguro })
  contexto.current = { pathname, esAdmin, navegarSeguro }

  useEffect(() => {
    const irASeccionVecina = (delta: 1 | -1) => {
      const { pathname, esAdmin, navegarSeguro } = contexto.current
      const secciones = NAV_ITEMS.filter((i) => !i.soloAdmin || esAdmin)
      const actual = secciones.findIndex((i) => pathname.startsWith(i.to))
      // Fuera de una sección conocida, ↓ va a la primera y ↑ a la última.
      const destino = actual === -1 ? (delta === 1 ? 0 : secciones.length - 1) : actual + delta
      const item = secciones[destino]
      if (item) navegarSeguro(item.to)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.ctrlKey || e.metaKey) return
      const objetivo = e.target

      // Alt+↑/↓ funciona también dentro de campos: no tiene otro uso ahí.
      if (e.altKey) {
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !hayCapaAbierta() && !e.repeat) {
          e.preventDefault()
          irASeccionVecina(e.key === 'ArrowDown' ? 1 : -1)
        }
        return
      }

      if (e.key === 'Escape') {
        if (hayCapaAbierta()) return
        if (esEditable(objetivo) || esFila(objetivo)) {
          ;(objetivo as HTMLElement).blur()
          return
        }
        const volver = botonVolver()
        if (volver) {
          e.preventDefault()
          volver.click()
          return
        }
        const padre = rutaPadre(contexto.current.pathname)
        if (padre) {
          e.preventDefault()
          contexto.current.navegarSeguro(padre)
        }
        return
      }

      if (hayCapaAbierta()) return

      // Desde el buscador, ↓ baja a los resultados. El resto de teclas son del campo.
      if (esEditable(objetivo)) {
        if (
          e.key === 'ArrowDown' && !e.shiftKey &&
          objetivo === buscadorDePagina() &&
          moverFila(1, null)
        ) {
          e.preventDefault()
        }
        return
      }

      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp':
          if (manejaSusFlechas(objetivo)) return
          if (moverFila(e.key === 'ArrowDown' ? 1 : -1, objetivo)) e.preventDefault()
          return
        case 'Home':
        case 'End':
          if (!esFila(objetivo)) return
          if (moverFila(e.key === 'Home' ? 'inicio' : 'fin', objetivo)) e.preventDefault()
          return
        case 'ArrowLeft':
        case 'ArrowRight':
          if (manejaSusFlechas(objetivo)) return
          if (cambiarPestana(e.key === 'ArrowRight' ? 1 : -1)) e.preventDefault()
          return
        case 'Enter':
          if (esFila(objetivo) && !e.repeat) {
            e.preventDefault()
            objetivo.click()
          }
          return
        case '/': {
          const buscador = buscadorDePagina()
          if (buscador) {
            e.preventDefault()
            buscador.focus()
            buscador.select()
          }
          return
        }
        case '?':
          if (!e.repeat) {
            e.preventDefault()
            setAyudaAbierta(true)
          }
          return
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  return { ayudaAbierta, setAyudaAbierta }
}
