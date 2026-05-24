import { useRef, useState, type ChangeEvent } from 'react'
import type { BackupConfig, BackupEntry } from './settingsTypes'
import type { FiberCableStatus, Project, UserPrefs, UserPrefsPatch } from './userPrefs'
import { BACKUP_INTERVAL_OPTIONS } from './settingsConstants'
import { Button } from './ui/Button'
import { FormField } from './ui/FormField'
import { Input } from './ui/Input'
import { Textarea } from './ui/Textarea'
import { COLUMN_HELP, COLUMN_REQUIRED_LABELS, EXCEL_MASS_IMPORT_HINT } from './import/excelImport'
import { roleLabel } from './users/permissions'

type SettingsSectionId = 'profile' | 'ui' | 'map' | 'workflow' | 'export' | 'backup' | 'integrations' | 'about'

const SECTION_LEADS: Partial<Record<SettingsSectionId, string>> = {
  profile: 'Сессия, пароль и права доступа.',
  ui: 'Тема и плотность интерфейса.',
  map: 'Подложка, слои и поведение карты.',
  workflow: 'Проект по умолчанию, ВОЛС и маршруты.',
  export: 'Импорт и экспорт данных.',
  backup: 'Автоматические и ручные копии базы.',
}

const SECTIONS: { id: SettingsSectionId; label: string }[] = [
  { id: 'profile', label: 'Профиль' },
  { id: 'ui', label: 'Интерфейс' },
  { id: 'map', label: 'Карта' },
  { id: 'workflow', label: 'Данные' },
  { id: 'export', label: 'Экспорт' },
  { id: 'backup', label: 'Копии' },
  { id: 'integrations', label: 'Интеграции' },
  { id: 'about', label: 'О системе' },
]

const FIBER_STATUS_OPTIONS: FiberCableStatus[] = ['READY', 'IN_WORK', 'OFFLINE', 'ACCIDENT', 'CONSTRUCTION']
const FIBER_STATUS_LABELS: Record<FiberCableStatus, string> = {
  READY: 'Готов',
  IN_WORK: 'В работе',
  OFFLINE: 'Отключён',
  ACCIDENT: 'Авария',
  CONSTRUCTION: 'Строительство',
}

const STARTUP_TABS: { value: UserPrefs['workflow']['startupTab']; label: string }[] = [
  { value: 'last', label: 'Последняя вкладка' },
  { value: 'map', label: 'Карта' },
  { value: 'database', label: 'База данных' },
  { value: 'settings', label: 'Настройки' },
]

export type SettingsPanelProps = {
  prefs: UserPrefs
  onPatchPrefs: (patch: UserPrefsPatch) => void
  authUser: { username: string; role: 'ADMIN' | 'ARCHITECT' | 'USER' } | null
  projects: Project[]
  importHelp: string
  importJsonText: string
  onImportJsonText: (v: string) => void
  onExportJson: () => void
  onImportJson: () => void
  onDownloadImportTemplateExcel: () => void
  onImportExcelFile: (file: File) => void
  onExportNodesExcelAll: () => void
  onExportNodesExcelMapView: () => void
  onExportGeoJsonTk: () => Promise<void>
  onImportGeoJsonTk: (file: File) => Promise<void>
  onFetchDatabaseHealthReport: () => Promise<{
    ok: boolean
    summary: { errors: number; warnings: number }
    issues: { severity: string; message: string; entity: string; id: number }[]
  }>
  onExportKml: () => void
  canImportData: boolean
  backupConfig: BackupConfig
  backupList: BackupEntry[]
  backupBusy: boolean
  onSaveBackupConfig: (patch: Partial<BackupConfig>) => void
  onCreateBackup: () => void
  onRestoreBackup: (filename: string, info?: { projects: number; nodes: number; edges: number }) => void
  onDeleteBackup: (filename: string) => void
  onDownloadBackup: (filename: string) => void
  onFetchBackupInfo: (filename: string) => Promise<{ projects: number; nodes: number; edges: number }>
  activityLog: { at: string; user: string; action: string }[]
  appVersion: string
  onLogout: () => void
  onChangePassword: (current: string, next: string) => Promise<void>
  isAdmin: boolean
  workspaces: {
    id: number
    name: string
    created_at: string
    is_active: boolean
    is_mine?: boolean
    is_server_default?: boolean
  }[]
  workspaceSelect: string
  onWorkspaceSelectChange: (name: string) => void
  onSwitchWorkspace: (name?: string) => void | Promise<void>
  onSetServerDefaultWorkspace?: (name?: string) => void | Promise<void>
  onCreateWorkspace: (name: string) => Promise<{ name: string }>
  onDeleteWorkspace: (name: string) => Promise<void>
  workspaceBusy: boolean
}

export function SettingsPanel(props: SettingsPanelProps) {
  const [section, setSection] = useState<SettingsSectionId>('profile')
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwNew2, setPwNew2] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const excelFileInputRef = useRef<HTMLInputElement>(null)
  const geojsonFileInputRef = useRef<HTMLInputElement>(null)
  const [showCreateWorkspaceModal, setShowCreateWorkspaceModal] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [createWorkspaceStep, setCreateWorkspaceStep] = useState<'form' | 'done'>('form')
  const [createdWorkspaceName, setCreatedWorkspaceName] = useState('')
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null)
  const [deleteWorkspaceError, setDeleteWorkspaceError] = useState<string | null>(null)

  const handleJsonFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => props.onImportJsonText(String(reader.result ?? ''))
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  const handleExcelFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) props.onImportExcelFile(file)
    e.target.value = ''
  }

  const handleGeoJsonFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void props.onImportGeoJsonTk(file).catch((err) => window.alert(err instanceof Error ? err.message : String(err)))
    e.target.value = ''
  }

  const closeCreateWorkspaceModal = () => {
    setShowCreateWorkspaceModal(false)
    setCreateWorkspaceStep('form')
    setCreateWorkspaceError(null)
  }

  const submitCreateWorkspace = async () => {
    const name = newWorkspaceName.trim()
    if (name.length < 2) {
      setCreateWorkspaceError('Название: от 2 до 64 символов')
      return
    }
    setCreateWorkspaceError(null)
    try {
      const created = await props.onCreateWorkspace(name)
      setCreatedWorkspaceName(created.name)
      setCreateWorkspaceStep('done')
    } catch (err) {
      setCreateWorkspaceError(err instanceof Error ? err.message : String(err))
    }
  }

  const switchToCreatedWorkspace = async () => {
    try {
      await props.onSwitchWorkspace(createdWorkspaceName)
      closeCreateWorkspaceModal()
    } catch (err) {
      setCreateWorkspaceError(err instanceof Error ? err.message : String(err))
    }
  }

  const confirmDeleteWorkspace = async () => {
    const name = props.workspaceSelect.trim()
    if (!name) return
    const activeName = props.workspaces.find((w) => w.is_mine ?? w.is_active)?.name
    const isActive = name === activeName
    const msg = isActive
      ? `Удалить активную базу «${name}»?\n\nВсе проекты, узлы и участки будут безвозвратно удалены. Откроется другая база из списка.`
      : `Удалить базу «${name}»?\n\nВсе проекты, узлы и участки в ней будут безвозвратно удалены.`
    if (!window.confirm(msg)) return
    setDeleteWorkspaceError(null)
    try {
      await props.onDeleteWorkspace(name)
    } catch (err) {
      setDeleteWorkspaceError(err instanceof Error ? err.message : String(err))
    }
  }

  const runHealthReport = () => {
    void props
      .onFetchDatabaseHealthReport()
      .then((r) => {
        const lines = r.issues.slice(0, 25).map((i) => `[${i.severity}] ${i.message}`)
        const more = r.issues.length > 25 ? `\n…и ещё ${r.issues.length - 25}` : ''
        window.alert(
          `Проверка базы\nОшибок: ${r.summary.errors}, предупреждений: ${r.summary.warnings}\n\n${lines.join('\n')}${more}`,
        )
      })
      .catch((err) => window.alert(err instanceof Error ? err.message : String(err)))
  }

  const submitPassword = async () => {
    if (pwNew !== pwNew2) {
      window.alert('Новые пароли не совпадают')
      return
    }
    try {
      await props.onChangePassword(pwCurrent, pwNew)
      setPwCurrent('')
      setPwNew('')
      setPwNew2('')
      window.alert('Пароль изменён')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Ошибка смены пароля')
    }
  }

  const restoreWithInfo = async (filename: string) => {
    try {
      const info = await props.onFetchBackupInfo(filename)
      props.onRestoreBackup(filename, info)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Не удалось прочитать копию')
    }
  }

  const p = props.prefs

  return (
    <div className="settings-app settings-app--anchored">
      <nav className="settings-app__nav" aria-label="Разделы настроек">
        {SECTIONS.map((s) => (
          <Button
            key={s.id}
            type="button"
            variant="ghost"
            className={section === s.id ? 'is-active' : ''}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </Button>
        ))}
      </nav>
      <div className="settings-app__panels">
        <h2>Настройки</h2>
        {SECTION_LEADS[section] ? <p className="settings-section__lead hint">{SECTION_LEADS[section]}</p> : null}

        {section === 'profile' && (
          <>
            <section className="settings-section settings-section--card" id="settings-profile">
              <h3>Сессия</h3>
              <p className="hint">
                {props.authUser
                  ? `Вы вошли как ${props.authUser.username} (${roleLabel(props.authUser.role).toLowerCase()})`
                  : '—'}
              </p>
              <button type="button" className="settings-btn-inline gis-btn gis-btn--secondary" onClick={props.onLogout}>
                Выйти
              </button>
            </section>
            <section className="settings-section settings-section--card">
              <h3>Смена пароля</h3>
              <label>
                Текущий пароль
                <input type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} autoComplete="current-password" />
              </label>
              <label>
                Новый пароль
                <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} autoComplete="new-password" />
              </label>
              <label>
                Повтор нового пароля
                <input type="password" value={pwNew2} onChange={(e) => setPwNew2(e.target.value)} autoComplete="new-password" />
              </label>
              <button type="button" className="settings-btn-inline gis-btn gis-btn--secondary" onClick={() => void submitPassword()}>
                Сохранить пароль
              </button>
            </section>
            <section className="settings-section settings-section--card">
              <h3>Безопасность сессии</h3>
              <label>
                Автовыход при неактивности (минут, 0 — выкл.)
                <input
                  type="number"
                  min={0}
                  max={480}
                  value={p.security.sessionTimeoutMinutes}
                  onChange={(e) =>
                    props.onPatchPrefs({
                      security: { sessionTimeoutMinutes: Math.max(0, Number(e.target.value) || 0) },
                    })
                  }
                />
              </label>
            </section>
            <section className="settings-section settings-section--card">
              <h3>Роли в системе</h3>
              <ul className="hint settings-roles-hint">
                <li>
                  <strong>Администратор</strong> — полный доступ, импорт/экспорт и создание рабочих баз.
                </li>
                <li>
                  <strong>Архитектор</strong> — карта, паспорта, сварка; без импорта и экспорта базы.
                </li>
                <li>
                  <strong>Пользователь</strong> — только просмотр (карта, база, сварка без сохранения).
                </li>
              </ul>
            </section>
          </>
        )}

        {section === 'ui' && (
          <section className="settings-section settings-section--card" id="settings-ui">
            <h3>Внешний вид</h3>
            <label className="settings-choice">
              <input
                type="radio"
                name="theme"
                checked={p.theme === 'light'}
                onChange={() => props.onPatchPrefs({ theme: 'light' })}
              />{' '}
              Светлая
            </label>
            <label className="settings-choice">
              <input
                type="radio"
                name="theme"
                checked={p.theme === 'dark'}
                onChange={() => props.onPatchPrefs({ theme: 'dark' })}
              />{' '}
              Тёмная
            </label>
            <label className="settings-choice">
              <input
                type="radio"
                name="theme"
                checked={p.theme === 'auto'}
                onChange={() => props.onPatchPrefs({ theme: 'auto' })}
              />{' '}
              Как в системе
            </label>
            <label>
              Плотность интерфейса
              <select
                value={p.uiDensity}
                onChange={(e) => props.onPatchPrefs({ uiDensity: e.target.value as UserPrefs['uiDensity'] })}
              >
                <option value="normal">Обычная</option>
                <option value="compact">Компактная</option>
              </select>
            </label>
          </section>
        )}

        {section === 'map' && (
          <section className="settings-section settings-section--card" id="settings-map">
            <h3>Карта и отображение</h3>
            <label>
              Подложка по умолчанию
              <select
                value={p.map.basemap}
                onChange={(e) => props.onPatchPrefs({ map: { basemap: e.target.value as UserPrefs['map']['basemap'] } })}
              >
                <option value="streets">Схема (OSM)</option>
                <option value="satellite">Спутник</option>
                <option value="hybrid">Гибрид</option>
              </select>
            </label>
            <label className="settings-choice">
              <input
                type="checkbox"
                checked={!p.map.hideMapLabels}
                onChange={(e) => props.onPatchPrefs({ map: { hideMapLabels: !e.target.checked } })}
              />{' '}
              Подписи на карте
            </label>
            <label className="settings-choice">
              <input
                type="checkbox"
                checked={p.map.layersKanal}
                onChange={(e) => props.onPatchPrefs({ map: { layersKanal: e.target.checked } })}
              />{' '}
              Слой канализации
            </label>
            <label className="settings-choice">
              <input
                type="checkbox"
                checked={p.map.layersVols}
                onChange={(e) => props.onPatchPrefs({ map: { layersVols: e.target.checked } })}
              />{' '}
              Слой ВОЛС
            </label>
            <label className="settings-choice">
              <input
                type="checkbox"
                checked={p.map.clusterEnabled}
                onChange={(e) => props.onPatchPrefs({ map: { clusterEnabled: e.target.checked } })}
              />{' '}
              Кластеризация узлов (zoom ≤ 13)
            </label>
            <label className="settings-choice">
              <input
                type="checkbox"
                checked={p.map.autoClusterWhenLarge}
                onChange={(e) => props.onPatchPrefs({ map: { autoClusterWhenLarge: e.target.checked } })}
              />{' '}
              Автокластер при &gt;200 узлах
            </label>
            <label className="settings-choice">
              <input
                type="checkbox"
                checked={p.map.bboxLoadWhenLarge}
                onChange={(e) => props.onPatchPrefs({ map: { bboxLoadWhenLarge: e.target.checked } })}
              />{' '}
              Подгрузка узлов по карте при &gt;400 в базе
            </label>
            <label>
              Zoom для колодцев, муфт и кроссов
              <input
                type="number"
                min={16}
                max={18}
                step={1}
                value={p.map.tkDetailZoom ?? 16}
                onChange={(e) =>
                  props.onPatchPrefs({
                    map: { tkDetailZoom: Math.min(18, Math.max(16, Number(e.target.value) || 16)) },
                  })
                }
              />
              <span className="hint">
                Узлы и подписи появляются при zoom ≥ этого значения (по умолчанию 16). Размер маркеров на экране не
                меняется при приближении. Линии участков видны всегда.
              </span>
            </label>
            <label>
              Порог полной детализации линий (zoom)
              <input
                type="number"
                min={8}
                max={18}
                value={p.map.minEdgeZoom}
                onChange={(e) => props.onPatchPrefs({ map: { minEdgeZoom: Number(e.target.value) || 15 } })}
              />
              <span className="hint">
                Линии ВОЛС и канализации видны на всех масштабах. Ниже этого zoom геометрия упрощается для
                производительности; с zoom ≥ значения — все изгибы.
              </span>
            </label>
            <label className="settings-choice">
              <input
                type="checkbox"
                checked={p.map.smoothFly}
                onChange={(e) => props.onPatchPrefs({ map: { smoothFly: e.target.checked } })}
              />{' '}
              Плавный полёт к объекту при поиске
            </label>
            <label>
              Скорость полёта
              <select
                value={p.map.flySpeed}
                onChange={(e) => props.onPatchPrefs({ map: { flySpeed: e.target.value as UserPrefs['map']['flySpeed'] } })}
              >
                <option value="fast">Быстро</option>
                <option value="normal">Нормально</option>
                <option value="slow">Медленно</option>
              </select>
            </label>
            <label className="settings-choice">
              <input
                type="checkbox"
                checked={p.map.rememberLastView}
                onChange={(e) => props.onPatchPrefs({ map: { rememberLastView: e.target.checked } })}
              />{' '}
              Запоминать положение карты при выходе
            </label>
            {!p.map.rememberLastView && (
              <label>
                Стартовый масштаб
                <input
                  type="number"
                  min={8}
                  max={19}
                  value={p.map.defaultZoom}
                  onChange={(e) =>
                    props.onPatchPrefs({ map: { defaultZoom: Math.min(19, Math.max(8, Number(e.target.value) || 13)) } })
                  }
                />
              </label>
            )}
          </section>
        )}

        {section === 'workflow' && (
          <section className="settings-section settings-section--card" id="settings-workflow">
            <h3>Рабочий контекст</h3>
            <label>
              Проект по умолчанию
              <select
                value={p.workflow.defaultProjectId ?? ''}
                onChange={(e) =>
                  props.onPatchPrefs({
                    workflow: { defaultProjectId: e.target.value === '' ? null : Number(e.target.value) },
                  })
                }
              >
                <option value="">Не выбран</option>
                {props.projects.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Вкладка при запуске
              <select
                value={p.workflow.startupTab}
                onChange={(e) =>
                  props.onPatchPrefs({ workflow: { startupTab: e.target.value as UserPrefs['workflow']['startupTab'] } })
                }
              >
                {STARTUP_TABS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-choice">
              <input
                type="checkbox"
                checked={p.workflow.hideMapToolsHint}
                onChange={(e) => props.onPatchPrefs({ workflow: { hideMapToolsHint: e.target.checked } })}
              />{' '}
              Скрыть длинную подсказку в панели карты
            </label>
            <label className="settings-choice">
              <input
                type="checkbox"
                checked={p.workflow.showRoutePanel}
                onChange={(e) => props.onPatchPrefs({ workflow: { showRoutePanel: e.target.checked } })}
              />{' '}
              Показывать панель маршрутов на карте
            </label>
            <div className="settings-subsection"><h3>Дефолты ВОЛС</h3>
            <label>
              Волокон в кабеле
              <input
                value={p.cableDefaults.totalFibers}
                onChange={(e) => props.onPatchPrefs({ cableDefaults: { totalFibers: e.target.value } })}
              />
            </label>
            <label>
              Занято волокон
              <input
                value={p.cableDefaults.usedFibers}
                onChange={(e) => props.onPatchPrefs({ cableDefaults: { usedFibers: e.target.value } })}
              />
            </label>
            <label>
              Статус кабеля
              <select
                value={p.cableDefaults.cableStatus}
                onChange={(e) =>
                  props.onPatchPrefs({ cableDefaults: { cableStatus: e.target.value as FiberCableStatus } })
                }
              >
                {FIBER_STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {FIBER_STATUS_LABELS[st]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Шаблон имени кабеля (<code>{'{n}'}</code>, <code>{'{project}'}</code>)
              <input
                value={p.cableDefaults.nameTemplate}
                onChange={(e) => props.onPatchPrefs({ cableDefaults: { nameTemplate: e.target.value } })}
              />
            </label>
            </div><div className="settings-subsection"><h3>Маршруты</h3>
            <label>
              Свободных волокон для поиска
              <input
                value={p.workflow.requiredFreeFibers}
                onChange={(e) => props.onPatchPrefs({ workflow: { requiredFreeFibers: e.target.value } })}
              />
            </label>
            <label>
              Резерв волокон на маршруте
              <input
                value={p.workflow.routeReserveFibers}
                onChange={(e) => props.onPatchPrefs({ workflow: { routeReserveFibers: e.target.value } })}
              />
            </label>
            </div><div className="settings-subsection"><h3>Подтверждения</h3>
            <label>
              Перед удалением
              <select
                value={p.workflow.deleteConfirm}
                onChange={(e) =>
                  props.onPatchPrefs({
                    workflow: { deleteConfirm: e.target.value as UserPrefs['workflow']['deleteConfirm'] },
                  })
                }
              >
                <option value="always">Всегда спрашивать</option>
                <option value="edges_only">Только участки и проекты</option>
                <option value="never">Не спрашивать</option>
              </select>
            </label>
          </div>
          </section>
        )}

        {section === 'export' && (
          <>
            <section className="settings-section settings-section--card" id="settings-export">
              <h3>База данных (JSON)</h3>
              {!props.canImportData && (
                <p className="hint settings-io__warn">Импорт и восстановление доступны только администратору.</p>
              )}
              <div className="settings-io__actions gis-btn-group">
                <button type="button" className="gis-btn gis-btn--secondary" disabled={!props.canImportData} onClick={props.onExportJson}>
                  Скачать JSON
                </button>
                <button type="button" className="settings-io__danger gis-btn gis-btn--danger" disabled={!props.canImportData} onClick={props.onImportJson}>
                  Импорт из поля
                </button>
                <button type="button" className="gis-btn gis-btn--secondary" disabled={!props.canImportData} onClick={() => fileInputRef.current?.click()}>
                  Выбрать файл…
                </button>
                <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={handleJsonFile} />
              </div>
              <details className="settings-io__format">
                <summary>Формат JSON</summary>
                <pre className="settings-io__pre">{props.importHelp}</pre>
              </details>
              <FormField label="JSON для импорта">
              <Textarea
                className="settings-io__textarea"
                value={props.importJsonText}
                onChange={(e) => props.onImportJsonText(e.target.value)}
                spellCheck={false}
                disabled={!props.canImportData}
              />
            </FormField>
            </section>
            <section className="settings-section settings-section--card" id="settings-export-excel">
              <h3>База данных (Excel)</h3>
              <p className="hint settings-io__lead">{EXCEL_MASS_IMPORT_HINT}</p>
              <p className="hint settings-io__lead">
                Существующие записи не удаляются; пустой <code>id</code> — автонумерация. Полная замена базы — только JSON выше.
              </p>
              {!props.canImportData && (
                <p className="hint settings-io__warn">Импорт доступен только администратору.</p>
              )}
              <div className="settings-io__actions gis-btn-group">
                <button type="button" className="gis-btn gis-btn--secondary" onClick={props.onDownloadImportTemplateExcel}>
                  Скачать шаблон Excel
                </button>
                <button type="button" className="gis-btn gis-btn--secondary" disabled={!props.canImportData} onClick={props.onExportNodesExcelAll}>
                  Excel: все ТК
                </button>
                <button type="button" className="gis-btn gis-btn--secondary" disabled={!props.canImportData} onClick={props.onExportNodesExcelMapView}>
                  Excel: ТК на карте
                </button>
                <button
                  type="button"
                  className="gis-btn gis-btn--primary"
                  disabled={!props.canImportData}
                  onClick={() => excelFileInputRef.current?.click()}
                >
                  Импорт из Excel…
                </button>
                <input
                  ref={excelFileInputRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  hidden
                  onChange={handleExcelFile}
                />
              </div>
              <details className="settings-io__format" open>
                <summary>Колонки и правила</summary>
                <div className="settings-excel-columns">
                  {COLUMN_HELP.map((sheet) => (
                    <div key={sheet.sheet} className="settings-excel-columns__block">
                      <h4>
                        Лист <code>{sheet.sheet}</code> — {sheet.title}
                      </h4>
                      <table className="settings-excel-columns__table">
                        <thead>
                          <tr>
                            <th>Колонка</th>
                            <th>Обязательность</th>
                            <th>Описание</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sheet.columns.map((col) => (
                            <tr key={col.column}>
                              <td>
                                <code>{col.column}</code>
                              </td>
                              <td>
                                <span className={`settings-excel-req settings-excel-req--${col.required.replace(/\s+/g, '-')}`}>
                                  {COLUMN_REQUIRED_LABELS[col.required]}
                                </span>
                              </td>
                              <td>{col.description}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </details>
              {props.canImportData && (
                <div className="settings-io__actions gis-btn-group" style={{ marginTop: 12 }}>
                  <button type="button" className="gis-btn gis-btn--secondary" onClick={runHealthReport}>
                    Проверка качества базы
                  </button>
                </div>
              )}
            </section>
            <section className="settings-section settings-section--card" id="settings-workspaces">
              <h3>Рабочие базы данных</h3>
              <p className="hint settings-io__lead">
                Каждая база — отдельный набор проектов и объектов на карте. Учётные записи пользователей общие для всех баз.
              </p>
              <label>
                Моя рабочая база
                <select
                  className="gis-select"
                  value={props.workspaceSelect}
                  disabled={props.workspaceBusy}
                  onChange={(e) => props.onWorkspaceSelectChange(e.target.value)}
                >
                  {props.workspaces.map((w) => (
                    <option key={w.id} value={w.name}>
                      {w.name}
                      {(w.is_mine ?? w.is_active) ? ' (моя)' : ''}
                      {w.is_server_default ? ' · по умолчанию для новых' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <div className="settings-io__actions gis-btn-group">
                <button
                  type="button"
                  className="gis-btn gis-btn--primary"
                  disabled={
                    props.workspaceBusy ||
                    props.workspaceSelect === props.workspaces.find((w) => w.is_mine ?? w.is_active)?.name
                  }
                  onClick={() => void props.onSwitchWorkspace()}
                >
                  {props.workspaceBusy ? 'Переключение…' : 'Переключить'}
                </button>
                {props.isAdmin && props.onSetServerDefaultWorkspace ? (
                  <button
                    type="button"
                    className="gis-btn gis-btn--secondary"
                    disabled={
                      props.workspaceBusy ||
                      props.workspaceSelect === props.workspaces.find((w) => w.is_server_default)?.name
                    }
                    onClick={() => void props.onSetServerDefaultWorkspace?.()}
                  >
                    База по умолчанию для новых
                  </button>
                ) : null}
                {props.isAdmin ? (
                  <button
                    type="button"
                    className="gis-btn gis-btn--secondary"
                    disabled={props.workspaceBusy}
                    onClick={() => {
                      setNewWorkspaceName('')
                      setCreateWorkspaceStep('form')
                      setCreatedWorkspaceName('')
                      setCreateWorkspaceError(null)
                      setShowCreateWorkspaceModal(true)
                    }}
                  >
                    Новая база…
                  </button>
                ) : null}
                {props.isAdmin ? (
                  <button
                    type="button"
                    className="gis-btn gis-btn--danger"
                    disabled={props.workspaceBusy || props.workspaces.length <= 1 || !props.workspaceSelect.trim()}
                    onClick={() => void confirmDeleteWorkspace()}
                  >
                    {props.workspaceBusy ? 'Удаление…' : 'Удалить выбранную…'}
                  </button>
                ) : null}
              </div>
              {deleteWorkspaceError ? <p className="hint settings-io__warn">{deleteWorkspaceError}</p> : null}
              {props.isAdmin && props.workspaces.length <= 1 ? (
                <p className="hint">Единственную базу удалить нельзя — сначала создайте другую.</p>
              ) : null}
            </section>
            <section className="settings-section settings-section--card">
              <h3>Экспорт трасс (KML)</h3>
              <label>
                Проект
                <select
                  value={p.kmlExport.projectId === '' ? '' : String(p.kmlExport.projectId)}
                  onChange={(e) =>
                    props.onPatchPrefs({
                      kmlExport: { projectId: e.target.value === '' ? '' : Number(e.target.value) },
                    })
                  }
                >
                  <option value="">Все проекты</option>
                  {props.projects.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-choice">
              <input
                type="checkbox"
                  checked={p.kmlExport.volsOnly}
                  onChange={(e) => props.onPatchPrefs({ kmlExport: { volsOnly: e.target.checked } })}
                />{' '}
                Только ВОЛС
              </label>
              <label className="settings-choice">
              <input
                type="checkbox"
                  checked={p.kmlExport.includeNodes}
                  onChange={(e) => props.onPatchPrefs({ kmlExport: { includeNodes: e.target.checked } })}
                />{' '}
                Включать узлы
              </label>
              <button type="button" className="settings-btn-inline gis-btn gis-btn--secondary" onClick={props.onExportKml}>
                Скачать KML
              </button>
            </section>
            {props.activityLog.length > 0 && (
              <section className="settings-section settings-section--card">
                <h3>Журнал операций</h3>
                <ul className="settings-activity-log">
                  {props.activityLog.map((e, i) => (
                    <li key={`${e.at}-${i}`}>
                      <span className="settings-activity-log__time">{new Date(e.at).toLocaleString('ru-RU')}</span>
                      <span className="settings-activity-log__user">{e.user}</span>
                      <span>{e.action}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {section === 'backup' && (
          <section className="settings-section settings-section--card" id="settings-backup">
            <h3>Резервные копии</h3>
            {!props.canImportData && <p className="hint settings-io__warn">Восстановление — только для администратора.</p>}
            <label className="settings-backup-toggle">
              <input
                type="checkbox"
                checked={props.backupConfig.enabled}
                onChange={(e) => props.onSaveBackupConfig({ enabled: e.target.checked })}
              />
              Автоматическое резервное копирование
            </label>
            <label>
              Интервал
              <select
                value={props.backupConfig.intervalMinutes}
                disabled={!props.backupConfig.enabled}
                onChange={(e) => props.onSaveBackupConfig({ intervalMinutes: Number(e.target.value) })}
              >
                {BACKUP_INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Хранить не более копий
              <input
                type="number"
                min={1}
                max={200}
                value={props.backupConfig.maxBackups}
                onChange={(e) => props.onSaveBackupConfig({ maxBackups: Number(e.target.value) || 30 })}
              />
            </label>
            <button type="button" className="settings-btn-inline gis-btn gis-btn--secondary" disabled={props.backupBusy} onClick={props.onCreateBackup}>
              {props.backupBusy ? 'Подождите…' : 'Создать копию сейчас'}
            </button>
            <div className="settings-backup-list" aria-label="Список резервных копий">
              {props.backupList.length === 0 ? (
                <p className="hint settings-backup-list__empty">Копий пока нет</p>
              ) : (
                <ul>
                  {props.backupList.map((b) => (
                    <li key={b.id} className="settings-backup-list__row">
                      <div className="settings-backup-list__meta">
                        <span className="settings-backup-list__name">{b.filename}</span>
                        <span className="settings-backup-list__sub">
                          {new Date(b.created_at).toLocaleString('ru-RU')} · {formatBytes(b.size_bytes)}
                        </span>
                      </div>
                      <div className="settings-backup-list__actions">
                        <button type="button" className="gis-btn gis-btn--secondary gis-btn--sm" onClick={() => props.onDownloadBackup(b.filename)}>
                          Скачать
                        </button>
                        <button type="button" className="gis-btn gis-btn--secondary gis-btn--sm" disabled={props.backupBusy || !props.canImportData} onClick={() => void restoreWithInfo(b.filename)}>
                          Восстановить
                        </button>
                        <button
                          type="button"
                          className="settings-io__danger gis-btn gis-btn--danger gis-btn--sm"
                          disabled={props.backupBusy}
                          onClick={() => props.onDeleteBackup(b.filename)}
                        >
                          Удалить
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {section === 'integrations' && (
          <section className="settings-section settings-section--card">
            <h3>Интеграции</h3>
            <p className="hint">Обмен колодцами (ТК) с QGIS и другими ГИС через GeoJSON.</p>
            <div className="settings-io__actions gis-btn-group">
              <button
                type="button"
                className="gis-btn gis-btn--secondary"
                disabled={!props.canImportData}
                onClick={() => void props.onExportGeoJsonTk().catch((e) => window.alert(e instanceof Error ? e.message : String(e)))}
              >
                Скачать GeoJSON (ТК)
              </button>
              <button
                type="button"
                className="gis-btn gis-btn--primary"
                disabled={!props.canImportData}
                onClick={() => geojsonFileInputRef.current?.click()}
              >
                Импорт GeoJSON…
              </button>
              <input
                ref={geojsonFileInputRef}
                type="file"
                accept=".geojson,.json,application/geo+json,application/json"
                hidden
                onChange={handleGeoJsonFile}
              />
            </div>
            <h4>Bitrix24</h4>
            <p className="hint">
              Эндпоинты <code>/integrations/bitrix/*</code>, карта во фрейме CRM по ссылке с{' '}
              <code>#embed=…</code>. Подробности в репозитории: <code>docs/bitrix-integration.md</code>.
            </p>
            <p className="hint">1С, СКАТ, OTDR, SHP — в разработке.</p>
          </section>
        )}

        {section === 'about' && (
          <section className="settings-section settings-section--card" id="settings-about">
            <h3>О системе</h3>
            <dl className="settings-about-dl">
              <dt>Версия API</dt>
              <dd>{props.appVersion}</dd>
              <dt>База данных</dt>
              <dd>SQLite (сервер backend/data)</dd>
              <dt>Режим</dt>
              <dd>Desktop / Web + Leaflet</dd>
            </dl>
          </section>
        )}
      </div>

      {showCreateWorkspaceModal && props.isAdmin ? (
        <div className="modal-backdrop" role="presentation" onClick={closeCreateWorkspaceModal}>
          <div
            className="modal"
            role="dialog"
            aria-labelledby="create-workspace-title"
            onClick={(e) => e.stopPropagation()}
          >
            {createWorkspaceStep === 'form' ? (
              <>
                <h3 id="create-workspace-title">Новая база данных</h3>
                <p className="hint">Пустая копия схемы (проекты, узлы, участки). Пользователи общие для всех баз.</p>
                <FormField label="Название">
                  <Input
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    placeholder="Например: Прод"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitCreateWorkspace()
                    }}
                  />
                </FormField>
                {createWorkspaceError ? <p className="hint settings-io__warn">{createWorkspaceError}</p> : null}
                <div className="passport-actions gis-btn-group">
                  <Button type="button" variant="primary" disabled={props.workspaceBusy} onClick={() => void submitCreateWorkspace()}>
                    {props.workspaceBusy ? 'Создание…' : 'Создать'}
                  </Button>
                  <Button type="button" variant="secondary" onClick={closeCreateWorkspaceModal}>
                    Отмена
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h3 id="create-workspace-title">База создана</h3>
                <p className="hint">
                  «{createdWorkspaceName}» готова к работе (без объектов на карте). Переключиться на неё сейчас?
                </p>
                {createWorkspaceError ? <p className="hint settings-io__warn">{createWorkspaceError}</p> : null}
                <div className="passport-actions gis-btn-group">
                  <Button type="button" variant="primary" disabled={props.workspaceBusy} onClick={() => void switchToCreatedWorkspace()}>
                    {props.workspaceBusy ? 'Переключение…' : 'Переключиться'}
                  </Button>
                  <Button type="button" variant="secondary" onClick={closeCreateWorkspaceModal}>
                    Оставить текущую
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`
}
