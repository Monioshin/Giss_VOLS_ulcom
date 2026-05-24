import { getSpliceV1 } from '../muftaSpliceTypes'
import type { EdgeEntity, FiberCableStatus, NodeEntity, Project } from '../gisTypes'
import { FIBER_STATUS_ORDER, normalizeFiberStatus } from '../gisTypes'
import type { ActivityLogEntry } from '../userPrefs'

export type AnalyticsPeriod = 'all' | '30d' | '90d'

export type AnalyticsFilters = {
  projectId: number | null
  status: FiberCableStatus | 'ALL'
  period: AnalyticsPeriod
}

export type FiberLoadBuckets = {
  idle: number
  partial: number
  full: number
  total: number
}

export type StatusSlice = {
  status: FiberCableStatus
  count: number
  pct: number
}

export type DailyCount = {
  day: string
  edges: number
  nodes: number
}

export type ProjectAccidentRow = {
  projectName: string
  count: number
}

export type AnalyticsKpi = {
  opticalCount: number
  lengthKm: number
  kanalLengthKm: number
  projectCount: number
  nodeTk: number
  nodeMufta: number
  nodeKross: number
  nodePiket: number
  spliceLinks: number
  accidentsOpen: number
  fiberUtilPct: number
  mapObjects: number
}

export type AnalyticsSnapshot = {
  kpi: AnalyticsKpi
  fiberLoad: FiberLoadBuckets
  statusSlices: StatusSlice[]
  dailyCreated: DailyCount[]
  accidentsByProject: ProjectAccidentRow[]
  hasCreatedDates: boolean
}

export type OpticalTableRow = {
  id: number
  cableName: string
  projectName: string
  ab: string
  lengthM: number
  fibers: string
  fiberUtilPct: number
  status: FiberCableStatus
}

function parseDay(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function inPeriod(iso: string | undefined, period: AnalyticsPeriod): boolean {
  if (period === 'all') return true
  if (!iso) return false
  const day = parseDay(iso)
  if (!day) return false
  const t = new Date(day).getTime()
  const days = period === '30d' ? 30 : 90
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return t >= cutoff
}

export function filterOpticalEdges(
  edges: EdgeEntity[],
  filters: AnalyticsFilters,
): EdgeEntity[] {
  return edges.filter((e) => {
    if (e.type !== 'OPTOVOLOKNO') return false
    if (filters.projectId != null && e.project_id !== filters.projectId) return false
    if (filters.status !== 'ALL' && normalizeFiberStatus(e.cable_status) !== filters.status) return false
    if (!inPeriod(e.created_at, filters.period)) return false
    return true
  })
}

export function computeAnalytics(
  nodes: NodeEntity[],
  edges: EdgeEntity[],
  projects: Project[],
  _activityLog: ActivityLogEntry[],
  filters: AnalyticsFilters,
): AnalyticsSnapshot {
  const optical = filterOpticalEdges(edges, filters)
  const kanal = edges.filter((e) => e.type === 'KANALIZACIYA')

  const totalFibersSum = (e: EdgeEntity) => e.total_fibers ?? 0
  const usedFibersVal = (e: EdgeEntity) => e.used_fibers ?? 0

  let partial = 0
  let full = 0
  let idle = 0
  let sumTotalFibers = 0
  let sumUsedFibers = 0

  for (const e of optical) {
    const t = totalFibersSum(e)
    const u = usedFibersVal(e)
    sumTotalFibers += t
    sumUsedFibers += u
    if (t <= 0 || u <= 0) idle += 1
    else if (u >= t) full += 1
    else partial += 1
  }

  const statusCounts = new Map<FiberCableStatus, number>()
  for (const st of FIBER_STATUS_ORDER) statusCounts.set(st, 0)
  for (const e of optical) {
    const st = normalizeFiberStatus(e.cable_status)
    statusCounts.set(st, (statusCounts.get(st) ?? 0) + 1)
  }
  const statusSlices: StatusSlice[] = FIBER_STATUS_ORDER.map((status) => {
    const count = statusCounts.get(status) ?? 0
    return {
      status,
      count,
      pct: optical.length ? (100 * count) / optical.length : 0,
    }
  }).filter((s) => s.count > 0)

  const dayMap = new Map<string, { edges: number; nodes: number }>()
  let hasCreatedDates = false
  for (const e of edges) {
    const day = parseDay(e.created_at)
    if (!day) continue
    hasCreatedDates = true
    if (!inPeriod(e.created_at, filters.period === 'all' ? 'all' : filters.period)) continue
    const cur = dayMap.get(day) ?? { edges: 0, nodes: 0 }
    cur.edges += 1
    dayMap.set(day, cur)
  }
  for (const n of nodes) {
    const day = parseDay(n.created_at)
    if (!day) continue
    hasCreatedDates = true
    if (!inPeriod(n.created_at, filters.period === 'all' ? 'all' : filters.period)) continue
    const cur = dayMap.get(day) ?? { edges: 0, nodes: 0 }
    cur.nodes += 1
    dayMap.set(day, cur)
  }

  const dailyCreated: DailyCount[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([day, v]) => ({ day, edges: v.edges, nodes: v.nodes }))

  const accidentMap = new Map<string, number>()
  for (const e of optical) {
    if (normalizeFiberStatus(e.cable_status) !== 'ACCIDENT') continue
    const name = e.project_name || 'Без проекта'
    accidentMap.set(name, (accidentMap.get(name) ?? 0) + 1)
  }
  const accidentsByProject: ProjectAccidentRow[] = [...accidentMap.entries()]
    .map(([projectName, count]) => ({ projectName, count }))
    .sort((a, b) => b.count - a.count)

  let spliceLinks = 0
  for (const n of nodes) {
    spliceLinks += getSpliceV1(n.passport_data).links.length
  }

  const accidentsOpen = optical.filter((e) => normalizeFiberStatus(e.cable_status) === 'ACCIDENT').length

  const kpi: AnalyticsKpi = {
    opticalCount: optical.length,
    lengthKm: optical.reduce((s, e) => s + (Number(e.length_m) || 0), 0) / 1000,
    kanalLengthKm: kanal.reduce((s, e) => s + (Number(e.length_m) || 0), 0) / 1000,
    projectCount: projects.length,
    nodeTk: nodes.filter((n) => n.type === 'TK').length,
    nodeMufta: nodes.filter((n) => n.type === 'MUFTA').length,
    nodeKross: nodes.filter((n) => n.type === 'KROSS').length,
    nodePiket: nodes.filter((n) => n.type === 'PIKET').length,
    spliceLinks,
    accidentsOpen,
    fiberUtilPct: sumTotalFibers > 0 ? (100 * sumUsedFibers) / sumTotalFibers : 0,
    mapObjects: nodes.length + edges.length,
  }

  return {
    kpi,
    fiberLoad: { idle, partial, full, total: optical.length },
    statusSlices,
    dailyCreated,
    accidentsByProject,
    hasCreatedDates,
  }
}

export function buildOpticalTableRows(edges: EdgeEntity[], filters: AnalyticsFilters): OpticalTableRow[] {
  return filterOpticalEdges(edges, filters).map((e) => {
    const t = e.total_fibers ?? 0
    const u = e.used_fibers ?? 0
    return {
      id: e.id,
      cableName: e.cable_name || `ВОЛС #${e.id}`,
      projectName: e.project_name ?? '—',
      ab: `${e.start_node_name} → ${e.end_node_name}`,
      lengthM: e.length_m,
      fibers: `${u}/${t || '?'}`,
      fiberUtilPct: t > 0 ? (100 * u) / t : 0,
      status: normalizeFiberStatus(e.cable_status),
    }
  })
}

export function exportOpticalCsv(rows: OpticalTableRow[], statusLabels: Record<FiberCableStatus, string>): string {
  const header = ['id', 'кабель', 'проект', 'A→B', 'длина_м', 'волокна', 'загрузка_%', 'статус']
  const lines = [
    header.join(';'),
    ...rows.map((r) =>
      [
        r.id,
        r.cableName,
        r.projectName,
        r.ab,
        Math.round(r.lengthM),
        r.fibers,
        r.fiberUtilPct.toFixed(1),
        statusLabels[r.status],
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(';'),
    ),
  ]
  return '\uFEFF' + lines.join('\n')
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
