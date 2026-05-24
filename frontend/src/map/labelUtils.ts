import type { NodeEntity } from '../gisTypes'

export const MUFTA_TK_LABEL_STACK_M = 5

export function haversineMeters(a: [number, number], b: [number, number]) {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(x))
}

export function buildParentTkMap(nodes: NodeEntity[]): Map<number, NodeEntity> {
  const map = new Map<number, NodeEntity>()
  for (const n of nodes) {
    if (n.type === 'TK') map.set(n.id, n)
  }
  return map
}

export function nodeLabelText(
  node: NodeEntity,
  parentTkById: Map<number, NodeEntity>,
  showTkStack = true,
): string {
  if (node.type === 'MUFTA' && showTkStack && node.parent_tk_id) {
    const tk = parentTkById.get(node.parent_tk_id)
    if (tk && haversineMeters([node.lat, node.lng], [tk.lat, tk.lng]) <= MUFTA_TK_LABEL_STACK_M) {
      return `${node.name}\n${tk.name}`
    }
  }
  const name = node.name?.trim()
  return name || `#${node.id}`
}

export type LabelPriority = { node: NodeEntity; priority: number; dist: number }

const TYPE_PRIORITY: Record<string, number> = { MUFTA: 0, KROSS: 1, PIKET: 2, TK: 3 }

/** Сколько статических подписей показывать при данном zoom. */
export function labelMaxForZoom(zoom: number, prefsMax: number, inViewCount: number): number {
  const cap = Math.max(1, inViewCount)
  let base = Math.max(50, prefsMax)
  if (inViewCount > 3000) base = Math.min(base, 120)
  else if (inViewCount > 1500) base = Math.min(base, 200)
  else if (inViewCount > 800) base = Math.min(base, Math.floor(base * 0.65))
  if (zoom >= 18) return Math.min(cap, base)
  if (zoom >= 17) return Math.min(cap, Math.max(base, 600))
  if (zoom >= 16) return Math.min(cap, Math.max(base, 300))
  return Math.min(cap, base)
}

export function pickLabelsForViewport(
  nodes: NodeEntity[],
  center: [number, number],
  maxCount: number,
): NodeEntity[] {
  const ranked: LabelPriority[] = nodes.map((node) => ({
    node,
    priority: TYPE_PRIORITY[node.type] ?? 9,
    dist: haversineMeters([node.lat, node.lng], center),
  }))
  ranked.sort((a, b) => a.priority - b.priority || a.dist - b.dist || a.node.id - b.node.id)
  return ranked.slice(0, Math.max(0, maxCount)).map((r) => r.node)
}
