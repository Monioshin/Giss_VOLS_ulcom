import type { TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ className, ...rest }: Props) {
  return <textarea className={cn('gis-textarea', className)} {...rest} />
}
