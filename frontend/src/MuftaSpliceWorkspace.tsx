import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useId } from 'react'
import { traceFiberLogicalRoute } from './fiberRouteTrace'
import {
  type EdgeFiberUsage,
  type SpliceFiberMeta,
  type SpliceFiberRef,
  type SpliceLinkV1,
  type SpliceLinkWaypoint,
  type SpliceV1,
  countBusyInUsage,
  filterSpliceLinksForContext,
  getCrossPortCount,
  getEdgeFiberUsage,
  getOpticalEdgesIncidentToNode,
  getSpliceV1,
  mergeEdgeFiberUsage,
  mergeSpliceV1,
} from './muftaSpliceTypes'
import { downloadSplicePng, downloadSpliceSvg } from './splice/exportDiagram'
import { buildPortLayout } from './splice/layout'
import { snapWaypoint } from './splice/linkGeometry'
import { SpliceDiagram } from './splice/spliceDiagram'
import { SpliceMinimap } from './splice/spliceMinimap'
import { SpliceSidePanel } from './splice/spliceSidePanel'
import { SpliceToolbar } from './splice/spliceToolbar'
import type { SpliceNodeOption, WorkspaceEdge, WorkspaceSpliceNode } from './splice/types'
import { cableDisplayName, clamp, fiberKey, refKey, removeLinksTouchingFiber } from './splice/utils'
import { countFreeFibers, validateSpliceBeforeSave } from './splice/validation'

const AUTH_TOKEN_KEY = 'gis_auth_token'

async function jsonFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null
  const headers = new Headers(options?.headers as HeadersInit | undefined)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options?.body != null && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(url, { ...options, headers })
  if (response.status === 204) return undefined as T
  const data = await response.json()
  if (!response.ok) throw new Error(data?.message || 'API error')
  return data as T
}

type TraceNode = { id: number; type: string; passport_data: Record<string, unknown> }

type Props = {
  apiBase: string
  node: WorkspaceSpliceNode
  /** При viewport-режиме карты подгружает полный граф оптики с сервера. */
  selfLoadGraph?: boolean
  allEdges: WorkspaceEdge[]
  allNodes: TraceNode[]
  allSpliceNodes: SpliceNodeOption[]
  onExit: () => void
  onSelectNode: (id: number) => void
  onSaved: (node: WorkspaceSpliceNode, edges: WorkspaceEdge[]) => void
  onShowOnMap: () => void
  onShowFiberRouteOnMap: (payload: { startNodeId: number; edgeId: number; fiberIndex: number }) => void
  readOnly?: boolean
}

function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const loc = pt.matrixTransform(ctm.inverse())
  return { x: loc.x, y: loc.y }
}

export function MuftaSpliceWorkspace({
  apiBase,
  node,
  selfLoadGraph = false,
  allEdges,
  allNodes,
  allSpliceNodes,
  onExit,
  onSelectNode,
  onSaved,
  onShowOnMap,
  onShowFiberRouteOnMap,
  readOnly = false,
}: Props) {
  const gridPatternId = `spliceGrid-${useId().replace(/:/g, '')}`
  const svgRef = useRef<SVGSVGElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [loadedEdges, setLoadedEdges] = useState<WorkspaceEdge[] | null>(null)
  const [loadedNodes, setLoadedNodes] = useState<TraceNode[] | null>(null)

  useEffect(() => {
    if (!selfLoadGraph) {
      setLoadedEdges(null)
      setLoadedNodes(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [edgeData, nodeData] = await Promise.all([
          jsonFetch<{ items?: WorkspaceEdge[] } | WorkspaceEdge[]>(
            `${apiBase}/edges?type=OPTOVOLOKNO&limit=8000&page=1`,
          ),
          jsonFetch<{ items?: TraceNode[] } | TraceNode[]>(
            `${apiBase}/nodes?types=TK,MUFTA,KROSS&limit=10000&page=1`,
          ),
        ])
        if (cancelled) return
        const edges = normalizeEdges(Array.isArray(edgeData) ? edgeData : (edgeData.items ?? []))
        const nodes = (Array.isArray(nodeData) ? nodeData : (nodeData.items ?? [])).map((n) => ({
          id: n.id,
          type: n.type,
          passport_data: n.passport_data ?? {},
        }))
        setLoadedEdges(edges)
        setLoadedNodes(nodes)
      } catch {
        /* parent edges remain fallback */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiBase, selfLoadGraph])

  function normalizeEdges(list: WorkspaceEdge[]): WorkspaceEdge[] {
    return list.map((e) => ({ ...e, passport_data: e.passport_data ?? {}, geometry: e.geometry ?? [] }))
  }

  const graphEdges = loadedEdges ?? allEdges
  const graphNodes = loadedNodes ?? allNodes

  const internalPorts = useMemo(
    () => (node.type === 'KROSS' ? getCrossPortCount(node.passport_data) : 0),
    [node.type, node.passport_data],
  )

  const incident = useMemo((): WorkspaceEdge[] => {
    const list = getOpticalEdgesIncidentToNode(node.id, graphEdges).slice() as WorkspaceEdge[]
    list.sort((a, b) => a.id - b.id)
    return list
  }, [graphEdges, node.id])

  const edgeIdSet = useMemo(() => new Set(incident.map((e) => e.id)), [incident])

  const initialSplice = useMemo(() => {
    const raw = getSpliceV1(node.passport_data)
    const links = filterSpliceLinksForContext(raw.links, edgeIdSet, internalPorts)
    return { links, fibers: { ...raw.fibers } }
  }, [node.passport_data, edgeIdSet, internalPorts])

  const [splice, setSplice] = useState<SpliceV1>(() => initialSplice)
  const [linkPick, setLinkPick] = useState<SpliceFiberRef | null>(null)
  const [linkDraftWaypoints, setLinkDraftWaypoints] = useState<SpliceLinkWaypoint[]>([])
  const [connectMode, setConnectMode] = useState(false)
  const editConnect = connectMode && !readOnly
  const [panelFiberFocus, setPanelFiberFocus] = useState<SpliceFiberRef | null>(null)
  const [hoverFiberRef, setHoverFiberRef] = useState<SpliceFiberRef | null>(null)
  const [selectedLinkIndex, setSelectedLinkIndex] = useState<number | null>(null)
  const [traceHighlightKeys, setTraceHighlightKeys] = useState<Set<string>>(new Set())
  const [snapGrid, setSnapGrid] = useState(true)
  const [showItuColors, setShowItuColors] = useState(false)
  const [fiberFilter, setFiberFilter] = useState<'all' | 'busy' | 'free' | 'linked'>('all')
  const [fiberJumpQuery, setFiberJumpQuery] = useState('')
  const [cursorSvg, setCursorSvg] = useState<{ x: number; y: number } | null>(null)
  const [dragFiber, setDragFiber] = useState<SpliceFiberRef | null>(null)
  const [waypointDrag, setWaypointDrag] = useState<{ linkIndex: number; wpIndex: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [panning, setPanning] = useState(false)
  const [viewportSize, setViewportSize] = useState({ w: 800, h: 600 })
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const panZoomRef = useRef({ pan: { x: 0, y: 0 }, zoom: 1 })
  panZoomRef.current = { pan, zoom }

  useEffect(() => {
    setSplice(initialSplice)
    setLinkPick(null)
    setSelectedLinkIndex(null)
    setTraceHighlightKeys(new Set())
  }, [initialSplice, node.id])

  const layout = useMemo(() => buildPortLayout(incident, internalPorts), [incident, internalPorts])
  const layoutKey = useMemo(
    () => `${node.id}:${internalPorts}:${incident.map((e) => e.id).join(',')}`,
    [node.id, internalPorts, incident],
  )

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el || (incident.length === 0 && internalPorts === 0)) return
    const ro = new ResizeObserver(() => {
      setViewportSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setViewportSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [incident.length, internalPorts])

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el || (incident.length === 0 && internalPorts === 0)) return
    const { w: vw, h: vh } = viewportSize
    if (vw < 8 || vh < 8) return
    const fit = Math.min(vw / layout.worldW, vh / layout.worldH, 1) * 0.9
    setZoom(fit)
    setPan({ x: (vw - layout.worldW * fit) / 2, y: (vh - layout.worldH * fit) / 2 })
  }, [layoutKey, layout.worldW, layout.worldH, incident.length, internalPorts, viewportSize.w, viewportSize.h])

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const { pan: p, zoom: z } = panZoomRef.current
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY > 0 ? 0.92 : 1.08
      const newZoom = clamp(z * factor, 0.12, 6)
      const wx = (mx - p.x) / z
      const wy = (my - p.y) / z
      setPan({ x: mx - wx * newZoom, y: my - wy * newZoom })
      setZoom(newZoom)
    }
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [incident.length, internalPorts])

  useEffect(() => {
    if (connectMode) setPanelFiberFocus(null)
  }, [connectMode])

  useEffect(() => {
    if (!linkPick) setLinkDraftWaypoints([])
  }, [linkPick])

  useEffect(() => {
    setPanelFiberFocus(null)
    setSelectedLinkIndex(null)
    setTraceHighlightKeys(new Set())
  }, [node.id])

  useEffect(() => {
    if (!panelFiberFocus) return
    const id = refKey(panelFiberFocus)
    const el = document.querySelector(`[data-splice-fiber="${id}"]`)
    if (!(el instanceof HTMLElement)) return
    const det = el.closest('details')
    if (det) (det as HTMLDetailsElement).open = true
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }, [panelFiberFocus])

  const edgeById = useMemo((): Map<number, WorkspaceEdge> => {
    const m = new Map<number, WorkspaceEdge>()
    for (const e of incident) m.set(e.id, e)
    if (internalPorts > 0) {
      m.set(0, {
        id: 0,
        type: 'OPTOVOLOKNO',
        start_node_id: 0,
        end_node_id: 0,
        total_fibers: internalPorts,
        cable_name: 'Порты кросса',
        used_fibers: null,
        project_id: null,
        project_name: null,
        cable_status: null,
        passport_data: {},
      })
    }
    return m
  }, [incident, internalPorts])

  const getFiberDisplay = useCallback(
    (edgeId: number, fiberIndex: number): SpliceFiberMeta => {
      const edge = edgeById.get(edgeId)
      const usage = edge ? getEdgeFiberUsage(edge.passport_data) : {}
      const sk = fiberKey(fiberIndex)
      const fromSplice = splice.fibers?.[String(edgeId)]?.[sk] ?? {}
      const slot = usage[sk] ?? {}
      const spliceLabel = String(fromSplice.ownerLabel ?? '').trim()
      const cableLabel = String(slot.label ?? '').trim()
      return {
        busy: fromSplice.busy ?? slot.busy,
        ownerLabel: spliceLabel || cableLabel || undefined,
        busyLineColor: fromSplice.busyLineColor,
        busyLineStyle: fromSplice.busyLineStyle,
      }
    },
    [edgeById, splice.fibers],
  )

  const getFiberBusy = useCallback(
    (edgeId: number, fiberIndex: number) => !!getFiberDisplay(edgeId, fiberIndex).busy,
    [getFiberDisplay],
  )

  const validationIssues = useMemo(
    () => validateSpliceBeforeSave(splice, incident, internalPorts, getFiberBusy),
    [splice, incident, internalPorts, getFiberBusy],
  )

  const stats = useMemo(() => countFreeFibers(incident, internalPorts, splice, getFiberBusy), [incident, internalPorts, splice, getFiberBusy])

  const cableSections = useMemo(() => {
    const rows: { key: string; ordinal: number; title: string; meta: string; edgeId: number; totalFibers: number }[] = []
    let n = 0
    if (internalPorts > 0) {
      n += 1
      rows.push({ key: 'cross', ordinal: n, title: 'Порты кросса', meta: `${internalPorts} портов`, edgeId: 0, totalFibers: internalPorts })
    }
    for (const e of incident) {
      n += 1
      rows.push({
        key: `e${e.id}`,
        ordinal: n,
        title: cableDisplayName(e),
        meta: `${e.used_fibers ?? 0}/${e.total_fibers ?? '—'} · id ${e.id}`,
        edgeId: e.id,
        totalFibers: Math.max(1, e.total_fibers ?? 1),
      })
    }
    return rows
  }, [internalPorts, incident])

  const linkLabel = useCallback(
    (ref: SpliceFiberRef) => {
      if (ref.edgeId === 0) return `Кросс · #${ref.fiberIndex}`
      const e = edgeById.get(ref.edgeId)
      return `${e ? cableDisplayName(e) : ref.edgeId} · #${ref.fiberIndex}`
    },
    [edgeById],
  )

  const connectPair = useCallback(
    (from: SpliceFiberRef, to: SpliceFiberRef, waypoints: SpliceLinkWaypoint[]) => {
      if (from.edgeId !== 0 && to.edgeId !== 0 && from.edgeId === to.edgeId) {
        setSaveError('Связь только между разными кабелями.')
        return
      }
      const edgeA = edgeById.get(from.edgeId)
      const edgeB = edgeById.get(to.edgeId)
      const ta = from.edgeId === 0 ? internalPorts : edgeA?.total_fibers ?? 0
      const tb = to.edgeId === 0 ? internalPorts : edgeB?.total_fibers ?? 0
      if (from.fiberIndex < 1 || from.fiberIndex > ta || to.fiberIndex < 1 || to.fiberIndex > tb) {
        setSaveError('Номер волокна вне диапазона.')
        return
      }
      setSplice((prev) => {
        let links = removeLinksTouchingFiber(prev.links, from)
        links = removeLinksTouchingFiber(links, to)
        const next: SpliceLinkV1 = { from, to, ...(waypoints.length > 0 ? { waypoints: [...waypoints] } : {}) }
        links = [...links, next]
        const skPick = fiberKey(from.fiberIndex)
        const metaPick = prev.fibers?.[String(from.edgeId)]?.[skPick] ?? {}
        const edgePick = from.edgeId !== 0 ? edgeById.get(from.edgeId) : undefined
        const usagePick = edgePick ? getEdgeFiberUsage(edgePick.passport_data) : {}
        const pickLabel = String(metaPick.ownerLabel ?? usagePick[skPick]?.label ?? '').trim()
        const baseFibers = { ...(prev.fibers ?? {}) }
        if (pickLabel) {
          const skRef = fiberKey(to.fiberIndex)
          const rowRef = { ...(baseFibers[String(to.edgeId)] ?? {}) }
          const curRefMeta = rowRef[skRef] ?? {}
          if (!String(curRefMeta.ownerLabel ?? '').trim()) {
            rowRef[skRef] = { ...curRefMeta, ownerLabel: pickLabel }
            baseFibers[String(to.edgeId)] = rowRef
          }
        }
        return { ...prev, links, fibers: baseFibers }
      })
      setSaveError(null)
    },
    [edgeById, internalPorts],
  )

  const onFiberClick = (ref: SpliceFiberRef) => {
    if (!editConnect) return
    if (linkPick && refKey(linkPick) === refKey(ref)) {
      setLinkPick(null)
      return
    }
    if (!linkPick) {
      setLinkDraftWaypoints([])
      setLinkPick(ref)
      return
    }
    connectPair(linkPick, ref, linkDraftWaypoints)
    setLinkPick(null)
    setLinkDraftWaypoints([])
  }

  const onDiagramFiberActivate = (ref: SpliceFiberRef) => {
    if (editConnect) {
      onFiberClick(ref)
      return
    }
    setPanelFiberFocus((prev) => (prev && refKey(prev) === refKey(ref) ? null : ref))
    setSelectedLinkIndex(null)
  }

  const resetView = () => {
    const el = viewportRef.current
    if (!el) return
    const vw = el.clientWidth
    const vh = el.clientHeight
    const fit = Math.min(vw / layout.worldW, vh / layout.worldH, 1) * 0.9
    setZoom(fit)
    setPan({ x: (vw - layout.worldW * fit) / 2, y: (vh - layout.worldH * fit) / 2 })
  }

  const buildEdgePatches = (): WorkspaceEdge[] => {
    const out: WorkspaceEdge[] = []
    for (const e of incident) {
      const total = Math.max(0, e.total_fibers ?? 0)
      const usage: EdgeFiberUsage = { ...getEdgeFiberUsage(e.passport_data) }
      for (let i = 1; i <= total; i += 1) {
        const sk = fiberKey(i)
        const meta = splice.fibers?.[String(e.id)]?.[sk]
        const prevSlot = usage[sk] ?? {}
        const metaOwner = String(meta?.ownerLabel ?? '').trim()
        const prevLabel = String(prevSlot.label ?? '').trim()
        usage[sk] = { ...prevSlot, busy: meta?.busy ?? prevSlot.busy, label: metaOwner || prevLabel || undefined }
      }
      out.push({ ...e, used_fibers: countBusyInUsage(total, usage), passport_data: mergeEdgeFiberUsage(e.passport_data, usage) })
    }
    return out
  }

  const handleSave = async () => {
    if (readOnly) return
    setSaving(true)
    setSaveError(null)
    try {
      const passport = mergeSpliceV1(node.passport_data, splice)
      const savedNode = await jsonFetch<WorkspaceSpliceNode>(`${apiBase}/nodes/${node.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...node, passport_data: passport }),
      })
      const patchedEdges = buildEdgePatches()
      const savedEdges: WorkspaceEdge[] = []
      for (const pe of patchedEdges) {
        savedEdges.push(await jsonFetch<WorkspaceEdge>(`${apiBase}/edges/${pe.id}`, { method: 'PUT', body: JSON.stringify(pe) }))
      }
      const nextSplice = getSpliceV1(savedNode.passport_data)
      const nextInternal = savedNode.type === 'KROSS' ? getCrossPortCount(savedNode.passport_data) : 0
      setSplice({ links: filterSpliceLinksForContext(nextSplice.links, edgeIdSet, nextInternal), fibers: { ...nextSplice.fibers } })
      onSaved(savedNode, savedEdges)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const passportPreview = useMemo(() => {
    try {
      return JSON.stringify(node.passport_data, null, 2)
    } catch {
      return '{}'
    }
  }, [node.passport_data])

  const setFiberMeta = (edgeId: number, fiberIndex: number, patch: Partial<SpliceFiberMeta>) => {
    const sk = fiberKey(fiberIndex)
    setSplice((prev) => {
      const fibers = { ...(prev.fibers ?? {}) }
      const row = { ...(fibers[String(edgeId)] ?? {}) }
      row[sk] = { ...(row[sk] ?? {}), ...patch }
      fibers[String(edgeId)] = row
      return { ...prev, fibers }
    })
  }

  const onTraceOnDiagram = (ref: SpliceFiberRef) => {
    const res = traceFiberLogicalRoute(node.id, ref, graphNodes, graphEdges)
    if (!res.ok) {
      setSaveError(res.message)
      return
    }
    const keys = new Set<string>()
    keys.add(refKey(ref))
    for (const l of splice.links) {
      if (keys.has(refKey(l.from)) || keys.has(refKey(l.to))) {
        keys.add(refKey(l.from))
        keys.add(refKey(l.to))
      }
    }
    setTraceHighlightKeys(keys)
  }

  const onBatchSplice = (edgeA: number, edgeB: number, from: number, to: number) => {
    if (edgeA === edgeB) return
    const a = edgeById.get(edgeA)
    const b = edgeById.get(edgeB)
    const maxA = edgeA === 0 ? internalPorts : a?.total_fibers ?? 0
    const maxB = edgeB === 0 ? internalPorts : b?.total_fibers ?? 0
    const lo = Math.max(1, from)
    const hi = Math.min(to, maxA, maxB)
    setSplice((prev) => {
      let links = [...prev.links]
      for (let i = lo; i <= hi; i += 1) {
        links = removeLinksTouchingFiber(links, { edgeId: edgeA, fiberIndex: i })
        links = removeLinksTouchingFiber(links, { edgeId: edgeB, fiberIndex: i })
        links.push({ from: { edgeId: edgeA, fiberIndex: i }, to: { edgeId: edgeB, fiberIndex: i } })
      }
      return { ...prev, links }
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'c' || e.key === 'C') setConnectMode((v) => !v)
      if (e.key === 'Escape') {
        setLinkPick(null)
        setSelectedLinkIndex(null)
        setDragFiber(null)
        setWaypointDrag(null)
      }
      if (e.key === 'Delete' && selectedLinkIndex != null) {
        setSplice((prev) => ({ ...prev, links: prev.links.filter((_, i) => i !== selectedLinkIndex) }))
        setSelectedLinkIndex(null)
      }
      if (e.key === 'f' || e.key === 'F') resetView()
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onPointerDownViewport = (e: React.PointerEvent) => {
    if (e.button !== 0 || dragFiber || waypointDrag) return
    const t = e.target as HTMLElement
    if (t.closest('.splice-fiber-hit-area, .splice-pan-toolbar, .splice-minimap, button, a, input, select, label')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
    setPanning(true)
  }

  const onPointerMoveViewport = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (d) {
      setPan({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) })
      return
    }
    if (waypointDrag && svgRef.current) {
      const pt = svgPoint(svgRef.current, e.clientX, e.clientY)
      if (!pt) return
      const snapped = snapWaypoint(pt, snapGrid)
      setSplice((prev) => {
        const links = prev.links.map((l, i) => {
          if (i !== waypointDrag.linkIndex || !l.waypoints) return l
          const wps = l.waypoints.map((w, wi) => (wi === waypointDrag.wpIndex ? snapped : w))
          return { ...l, waypoints: wps }
        })
        return { ...prev, links }
      })
    }
  }

  const endDrag = (e: React.PointerEvent) => {
    if (dragFiber && editConnect) {
      const target = document.elementFromPoint(e.clientX, e.clientY)
      const hit = target?.closest('[data-fiber-ref]')
      if (hit) {
        try {
          const ref = JSON.parse(hit.getAttribute('data-fiber-ref') || '') as SpliceFiberRef
          if (refKey(ref) !== refKey(dragFiber)) connectPair(dragFiber, ref, linkDraftWaypoints)
        } catch {
          /* noop */
        }
      }
    }
    setDragFiber(null)
    if (dragRef.current) {
      dragRef.current = null
      setPanning(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
    }
    setWaypointDrag(null)
  }

  const linkPickLabel = linkPick
    ? `${linkLabel(linkPick)} — второй волокон; ПКМ — изгиб`
    : editConnect
      ? 'Первый клик по волокну…'
      : null

  return (
    <div className="splice-workspace">
      {saveError && <p className="splice-workspace__error">{saveError}</p>}
      <div className="splice-workspace__body">
        <div className="splice-workspace__diagram">
          <div className="splice-workspace__canvas-wrap">
            <SpliceToolbar
              connectMode={connectMode}
              connectModeDisabled={readOnly}
              snapGrid={snapGrid}
              showItuColors={showItuColors}
              linkPickLabel={linkPickLabel}
              statsLine={`Связей: ${stats.linked} · свободно волокон: ${stats.free} / ${stats.total}`}
              onConnectModeChange={setConnectMode}
              onSnapGridChange={setSnapGrid}
              onShowItuChange={setShowItuColors}
              onResetView={resetView}
              onExportSvg={() => svgRef.current && downloadSpliceSvg(svgRef.current, `splice-${node.id}.svg`)}
              onExportPng={() => svgRef.current && void downloadSplicePng(svgRef.current, `splice-${node.id}.png`)}
            />
            {incident.length === 0 && internalPorts === 0 ? (
              <p className="hint splice-workspace__empty">Нет ВОЛС и портов кросса.</p>
            ) : (
              <div
                ref={viewportRef}
                className={`splice-panorama ${panning ? 'splice-panorama--drag' : ''}`}
                onPointerDown={onPointerDownViewport}
                onPointerMove={onPointerMoveViewport}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <div
                  className="splice-panorama__sheet"
                  style={{
                    width: layout.worldW,
                    height: layout.worldH,
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: '0 0',
                  }}
                >
                  <SpliceDiagram
                      ref={svgRef}
                      gridPatternId={gridPatternId}
                      layout={layout}
                      node={node}
                      incident={incident}
                      internalPorts={internalPorts}
                      links={splice.links}
                      connectMode={editConnect}
                      linkPick={linkPick}
                      linkDraftWaypoints={linkDraftWaypoints}
                      cursorSvg={cursorSvg}
                      selectedLinkIndex={selectedLinkIndex}
                      panelFiberFocus={panelFiberFocus}
                      hoverFiberRef={hoverFiberRef}
                      traceHighlightKeys={traceHighlightKeys}
                      showItuColors={showItuColors}
                      edgeById={edgeById}
                      getFiberDisplay={getFiberDisplay}
                      onSvgContextMenu={(e) => {
                        if (!editConnect || !linkPick || !svgRef.current) return
                        if ((e.target as Element).closest('.splice-fiber-hit-area')) return
                        e.preventDefault()
                        const pt = svgPoint(svgRef.current, e.clientX, e.clientY)
                        if (!pt) return
                        setLinkDraftWaypoints((wp) => [...wp, snapWaypoint(pt, snapGrid)])
                      }}
                      onSvgPointerMove={(e) => {
                        if (!svgRef.current) return
                        const pt = svgPoint(svgRef.current, e.clientX, e.clientY)
                        setCursorSvg(pt)
                      }}
                      onFiberPointerDown={(ref, ev) => {
                        ev.stopPropagation()
                        if (editConnect) setDragFiber(ref)
                      }}
                      onFiberClick={onDiagramFiberActivate}
                      onFiberHover={setHoverFiberRef}
                      onLinkClick={setSelectedLinkIndex}
                      onWaypointPointerDown={(linkIndex, wpIndex, ev) => {
                        ev.stopPropagation()
                        setWaypointDrag({ linkIndex, wpIndex })
                      }}
                      onWaypointContextMenu={(linkIndex, wpIndex, e) => {
                        e.preventDefault()
                        setSplice((prev) => ({
                          ...prev,
                          links: prev.links.map((l, i) =>
                            i === linkIndex ? { ...l, waypoints: l.waypoints?.filter((_, wi) => wi !== wpIndex) } : l,
                          ),
                        }))
                      }}
                    />
                </div>
                <SpliceMinimap
                  layout={layout}
                  pan={pan}
                  zoom={zoom}
                  viewportW={viewportSize.w}
                  viewportH={viewportSize.h}
                  onPanTo={(wx, wy) => {
                    setPan({ x: viewportSize.w / 2 - wx * zoom, y: viewportSize.h / 2 - wy * zoom })
                  }}
                />
              </div>
            )}
          </div>
        </div>
        <div className="splice-workspace__side-rail">
          <SpliceSidePanel
            node={node}
            internalPorts={internalPorts}
            splice={splice}
            validationIssues={validationIssues}
            allSpliceNodes={allSpliceNodes}
            saving={saving}
            panelFiberFocus={panelFiberFocus}
            selectedLinkIndex={selectedLinkIndex}
            incident={incident}
            cableSections={cableSections}
            getFiberDisplay={getFiberDisplay}
            linkLabel={linkLabel}
            passportPreview={passportPreview}
            fiberFilter={fiberFilter}
            fiberJumpQuery={fiberJumpQuery}
            onFiberFilterChange={setFiberFilter}
            onFiberJumpQueryChange={setFiberJumpQuery}
            onSelectNode={onSelectNode}
            onExit={onExit}
            onShowOnMap={onShowOnMap}
            onClearAllLinks={() => {
              if (splice.links.length === 0) return
              if (!window.confirm('Удалить все связи?')) return
              setSplice((prev) => ({ ...prev, links: [] }))
              setLinkPick(null)
            }}
            onSave={() => void handleSave()}
            onPanelFiberFocus={setPanelFiberFocus}
            onShowFiberRouteOnMap={(ref) => onShowFiberRouteOnMap({ startNodeId: node.id, edgeId: ref.edgeId, fiberIndex: ref.fiberIndex })}
            onTraceOnDiagram={onTraceOnDiagram}
            onRemoveLink={(idx) => {
              setSplice((prev) => ({ ...prev, links: prev.links.filter((_, i) => i !== idx) }))
              if (selectedLinkIndex === idx) setSelectedLinkIndex(null)
            }}
            onClearLinkWaypoints={(idx) => {
              setSplice((prev) => ({
                ...prev,
                links: prev.links.map((l, i) => (i === idx ? { from: l.from, to: l.to } : l)),
              }))
            }}
            onSetLabel={(edgeId, fi, label) => setFiberMeta(edgeId, fi, { ownerLabel: label })}
            onToggleBusy={(edgeId, fi) => setFiberMeta(edgeId, fi, { busy: !getFiberDisplay(edgeId, fi).busy })}
            onSetFiberMeta={setFiberMeta}
            onBatchSplice={onBatchSplice}
            readOnly={readOnly}
          />
        </div>
      </div>
    </div>
  )
}
