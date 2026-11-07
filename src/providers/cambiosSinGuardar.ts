import { createContext, useContext, useEffect } from 'react'

export type CambiosSinGuardar = {
  /** La página actual marca si tiene cambios sin guardar. */
  marcar: (sucio: boolean) => void
  /** Navega, pero pregunta antes si la página tiene cambios sin guardar. */
  navegarSeguro: (to: string) => void
}

export const CambiosSinGuardarContext = createContext<CambiosSinGuardar | null>(null)

export function useNavegarSeguro() {
  const ctx = useContext(CambiosSinGuardarContext)
  if (!ctx) throw new Error('useNavegarSeguro debe usarse dentro de CambiosSinGuardarProvider')
  return ctx.navegarSeguro
}

/**
 * Registra que la página tiene cambios sin guardar. Al desmontarse la página
 * la marca se limpia sola. Solo cubre la navegación por atajos de teclado.
 */
export function useCambiosSinGuardar(sucio: boolean) {
  const ctx = useContext(CambiosSinGuardarContext)
  const marcar = ctx?.marcar
  useEffect(() => {
    marcar?.(sucio)
    return () => marcar?.(false)
  }, [marcar, sucio])
}
