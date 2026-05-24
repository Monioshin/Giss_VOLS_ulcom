import L from 'leaflet'
import type { EdgeEntity } from '../gisTypes'
import { syncCanvasSize } from './canvasResize'
import { attachMapPaintSync, registerMapInteractHandlers, registerMapPainter } from './mapPaintBus'
import { polylineIntersectsBounds } from './boundsUtils'
import { distToSegmentPx } from './edgeHitTest'
import { edgeStrokeStyleKey, simplifyEdgeGeometry, strokeForEdge, type EdgeStrokeStyle } from './edgeStyles'

export type EdgesCanvasHandlers = {
  onEdgeClick?: (edge: EdgeEntity) => void
  onEdgeContextMenu?: (e: L.LeafletMouseEvent, edge: EdgeEntity) => void
}

type SegmentHit = { edge: EdgeEntity; x1: number; y1: number; x2: number; y2: number; weight: number }

type PreparedPath = {
  edge: EdgeEntity
  pts: { x: number; y: number }[]
  style: EdgeStrokeStyle
}

const MAX_HIT_SEGMENTS = 2500

type EdgesCanvasOptions = {
  getEdges: () => EdgeEntity[]
  getHighlightEdgeId: () => number | null
  getRouteEdgeIds: () => number[]
  getFiberTraceEdgeIds: () => number[]
  getExcludedEdgeId: () => number | null
  getEdgeDetailZoom: () => number
  isPaused: () => boolean
  handlers: EdgesCanvasHandlers
}

export class EdgesCanvasLayer extends L.Layer {
  private _canvas: HTMLCanvasElement | null = null
  private _ctx: CanvasRenderingContext2D | null = null
  private _segments: SegmentHit[] = []
  private _rafId: number | null = null
  private _sizeKey = ''
  private _interacting = false
  private _detachMap: (() => void) | null = null
  private _detachPaint: (() => void) | null = null
  private _detachInteract: (() => void) | null = null
  private opts: EdgesCanvasOptions

  constructor(opts: EdgesCanvasOptions) {
    super()
    this.opts = opts
  }

  onAdd(map: L.Map): this {
    this._canvas = L.DomUtil.create('canvas', 'leaflet-edges-canvas') as HTMLCanvasElement
    const container = map.getContainer()
    container.appendChild(this._canvas)
    this._canvas.style.position = 'absolute'
    this._canvas.style.left = '0'
    this._canvas.style.top = '0'
    this._canvas.style.pointerEvents = 'none'
    this._canvas.style.zIndex = '550'
    this._ctx = this._canvas.getContext('2d')
    this._detachMap = attachMapPaintSync(map)
    this._detachPaint = registerMapPainter(() => {
      if (!this.opts.isPaused()) this._redraw()
    })
    this._detachInteract = registerMapInteractHandlers(
      () => this.setInteracting(true),
      () => this.setInteracting(false),
    )
    this.paintFrame()
    return this
  }

  onRemove(_map: L.Map): this {
    this._detachInteract?.()
    this._detachInteract = null
    this._detachPaint?.()
    this._detachPaint = null
    this._detachMap?.()
    this._detachMap = null
    if (this._rafId != null) cancelAnimationFrame(this._rafId)
    this._canvas?.remove()
    this._canvas = null
    this._ctx = null
    return this
  }

  invalidate(): void {
    this.paintFrame()
  }

  paintFrame(): void {
    if (this.opts.isPaused()) return
    this._redraw()
  }

  redraw(): void {
    if (this.opts.isPaused()) return
    if (this._rafId != null) return
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null
      this._redraw()
    })
  }

  setPaused(paused: boolean): void {
    if (paused) {
      if (this._rafId != null) cancelAnimationFrame(this._rafId)
      this._rafId = null
    } else {
      this.paintFrame()
    }
  }

  setInteracting(interacting: boolean): void {
    this._interacting = interacting
  }

  hitTestAtContainerPoint(x: number, y: number): EdgeEntity | null {
    let best: SegmentHit | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const seg of this._segments) {
      const d = distToSegmentPx(x, y, seg.x1, seg.y1, seg.x2, seg.y2)
      const hitW = Math.max(8, seg.weight + 4)
      if (d <= hitW && d < bestD) {
        bestD = d
        best = seg
      }
    }
    return best?.edge ?? null
  }

  private _strokeBatch(
    ctx: CanvasRenderingContext2D,
    style: EdgeStrokeStyle,
    paths: PreparedPath[],
  ): void {
    if (!paths.length) return
    ctx.beginPath()
    for (const path of paths) {
      ctx.moveTo(path.pts[0].x, path.pts[0].y)
      for (let i = 1; i < path.pts.length; i++) ctx.lineTo(path.pts[i].x, path.pts[i].y)
    }
    ctx.strokeStyle = style.color
    ctx.lineWidth = style.weight
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (style.dash?.length) ctx.setLineDash(style.dash)
    else ctx.setLineDash([])
    ctx.stroke()
  }

  private _redraw = (): void => {
    const map = this._map
    if (!map || !this._canvas || !this._ctx || this.opts.isPaused()) return
    const devPerf = import.meta.env.DEV
    const t0 = devPerf ? performance.now() : 0

    const zoom = map.getZoom()
    const detailZoom = this.opts.getEdgeDetailZoom()
    const size = map.getSize()
    const dpr = window.devicePixelRatio || 1
    const sizeKeyRef = { current: this._sizeKey }
    syncCanvasSize(this._canvas, this._ctx, size, dpr, sizeKeyRef)
    this._sizeKey = sizeKeyRef.current

    const ctx = this._ctx
    ctx.clearRect(0, 0, size.x, size.y)

    const bounds = map.getBounds()
    const highlightId = this.opts.getHighlightEdgeId()
    const routeIds = new Set(this.opts.getRouteEdgeIds())
    const traceIds = new Set(this.opts.getFiberTraceEdgeIds())
    const excluded = this.opts.getExcludedEdgeId()
    const edges = this.opts.getEdges().filter((e) => e.id !== excluded)

    const buildHit = !this._interacting
    this._segments = []
    const batches = new Map<string, { style: EdgeStrokeStyle; paths: PreparedPath[] }>()
    let hitSegmentCount = 0

    for (const edge of edges) {
      const geom = simplifyEdgeGeometry(edge.geometry ?? [], zoom, detailZoom, edge.type)
      if (!geom.length || !polylineIntersectsBounds(geom, bounds)) continue

      const pts: { x: number; y: number }[] = []
      for (const [lat, lng] of geom) {
        const p = map.latLngToContainerPoint([lat, lng])
        pts.push({ x: p.x, y: p.y })
      }
      if (pts.length < 2) continue

      const style = strokeForEdge(edge, {
        highlight: highlightId === edge.id,
        route: routeIds.has(edge.id),
        fiberTrace: traceIds.has(edge.id),
        zoom,
      })

      const key = edgeStrokeStyleKey(style)
      const batch = batches.get(key) ?? { style, paths: [] }
      batch.paths.push({ edge, pts, style })
      batches.set(key, batch)

      if (buildHit) {
        const mustHit =
          edge.id === highlightId || routeIds.has(edge.id) || traceIds.has(edge.id)
        for (let i = 1; i < pts.length; i++) {
          if (!mustHit && hitSegmentCount >= MAX_HIT_SEGMENTS) break
          this._segments.push({
            edge,
            x1: pts[i - 1].x,
            y1: pts[i - 1].y,
            x2: pts[i].x,
            y2: pts[i].y,
            weight: style.weight,
          })
          hitSegmentCount += 1
        }
      }
    }

    for (const { style, paths } of batches.values()) {
      this._strokeBatch(ctx, style, paths)
    }

    if (devPerf) {
      const ms = performance.now() - t0
      if (ms > 16) console.debug(`[gis] edges canvas redraw ${ms.toFixed(1)}ms (${edges.length} edges)`)
    }
  }
}

export function createEdgesCanvasLayer(opts: EdgesCanvasOptions): EdgesCanvasLayer {
  return new EdgesCanvasLayer(opts)
}
