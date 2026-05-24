import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { EdgeEntity, FiberCableStatus, NodeEntity, Project } from './gisTypes'
import {
  FIBER_LINE_COLORS,
  FIBER_STATUS_LABELS,
  FIBER_STATUS_ORDER,
} from './gisTypes'
import {
  buildOpticalTableRows,
  computeAnalytics,
  downloadCsv,
  exportOpticalCsv,
  type AnalyticsFilters,
  type AnalyticsPeriod,
  type AnalyticsSnapshot,
} from './analytics/computeAnalytics'
import type { ActivityLogEntry } from './userPrefs'

type TableSortKey = 'name' | 'length' | 'status' | 'util'

type ServerAnalyticsSummary = {
  kpi: AnalyticsSnapshot['kpi']
  fiberLoad: AnalyticsSnapshot['fiberLoad']
  statusSlices: AnalyticsSnapshot['statusSlices']
  accidentsByProject: AnalyticsSnapshot['accidentsByProject']
}

type Props = {
  apiBase?: string
  useServerSummary?: boolean
  nodes: NodeEntity[]
  edges: EdgeEntity[]
  projects: Project[]
  activityLog: ActivityLogEntry[]
  onOpenPassport: (object: 'edge', id: number) => void
  onShowOnMap: (object: 'edge', id: number, opts?: { smooth?: boolean }) => void
}

export function AnalyticsTab({
  apiBase,
  useServerSummary = false,
  nodes,
  edges,
  projects,
  activityLog,
  onOpenPassport,
  onShowOnMap,
}: Props) {
  const [serverSummary, setServerSummary] = useState<ServerAnalyticsSummary | null>(null)

  useEffect(() => {
    if (!useServerSummary || !apiBase) {
      setServerSummary(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const token = localStorage.getItem('gis_auth_token')
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
        const res = await fetch(`${apiBase}/analytics/summary`, { headers })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.message || 'API error')
        if (!cancelled) setServerSummary(data as ServerAnalyticsSummary)
      } catch {
        if (!cancelled) setServerSummary(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiBase, useServerSummary])
  const [projectId, setProjectId] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<FiberCableStatus | 'ALL'>('ALL')
  const [period, setPeriod] = useState<AnalyticsPeriod>('all')
  const [sortKey, setSortKey] = useState<TableSortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)

  const filters: AnalyticsFilters = useMemo(
    () => ({ projectId, status: statusFilter, period }),
    [projectId, statusFilter, period],
  )

  const localSnapshot = useMemo(
    () => computeAnalytics(nodes, edges, projects, activityLog, filters),
    [nodes, edges, projects, activityLog, filters],
  )

  const snapshot = useMemo(() => {
    if (!serverSummary) return localSnapshot
    return {
      ...localSnapshot,
      kpi: serverSummary.kpi,
      fiberLoad: serverSummary.fiberLoad,
      statusSlices: serverSummary.statusSlices,
      accidentsByProject: serverSummary.accidentsByProject,
    }
  }, [localSnapshot, serverSummary])

  const tableRows = useMemo(() => {
    const rows = buildOpticalTableRows(edges, filters)
    const dir = sortAsc ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sortKey === 'name') return a.cableName.localeCompare(b.cableName, 'ru') * dir
      if (sortKey === 'length') return (a.lengthM - b.lengthM) * dir
      if (sortKey === 'util') return (a.fiberUtilPct - b.fiberUtilPct) * dir
      const ai = FIBER_STATUS_ORDER.indexOf(a.status)
      const bi = FIBER_STATUS_ORDER.indexOf(b.status)
      return (ai - bi) * dir
    })
  }, [edges, filters, sortKey, sortAsc])

  const { kpi, fiberLoad, statusSlices, dailyCreated, accidentsByProject, hasCreatedDates } = snapshot
  const maxDaily = Math.max(1, ...dailyCreated.map((d) => d.edges + d.nodes))
  const donutTotal = statusSlices.reduce((s, x) => s + x.count, 0)
  const donutSegments = useMemo(() => {
    let offset = 0
    return statusSlices.map((slice) => {
      const pct = donutTotal ? slice.count / donutTotal : 0
      const dash = pct * 100
      const seg = { slice, dash, offset }
      offset += dash
      return seg
    })
  }, [statusSlices, donutTotal])

  const toggleSort = (key: TableSortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const sortInd = (key: TableSortKey) => (sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '')

  return (
    <div className="analytics-tab stack-front">
      <div className="analytics-app">
        <header className="analytics-app__head">
          <div>
            <h2>Аналитика</h2>
            <p className="hint">Сводка по данным текущей сессии. Фильтры применяются к участкам ВОЛС и графикам.</p>
          </div>
          <div className="analytics-toolbar">
            <label className="analytics-toolbar__field">
              <span className="hint">Проект</span>
              <select className="gis-select" value={projectId ?? ''} onChange={(e) => setProjectId(Number(e.target.value) || null)}>
                <option value="">Все</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="analytics-toolbar__field">
              <span className="hint">Период (по дате создания участка)</span>
              <select className="gis-select" value={period} onChange={(e) => setPeriod(e.target.value as AnalyticsPeriod)}>
                <option value="all">Все данные</option>
                <option value="30d">30 дней</option>
                <option value="90d">90 дней</option>
              </select>
            </label>
            <button
              type="button"
              className="gis-btn gis-btn--secondary"
              onClick={() => downloadCsv('vols-analytics.csv', exportOpticalCsv(tableRows, FIBER_STATUS_LABELS))}
              disabled={tableRows.length === 0}
            >
              Экспорт CSV
            </button>
          </div>
        </header>

        <div className="db-status-chips analytics-status-chips" role="group" aria-label="Фильтр статуса">
          <button
            type="button"
            className={statusFilter === 'ALL' ? 'active' : ''}
            onClick={() => setStatusFilter('ALL')}
          >
            Все статусы
          </button>
          {FIBER_STATUS_ORDER.map((st) => (
            <button
              key={st}
              type="button"
              className={statusFilter === st ? 'active' : ''}
              style={{ '--chip-color': FIBER_LINE_COLORS[st] } as CSSProperties}
              onClick={() => setStatusFilter(st)}
            >
              {FIBER_STATUS_LABELS[st]}
            </button>
          ))}
        </div>

        <div className="analytics-kpi-row">
          {[
            { label: 'Участков ВОЛС', value: kpi.opticalCount, delta: 'в выборке' },
            { label: 'Длина ВОЛС, км', value: kpi.lengthKm.toFixed(2), delta: 'сумма' },
            { label: 'Загрузка волокон', value: `${kpi.fiberUtilPct.toFixed(1)}%`, delta: 'used/total' },
            { label: 'Аварий', value: kpi.accidentsOpen, delta: 'статус ACCIDENT' },
            { label: 'Сварок (связей)', value: kpi.spliceLinks, delta: 'splice_v1' },
            { label: 'Проектов', value: kpi.projectCount, delta: `канал ${kpi.kanalLengthKm.toFixed(1)} км` },
          ].map((item) => (
            <div key={item.label} className="analytics-kpi">
              <div className="analytics-kpi__label">{item.label}</div>
              <div className="analytics-kpi__value">{item.value}</div>
              <div className="analytics-kpi__delta">{item.delta}</div>
            </div>
          ))}
        </div>

        <div className="analytics-charts">
          <div className="analytics-chart-card">
            <h3>Загрузка волокон по участкам</h3>
            <div className="bar-chart analytics-stacked">
              {[
                { key: 'partial', label: 'Частично занято', count: fiberLoad.partial, cls: 'bar-chart__fill--work' },
                { key: 'full', label: 'Полностью занято', count: fiberLoad.full, cls: 'bar-chart__fill--alarm' },
                { key: 'idle', label: 'Свободно', count: fiberLoad.idle, cls: 'bar-chart__fill--idle' },
              ].map((row) => (
                <div key={row.key} className="bar-chart__row">
                  <span>{row.label}</span>
                  <div className="bar-chart__track">
                    <div
                      className={`bar-chart__fill ${row.cls}`}
                      style={{
                        width: `${fiberLoad.total ? (100 * row.count) / fiberLoad.total : 0}%`,
                      }}
                    />
                  </div>
                  <span className="gis-num">{row.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="analytics-chart-card">
            <h3>Статусы участков ВОЛС</h3>
            {donutTotal === 0 ? (
              <p className="hint">Нет участков в выборке</p>
            ) : (
              <div className="analytics-donut-wrap">
                <svg className="analytics-donut-svg" viewBox="0 0 100 100" role="img" aria-label="Статусы ВОЛС">
                  {donutSegments.map(({ slice, dash, offset }) => (
                    <circle
                      key={slice.status}
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke={FIBER_LINE_COLORS[slice.status]}
                      strokeWidth="16"
                      strokeDasharray={`${dash} ${100 - dash}`}
                      strokeDashoffset={-offset}
                      transform="rotate(-90 50 50)"
                      pathLength={100}
                    />
                  ))}
                </svg>
                <ul className="analytics-legend">
                  {statusSlices.map((slice) => (
                    <li key={slice.status}>
                      <i style={{ background: FIBER_LINE_COLORS[slice.status] }} />
                      {FIBER_STATUS_LABELS[slice.status]} — {slice.count} ({slice.pct.toFixed(0)}%)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="analytics-chart-card">
            <h3>Создание объектов (последние 30 дней с датой)</h3>
            {!hasCreatedDates || dailyCreated.length === 0 ? (
              <p className="hint">Нет данных с полем created_at для построения динамики.</p>
            ) : (
              <div className="analytics-daily-chart">
                {dailyCreated.map((d) => {
                  const total = d.edges + d.nodes
                  return (
                    <div key={d.day} className="analytics-daily-col" title={`${d.day}: участков ${d.edges}, узлов ${d.nodes}`}>
                      <div
                        className="analytics-daily-bar analytics-daily-bar--edges"
                        style={{ height: `${(d.edges / maxDaily) * 100}%` }}
                      />
                      <div
                        className="analytics-daily-bar analytics-daily-bar--nodes"
                        style={{ height: `${(d.nodes / maxDaily) * 100}%` }}
                      />
                      <span className="analytics-daily-label">{d.day.slice(5)}</span>
                      <span className="gis-num analytics-daily-total">{total}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="analytics-chart-card">
            <h3>Аварии по проектам</h3>
            {accidentsByProject.length === 0 ? (
              <p className="hint">Нет аварийных участков в выборке.</p>
            ) : (
              <table className="analytics-mini-table">
                <thead>
                  <tr>
                    <th>Проект</th>
                    <th>Аварий</th>
                  </tr>
                </thead>
                <tbody>
                  {accidentsByProject.map((row) => (
                    <tr key={row.projectName}>
                      <td>{row.projectName}</td>
                      <td className="gis-num">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="analytics-chart-card analytics-table-section">
          <h3>Участки ВОЛС ({tableRows.length})</h3>
          <p className="hint">Клик — паспорт, двойной клик — на карте.</p>
          <div className="analytics-table-wrap db-list-wrap">
            {tableRows.length === 0 ? (
              <p className="hint">Нет участков по выбранным фильтрам.</p>
            ) : (
              <table className="analytics-table db-table">
                <thead>
                  <tr>
                    <th />
                    <th>
                      <button type="button" className="db-th-sort" onClick={() => toggleSort('name')}>
                        Участок{sortInd('name')}
                      </button>
                    </th>
                    <th>Проект</th>
                    <th>A → B</th>
                    <th>
                      <button type="button" className="db-th-sort" onClick={() => toggleSort('length')}>
                        Длина{sortInd('length')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="db-th-sort" onClick={() => toggleSort('util')}>
                        Волокна{sortInd('util')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="db-th-sort" onClick={() => toggleSort('status')}>
                        Статус{sortInd('status')}
                      </button>
                    </th>
                    <th>id</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => onOpenPassport('edge', row.id)}
                      onDoubleClick={(e) => {
                        e.preventDefault()
                        onShowOnMap('edge', row.id, { smooth: true })
                      }}
                    >
                      <td>
                        <span
                          className="db-status-pill"
                          style={{ background: FIBER_LINE_COLORS[row.status] }}
                          title={FIBER_STATUS_LABELS[row.status]}
                        />
                      </td>
                      <td className="db-table__title">{row.cableName}</td>
                      <td className="db-table__muted">{row.projectName}</td>
                      <td className="db-table__muted">{row.ab}</td>
                      <td className="gis-num">{Math.round(row.lengthM)}</td>
                      <td className="gis-num">{row.fibers}</td>
                      <td>
                        <span className="fiber-orders-chip" style={{ fontSize: 11 }}>
                          {FIBER_STATUS_LABELS[row.status]}
                        </span>
                      </td>
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
