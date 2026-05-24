import { useEffect, useRef, type RefObject } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import type { LeafletMouseEvent } from 'leaflet'
import type { EdgeEntity } from '../gisTypes'
import {
  createEdgesCanvasLayer,
  type EdgesCanvasHandlers,
  type EdgesCanvasLayer,
} from './EdgesCanvasLayer'
import { listIdsSignature } from './listSignature'
import type { NodesCanvasLayer } from './NodesCanvasLayer'

type MapEdgesOverlayProps = {
  edges: EdgeEntity[]
  highlightEdgeId: number | null
  routeEdgeIds: number[]
  fiberTraceEdgeIds: number[]
  excludedEdgeId: number | null
  edgeDetailZoom: number
  paused?: boolean
  onEdgeClick?: (edge: EdgeEntity) => void
  onEdgeContextMenu?: (e: LeafletMouseEvent, edge: EdgeEntity) => void
  onLayerReady?: (layer: EdgesCanvasLayer | null) => void
  nodesLayerRef?: RefObject<NodesCanvasLayer | null>
}

export function MapEdgesOverlay({
  edges,
  highlightEdgeId,
  routeEdgeIds,
  fiberTraceEdgeIds,
  excludedEdgeId,
  edgeDetailZoom,
  paused = false,
  onEdgeClick,
  onEdgeContextMenu,
  onLayerReady,
  nodesLayerRef,
}: MapEdgesOverlayProps) {
  const map = useMap()
  const layerRef = useRef<EdgesCanvasLayer | null>(null)
  const edgesRef = useRef(edges)
  const highlightRef = useRef(highlightEdgeId)
  const routeRef = useRef(routeEdgeIds)
  const traceRef = useRef(fiberTraceEdgeIds)
  const excludedRef = useRef(excludedEdgeId)
  const detailZoomRef = useRef(edgeDetailZoom)
  const pausedRef = useRef(paused)
  const handlersRef = useRef<EdgesCanvasHandlers>({})
  const invalidateSigRef = useRef('')

  edgesRef.current = edges
  highlightRef.current = highlightEdgeId
  routeRef.current = routeEdgeIds
  traceRef.current = fiberTraceEdgeIds
  excludedRef.current = excludedEdgeId
  detailZoomRef.current = edgeDetailZoom
  pausedRef.current = paused
  handlersRef.current = { onEdgeClick, onEdgeContextMenu }

  useEffect(() => {
    const layer = createEdgesCanvasLayer({
      getEdges: () => edgesRef.current,
      getHighlightEdgeId: () => highlightRef.current,
      getRouteEdgeIds: () => routeRef.current,
      getFiberTraceEdgeIds: () => traceRef.current,
      getExcludedEdgeId: () => excludedRef.current,
      getEdgeDetailZoom: () => detailZoomRef.current,
      isPaused: () => pausedRef.current,
      handlers: {
        onEdgeClick: (e) => handlersRef.current.onEdgeClick?.(e),
        onEdgeContextMenu: (ev, e) => handlersRef.current.onEdgeContextMenu?.(ev, e),
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

  useEffect(() => {
    layerRef.current?.setPaused(paused)
  }, [paused])

  useMapEvents({
    click: (e) => {
      const layer = layerRef.current
      if (!layer || pausedRef.current) return
      const nodeHit = nodesLayerRef?.current?.hitTestAtContainerPoint(
        e.containerPoint.x,
        e.containerPoint.y,
      )
      if (nodeHit) return
      const hit = layer.hitTestAtContainerPoint(e.containerPoint.x, e.containerPoint.y)
      if (hit) handlersRef.current.onEdgeClick?.(hit)
    },
    contextmenu: (e) => {
      const layer = layerRef.current
      if (!layer || pausedRef.current) return
      const nodeHit = nodesLayerRef?.current?.hitTestAtContainerPoint(
        e.containerPoint.x,
        e.containerPoint.y,
      )
      if (nodeHit) return
      const hit = layer.hitTestAtContainerPoint(e.containerPoint.x, e.containerPoint.y)
      if (hit) handlersRef.current.onEdgeContextMenu?.(e, hit)
    },
  })

  useEffect(() => {
    const sig = `${listIdsSignature(edges)}|h${highlightEdgeId ?? ''}|r${routeEdgeIds.join(',')}|t${fiberTraceEdgeIds.join(',')}|x${excludedEdgeId ?? ''}|z${edgeDetailZoom}`
    if (sig === invalidateSigRef.current) return
    invalidateSigRef.current = sig
    layerRef.current?.invalidate()
  }, [edges, highlightEdgeId, routeEdgeIds, fiberTraceEdgeIds, excludedEdgeId, edgeDetailZoom])

  return null
}
