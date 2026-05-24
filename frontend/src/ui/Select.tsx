import type { SelectHTMLAttributes } from 'react'
import { cn } from './cn'

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  selectSize?: 'sm' | 'md'
}

export function Select({ className, selectSize = 'md', ...rest }: Props) {
  return (
    <select
      className={cn('gis-select', selectSize === 'sm' && 'gis-select--sm', className)}
      {...rest}
    />
  )
}
