import type { CSSProperties } from 'react'
import { busyLineDashArray, type SpliceFiberMeta, type EdgeFiberUsage } from '../muftaSpliceTypes'

export function fiberBusyLinkStyle(d: SpliceFiberMeta & { edgeUsage?: EdgeFiberUsage }): CSSProperties {
  if (!d.busy) return {}
  const stroke = d.busyLineColor?.trim() || '#ea580c'
  const dash = busyLineDashArray(d.busyLineStyle)
  const out: CSSProperties = { stroke }
  if (dash) out.strokeDasharray = dash
  return out
}

export function spliceLinkStrokeStyle(
  dFrom: SpliceFiberMeta & { edgeUsage?: EdgeFiberUsage },
  dTo: SpliceFiberMeta & { edgeUsage?: EdgeFiberUsage },
): CSSProperties {
  if (dFrom.busy) return fiberBusyLinkStyle(dFrom)
  if (dTo.busy) return fiberBusyLinkStyle(dTo)
  return {}
}

export const FIBER_VIS_R = 7
export const FIBER_HIT_R = 11
