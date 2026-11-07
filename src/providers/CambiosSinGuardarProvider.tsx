import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { CambiosSinGuardarContext } from './cambiosSinGuardar'

/**
 * Guarda si la página actual tiene cambios sin guardar y, antes de navegar por
 * atajo, pide confirmación. Va dentro del router (usa `useNavigate`).
 */
export function CambiosSinGuardarProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  // Ref y no estado: marcar no debe re-renderizar toda la app en cada tecla.
  const sucio = useRef(false)
  const [pendiente, setPendiente] = useState<string | null>(null)

  const marcar = useCallback((valor: boolean) => {
    sucio.current = valor
  }, [])

  const navegarSeguro = useCallback(
    (to: string) => {
      if (sucio.current) setPendiente(to)
      else navigate(to)
    },
    [navigate]
  )

  const valor = useMemo(() => ({ marcar, navegarSeguro }), [marcar, navegarSeguro])

  return (
    <CambiosSinGuardarContext.Provider value={valor}>
      {children}
      <ConfirmDialog
        open={pendiente !== null}
        onOpenChange={(abierto) => !abierto && setPendiente(null)}
        title="Hay cambios sin guardar"
        description="Si sales ahora, se pierden los cambios de esta página."
        confirmLabel="Salir sin guardar"
        onConfirm={() => {
          const destino = pendiente
          sucio.current = false
          setPendiente(null)
          if (destino) navigate(destino)
        }}
      />
    </CambiosSinGuardarContext.Provider>
  )
}
