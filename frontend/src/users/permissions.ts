import type { UserRole } from './types'

export function canEditData(role: UserRole | null | undefined): boolean {
  return role === 'ADMIN' || role === 'ARCHITECT'
}

export function canImportExportDatabase(role: UserRole | null | undefined): boolean {
  return role === 'ADMIN'
}

export function isViewer(role: UserRole | null | undefined): boolean {
  return role === 'USER' || role == null
}

export function roleLabel(role: UserRole): string {
  if (role === 'ADMIN') return 'Администратор'
  if (role === 'ARCHITECT') return 'Архитектор'
  return 'Пользователь'
}

export function roleBadgeClass(role: UserRole): 'admin' | 'architect' | 'user' {
  if (role === 'ADMIN') return 'admin'
  if (role === 'ARCHITECT') return 'architect'
  return 'user'
}
