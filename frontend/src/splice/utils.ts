import type { SpliceFiberRef, SpliceLinkV1 } from '../muftaSpliceTypes'
import type { WorkspaceEdge } from './types'

export function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}

export function fiberKey(i: number) {
  return String(i)
}

export function refKey(r: SpliceFiberRef) {
  return `${r.edgeId}:${r.fiberIndex}`
}

export function removeLinksTouchingFiber(links: SpliceLinkV1[], r: SpliceFiberRef): SpliceLinkV1[] {
  const k = refKey(r)
  return links.filter((l) => refKey(l.from) !== k && refKey(l.to) !== k)
}

export function cableDisplayName(e: WorkspaceEdge) {
  return e.cable_name?.trim() || `Кабель id ${e.id}`
}

export function snapGridCoord(v: number, step = 8) {
  return Math.round(v / step) * step
}
