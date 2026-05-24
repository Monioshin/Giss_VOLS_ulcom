import L from 'leaflet'
import type Supercluster from 'supercluster'
import type { NodeEntity } from '../gisTypes'
import { syncCanvasSize } from './canvasResize'
import { attachMapPaintSync, registerMapInteractHandlers, registerMapPainter } from './mapPaintBus'
import { buildNodeClusterIndex, clusterRadiusForZoom, type NodeClusterProps } from './superclusterIndex'
import { buildMuftaScreenPositions } from './muftaTkLayout'
import { CLUSTER_STYLE, NODE_STYLE, traceNodeMarkerPath } from './nodeStyles'

export type NodesCanvasHandlers = {
  onNodeClick?: (node: NodeEntity) => void
  onNodeContextMenu?: (e: L.LeafletMouseEvent, node: NodeEntity) => void
  onClusterClick?: (lat: number, lng: number, expansionZoom: number, clusterId?: number, count?: number) => void
}

export type HitTestResult =
  | { kind: 'point'; node: NodeEntity }
  | { kind: 'cluster'; lat: number; lng: number; expansionZoom: number; clusterId: number; count: number }

type NodesCanvasOptions = {
  getNodes: () => NodeEntity[]
  getNodeById: (id: number) => NodeEntity | undefined
  clusterEnabled: () => boolean
  getHighlightNodeId: () => number | null
  getDetailZoom: () => number
  isPaused: () => boolean
  handlers: NodesCanvasHandlers
}

type DrawItem =
  | { kind: 'point'; node: NodeEntity; x: number; y: number; r: number }
  | { kind: 'cluster'; clusterId: number; x: number; y: number; r: number; count: number; lat: number; lng: number; expansionZoom: number }

export class NodesCanvasLayer extends L.Layer {
  private _canvas: HTMLCanvasElement | null = null
  private _ctx: CanvasRenderingContext2D | null = null
  private _items: DrawItem[] = []
  private _index: Supercluster<NodeClusterProps> | null = null
  private _indexKey = ''
  private _rafId: number | null = null
  private _sizeKey = ''
  private _detachMap: (() => void) | null = null
  private _detachPaint: (() => void) | null = null
  private _detachInteract: (() => void) | null = null
  private opts: NodesCanvasOptions

  constructor(opts: NodesCanvasOptions) {
    super()
    this.opts = opts
  }

  onAdd(map: L.Map): this {
    this._canvas = L.DomUtil.create('canvas', 'leaflet-nodes-canvas') as HTMLCanvasElement
    const container = map.getContainer()
    container.appendChild(this._canvas)
    this._canvas.style.position = 'absolute'
    this._canvas.style.left = '0'
    this._canvas.style.top = '0'
    this._canvas.style.pointerEvents = 'none'
    this._canvas.style.zIndex = '600'
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
    this._index = null
    this._indexKey = ''
    this.paintFrame()
  }

  /** Синхронная отрисовка (вызывается MapCanvasCoordinator). */
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

  setInteracting(_interacting: boolean): void {
    /* узлы не строят hit-сегменты; флаг для единого API с линиями */
  }

  getSuperclusterIndex(): Supercluster<NodeClusterProps> | null {
    return this._index
  }

  hitTestAtContainerPoint(x: number, y: number): HitTestResult | null {
    let best: DrawItem | null = null
    let bestDist = Number.POSITIVE_INFINITY
    for (const item of this._items) {
      const d = Math.hypot(item.x - x, item.y - y)
      const hitR = item.r + 6
      if (d <= hitR && d < bestDist) {
        bestDist = d
        best = item
      }
    }
    if (!best) return null
    if (best.kind === 'cluster') {
      return {
        kind: 'cluster',
        lat: best.lat,
        lng: best.lng,
        expansionZoom: best.expansionZoom,
        clusterId: best.clusterId,
        count: best.count,
      }
    }
    return { kind: 'point', node: best.node }
  }

  private _ensureIndex(nodes: NodeEntity[], zoom: number): Supercluster<NodeClusterProps> | null {
    const zoomKey = Math.floor(zoom)
    const key = `${nodes.length}:${zoomKey}`
    if (this._index && this._indexKey === key) return this._index
    if (nodes.length === 0) return null
    this._index = buildNodeClusterIndex(nodes, zoom)
    this._indexKey = key
    return this._index
  }

  private _redraw = (): void => {
    const map = this._map
    if (!map || !this._canvas || !this._ctx) return
    const devPerf = import.meta.env.DEV
    const t0 = devPerf ? performance.now() : 0

    const size = map.getSize()
    const dpr = window.devicePixelRatio || 1
    const sizeKeyRef = { current: this._sizeKey }
    syncCanvasSize(this._canvas, this._ctx, size, dpr, sizeKeyRef)
    this._sizeKey = sizeKeyRef.current

    const ctx = this._ctx
    ctx.clearRect(0, 0, size.x, size.y)

    const zoom = map.getZoom()
    if (zoom < this.opts.getDetailZoom()) {
      this._items = []
      return
    }

    const nodes = this.opts.getNodes()
    const highlightId = this.opts.getHighlightNodeId()
    const zoomKey = Math.floor(zoom)
    const radius = clusterRadiusForZoom(zoomKey)
    const clusterOn = this.opts.clusterEnabled() && nodes.length > 0 && radius > 0
    const muftaScreen = buildMuftaScreenPositions(nodes, map)

    this._items = []

    if (!clusterOn) {
      for (const node of nodes) {
        const screen = node.type === 'MUFTA' ? muftaScreen.get(node.id) : undefined
        const pt = screen ?? map.latLngToContainerPoint([node.lat, node.lng])
        if (pt.x < -40 || pt.y < -40 || pt.x > size.x + 40 || pt.y > size.y + 40) continue
        const style = NODE_STYLE[node.type]
        const hl = highlightId === node.id
        const r = hl ? style.radius + 3 : style.radius
        this._items.push({ kind: 'point', node, x: pt.x, y: pt.y, r })
        this._drawNode(ctx, pt.x, pt.y, r, style, hl)
      }
      return
    }

    const index = this._ensureIndex(nodes, zoom)
    if (!index) return

    const bounds = map.getBounds()
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ]
    const clusters = index.getClusters(bbox, zoomKey)

    for (const feat of clusters) {
      const [lng, lat] = feat.geometry.coordinates
      const pt = map.latLngToContainerPoint([lat, lng])
      if (pt.x < -50 || pt.y < -50 || pt.x > size.x + 50 || pt.y > size.y + 50) continue

      if ('cluster' in feat.properties && feat.properties.cluster) {
        const count = feat.properties.point_count ?? 0
        const clusterId = feat.properties.cluster_id
        const expansionZoom = index.getClusterExpansionZoom(clusterId)
        const r = CLUSTER_STYLE.radius
        this._items.push({
          kind: 'cluster',
          clusterId,
          x: pt.x,
          y: pt.y,
          r,
          count,
          lat,
          lng,
          expansionZoom,
        })
        this._drawCluster(ctx, pt.x, pt.y, r, count)
      } else {
        const nodeId = feat.properties.nodeId
        const node = this.opts.getNodeById(nodeId) ?? nodes.find((n) => n.id === nodeId)
        if (!node) continue
        const screen = node.type === 'MUFTA' ? muftaScreen.get(node.id) : undefined
        const drawPt = screen ?? pt
        const style = NODE_STYLE[node.type]
        const hl = highlightId === node.id
        const r = hl ? style.radius + 3 : style.radius
        this._items.push({ kind: 'point', node, x: drawPt.x, y: drawPt.y, r })
        this._drawNode(ctx, drawPt.x, drawPt.y, r, style, hl)
      }
    }

    if (devPerf) {
      const ms = performance.now() - t0
      if (ms > 16) console.debug(`[gis] nodes canvas redraw ${ms.toFixed(1)}ms`)
    }
  }

  private _drawNode(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    style: (typeof NODE_STYLE)[keyof typeof NODE_STYLE],
    highlight = false,
  ): void {
    ctx.beginPath()
    traceNodeMarkerPath(ctx, x, y, r, style.shape)
    ctx.fillStyle = style.fill
    ctx.globalAlpha = highlight ? 0.9 : style.fillOpacity
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = style.stroke
    ctx.lineWidth = highlight ? 4 : style.weight
    ctx.stroke()
  }

  private _drawCluster(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, count: number): void {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = CLUSTER_STYLE.fill
    ctx.globalAlpha = CLUSTER_STYLE.fillOpacity
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = CLUSTER_STYLE.stroke
    ctx.lineWidth = CLUSTER_STYLE.weight
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const label = count > 999 ? `${Math.round(count / 1000)}k` : String(count)
    ctx.fillText(label, x, y)
  }
}

export function createNodesCanvasLayer(opts: NodesCanvasOptions): NodesCanvasLayer {
  return new NodesCanvasLayer(opts)
}
