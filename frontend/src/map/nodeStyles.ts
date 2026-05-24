import type { NodeType } from '../gisTypes'

export type NodeMarkerShape = 'circle' | 'triangle' | 'diamond'

export type NodeStyleSpec = {
  fill: string
  stroke: string
  /** Радиус / полуось в экранных пикселях (не зависит от zoom карты). */
  radius: number
  fillOpacity: number
  weight: number
  shape: NodeMarkerShape
}

export const NODE_STYLE: Record<NodeType, NodeStyleSpec> = {
  TK: { fill: '#7e57c2', stroke: '#7e57c2', radius: 12, fillOpacity: 0.5, weight: 1, shape: 'circle' },
  PIKET: { fill: '#3949ab', stroke: '#3949ab', radius: 8, fillOpacity: 0.5, weight: 1, shape: 'circle' },
  KROSS: { fill: '#ff9800', stroke: '#e65100', radius: 9, fillOpacity: 1, weight: 2, shape: 'triangle' },
  MUFTA: { fill: '#00e676', stroke: '#1b5e20', radius: 8, fillOpacity: 1, weight: 2, shape: 'diamond' },
}

/** Контур маркера узла (центр x,y; r — как у круга). */
export function traceNodeMarkerPath(
  ctx: CanvasRenderingContext2D | Path2D,
  x: number,
  y: number,
  r: number,
  shape: NodeMarkerShape,
): void {
  if (shape === 'triangle') {
    const w = (r * Math.sqrt(3)) / 2
    ctx.moveTo(x, y - r)
    ctx.lineTo(x - w, y + r / 2)
    ctx.lineTo(x + w, y + r / 2)
    ctx.closePath()
    return
  }
  if (shape === 'diamond') {
    ctx.moveTo(x, y - r)
    ctx.lineTo(x + r, y)
    ctx.lineTo(x, y + r)
    ctx.lineTo(x - r, y)
    ctx.closePath()
    return
  }
  ctx.moveTo(x + r, y)
  ctx.arc(x, y, r, 0, Math.PI * 2)
  if ('closePath' in ctx && typeof ctx.closePath === 'function') ctx.closePath()
}

export const CLUSTER_STYLE = { fill: '#6a1b9a', stroke: '#6a1b9a', radius: 14, fillOpacity: 0.55, weight: 1 }
export const HIGHLIGHT_STROKE = '#facc15'

export const NODE_MAP_LAYER_ORDER: Record<NodeType, number> = { TK: 0, PIKET: 1, KROSS: 2, MUFTA: 3 }

export function sortNodesByMapLayer<T extends { type: NodeType; id: number }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => NODE_MAP_LAYER_ORDER[a.type] - NODE_MAP_LAYER_ORDER[b.type] || a.id - b.id,
  )
}
