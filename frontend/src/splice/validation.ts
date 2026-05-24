import type { SpliceFiberRef, SpliceLinkV1, SpliceV1 } from '../muftaSpliceTypes'
import { countBusyInUsage, getEdgeFiberUsage } from '../muftaSpliceTypes'
import type { WorkspaceEdge } from './types'
import { refKey } from './utils'

export type SpliceValidationIssue = { level: 'warn' | 'info'; message: string }

export function validateSpliceBeforeSave(
  splice: SpliceV1,
  incident: WorkspaceEdge[],
  internalPorts: number,
  getFiberBusy: (edgeId: number, fiberIndex: number) => boolean,
): SpliceValidationIssue[] {
  const issues: SpliceValidationIssue[] = []
  const linkedKeys = new Set<string>()
  for (const l of splice.links) {
    linkedKeys.add(refKey(l.from))
    linkedKeys.add(refKey(l.to))
  }

  const checkFibers = (edgeId: number, total: number) => {
    for (let fi = 1; fi <= total; fi += 1) {
      const k = `${edgeId}:${fi}`
      const busy = getFiberBusy(edgeId, fi)
      if (busy && !linkedKeys.has(k)) {
        issues.push({
          level: 'warn',
          message: `Волокно ${k} отмечено занятым, но без сварки на схеме`,
        })
      }
    }
  }

  for (const e of incident) {
    const total = Math.max(0, e.total_fibers ?? 0)
    checkFibers(e.id, total)
    const usage = getEdgeFiberUsage(e.passport_data)
    const busyCount = countBusyInUsage(total, usage)
    const used = e.used_fibers ?? 0
    if (used !== busyCount) {
      issues.push({
        level: 'info',
        message: `Кабель id ${e.id}: used_fibers=${used}, занято по паспорту=${busyCount}`,
      })
    }
  }
  if (internalPorts > 0) checkFibers(0, internalPorts)

  for (const l of splice.links) {
    const fromLabel = splice.fibers?.[String(l.from.edgeId)]?.[String(l.from.fiberIndex)]?.ownerLabel
    const toLabel = splice.fibers?.[String(l.to.edgeId)]?.[String(l.to.fiberIndex)]?.ownerLabel
    if (!fromLabel?.trim() && !toLabel?.trim()) {
      issues.push({
        level: 'info',
        message: `Связь ${refKey(l.from)} ↔ ${refKey(l.to)} без подписей на концах`,
      })
    }
  }

  return issues
}

export function countFreeFibers(
  incident: WorkspaceEdge[],
  internalPorts: number,
  splice: SpliceV1,
  getFiberBusy: (edgeId: number, fiberIndex: number) => boolean,
): { total: number; free: number; linked: number } {
  let total = 0
  let free = 0
  const linkedKeys = new Set<string>()
  for (const l of splice.links) {
    linkedKeys.add(refKey(l.from))
    linkedKeys.add(refKey(l.to))
  }
  const countEdge = (edgeId: number, n: number) => {
    for (let fi = 1; fi <= n; fi += 1) {
      total += 1
      const k = `${edgeId}:${fi}`
      if (!getFiberBusy(edgeId, fi) && !linkedKeys.has(k)) free += 1
    }
  }
  for (const e of incident) countEdge(e.id, Math.max(0, e.total_fibers ?? 0))
  if (internalPorts > 0) countEdge(0, internalPorts)
  return { total, free, linked: splice.links.length }
}

export function findLinkIndexForFiber(links: SpliceLinkV1[], ref: SpliceFiberRef): number {
  const k = refKey(ref)
  return links.findIndex((l) => refKey(l.from) === k || refKey(l.to) === k)
}
