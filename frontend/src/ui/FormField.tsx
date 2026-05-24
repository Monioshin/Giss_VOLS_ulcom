import type { ReactNode } from 'react'
import { cn } from './cn'

type Props = {
  label?: string
  hint?: string
  error?: string
  htmlFor?: string
  className?: string
  children: ReactNode
}

export function FormField({ label, hint, error, htmlFor, className, children }: Props) {
  return (
    <div className={cn('gis-field', className)}>
      {label ? (
        <label className="gis-field__label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? <span className="gis-field__error">{error}</span> : null}
      {hint && !error ? <span className="gis-field__hint">{hint}</span> : null}
    </div>
  )
}
