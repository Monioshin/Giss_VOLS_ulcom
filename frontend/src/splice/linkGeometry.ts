import type { SpliceLinkWaypoint } from '../muftaSpliceTypes'
import type { PortGeom } from './layout'
import { snapGridCoord } from './utils'

export function linkPathCubic(a: PortGeom, b: PortGeom, bundleOffset = 0): string {
  const ax = a.hitCx
  const ay = a.hitCy
  const bx0 = b.hitCx
  const by0 = b.hitCy
  const dx = bx0 - ax
  const dy = by0 - ay
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist
  const uy = dy / dist
  const nx = -uy
  const ny = ux
  const ox = nx * bundleOffset
  const oy = ny * bundleOffset
  const tension = Math.min(120, dist * 0.42)
  const c1x = ax + ux * tension + ox
  const c1y = ay + uy * tension + oy
  const c2x = bx0 - ux * tension + ox
  const c2y = by0 - uy * tension + oy
  return `M ${ax + ox} ${ay + oy} C ${c1x} ${c1y} ${c2x} ${c2y} ${bx0 + ox} ${by0 + oy}`
}

export function linkPathForSplice(
  a: PortGeom,
  b: PortGeom,
  waypoints?: SpliceLinkWaypoint[] | null,
  bundleOffset = 0,
): string {
  if (!waypoints?.length) return linkPathCubic(a, b, bundleOffset)
  const ox = bundleOffset
  let d = `M ${a.hitCx} ${a.hitCy}`
  for (const w of waypoints) d += ` L ${w.x + ox} ${w.y}`
  d += ` L ${b.hitCx} ${b.hitCy}`
  return d
}

export function bundleOffsetForLinkIndex(index: number, total: number): number {
  if (total <= 1) return 0
  const mid = (total - 1) / 2
  return (index - mid) * 3.5
}

export function snapWaypoint(w: SpliceLinkWaypoint, enabled: boolean): SpliceLinkWaypoint {
  if (!enabled) return w
  return { x: snapGridCoord(w.x), y: snapGridCoord(w.y) }
}
