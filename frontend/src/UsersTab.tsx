import { useMemo, useState } from 'react'
import { Button } from './ui/Button'
import { FormField } from './ui/FormField'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { UserDrawer } from './users/UserDrawer'
import { roleBadgeClass, roleLabel } from './users/permissions'
import type { UserRole, UserRoleFilter, UserRow, UserSortKey } from './users/types'
import type { ActivityLogEntry } from './userPrefs'

type Props = {
  users: UserRow[]
  authUser: { id: number; username: string; role: UserRole } | null
  activityLog: ActivityLogEntry[]
  onRefresh: () => void | Promise<void>
  onCreateUser: (payload: { username: string; password: string; role: UserRole }) => void | Promise<void>
  onPatchRole: (id: number, role: UserRole) => void | Promise<void>
  onResetPassword: (id: number, password: string) => void | Promise<void>
  onDeleteUser: (id: number) => void | Promise<void>
}

function formatDate(ts: string) {
  try {
    return new Date(ts).toLocaleDateString('ru-RU')
  } catch {
    return ts
  }
}

function sortUsers(rows: UserRow[], key: UserSortKey, asc: boolean): UserRow[] {
  const dir = asc ? 1 : -1
  return [...rows].sort((a, b) => {
    if (key === 'username') return a.username.localeCompare(b.username, 'ru') * dir
    if (key === 'id') return (a.id - b.id) * dir
    return String(a.created_at).localeCompare(String(b.created_at)) * dir
  })
}

export function UsersTab({
  users,
  authUser,
  activityLog,
  onRefresh,
  onCreateUser,
  onPatchRole,
  onResetPassword,
  onDeleteUser,
}: Props) {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRoleFilter>('ALL')
  const [sortKey, setSortKey] = useState<UserSortKey>('username')
  const [sortAsc, setSortAsc] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('USER')
  const [createBusy, setCreateBusy] = useState(false)

  const isAdmin = authUser?.role === 'ADMIN'

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return users.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false
      if (q && !u.username.toLowerCase().includes(q) && !String(u.id).includes(q)) return false
      return true
    })
  }, [users, search, roleFilter])

  const rows = useMemo(() => sortUsers(filtered, sortKey, sortAsc), [filtered, sortKey, sortAsc])
  const selected = selectedId != null ? users.find((u) => u.id === selectedId) : undefined

  const toggleSort = (key: UserSortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const sortInd = (key: UserSortKey) => (sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '')

  const submitCreate = async () => {
    if (!newUsername.trim()) {
      window.alert('Укажите логин')
      return
    }
    if (newPassword.length < 4) {
      window.alert('Пароль не короче 4 символов')
      return
    }
    if (newPassword !== newPassword2) {
      window.alert('Пароли не совпадают')
      return
    }
    setCreateBusy(true)
    try {
      await onCreateUser({ username: newUsername.trim(), password: newPassword, role: newRole })
      setShowCreate(false)
      setNewUsername('')
      setNewPassword('')
      setNewPassword2('')
      setNewRole('USER')
    } finally {
      setCreateBusy(false)
    }
  }

  return (
    <div className="users-tab stack-front">
      <div className="users-app">
        <header className="users-app__head">
          <div>
            <h2>Пользователи</h2>
            <p className="hint">
              Учётные записи системы. Администратор может создавать пользователей, менять роли и сбрасывать пароли.
            </p>
          </div>
          <div className="users-toolbar">
            <label className="users-toolbar__search">
              Поиск
              <input
                type="search"
                className="gis-input"
                placeholder="Логин или id…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="users-toolbar__field">
              <span className="hint">Роль</span>
              <select className="gis-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as UserRoleFilter)}>
                <option value="ALL">Все</option>
                <option value="ADMIN">Администратор</option>
                <option value="ARCHITECT">Архитектор</option>
                <option value="USER">Пользователь</option>
              </select>
            </label>
            <p className="users-toolbar__count">
              Показано <strong>{rows.length}</strong> из <strong>{users.length}</strong>
            </p>
            <button type="button" className="gis-btn gis-btn--secondary" onClick={() => void onRefresh()}>
              Обновить
            </button>
            {isAdmin ? (
              <button type="button" className="gis-btn gis-btn--primary" onClick={() => setShowCreate(true)}>
                Создать
              </button>
            ) : null}
          </div>
        </header>

        <div className="users-list-wrap db-list-wrap">
          {rows.length === 0 ? (
            <p className="hint">Нет пользователей по фильтру.</p>
          ) : (
            <table className="users-table db-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" className="db-th-sort" onClick={() => toggleSort('id')}>
                      id{sortInd('id')}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="db-th-sort" onClick={() => toggleSort('username')}>
                      Логин{sortInd('username')}
                    </button>
                  </th>
                  <th>Роль</th>
                  <th>
                    <button type="button" className="db-th-sort" onClick={() => toggleSort('created_at')}>
                      Создан{sortInd('created_at')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr
                    key={u.id}
                    className={selectedId === u.id ? 'users-row--selected' : undefined}
                    onClick={() => setSelectedId(u.id)}
                  >
                    <td className="gis-num">{u.id}</td>
                    <td className="db-table__title">{u.username}</td>
                    <td>
                      <span className={`user-role-badge user-role-badge--${roleBadgeClass(u.role)}`}>
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="db-table__muted">{formatDate(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected && authUser ? (
        <UserDrawer
          user={selected}
          authUserId={authUser.id}
          isAdmin={isAdmin}
          activityLog={activityLog}
          onClose={() => setSelectedId(null)}
          onPatchRole={onPatchRole}
          onResetPassword={onResetPassword}
          onDelete={async (id) => {
            await onDeleteUser(id)
            setSelectedId(null)
          }}
        />
      ) : null}

      {showCreate && isAdmin ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Новый пользователь</h3>
            <FormField label="Логин">
              <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoComplete="off" />
            </FormField>
            <FormField label="Пароль">
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </FormField>
            <FormField label="Подтверждение пароля">
              <Input
                type="password"
                value={newPassword2}
                onChange={(e) => setNewPassword2(e.target.value)}
                autoComplete="new-password"
              />
            </FormField>
            <FormField label="Роль">
              <Select value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)}>
                <option value="USER">Пользователь (только просмотр)</option>
                <option value="ARCHITECT">Архитектор</option>
                <option value="ADMIN">Администратор</option>
              </Select>
            </FormField>
            <div className="passport-actions gis-btn-group">
              <Button type="button" variant="primary" disabled={createBusy} onClick={() => void submitCreate()}>
                Создать
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>
                Отмена
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
