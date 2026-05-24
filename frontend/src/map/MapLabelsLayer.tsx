import { useEffect, useRef } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { NodeEntity } from '../gisTypes'
import { buildParentTkMap, labelMaxForZoom, nodeLabelText, pickLabelsForViewport } from './labelUtils'
import { pointInBounds } from './boundsUtils'
import { isDetailNodeType, TK_DETAIL_ZOOM } from './mapZoomConstants'
import { buildMuftaScreenPositions } from './muftaTkLayout'
import { NODE_STYLE } from './nodeStyles'

const HOVER_RADIUS_PX = 14
const HOVER_THROTTLE_MS = 50
const LABEL_GAP_PX = 4

type MapLabelsLayerProps = {
  nodes: NodeEntity[]
  allNodes?: NodeEntity[]
  hideMapLabels: boolean
  labelMaxCount: number
  mapZoom: number
  tkDetailZoom?: number
  labelsWithNodes?: boolean
  highlightNodeId?: number | null
  paused?: boolean
}

type LabelsCtx = {
  nodes: NodeEntity[]
  parentTkById: Map<number, NodeEntity>
  hideMapLabels: boolean
  labelMaxCount: number
  mapZoom: number
  tkDetailZoom: number
  labelsWithNodes: boolean
  highlightNodeId: number | null
}

function labelOffsetPx(node: NodeEntity): number {
  const r = NODE_STYLE[node.type]?.radius ?? 8
  return r + LABEL_GAP_PX
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function MapLabelsLayer({
  nodes,
  allNodes,
  hideMapLabels,
  labelMaxCount,
  mapZoom,
  tkDetailZoom = TK_DETAIL_ZOOM,
  labelsWithNodes = false,
  highlightNodeId = null,
  paused = false,
}: MapLabelsLayerProps) {
  const map = useMap()
  const hoverElRef = useRef<HTMLDivElement | null>(null)
  const labelsPaneRef = useRef<HTMLDivElement | null>(null)
  const nodesRef = useRef(nodes)
  const parentTkByIdRef = useRef(buildParentTkMap(allNodes ?? nodes))
  const ctxRef = useRef<LabelsCtx>({
    nodes,
    parentTkById: parentTkByIdRef.current,
    hideMapLabels,
    labelMaxCount,
    mapZoom,
    tkDetailZoom,
    labelsWithNodes,
    highlightNodeId,
  })
  const draggingRef = useRef(false)
  const hoverThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRedrawRef = useRef<number | null>(null)
  const rafRepositionRef = useRef<number | null>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  nodesRef.current = nodes
  parentTkByIdRef.current = buildParentTkMap(allNodes ?? nodes)
  ctxRef.current = {
    nodes,
    parentTkById: parentTkByIdRef.current,
    hideMapLabels,
    labelMaxCount,
    mapZoom,
    tkDetailZoom,
    labelsWithNodes,
    highlightNodeId,
  }

  const redrawStaticLabels = () => {
    const pane = labelsPaneRef.current
    if (!pane) return
    pane.innerHTML = ''

    const ctx = ctxRef.current
    const zoom = map.getZoom()
    const showLabels = ctx.labelsWithNodes ? zoom >= ctx.tkDetailZoom : zoom >= 16
    if (ctx.hideMapLabels || !showLabels) return

    const labelCandidates = nodesRef.current.filter((n) => isDetailNodeType(n.type))
    if (!labelCandidates.length) return

    const bounds = map.getBounds()
    const inView = labelCandidates.filter((n) => pointInBounds(n.lat, n.lng, bounds))
    if (!inView.length) return

    const center = map.getCenter()
    const maxLabels = labelMaxForZoom(zoom, ctx.labelMaxCount, inView.length)
    const skipCollision = zoom >= 18
    const relaxCollision = zoom >= 17
    const picked = pickLabelsForViewport(inView, [center.lat, center.lng], maxLabels)
    const pickedIds = new Set(picked.map((n) => n.id))
    const placed: { cx: number; cy: number; r: number }[] = []
    const muftaScreen = buildMuftaScreenPositions(nodesRef.current, map)

    const nodeContainerPoint = (node: NodeEntity) => {
      const screen = node.type === 'MUFTA' ? muftaScreen.get(node.id) : undefined
      return screen ?? map.latLngToContainerPoint([node.lat, node.lng])
    }

    const placeLabelAtNode = (el: HTMLElement, node: NodeEntity) => {
      const pt = nodeContainerPoint(node)
      const gap = labelOffsetPx(node)
      el.style.left = `${pt.x}px`
      el.style.top = `${pt.y}px`
      el.style.transform = `translate(-50%, calc(-100% - ${gap}px))`
    }

    const appendLabelEl = (node: NodeEntity) => {
      const text = nodeLabelText(node, ctx.parentTkById, true)
      const lines = text.split('\n').filter((l) => l.length > 0)
      if (!lines.length) return
      const el = L.DomUtil.create('div', 'map-label-static') as HTMLDivElement
      el.className = 'map-label-static'
      el.dataset.nodeId = String(node.id)
      placeLabelAtNode(el, node)
      if (lines.length > 1) {
        el.innerHTML = lines
          .map(
            (l, i) =>
              `<span class="map-label-line map-label-line--${i === 0 ? 'primary' : 'secondary'}">${escapeHtml(l)}</span>`,
          )
          .join('')
      } else {
        el.textContent = text
      }
      pane.appendChild(el)
    }

    const tryPlace = (node: NodeEntity, force: boolean): boolean => {
      const text = nodeLabelText(node, ctx.parentTkById, true)
      const lines = text.split('\n').filter((l) => l.length > 0)
      if (!lines.length) return false
      const pt = nodeContainerPoint(node)
      const w = Math.max(...lines.map((l) => l.length)) * 6.5 + 12
      const h = lines.length * 14 + 8
      const gap = labelOffsetPx(node)
      const cx = pt.x
      const cy = pt.y - gap - h / 2
      const hitR = (Math.max(w, h) / 2 + 4) * (relaxCollision && !skipCollision ? 0.65 : 1)
      if (!force && !skipCollision && placed.some((p) => Math.hypot(p.cx - cx, p.cy - cy) < p.r + hitR)) {
        return false
      }
      placed.push({ cx, cy, r: hitR })
      appendLabelEl(node)
      return true
    }

    for (const node of picked) {
      tryPlace(node, false)
    }

    if (ctx.highlightNodeId != null) {
      const hi = nodesRef.current.find((n) => n.id === ctx.highlightNodeId)
      if (hi && isDetailNodeType(hi.type) && !pickedIds.has(hi.id)) {
        tryPlace(hi, true)
      }
    }
  }

  const repositionStaticLabels = () => {
    const pane = labelsPaneRef.current
    if (!pane) return

    const ctx = ctxRef.current
    const zoom = map.getZoom()
    const showLabels = ctx.labelsWithNodes ? zoom >= ctx.tkDetailZoom : zoom >= 16
    if (ctx.hideMapLabels || !showLabels) return

    const muftaScreen = buildMuftaScreenPositions(nodesRef.current, map)
    const nodeById = new Map(nodesRef.current.map((n) => [n.id, n]))

    for (const raw of pane.querySelectorAll('.map-label-static')) {
      const el = raw as HTMLDivElement
      const id = Number(el.dataset.nodeId)
      if (!Number.isFinite(id)) continue
      const node = nodeById.get(id)
      if (!node || !isDetailNodeType(node.type)) continue
      const screen = node.type === 'MUFTA' ? muftaScreen.get(node.id) : undefined
      const pt = screen ?? map.latLngToContainerPoint([node.lat, node.lng])
      const gap = labelOffsetPx(node)
      el.style.left = `${pt.x}px`
      el.style.top = `${pt.y}px`
      el.style.transform = `translate(-50%, calc(-100% - ${gap}px))`
    }
  }

  const scheduleReposition = () => {
    if (pausedRef.current) return
    if (rafRepositionRef.current != null) return
    rafRepositionRef.current = requestAnimationFrame(() => {
      rafRepositionRef.current = null
      repositionStaticLabels()
    })
  }

  const scheduleRedraw = () => {
    if (pausedRef.current) return
    if (rafRedrawRef.current != null) return
    rafRedrawRef.current = requestAnimationFrame(() => {
      rafRedrawRef.current = null
      redrawStaticLabels()
    })
  }

  const runHover = (pt: L.Point) => {
    const hover = hoverElRef.current
    const ctx = ctxRef.current
    const zoom = map.getZoom()
    const showLabels = ctx.labelsWithNodes ? zoom >= ctx.tkDetailZoom : zoom >= 16
    if (!hover || ctx.hideMapLabels || !showLabels || draggingRef.current) {
      if (hover) hover.style.display = 'none'
      return
    }
    const muftaScreen = buildMuftaScreenPositions(nodesRef.current, map)
    let best: NodeEntity | null = null
    let bestD = HOVER_RADIUS_PX
    for (const n of nodesRef.current.filter((x) => isDetailNodeType(x.type))) {
      const screen = n.type === 'MUFTA' ? muftaScreen.get(n.id) : undefined
      const np = screen ?? map.latLngToContainerPoint([n.lat, n.lng])
      const d = Math.hypot(np.x - pt.x, np.y - pt.y)
      if (d < bestD) {
        bestD = d
        best = n
      }
    }
    if (!best) {
      hover.style.display = 'none'
      return
    }
    const text = nodeLabelText(best, ctx.parentTkById, true)
    const lines = text.split('\n').filter((l) => l.length > 0)
    if (!lines.length) {
      hover.style.display = 'none'
      return
    }
    const ptNode =
      best.type === 'MUFTA' && muftaScreen.get(best.id)
        ? muftaScreen.get(best.id)!
        : map.latLngToContainerPoint([best.lat, best.lng])
    const gap = labelOffsetPx(best)
    hover.style.display = 'block'
    hover.style.left = `${ptNode.x}px`
    hover.style.top = `${ptNode.y}px`
    hover.style.transform = `translate(-50%, calc(-100% - ${gap}px))`
    if (lines.length > 1) {
      hover.innerHTML = lines
        .map(
          (l, i) =>
            `<span class="map-label-line map-label-line--${i === 0 ? 'primary' : 'secondary'}">${escapeHtml(l)}</span>`,
        )
        .join('<br/>')
    } else {
      hover.textContent = text
    }
  }

  useEffect(() => {
    const onMoveFrame = () => scheduleReposition()
    map.on('move', onMoveFrame)
    map.on('zoomanim', onMoveFrame)
    map.on('drag', onMoveFrame)
    map.on('zoom', onMoveFrame)
    return () => {
      map.off('move', onMoveFrame)
      map.off('zoomanim', onMoveFrame)
      map.off('drag', onMoveFrame)
      map.off('zoom', onMoveFrame)
    }
  }, [map])

  useEffect(() => {
    const container = map.getContainer()

    const hover = L.DomUtil.create('div', 'map-label-hover') as HTMLDivElement
    hover.className = 'map-label-hover'
    hover.style.display = 'none'
    container.appendChild(hover)
    hoverElRef.current = hover

    const pane = L.DomUtil.create('div', 'map-labels-pane') as HTMLDivElement
    pane.className = 'map-labels-pane'
    container.appendChild(pane)
    labelsPaneRef.current = pane

    const onResize = () => scheduleRedraw()
    map.on('resize', onResize)
    redrawStaticLabels()

    return () => {
      map.off('resize', onResize)
      if (rafRedrawRef.current != null) cancelAnimationFrame(rafRedrawRef.current)
      if (rafRepositionRef.current != null) cancelAnimationFrame(rafRepositionRef.current)
      hover.remove()
      pane.remove()
      hoverElRef.current = null
      labelsPaneRef.current = null
    }
  }, [map])

  useMapEvents({
    movestart: () => {
      draggingRef.current = true
      if (hoverElRef.current) hoverElRef.current.style.display = 'none'
    },
    moveend: () => {
      draggingRef.current = false
      redrawStaticLabels()
    },
    zoomend: () => redrawStaticLabels(),
    dragstart: () => {
      draggingRef.current = true
      if (hoverElRef.current) hoverElRef.current.style.display = 'none'
    },
    dragend: () => {
      draggingRef.current = false
      redrawStaticLabels()
    },
    mousemove: (e) => {
      if (draggingRef.current) return
      const pt = e.containerPoint
      if (hoverThrottleRef.current) clearTimeout(hoverThrottleRef.current)
      hoverThrottleRef.current = setTimeout(() => runHover(pt), HOVER_THROTTLE_MS)
    },
    mouseout: () => {
      if (hoverThrottleRef.current) clearTimeout(hoverThrottleRef.current)
      if (hoverElRef.current) hoverElRef.current.style.display = 'none'
    },
  })

  useEffect(() => {
    if (pausedRef.current) return
    redrawStaticLabels()
  }, [nodes, allNodes, hideMapLabels, labelMaxCount, mapZoom, tkDetailZoom, labelsWithNodes, highlightNodeId, paused])

  return null
}
