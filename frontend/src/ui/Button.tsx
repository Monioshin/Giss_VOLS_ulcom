import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  className,
  type = 'button',
  children,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={cn(
        'gis-btn',
        variant === 'primary' && 'gis-btn--primary',
        variant === 'secondary' && 'gis-btn--secondary',
        variant === 'ghost' && 'gis-btn--ghost',
        variant === 'danger' && 'gis-btn--danger',
        size === 'sm' && 'gis-btn--sm',
        size === 'lg' && 'gis-btn--lg',
        size === 'icon' && 'gis-btn--icon',
        block && 'gis-btn--block',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
