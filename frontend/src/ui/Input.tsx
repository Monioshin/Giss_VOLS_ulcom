import type { InputHTMLAttributes } from 'react'
import { cn } from './cn'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  inputSize?: 'sm' | 'md'
}

export function Input({ className, inputSize = 'md', ...rest }: Props) {
  return (
    <input
      className={cn('gis-input', inputSize === 'sm' && 'gis-input--sm', className)}
      {...rest}
    />
  )
}
