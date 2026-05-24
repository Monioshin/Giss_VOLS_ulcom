/** Узлы на карте (ТК, муфта, кросс): только при zoom ≥ этого значения; размер маркера — в экранных px. */
export const TK_DETAIL_ZOOM = 16

export const DETAIL_NODE_TYPES = ['TK', 'MUFTA', 'KROSS'] as const

export const VIEWPORT_TYPES_DETAIL = 'TK,MUFTA,KROSS'
export const VIEWPORT_TYPES_OVERVIEW = 'TK'

const DETAIL_SET = new Set<string>(DETAIL_NODE_TYPES)

/** Порог включения viewport-режима (подгрузка по bbox). */
export const VIEWPORT_NODE_THRESHOLD = 2000

/** Лимиты объектов в RAM при viewport-режиме. */
export const VIEWPORT_MAX_NODES_IN_MEMORY = 10000
export const VIEWPORT_MAX_EDGES_IN_MEMORY = 20000

export const VIEWPORT_PAGE_LIMIT = 2000
export const VIEWPORT_MAX_NODE_PAGES = 6
/** Страниц на тип участка (канализация и ВОЛС отдельно). */
export const VIEWPORT_MAX_EDGE_PAGES_PER_TYPE = 6
export const VIEWPORT_CACHE_MAX = 12

/** Лимит страниц участков (legacy alias). */
export const VIEWPORT_MAX_EDGE_PAGES = VIEWPORT_MAX_EDGE_PAGES_PER_TYPE

export function isDetailNodeType(type: string): boolean {
  return DETAIL_SET.has(String(type).toUpperCase())
}

export function shouldShowDetailNodes(zoom: number, detailZoom = TK_DETAIL_ZOOM): boolean {
  return zoom >= detailZoom
}

/** Типы узлов для GET /map/viewport: далеко — только ТК (муфты на клиенте не рисуются до detail zoom). */
export function viewportTypesForZoom(zoom: number, detailZoom = TK_DETAIL_ZOOM): string {
  return zoom >= detailZoom ? VIEWPORT_TYPES_DETAIL : VIEWPORT_TYPES_OVERVIEW
}

export function viewportPageLimitForZoom(zoom: number, detailZoom = TK_DETAIL_ZOOM): number {
  return zoom >= detailZoom ? VIEWPORT_PAGE_LIMIT : Math.min(800, VIEWPORT_PAGE_LIMIT)
}

/** Участки: полный page limit на всех zoom (не 800), чтобы канализация не пропадала при отдалении. */
export function viewportEdgePageLimitForZoom(_zoom: number): number {
  return VIEWPORT_PAGE_LIMIT
}

/** Ступень LOD геометрии участков (совпадает с simplifyEdgeGeometry). */
export function edgeLodTier(zoom: number, detailZoom = 15): number {
  const z = Number.isFinite(zoom) ? zoom : detailZoom
  if (z >= detailZoom) return 4
  if (z > 13) return 3
  if (z > 11) return 2
  if (z > 9) return 1
  return 0
}
