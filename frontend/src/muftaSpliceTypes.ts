/** Точка волокна на схеме сварки (1-based index). edgeId === 0 — порт кросса (fiberIndex = номер порта). */
export type SpliceFiberRef = { edgeId: number; fiberIndex: number }

/** Точка изгиба линии связи в координатах SVG схемы (между двумя волокнами). */
export type SpliceLinkWaypoint = { x: number; y: number }

export type SpliceLinkV1 = { from: SpliceFiberRef; to: SpliceFiberRef; waypoints?: SpliceLinkWaypoint[] }

/** Стиль линии «щупа» для занятого волокна на схеме. */
export type SpliceBusyLineStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot'

/** Метаданные волокна на муфте: подпись снаружи, занятость (дублируется в кабель). */
export type SpliceFiberMeta = {
  ownerLabel?: string
  busy?: boolean
  /** Цвет линии от корпуса к точке волокна, если занято (например #ea580c). */
  busyLineColor?: string
  /** Рисунок штриха для занятой линии. */
  busyLineStyle?: SpliceBusyLineStyle
}

/** Карта edgeId -> { "1"|"2"|...: meta } */
export type SpliceFiberMap = Record<string, Record<string, SpliceFiberMeta>>

export type SpliceV1 = {
  links: SpliceLinkV1[]
  /** Доп. поля по волокнам на этой муфте (подпись/занято до входа в корпус). */
  fibers?: SpliceFiberMap
}

/** Приводит ссылки из JSON/SQLite (иногда строки) к числам для сравнения и поиска в Map. */
export function coerceSpliceFiberRef(r: SpliceFiberRef): SpliceFiberRef {
  const edgeId = typeof r.edgeId === 'number' && Number.isFinite(r.edgeId) ? r.edgeId : Number(r.edgeId)
  const fiberIndex =
    typeof r.fiberIndex === 'number' && Number.isFinite(r.fiberIndex) ? r.fiberIndex : Number(r.fiberIndex)
  return { edgeId, fiberIndex }
}

function validFiberRef(r: SpliceFiberRef): boolean {
  if (r == null || typeof r !== 'object') return false
  const c = coerceSpliceFiberRef(r)
  return (
    Number.isFinite(c.edgeId) &&
    Number.isFinite(c.fiberIndex) &&
    c.fiberIndex >= 1 &&
    (c.edgeId !== 0 || c.fiberIndex >= 1)
  )
}

function validWaypoints(wp: unknown): wp is SpliceLinkWaypoint[] {
  if (wp == null) return true
  if (!Array.isArray(wp)) return false
  for (const p of wp) {
    if (!p || typeof p !== 'object') return false
    const o = p as Record<string, unknown>
    if (typeof o.x !== 'number' || typeof o.y !== 'number' || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return false
  }
  return true
}

function validLink(l: SpliceLinkV1): boolean {
  return (
    validFiberRef(l.from) &&
    validFiberRef(l.to) &&
    (l.from.edgeId !== l.to.edgeId || l.from.fiberIndex !== l.to.fiberIndex) &&
    validWaypoints(l.waypoints)
  )
}

export function getSpliceV1(passport: Record<string, unknown>): SpliceV1 {
  const raw = passport.splice_v1
  if (!raw || typeof raw !== 'object') return { links: [], fibers: {} }
  const o = raw as Record<string, unknown>
  const rawLinks = Array.isArray(o.links) ? (o.links as SpliceLinkV1[]) : []
  const links = rawLinks
    .filter((l): l is SpliceLinkV1 => !!l && typeof l === 'object' && (l as SpliceLinkV1).from != null && (l as SpliceLinkV1).to != null)
    .map((l) => ({
      ...l,
      from: coerceSpliceFiberRef(l.from),
      to: coerceSpliceFiberRef(l.to),
    }))
    .filter(validLink)
  const fibers = (o.fibers && typeof o.fibers === 'object' ? o.fibers : {}) as SpliceFiberMap
  return { links, fibers }
}

export function mergeSpliceV1(passport: Record<string, unknown>, splice: SpliceV1): Record<string, unknown> {
  return {
    ...passport,
    splice_v1: {
      links: splice.links,
      fibers: splice.fibers ?? {},
    },
  }
}

/** Число портов на кроссе (паспорт узла). */
export function getCrossPortCount(passport: Record<string, unknown>): number {
  const raw = passport.cross_ports
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n < 1) return 8
  return Math.min(288, Math.floor(n))
}

/** fiber_usage в passport_data кабеля: ключ — номер волокна "1".."n". */
export type EdgeFiberUsageSlot = { busy?: boolean; label?: string }

export type EdgeFiberUsage = Record<string, EdgeFiberUsageSlot>

export function getEdgeFiberUsage(passport: Record<string, unknown>): EdgeFiberUsage {
  const u = passport.fiber_usage
  if (!u || typeof u !== 'object') return {}
  return u as EdgeFiberUsage
}

export function countBusyInUsage(total: number, usage: EdgeFiberUsage): number {
  let n = 0
  for (let i = 1; i <= total; i += 1) {
    const slot = usage[String(i)]
    if (slot?.busy) n += 1
  }
  return n
}

export function mergeEdgeFiberUsage(passport: Record<string, unknown>, usage: EdgeFiberUsage): Record<string, unknown> {
  return { ...passport, fiber_usage: usage }
}

export function busyLineDashArray(style?: SpliceBusyLineStyle): string | undefined {
  switch (style) {
    case 'dashed':
      return '7 6'
    case 'dotted':
      return '1.5 5'
    case 'dashdot':
      return '10 5 2 5'
    case 'solid':
    default:
      return undefined
  }
}

/** Все ВОЛС, инцидентные узлу (муфта или кросс). */
export function getOpticalEdgesIncidentToNode<T extends { type: string; start_node_id: number; end_node_id: number }>(
  nodeId: number,
  edges: T[],
): T[] {
  return edges.filter((e) => e.type === 'OPTOVOLOKNO' && (e.start_node_id === nodeId || e.end_node_id === nodeId))
}

/** @deprecated use getOpticalEdgesIncidentToNode */
export const getOpticalEdgesIncidentToMufta = getOpticalEdgesIncidentToNode

/** Фильтр связей: реальные edge id + опционально порты кросса edgeId=0..internalPortCount */
export function filterSpliceLinksForContext(links: SpliceLinkV1[], edgeIds: Set<number>, internalPortCount: number): SpliceLinkV1[] {
  const endOk = (r: SpliceFiberRef) => {
    if (r.edgeId === 0) return internalPortCount > 0 && r.fiberIndex >= 1 && r.fiberIndex <= internalPortCount
    return edgeIds.has(r.edgeId)
  }
  return links.filter((l) => validLink(l) && endOk(l.from) && endOk(l.to))
}

export function filterSpliceLinksToKnownEdges(links: SpliceLinkV1[], edgeIds: Set<number>): SpliceLinkV1[] {
  return filterSpliceLinksForContext(links, edgeIds, 0)
}
