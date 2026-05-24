import { useState } from 'react'
import { Button } from '../ui/Button'
import { RBAC_MATRIX, rbacCellLabel } from './rbacMatrix'
import { roleLabel } from './permissions'
import type { UserRole, UserRow } from './types'
import type { ActivityLogEntry } from '../userPrefs'

type Tab = 'profile' | 'rbac' | 'log'

type Props = {
  user: UserRow
  authUserId: number
  isAdmin: boolean
  activityLog: ActivityLogEntry[]
  onClose: () => void
  onPatchRole: (id: number, role: UserRole) => void | Promise<void>
  onResetPassword: (id: number, password: string) => void | Promise<void>
  onDelete: (id: number) => void | Promise<void>
}

function formatTs(ts: string) {
  try {
    return new Date(ts).toLocaleString('ru-RU')
  } catch {
    return ts
  }
}

export function UserDrawer({
  user,
  authUserId,
  isAdmin,
  activityLog,
  onClose,
  onPatchRole,
  onResetPassword,
  onDelete,
}: Props) {
  const [tab, setTab] = useState<Tab>('profile')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const userLog = activityLog.filter((e) => e.user === user.username).slice(0, 50)
  const canEdit = isAdmin
  const isSelf = user.id === authUserId

  const submitReset = async () => {
    if (newPassword.length < 4) {
      window.alert('Пароль не короче 4 символов')
      return
    }
    if (newPassword !== confirmPassword) {
      window.alert('Пароли не совпадают')
      return
    }
    setBusy(true)
    try {
      await onResetPassword(user.id, newPassword)
      setNewPassword('')
      setConfirmPassword('')
      window.alert('Пароль обновлён')
    } finally {
      setBusy(false)
    }
  }

  const submitDelete = async () => {
    if (!window.confirm(`Удалить пользователя «${user.username}»?`)) return
    setBusy(true)
    try {
      await onDelete(user.id)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="passport-backdrop" role="presentation" onClick={onClose} />
      <aside className="passport passport--drawer users-drawer" role="dialog" aria-labelledby="user-drawer-title">
        <div className="passport-drawer__head passport-drawer__head--rich">
          <div className="passport-drawer__title-block" style={{ borderLeftColor: user.role === 'ADMIN' ? '#6366f1' : user.role === 'ARCHITECT' ? '#f59e0b' : '#0ea5e9' }}>
            <h3 id="user-drawer-title">{user.username}</h3>
            <p className="passport-drawer__meta">
              id {user.id} · {roleLabel(user.role)} · создан {formatTs(user.created_at)}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="passport-drawer__close" onClick={onClose} aria-label="Закрыть">
            ×
          </Button>
        </div>

        <nav className="passport-tabs">
          {(['profile', 'rbac', 'log'] as const).map((t) => (
            <button key={t} type="button" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'profile' ? 'Профиль' : t === 'rbac' ? 'Права' : 'Журнал'}
            </button>
          ))}
        </nav>

        <div className="passport-drawer__body">
          {tab === 'profile' && (
            <>
              <label>Логин</label>
              <input readOnly value={user.username} />
              <label>Роль</label>
              {canEdit ? (
                <select
                  value={user.role}
                  disabled={isSelf || busy}
                  onChange={(e) => void onPatchRole(user.id, e.target.value as UserRole)}
                >
                  <option value="USER">Пользователь (только просмотр)</option>
                  <option value="ARCHITECT">Архитектор</option>
                  <option value="ADMIN">Администратор</option>
                </select>
              ) : (
                <input readOnly value={roleLabel(user.role)} />
              )}
              {isSelf && canEdit ? <p className="hint">Нельзя снять с себя роль администратора.</p> : null}

              {canEdit ? (
                <>
                  <h4 className="users-drawer__section">Сброс пароля</h4>
                  <label>Новый пароль</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <label>Подтверждение</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => void submitReset()}>
                    Сбросить пароль
                  </Button>
                </>
              ) : null}
            </>
          )}

          {tab === 'rbac' && (
            <table className="users-rbac-table">
              <thead>
                <tr>
                  <th>Действие</th>
                  <th>ADMIN</th>
                  <th>ARCHITECT</th>
                  <th>USER</th>
                </tr>
              </thead>
              <tbody>
                {RBAC_MATRIX.map((row) => (
                  <tr key={row.action}>
                    <td>{row.action}</td>
                    <td>{rbacCellLabel(row.admin)}</td>
                    <td>{rbacCellLabel(row.architect)}</td>
                    <td>{rbacCellLabel(row.user)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'log' && (
            <>
              {userLog.length === 0 ? (
                <p className="hint">Записей для этого пользователя в локальном журнале нет.</p>
              ) : (
                <ul className="users-activity-log">
                  {userLog.map((e, i) => (
                    <li key={`${e.at}-${i}`}>
                      <time dateTime={e.at}>{formatTs(e.at)}</time>
                      <span>{e.action}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {canEdit && !isSelf && tab === 'profile' ? (
          <div className="passport-drawer__foot">
            <div className="passport-actions">
              <Button type="button" variant="danger" className="passport-delete-btn" disabled={busy} onClick={() => void submitDelete()}>
                Удалить пользователя
              </Button>
            </div>
          </div>
        ) : null}
      </aside>
    </>
  )
}
