import { useEffect, useRef } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import type { LeafletMouseEvent } from 'leaflet'
import type { NodeEntity } from '../gisTypes'
import { listIdsSignature } from './listSignature'
import { createNodesCanvasLayer, type NodesCanvasHandlers, type NodesCanvasLayer } from './NodesCanvasLayer'

type MapNodesOverlayProps = {
  nodes: NodeEntity[]
  nodesById: Map<number, NodeEntity>
  clusterEnabled: boolean
  highlightNodeId: number | null
  detailZoom: number
  paused?: boolean
  onNodeClick?: (node: NodeEntity) => void
  onNodeContextMenu?: (e: LeafletMouseEvent, node: NodeEntity) => void
  onClusterClick?: (
    lat: number,
    lng: number,
    expansionZoom: number,
    clusterId?: number,
    count?: number,
  ) => void
  onLayerReady?: (layer: NodesCanvasLayer | null) => void
}

export function MapNodesOverlay({
  nodes,
  nodesById,
  clusterEnabled,
  highlightNodeId,
  detailZoom,
  paused = false,
  onNodeClick,
  onNodeContextMenu,
  onClusterClick,
  onLayerReady,
}: MapNodesOverlayProps) {
  const map = useMap()
  const layerRef = useRef<ReturnType<typeof createNodesCanvasLayer> | null>(null)
  const nodesRef = useRef(nodes)
  const nodesByIdRef = useRef(nodesById)
  const clusterRef = useRef(clusterEnabled)
  const highlightRef = useRef(highlightNodeId)
  const detailZoomRef = useRef(detailZoom)
  const pausedRef = useRef(paused)
  const handlersRef = useRef<NodesCanvasHandlers>({})
  const invalidateSigRef = useRef('')

  nodesRef.current = nodes
  nodesByIdRef.current = nodesById
  clusterRef.current = clusterEnabled
  highlightRef.current = highlightNodeId
  detailZoomRef.current = detailZoom
  pausedRef.current = paused
  handlersRef.current = { onNodeClick, onNodeContextMenu, onClusterClick }

  useEffect(() => {
    const layer = createNodesCanvasLayer({
      getNodes: () => nodesRef.current,
      getNodeById: (id) => nodesByIdRef.current.get(id),
      clusterEnabled: () => clusterRef.current,
      getHighlightNodeId: () => highlightRef.current,
      getDetailZoom: () => detailZoomRef.current,
      isPaused: () => pausedRef.current,
      handlers: {
        onNodeClick: (n) => handlersRef.current.onNodeClick?.(n),
        onNodeContextMenu: (e, n) => handlersRef.current.onNodeContextMenu?.(e, n),
        onClusterClick: (lat, lng, z, cid, cnt) =>
          handlersRef.current.onClusterClick?.(lat, lng, z, cid, cnt),
      },
    })
    layer.addTo(map)
    layerRef.current = layer
    onLayerReady?.(layer)
    return () => {
      layer.remove()
      layerRef.current = null
      onLayerReady?.(null)
    }
  }, [map, onLayerReady])

  useMapEvents({
    click: (e) => {
      const layer = layerRef.current
      if (!layer) return
      const hit = layer.hitTestAtContainerPoint(e.containerPoint.x, e.containerPoint.y)
      if (!hit) return
      if (hit.kind === 'cluster') {
        handlersRef.current.onClusterClick?.(
          hit.lat,
          hit.lng,
          hit.expansionZoom,
          hit.clusterId,
          hit.count,
        )
      } else {
        handlersRef.current.onNodeClick?.(hit.node)
      }
    },
    contextmenu: (e) => {
      const layer = layerRef.current
      if (!layer) return
      const hit = layer.hitTestAtContainerPoint(e.containerPoint.x, e.containerPoint.y)
      if (!hit || hit.kind !== 'point') return
      handlersRef.current.onNodeContextMenu?.(e, hit.node)
    },
  })

  useEffect(() => {
    layerRef.current?.setPaused(paused)
  }, [paused])

  useEffect(() => {
    const sig = `${listIdsSignature(nodes)}|c${clusterEnabled ? 1 : 0}|h${highlightNodeId ?? ''}|z${detailZoom}`
    if (sig === invalidateSigRef.current) return
    invalidateSigRef.current = sig
    layerRef.current?.invalidate()
  }, [nodes, clusterEnabled, highlightNodeId, detailZoom])

  return null
}
