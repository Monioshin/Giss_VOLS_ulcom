import Supercluster from 'supercluster'
import type { NodeEntity } from '../gisTypes'
import { NODE_MAP_LAYER_ORDER } from './nodeStyles'

export type NodeClusterProps = {
  nodeId: number
  type: string
  name: string
  parent_tk_id: number | null
}

export type NodeClusterFeature = Supercluster.PointFeature<NodeClusterProps>

let indexCache: { nodes: NodeEntity[]; zoom: number; index: Supercluster<NodeClusterProps> } | null = null

export function buildNodeClusterIndex(nodes: NodeEntity[], zoom: number): Supercluster<NodeClusterProps> {
  const zKey = Math.floor(zoom)
  if (indexCache && indexCache.nodes === nodes && indexCache.zoom === zKey) return indexCache.index

  const features: NodeClusterFeature[] = nodes.map((n) => ({
    type: 'Feature',
    properties: {
      nodeId: n.id,
      type: n.type,
      name: n.name,
      parent_tk_id: n.parent_tk_id ?? null,
    },
    geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
  }))

  const radius = clusterRadiusForZoom(zKey)
  const index = new Supercluster<NodeClusterProps>({
    radius: radius > 0 ? radius : 1,
    maxZoom: 20,
    minZoom: 0,
    map: (props: NodeClusterProps) => ({
      typeOrder: NODE_MAP_LAYER_ORDER[props.type as keyof typeof NODE_MAP_LAYER_ORDER] ?? 9,
    }),
    reduce: (acc: { typeOrder?: number }, props: { typeOrder?: number }) => {
      acc.typeOrder = Math.min(acc.typeOrder ?? 99, props.typeOrder ?? 99)
    },
  })
  index.load(features)
  indexCache = { nodes, zoom: zKey, index }
  return index
}

export function invalidateClusterIndexCache() {
  indexCache = null
}

/** Радиус кластера в пикселях; 0 = отдельные точки (узлы рисуются только с zoom ≥ TK_DETAIL_ZOOM). */
export function clusterRadiusForZoom(_zoom: number): number {
  return 0
}
