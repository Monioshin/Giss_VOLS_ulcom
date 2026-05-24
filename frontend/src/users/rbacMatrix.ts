export type RbacRow = {
  action: string
  admin: boolean | 'partial'
  architect: boolean | 'partial'
  user: boolean | 'partial'
}

export const RBAC_MATRIX: RbacRow[] = [
  { action: 'Просмотр карты, базы, сварки, заказов', admin: true, architect: true, user: true },
  { action: 'Линейка на карте (без сохранения)', admin: true, architect: true, user: true },
  { action: 'Редактирование узлов, участков, проектов', admin: true, architect: true, user: false },
  { action: 'Схема сварки муфт / кроссов', admin: true, architect: true, user: false },
  { action: 'Импорт / экспорт JSON и Excel базы', admin: true, architect: false, user: false },
  { action: 'Импорт / экспорт GeoJSON ТК', admin: true, architect: false, user: false },
  { action: 'Переключение рабочих баз', admin: true, architect: true, user: true },
  { action: 'Создание новой рабочей базы', admin: true, architect: false, user: false },
  { action: 'Резервные копии и восстановление', admin: true, architect: false, user: false },
  { action: 'Проверка качества базы', admin: true, architect: false, user: false },
  { action: 'Экспорт трасс KML', admin: true, architect: true, user: true },
  { action: 'Список пользователей', admin: true, architect: true, user: true },
  { action: 'Создание / удаление пользователей', admin: true, architect: false, user: false },
  { action: 'Смена роли и сброс пароля', admin: true, architect: false, user: false },
  { action: 'Смена своего пароля', admin: true, architect: true, user: true },
]

export function rbacCellLabel(v: boolean | 'partial'): string {
  if (v === true) return 'Да'
  if (v === 'partial') return 'Частично'
  return 'Нет'
}
