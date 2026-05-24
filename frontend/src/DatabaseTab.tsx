import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import { useDatabasePage } from './database/useDatabasePage'
import type { DbEntityCategory, EdgeEntity, FiberCableStatus, NodeEntity, Project } from './gisTypes'
import {
  FIBER_LINE_COLORS,
  FIBER_STATUS_LABELS,
  FIBER_STATUS_ORDER,
  normalizeFiberStatus,
} from './gisTypes'
import { passportMetaLabel, projectStats } from './passport/schemas'

export type DbListRow = {
  object: 'project' | 'node' | 'edge'
  id: number
  title: string
  subtitle: string
  status?: FiberCableStatus
  projectName?: string
  lengthM?: number
  fibers?: string
  coords?: string
  meta?: string
  createdAt?: string
  description?: string
  nodeType?: string
  ab?: string
}

type DbSortKey = 'name' | 'id' | 'length' | 'status' | 'date'

type Props = {
  category: DbEntityCategory
  onCategoryChange: (c: DbEntityCategory) => void
  search: string
  onSearchChange: (s: string) => void
  projectFilterId: number | null
  onProjectFilterChange: (id: number | null) => void
  projects: Project[]
  apiBase: string
  jsonFetch: <T>(url: string, options?: RequestInit) => Promise<T>
  tabActive: boolean
  selectedObjectId: { kind: 'project' | 'node' | 'edge'; id: number } | null
  fiberStatusFilter: FiberCableStatus | 'ALL'
  onFiberStatusFilterChange: (s: FiberCableStatus | 'ALL') => void
  onOpenPassport: (object: 'project' | 'node' | 'edge', id: number) => void
  onShowOnMap: (object: 'project' | 'node' | 'edge', id: number, opts?: { smooth?: boolean }) => void
  onContextMenu: (
    e: MouseEvent,
    object: 'project' | 'node' | 'edge',
    id: number,
  ) => void
  onCreate?: () => void
}

const CATEGORIES: { key: DbEntityCategory; label: string }[] = [
  { key: 'projects', label: 'Проекты' },
  { key: 'optical', label: 'Оптика' },
  { key: 'kanal', label: 'Канализация' },
  { key: 'mufta', label: 'Муфты' },
  { key: 'tk', label: 'ТК' },
  { key: 'piket', label: 'Пикеты' },
  { key: 'kross', label: 'Кроссы' },
]

function buildRows(
  category: DbEntityCategory,
  projects: Project[],
  nodes: NodeEntity[],
  edges: EdgeEntity[],
  search: string,
  projectFilterId: number | null,
  fiberStatusFilter: FiberCableStatus | 'ALL',
): DbListRow[] {
  const q = search.toLowerCase().trim()
  const matches = (s: string) => !q || s.toLowerCase().includes(q)
  const nodeIdsInProject = new Set<number>()
  if (projectFilterId) {
    for (const e of edges) {
      if (e.type === 'OPTOVOLOKNO' && e.project_id === projectFilterId) {
        nodeIdsInProject.add(e.start_node_id)
        nodeIdsInProject.add(e.end_node_id)
      }
    }
  }
  const nodeInProject = (n: NodeEntity) => !projectFilterId || nodeIdsInProject.has(n.id)

  if (category === 'projects') {
    return projects
      .filter((p) => matches(p.name) || matches(p.description || ''))
      .map((p) => {
        const st = projectStats(p.id, edges)
        return {
          object: 'project' as const,
          id: p.id,
          title: p.name,
          subtitle: p.description || '—',
          description: p.description || '—',
          createdAt: p.created_at,
          meta: `${st.edgeCount} уч. · ${Math.round(st.totalLen)} м`,
        }
      })
  }

  if (category === 'optical') {
    return edges
      .filter((e) => e.type === 'OPTOVOLOKNO')
      .filter((e) => !projectFilterId || e.project_id === projectFilterId)
      .filter((e) => fiberStatusFilter === 'ALL' || normalizeFiberStatus(e.cable_status) === fiberStatusFilter)
      .filter(
        (e) =>
          matches(e.cable_name || '') ||
          matches(e.project_name || '') ||
          matches(e.start_node_name) ||
          matches(e.end_node_name) ||
          matches(String(e.id)),
      )
      .map((e) => ({
        object: 'edge' as const,
        id: e.id,
        title: e.cable_name || 'Оптика',
        subtitle: `${e.start_node_name} → ${e.end_node_name}`,
        status: normalizeFiberStatus(e.cable_status),
        projectName: e.project_name ?? '—',
        ab: `${e.start_node_name} → ${e.end_node_name}`,
        lengthM: e.length_m,
        fibers: `${e.used_fibers ?? 0}/${e.total_fibers ?? '?'}`,
      }))
  }

  if (category === 'kanal') {
    return edges
      .filter((e) => e.type === 'KANALIZACIYA')
      .filter(
        (e) =>
          matches(e.start_node_name) ||
          matches(e.end_node_name) ||
          matches(String(e.id)),
      )
      .map((e) => ({
        object: 'edge' as const,
        id: e.id,
        title: `Канал #${e.id}`,
        subtitle: `${e.start_node_name} → ${e.end_node_name}`,
        ab: `${e.start_node_name} → ${e.end_node_name}`,
        lengthM: e.length_m,
      }))
  }

  const nodeCat = (t: NodeEntity['type'], badge: string): DbListRow[] =>
    nodes
      .filter((n) => n.type === t)
      .filter(nodeInProject)
      .filter((n) => matches(n.name) || matches(n.type) || matches(String(n.id)))
      .map((n) => ({
        object: 'node' as const,
        id: n.id,
        title: n.name,
        subtitle: `${n.lat.toFixed(5)}, ${n.lng.toFixed(5)}`,
        nodeType: badge,
        coords: `${n.lat.toFixed(5)}, ${n.lng.toFixed(5)}`,
        meta: passportMetaLabel(n),
      }))

  if (category === 'mufta') return nodeCat('MUFTA', 'Муфта')
  if (category === 'tk') return nodeCat('TK', 'ТК')
  if (category === 'piket') return nodeCat('PIKET', 'Пикет')
  if (category === 'kross') return nodeCat('KROSS', 'Кросс')
  return []
}

function sortRows(rows: DbListRow[], sortKey: DbSortKey, asc: boolean): DbListRow[] {
  const dir = asc ? 1 : -1
  return [...rows].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'name') cmp = a.title.localeCompare(b.title, 'ru')
    else if (sortKey === 'id') cmp = a.id - b.id
    else if (sortKey === 'length') cmp = (a.lengthM ?? 0) - (b.lengthM ?? 0)
    else if (sortKey === 'status') {
      const ai = a.status ? FIBER_STATUS_ORDER.indexOf(a.status) : 99
      const bi = b.status ? FIBER_STATUS_ORDER.indexOf(b.status) : 99
      cmp = ai - bi
    } else if (sortKey === 'date') {
      cmp = String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
    }
    return cmp * dir
  })
}

export function DatabaseTab({
  category,
  onCategoryChange,
  search,
  onSearchChange,
  projectFilterId,
  onProjectFilterChange,
  projects,
  apiBase,
  jsonFetch,
  tabActive,
  selectedObjectId,
  fiberStatusFilter,
  onFiberStatusFilterChange,
  onOpenPassport,
  onShowOnMap,
  onContextMenu,
  onCreate,
}: Props) {
  const [sortKey, setSortKey] = useState<DbSortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)

  const dbPage = useDatabasePage(apiBase, jsonFetch, category, search, tabActive, sortKey, sortAsc)
  const listNodes = dbPage.usesServerPage ? dbPage.nodes : []
  const listEdges = dbPage.usesServerPage ? dbPage.edges : []

  const allRows = useMemo(
    () => buildRows(category, projects, listNodes, listEdges, search, projectFilterId, fiberStatusFilter),
    [category, projects, listNodes, listEdges, search, projectFilterId, fiberStatusFilter],
  )

  const rows = useMemo(() => {
    if (dbPage.serverSort && (sortKey === 'name' || sortKey === 'id')) return allRows
    return sortRows(allRows, sortKey, sortAsc)
  }, [allRows, sortKey, sortAsc, dbPage.serverSort])

  const totalInCategory = dbPage.usesServerPage
    ? dbPage.loading && dbPage.total === 0 && !dbPage.hasLoadedOnce
      ? null
      : dbPage.total
    : buildRows(category, projects, listNodes, listEdges, '', projectFilterId, 'ALL').length

  const selectedRow = selectedObjectId
    ? rows.find((r) => r.object === selectedObjectId.kind && r.id === selectedObjectId.id) ??
      allRows.find((r) => r.object === selectedObjectId.kind && r.id === selectedObjectId.id)
    : null

  const toggleSort = (key: DbSortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const sortIndicator = (key: DbSortKey) => (sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '')

  const isSelected = (row: DbListRow) =>
    selectedObjectId?.kind === row.object && selectedObjectId.id === row.id

  return (
    <div className="db-tab stack-front">
      <div className="db-tab-layout">
        <aside className="db-sidebar" aria-label="Категории объектов">
          {CATEGORIES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={category === key ? 'active' : ''}
              onClick={() => onCategoryChange(key)}
            >
              {label}
            </button>
          ))}
        </aside>
        <div className="db-main">
          <header className="db-main__header">
            <h2>База данных</h2>
            <p className="hint">
              Клик — паспорт, двойной клик — на карте. ПКМ: паспорт, карта, копировать id, удаление.
            </p>
          </header>
          <div className="db-toolbar">
            <label className="db-toolbar__search">
              Поиск
              <input
                type="search"
                className="gis-input"
                placeholder="Фильтр по названию, проекту, узлам…"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </label>
            <div className="db-toolbar__filter">
              <span className="hint">Проект:</span>
              <select
                className="gis-select"
                value={projectFilterId ?? ''}
                onChange={(e) => onProjectFilterChange(Number(e.target.value) || null)}
              >
                <option value="">Все проекты</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="db-toolbar__sort">
              <span className="hint">Сортировка:</span>
              <select
                className="gis-select"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as DbSortKey)}
              >
                <option value="name">Имя</option>
                <option value="id">ID</option>
                {(category === 'optical' || category === 'kanal') && <option value="length">Длина</option>}
                {category === 'optical' && <option value="status">Статус</option>}
                {category === 'projects' && <option value="date">Дата</option>}
              </select>
              <button type="button" className="gis-btn gis-btn--secondary gis-btn--sm" title="Направление" onClick={() => setSortAsc((v) => !v)}>
                {sortAsc ? '↑' : '↓'}
              </button>
            </div>
            <p className="db-toolbar__count">
              Показано <strong>{rows.length}</strong> из{' '}
              <strong>{totalInCategory ?? '—'}</strong>
              {dbPage.loading ? ' · загрузка…' : null}
              {dbPage.error ? ` · ${dbPage.error}` : null}
            </p>
            {dbPage.usesServerPage && dbPage.pageCount > 1 ? (
              <div className="db-pagination">
                <button
                  type="button"
                  className="gis-btn gis-btn--secondary gis-btn--sm"
                  disabled={dbPage.page <= 1 || dbPage.loading}
                  onClick={() => dbPage.setPage((p) => Math.max(1, p - 1))}
                >
                  ← Назад
                </button>
                <span className="hint">
                  Стр. {dbPage.page} / {dbPage.pageCount}
                </span>
                <button
                  type="button"
                  className="gis-btn gis-btn--secondary gis-btn--sm"
                  disabled={dbPage.page >= dbPage.pageCount || dbPage.loading}
                  onClick={() => dbPage.setPage((p) => p + 1)}
                >
                  Вперёд →
                </button>
              </div>
            ) : null}
            <div className="db-toolbar__actions">
              {selectedRow ? (
                <button
                  type="button"
                  className="gis-btn gis-btn--secondary"
                  onClick={() => onShowOnMap(selectedRow.object, selectedRow.id)}
                >
                  На карте
                </button>
              ) : null}
              {onCreate ? (
                <button type="button" className="gis-btn gis-btn--primary" onClick={onCreate}>
                  Создать
                </button>
              ) : null}
            </div>
          </div>

          {category === 'optical' ? (
            <div className="db-status-chips" role="group" aria-label="Фильтр статуса ВОЛС">
              <button
                type="button"
                className={fiberStatusFilter === 'ALL' ? 'active' : ''}
                onClick={() => onFiberStatusFilterChange('ALL')}
              >
                Все
              </button>
              {FIBER_STATUS_ORDER.map((st) => (
                <button
                  key={st}
                  type="button"
                  className={fiberStatusFilter === st ? 'active' : ''}
                  style={{ '--chip-color': FIBER_LINE_COLORS[st] } as CSSProperties}
                  onClick={() => onFiberStatusFilterChange(st)}
                >
                  {FIBER_STATUS_LABELS[st]}
                </button>
              ))}
            </div>
          ) : null}

          <div className="db-list-wrap">
            {rows.length === 0 ? (
              <p className="hint">Нет записей в этой категории.</p>
            ) : (
              <table className="db-table">
                <thead>
                  <tr>
                    {category === 'optical' && (
                      <th>
                        <button type="button" className="db-th-sort" onClick={() => toggleSort('status')}>
                          Статус{sortIndicator('status')}
                        </button>
                      </th>
                    )}
                    <th>
                      <button type="button" className="db-th-sort" onClick={() => toggleSort('name')}>
                        Название{sortIndicator('name')}
                      </button>
                    </th>
                    {category === 'projects' && <th>Описание</th>}
                    {(category === 'optical' || category === 'projects') && (
                      <th>{category === 'projects' ? 'Сводка' : 'Проект'}</th>
                    )}
                    {(category === 'optical' || category === 'kanal') && (
                      <>
                        <th>A → B</th>
                        <th>
                          <button type="button" className="db-th-sort" onClick={() => toggleSort('length')}>
                            Длина{sortIndicator('length')}
                          </button>
                        </th>
                      </>
                    )}
                    {category === 'optical' && <th>Волокна</th>}
                    {(category === 'mufta' || category === 'tk' || category === 'piket' || category === 'kross') && (
                      <>
                        <th>Тип</th>
                        <th>Координаты</th>
                        <th>Метка</th>
                      </>
                    )}
                    {category === 'projects' && (
                      <th>
                        <button type="button" className="db-th-sort" onClick={() => toggleSort('date')}>
                          Дата{sortIndicator('date')}
                        </button>
                      </th>
                    )}
                    <th>
                      <button type="button" className="db-th-sort" onClick={() => toggleSort('id')}>
                        id{sortIndicator('id')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className={dbPage.loading ? 'db-table__body--loading' : undefined}>
                  {dbPage.loading && rows.length === 0
                    ? Array.from({ length: 8 }, (_, i) => (
                        <tr key={`sk-${i}`} className="db-row--skeleton" aria-hidden>
                          <td colSpan={12}>
                            <span className="db-skeleton-bar" />
                          </td>
                        </tr>
                      ))
                    : null}
                  {rows.map((row) => (
                    <tr
                      key={`${row.object}-${row.id}`}
                      className={isSelected(row) ? 'db-row--selected' : undefined}
                      onClick={() => onOpenPassport(row.object, row.id)}
                      onDoubleClick={(e) => {
                        e.preventDefault()
                        onShowOnMap(row.object, row.id, { smooth: true })
                      }}
                      onContextMenu={(e) => onContextMenu(e, row.object, row.id)}
                    >
                      {category === 'optical' && row.status ? (
                        <td>
                          <span
                            className="db-status-pill"
                            style={{ background: FIBER_LINE_COLORS[row.status] }}
                            title={FIBER_STATUS_LABELS[row.status]}
                          />
                        </td>
                      ) : category === 'optical' ? (
                        <td />
                      ) : null}
                      <td className="db-table__title">{row.title}</td>
                      {category === 'projects' && (
                        <td className="db-table__muted">{row.description?.slice(0, 80) || '—'}</td>
                      )}
                      {(category === 'optical' || category === 'projects') && (
                        <td className="db-table__muted">{category === 'projects' ? row.meta : row.projectName}</td>
                      )}
                      {(category === 'optical' || category === 'kanal') && (
                        <>
                          <td className="db-table__muted">{row.ab}</td>
                          <td className="gis-num">{row.lengthM != null ? Math.round(row.lengthM) : '—'}</td>
                        </>
                      )}
                      {category === 'optical' && <td className="gis-num">{row.fibers}</td>}
                      {(category === 'mufta' || category === 'tk' || category === 'piket' || category === 'kross') && (
                        <>
                          <td>
                            <span className="db-list__badge db-list__badge--node">{row.nodeType}</span>
                          </td>
                          <td className="db-table__muted gis-num">{row.coords}</td>
                          <td className="db-table__muted">{row.meta}</td>
                        </>
                      )}
                      {category === 'projects' && (
                        <td className="db-table__muted">
                          {row.createdAt ? new Date(row.createdAt).toLocaleDateString('ru-RU') : '—'}
                        </td>
                      )}
                      <td className="gis-num">{row.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
