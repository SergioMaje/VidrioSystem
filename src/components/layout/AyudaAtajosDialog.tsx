import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/shared/Kbd'
import { ATAJO_ALT, ATAJO_CTRL } from '@/hooks/useAtajoConfirmar'

type Atajo = { teclas: string[][]; accion: string }

/** Cada `teclas` es una lista de alternativas; cada alternativa, las teclas a la vez. */
const GRUPOS: { titulo: string; atajos: Atajo[] }[] = [
  {
    titulo: 'Moverse',
    atajos: [
      { teclas: [[ATAJO_ALT, '↑'], [ATAJO_ALT, '↓']], accion: 'Sección anterior / siguiente del menú' },
      { teclas: [['←'], ['→']], accion: 'Pestaña anterior / siguiente' },
      { teclas: [['Esc']], accion: 'Salir del campo o volver atrás' },
    ],
  },
  {
    titulo: 'Listados',
    atajos: [
      { teclas: [['↑'], ['↓']], accion: 'Subir / bajar por las filas' },
      { teclas: [['Enter']], accion: 'Abrir la fila resaltada' },
      { teclas: [['Inicio'], ['Fin']], accion: 'Primera / última fila' },
      { teclas: [['/']], accion: 'Ir al buscador (↓ baja a los resultados)' },
    ],
  },
  {
    titulo: 'Diálogos',
    atajos: [
      { teclas: [['Enter']], accion: 'Confirmar' },
      { teclas: [[ATAJO_CTRL, 'Enter']], accion: 'Confirmar cobros, cierres y anulaciones' },
      { teclas: [['Esc']], accion: 'Cerrar' },
    ],
  },
]

export function AyudaAtajosDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Atajos de teclado</DialogTitle>
          <DialogDescription>Funcionan cuando no estás escribiendo en un campo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {GRUPOS.map(({ titulo, atajos }) => (
            <section key={titulo}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo}</h3>
              <dl className="space-y-1.5 text-sm">
                {atajos.map(({ teclas, accion }) => (
                  <div key={accion} className="flex items-center justify-between gap-4">
                    <dt>{accion}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {teclas.map((combo, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          {i > 0 && <span className="mx-0.5 text-muted-foreground">/</span>}
                          {combo.map((t) => <Kbd key={t} className="opacity-100">{t}</Kbd>)}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
