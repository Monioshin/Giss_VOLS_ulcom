import type { EdgeEntity, FiberCableStatus } from '../gisTypes'

export const FIBER_LINE_COLORS: Record<FiberCableStatus, string> = {
  READY: '#ea580c',
  IN_WORK: '#f59e0b',
  OFFLINE: '#64748b',
  ACCIDENT: '#ff0080',
  CONSTRUCTION: '#7c3aed',
}

export function normalizeFiberStatus(status: string | null | undefined): FiberCableStatus {
  if (status === 'IN_WORK' || status === 'OFFLINE' || status === 'ACCIDENT' || status === 'CONSTRUCTION') return status
  return 'READY'
}

export type EdgeStrokeStyle = { color: string; weight: number; dash?: number[] }

export function strokeForEdge(
  edge: EdgeEntity,
  opts: { highlight: boolean; route: boolean; fiberTrace: boolean; zoom?: number },
): EdgeStrokeStyle {
  const z = opts.zoom ?? 15
  if (opts.highlight) return { color: '#fef08a', weight: 10 }
  if (edge.type === 'KANALIZACIYA') {
    const base = opts.route ? 6 : 4
    const weight = z < 12 ? Math.max(base, 5) : z < 14 ? Math.max(base, 4.5) : base
    return {
      color: opts.route ? '#22c55e' : '#5d4037',
      weight,
    }
  }
  if (opts.fiberTrace) return { color: '#0891b2', weight: 8 }
  if (opts.route) return { color: '#22c55e', weight: 6 }
  const st = normalizeFiberStatus(edge.cable_status)
  if (st === 'ACCIDENT') return { color: FIBER_LINE_COLORS.ACCIDENT, weight: 7 }
  return { color: FIBER_LINE_COLORS[st], weight: 4 }
}

/** Упрощение геометрии по zoom; линии не скрываются, только LOD. Прямые участки (2 точки) не режутся. */
export function simplifyEdgeGeometry(
  geometry: [number, number][],
  zoom: number,
  detailZoom = 15,
  edgeType?: EdgeEntity['type'],
): [number, number][] {
  if (!geometry?.length || geometry.length <= 2) return geometry ?? []
  if (edgeType === 'KANALIZACIYA') return geometry
  const z = Number.isFinite(zoom) ? zoom : detailZoom
  if (z >= detailZoom) return geometry

  let step: number
  if (z <= 9) step = 16
  else if (z <= 11) step = 8
  else if (z <= 13) step = 4
  else step = 2

  if (step <= 1) return geometry
  const out: [number, number][] = [geometry[0]]
  for (let i = step; i < geometry.length - 1; i += step) out.push(geometry[i])
  out.push(geometry[geometry.length - 1])
  return out
}

export function edgeStrokeStyleKey(style: EdgeStrokeStyle): string {
  const dash = style.dash?.length ? style.dash.join(',') : ''
  return `${style.color}|${style.weight}|${dash}`
}
