import { Input, type InputProps } from '@/components/ui/input'
import { cn, formatMiles, soloDigitos } from '@/lib/utils'

type InputDineroProps = Omit<InputProps, 'value' | 'onChange' | 'type'> & {
  /** Solo dígitos ('' cuando está vacío). */
  value: string
  onChange: (digitos: string) => void
  /** Clases del input; `className` va al contenedor (ancho, márgenes). */
  inputClassName?: string
}

/**
 * Input de pesos: se teclean dígitos y se muestran agrupados en miles, para no
 * confundir 150.000 con 1.500.000. COP no maneja centavos, así que solo enteros.
 */
export function InputDinero({ value, onChange, className, inputClassName, ...props }: InputDineroProps) {
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="0"
        {...props}
        value={value === '' ? '' : formatMiles(Number(value))}
        onChange={(e) => onChange(soloDigitos(e.target.value))}
        className={cn('pl-7 text-right font-mono', inputClassName)}
      />
    </div>
  )
}
