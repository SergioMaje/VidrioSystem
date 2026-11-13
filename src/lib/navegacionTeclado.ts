/**
 * Navegación con teclado sobre el DOM de la página actual. Las páginas solo
 * marcan sus elementos con atributos `data-*`; `useAtajosGlobales` decide
 * cuándo llamar a estas funciones.
 *
 * - `data-fila`: fila de un listado que se abre con clic (↑/↓ y Enter).
 * - `data-busqueda`: el buscador del listado (/ y ↑ desde la primera fila).
 * - `data-pestanas-flechas`: TabsList que cambia con ←/→.
 * - `data-volver`: botón "volver" de la página (Escape).
 */

/** Props para un `<tr>` que se abre con clic: entra en la navegación con flechas. */
export const FILA_NAVEGABLE = { tabIndex: -1, 'data-fila': '' } as const

/** Resaltado de la fila con foco; se suma al className del `<tr>`. */
export const filaNavegableClase =
  'focus:bg-muted/60 focus:outline-none focus:shadow-[inset_3px_0_0_hsl(var(--primary))]'

export const esEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

/** Diálogo, menú o lista desplegable abiertos: ellos manejan su teclado. */
export const hayCapaAbierta = () =>
  !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')

/** Elementos que ya usan las flechas por su cuenta (Radix los maneja). */
export const manejaSusFlechas = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  !!el.closest('[role="tablist"], [role="radiogroup"], [role="menubar"], [aria-expanded="true"]')

const principal = () => document.querySelector('main')

const visible = (el: HTMLElement) => el.offsetParent !== null

export function filasNavegables(): HTMLElement[] {
  const main = principal()
  if (!main) return []
  return Array.from(main.querySelectorAll<HTMLElement>('[data-fila]')).filter(visible)
}

export const esFila = (el: EventTarget | null): el is HTMLElement =>
  el instanceof HTMLElement && el.hasAttribute('data-fila')

export function buscadorDePagina(): HTMLInputElement | null {
  const el = principal()?.querySelector<HTMLInputElement>('[data-busqueda]')
  return el && visible(el) ? el : null
}

/**
 * Mueve el foco entre las filas. Devuelve false si no hay filas (para que la
 * página haga su scroll normal). Desde la primera fila, ↑ vuelve al buscador.
 */
export function moverFila(destino: 1 | -1 | 'inicio' | 'fin', actual: EventTarget | null): boolean {
  const filas = filasNavegables()
  if (filas.length === 0) return false
  const indice = esFila(actual) ? filas.indexOf(actual) : -1

  let siguiente: number
  if (destino === 'inicio') siguiente = 0
  else if (destino === 'fin') siguiente = filas.length - 1
  else if (indice === -1) siguiente = destino === 1 ? 0 : filas.length - 1
  else siguiente = indice + destino

  if (siguiente < 0) {
    const buscador = buscadorDePagina()
    if (buscador) buscador.focus()
    return true
  }
  const fila = filas[Math.min(siguiente, filas.length - 1)]
  fila.focus()
  fila.scrollIntoView({ block: 'nearest' })
  return true
}

/** Pasa a la pestaña vecina del TabsList marcado. False si la página no tiene. */
export function cambiarPestana(delta: 1 | -1): boolean {
  const lista = principal()?.querySelector<HTMLElement>('[data-pestanas-flechas]')
  if (!lista) return false
  const pestanas = Array.from(lista.querySelectorAll<HTMLButtonElement>('[role="tab"]')).filter(
    (p) => !p.disabled
  )
  const activa = pestanas.findIndex((p) => p.getAttribute('data-state') === 'active')
  const vecina = pestanas[activa + delta]
  if (!vecina) return true
  // Radix activa la pestaña al recibir el foco (activación automática), no en
  // click. Se suelta el foco después para que ↑/↓ sigan yendo a las filas.
  vecina.focus()
  vecina.blur()
  return true
}

export function botonVolver(): HTMLElement | null {
  return principal()?.querySelector<HTMLElement>('[data-volver]') ?? null
}
