import { ATAJO_CTRL } from '@/hooks/useAtajoConfirmar'
import { cn } from '@/lib/utils'

/** Una tecla, como pista visual de un atajo. Decorativa para lectores de pantalla. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      aria-hidden
      className={cn(
        'pointer-events-none inline-flex h-5 select-none items-center rounded border border-current px-1.5 font-sans text-[10px] font-medium opacity-60',
        className
      )}
    >
      {children}
    </kbd>
  )
}

/**
 * Pista para el botón principal de un diálogo: "Enter" o "Ctrl Enter".
 * Se oculta en celular, donde no hay teclado físico.
 */
export function PistaConfirmar({ conCtrl = false }: { conCtrl?: boolean }) {
  return (
    <span className="ml-2 hidden items-center gap-0.5 sm:inline-flex">
      {conCtrl && <Kbd>{ATAJO_CTRL}</Kbd>}
      <Kbd>Enter</Kbd>
    </span>
  )
}
