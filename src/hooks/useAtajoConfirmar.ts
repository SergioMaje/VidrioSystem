import { useCallback, useRef, type KeyboardEvent } from 'react'

/**
 * Enter (o Ctrl+Enter) para confirmar un diálogo que no es un `<form>`.
 * Devuelve un `onKeyDown` para `DialogContent`.
 *
 * Con `conCtrl` exige Ctrl+Enter (⌘+Enter en Mac): es para cobros, cierres,
 * anulaciones y eliminaciones, donde un Enter de más repetiría la operación.
 *
 * No dispara:
 * - con la tecla sostenida (`repeat`) ni durante composición de texto;
 * - con Enter solo y el foco en un botón: el navegador ya lo pulsa
 *   (Ctrl+Enter sí confirma, aunque el foco esté en "Cancelar");
 * - en un textarea con Enter solo (es salto de línea);
 * - con un combobox abierto (Select de Radix): Enter elige la opción;
 * - si `habilitado` es falso (validación pendiente u operación en curso).
 */
export function useAtajoConfirmar(
  onConfirmar: () => void | Promise<unknown>,
  { habilitado, conCtrl = false }: { habilitado: boolean; conCtrl?: boolean }
) {
  // El handler se lee de una ref para que el callback no cambie en cada render.
  const confirmar = useRef(onConfirmar)
  confirmar.current = onConfirmar
  // `isPending` tarda un render en llegar a `habilitado`: dos pulsaciones en el
  // mismo instante pasarían las dos. Mientras la primera corre, se ignoran.
  const enCurso = useRef(false)

  return useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.nativeEvent.isComposing) return
      const conModificador = e.ctrlKey || e.metaKey
      if (conCtrl && !conModificador) return
      if (e.altKey || e.shiftKey) return

      const destino = e.target as HTMLElement
      if (destino.getAttribute('aria-expanded') === 'true') return
      // Enter solo sobre un botón lo pulsa el navegador. Ctrl+Enter es siempre
      // "confirmar": Radix enfoca primero "Cancelar", y sin esto Ctrl+Enter lo
      // pulsaba. El preventDefault de abajo evita ese clic nativo.
      if (!conModificador && destino.closest('button, a, [role="button"], [role="option"], [role="tab"]')) return
      if (destino instanceof HTMLTextAreaElement && !conModificador) return
      if (!habilitado || enCurso.current) {
        // Deshabilitado: tampoco se deja que Ctrl+Enter pulse el botón enfocado.
        if (conModificador) e.preventDefault()
        return
      }

      e.preventDefault()
      e.stopPropagation()
      enCurso.current = true
      Promise.resolve()
        .then(() => confirmar.current())
        .finally(() => {
          enCurso.current = false
        })
    },
    [habilitado, conCtrl]
  )
}

/** Texto de la pista del atajo, según la plataforma. */
export const ATAJO_CTRL = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'
