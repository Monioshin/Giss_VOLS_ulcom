import { useCallback, useEffect, useRef, useState } from 'react'
import type { LatLngBounds } from 'leaflet'
import type { EdgeEntity, NodeEntity } from '../gisTypes'
import { getMapNetworkTiming } from '../apiBase'
import type { LatLngBoundsBox } from './boundsUtils'
import {
  boundsChangedSignificantly,
  boundsOverlap,
  boundsToQuery,
  parseBoundsKey,
  viewportCacheKey,
} from './boundsUtils'
import { edgeLodTier } from './mapZoomConstants'
import {
  TK_DETAIL_ZOOM,
  VIEWPORT_MAX_EDGE_PAGES_PER_TYPE,
  VIEWPORT_MAX_EDGES_IN_MEMORY,
  VIEWPORT_MAX_NODE_PAGES,
  VIEWPORT_MAX_NODES_IN_MEMORY,
  VIEWPORT_NODE_THRESHOLD,
  VIEWPORT_CACHE_MAX,
  VIEWPORT_TYPES_DETAIL,
  viewportEdgePageLimitForZoom,
  viewportPageLimitForZoom,
  viewportTypesForZoom,
} from './mapZoomConstants'

const NODE_FETCH_LIMIT = 10000
const EDGE_FETCH_LIMIT = 10000

export type MapViewportSummary = {
  totalNodes: number
  totalEdges: number
  bounds?: LatLngBoundsBox | null
}

type NodesPaged = { items: NodeEntity[]; total: number; hasMore?: boolean }
type EdgesPaged = { items: EdgeEntity[]; total: number }
type ViewportResponse = {
  nodes: NodeEntity[]
  edges?: EdgeEntity[]
  kanalEdges?: EdgeEntity[]
  volsEdges?: EdgeEntity[]
  kanalTotal?: number
  volsTotal?: number
  kanalHasMore?: boolean
  volsHasMore?: boolean
  totalNodes: number
  totalEdges: number
  page: number
  limit: number
  hasMore: boolean
  truncated?: boolean
}

type JsonFetch = <T>(url: string, options?: RequestInit) => Promise<T>

type CacheEntry = {
  nodes: NodeEntity[]
  edges: EdgeEntity[]
  totalNodes: number
  totalEdges: number
}

function normalizeNodes(nd: NodeEntity[]): NodeEntity[] {
  return nd.map((n) => {
    const t = String(n.type).toUpperCase()
    const type =
      t === 'TK' || t === 'MUFTA' || t === 'PIKET' || t === 'KROSS' ? (t as NodeEntity['type']) : n.type
    return { ...n, type, passport_data: n.passport_data ?? {} }
  })
}

function normalizeEdges(list: EdgeEntity[]): EdgeEntity[] {
  return list.map((e) => ({
    ...e,
    passport_data: e.passport_data ?? {},
    geometry: Array.isArray(e.geometry) ? e.geometry : [],
  }))
}

function mergeById<T extends { id: number }>(existing: T[], incoming: T[]): T[] {
  const map = new Map<number, T>()
  for (const x of existing) map.set(x.id, x)
  for (const x of incoming) map.set(x.id, x)
  return [...map.values()]
}

function mergeEdgesPreferDetail(existing: EdgeEntity[], incoming: EdgeEntity[]): EdgeEntity[] {
  const map = new Map<number, EdgeEntity>()
  for (const x of existing) map.set(x.id, x)
  for (const x of incoming) {
    const prev = map.get(x.id)
    if (!prev || (x.geometry?.length ?? 0) >= (prev.geometry?.length ?? 0)) map.set(x.id, x)
  }
  return [...map.values()]
}

function idsSignature(list: { id: number }[]): string {
  if (list.length === 0) return '0'
  const sample = list.length <= 32 ? list : [...list.slice(0, 16), ...list.slice(-16)]
  return `${list.length}:${sample.map((x) => x.id).join(',')}`
}

function capMergedLists(
  nodes: NodeEntity[],
  edges: EdgeEntity[],
): { nodes: NodeEntity[]; edges: EdgeEntity[]; memoryCapped: boolean } {
  let memoryCapped = false
  let n = nodes
  let e = edges
  if (n.length > VIEWPORT_MAX_NODES_IN_MEMORY) {
    n = n.slice(0, VIEWPORT_MAX_NODES_IN_MEMORY)
    memoryCapped = true
  }
  if (e.length > VIEWPORT_MAX_EDGES_IN_MEMORY) {
    e = e.slice(0, VIEWPORT_MAX_EDGES_IN_MEMORY)
    memoryCapped = true
  }
  return { nodes: n, edges: e, memoryCapped }
}

function maxNodePagesForZoom(zoom: number): number {
  const timing = getMapNetworkTiming()
  if (zoom < 14) return Math.min(VIEWPORT_MAX_NODE_PAGES, timing.maxNodePagesOverview)
  return VIEWPORT_MAX_NODE_PAGES
}

export { TK_DETAIL_ZOOM, shouldShowDetailNodes } from './mapZoomConstants'

export function useMapViewport(
  apiBase: string,
  jsonFetch: JsonFetch,
  bboxLoadWhenLarge: boolean,
  _detailZoom = TK_DETAIL_ZOOM,
) {
  const [nodes, setNodes] = useState<NodeEntity[]>([])
  const [edges, setEdges] = useState<EdgeEntity[]>([])
  const [mapTruncated, setMapTruncated] = useState(false)
  const [summary, setSummary] = useState<MapViewportSummary>({ totalNodes: 0, totalEdges: 0 })
  const [useBboxLoad, setUseBboxLoad] = useState(false)
  const [viewportLoading, setViewportLoading] = useState(false)
  const [remoteApi, setRemoteApi] = useState(() => getMapNetworkTiming().useBundledViewportPhase1)

  const mapBoundsRef = useRef<LatLngBounds | null>(null)
  const mapZoomRef = useRef(13)
  const nodesLoadedRef = useRef(false)
  const viewportModeRef = useRef(false)
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const cacheOrderRef = useRef<string[]>([])
  const pinnedNodesRef = useRef<Map<number, NodeEntity>>(new Map())
  const pinnedEdgesRef = useRef<Map<number, EdgeEntity>>(new Map())
  const lastBboxKeyRef = useRef<string | null>(null)
  const lastSettledKeyRef = useRef<string | null>(null)
  const inFlightKeyRef = useRef<string | null>(null)
  const lastLodTierRef = useRef<number | null>(null)
  const fetchGenRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const settleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nodesSigRef = useRef('')
  const edgesSigRef = useRef('')

  useEffect(() => {
    setRemoteApi(getMapNetworkTiming().useBundledViewportPhase1)
  }, [apiBase])

  useEffect(
    () => () => {
      if (settleDebounceRef.current) clearTimeout(settleDebounceRef.current)
      abortRef.current?.abort()
    },
    [],
  )

  const touchCache = useCallback((key: string, entry: CacheEntry) => {
    const cache = cacheRef.current
    cache.set(key, entry)
    const order = cacheOrderRef.current.filter((k) => k !== key)
    order.unshift(key)
    while (order.length > VIEWPORT_CACHE_MAX) {
      const drop = order.pop()
      if (drop) cache.delete(drop)
    }
    cacheOrderRef.current = order
  }, [])

  const commitNodesEdges = useCallback((nextNodes: NodeEntity[], nextEdges: EdgeEntity[], truncated: boolean) => {
    const ns = idsSignature(nextNodes)
    const es = idsSignature(nextEdges)
    if (ns !== nodesSigRef.current) {
      nodesSigRef.current = ns
      setNodes(nextNodes)
    }
    if (es !== edgesSigRef.current) {
      edgesSigRef.current = es
      setEdges(nextEdges)
    }
    setMapTruncated(truncated)
    nodesLoadedRef.current = nextNodes.length > 0 || nextEdges.length > 0
  }, [])

  const applyMergedViewport = useCallback(
    (bounds: LatLngBounds) => {
      let accNodes: NodeEntity[] = [...pinnedNodesRef.current.values()]
      let accEdges: EdgeEntity[] = [...pinnedEdgesRef.current.values()]
      let totalNodes = summary.totalNodes
      let totalEdges = summary.totalEdges

      for (const [key, entry] of cacheRef.current) {
        const tile = parseBoundsKey(key)
        if (!tile || !boundsOverlap(bounds, tile)) continue
        accNodes = mergeById(accNodes, entry.nodes)
        accEdges = mergeEdgesPreferDetail(accEdges, entry.edges)
        totalNodes = Math.max(totalNodes, entry.totalNodes)
        totalEdges = Math.max(totalEdges, entry.totalEdges)
      }

      const capped = capMergedLists(accNodes, accEdges)
      const truncated =
        totalNodes > capped.nodes.length ||
        totalEdges > capped.edges.length ||
        capped.memoryCapped

      commitNodesEdges(capped.nodes, capped.edges, truncated)
    },
    [summary.totalNodes, summary.totalEdges, commitNodesEdges],
  )

  const markSettled = useCallback((key: string) => {
    lastSettledKeyRef.current = key
    lastBboxKeyRef.current = key
    inFlightKeyRef.current = null
  }, [])

  const commitPartialTile = useCallback(
    (
      key: string,
      bounds: LatLngBounds,
      accNodes: NodeEntity[],
      accEdges: EdgeEntity[],
      totalNodes: number,
      totalEdges: number,
    ) => {
      touchCache(key, { nodes: accNodes, edges: accEdges, totalNodes, totalEdges })
      applyMergedViewport(bounds)
    },
    [touchCache, applyMergedViewport],
  )

  const loadAllDetailNodes = useCallback(async () => {
    const acc: NodeEntity[] = []
    let truncated = false
    for (let page = 1; page <= 3; page++) {
      const data = await jsonFetch<NodesPaged>(
        `${apiBase}/nodes?types=${VIEWPORT_TYPES_DETAIL}&limit=${NODE_FETCH_LIMIT}&page=${page}`,
      )
      const chunk = normalizeNodes(data.items ?? [])
      acc.push(...chunk)
      const total = data.total ?? acc.length
      if (chunk.length < NODE_FETCH_LIMIT || acc.length >= total) break
      if (page === 3 && acc.length < total) truncated = true
    }
    nodesSigRef.current = idsSignature(acc)
    setNodes(acc)
    setMapTruncated(truncated)
    nodesLoadedRef.current = true
  }, [apiBase, jsonFetch])

  const loadAllEdges = useCallback(async () => {
    const data = await jsonFetch<EdgeEntity[] | EdgesPaged>(`${apiBase}/edges?limit=${EDGE_FETCH_LIMIT}&page=1`)
    const list = normalizeEdges(Array.isArray(data) ? data : (data.items ?? []))
    edgesSigRef.current = idsSignature(list)
    setEdges(list)
  }, [apiBase, jsonFetch])

  const fetchViewport = useCallback(
    async (bounds: LatLngBounds, zoom: number, force = false) => {
      const timing = getMapNetworkTiming()
      const key = viewportCacheKey(bounds, zoom)
      if (!force && lastSettledKeyRef.current === key && inFlightKeyRef.current !== key) {
        applyMergedViewport(bounds)
        return
      }
      if (!force && !boundsChangedSignificantly(lastSettledKeyRef.current, key)) {
        applyMergedViewport(bounds)
        return
      }

      const cached = cacheRef.current.get(key)
      if (cached && !force) {
        markSettled(key)
        applyMergedViewport(bounds)
        return
      }

      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      const gen = ++fetchGenRef.current
      inFlightKeyRef.current = key
      setViewportLoading(true)
      applyMergedViewport(bounds)

      const types = viewportTypesForZoom(zoom)
      const pageLimit = viewportPageLimitForZoom(zoom)
      const edgePageLimit = viewportEdgePageLimitForZoom(zoom)
      const maxNodePages = maxNodePagesForZoom(zoom)
      const bboxPadRatio = zoom < 14 ? 0.22 : 0.15
      const useBundled = timing.useBundledViewportPhase1
      let aborted = false

      const pushPartial = (
        accNodes: NodeEntity[],
        accEdges: EdgeEntity[],
        totalNodes: number,
        totalEdges: number,
      ) => {
        if (ac.signal.aborted || gen !== fetchGenRef.current) return false
        commitPartialTile(key, bounds, accNodes, accEdges, totalNodes, totalEdges)
        return true
      }

      try {
        const bbox = boundsToQuery(bounds, bboxPadRatio)
        let accNodes: NodeEntity[] = []
        let accEdges: EdgeEntity[] = []
        let totalNodes = 0
        let totalEdges = 0
        let hitNodePageCap = false
        let hitEdgePageCap = false

        const fetchEdgesOfType = async (
          edgeType: 'KANALIZACIYA' | 'OPTOVOLOKNO',
          startPage = 1,
        ): Promise<{ edges: EdgeEntity[]; total: number; hitCap: boolean }> => {
          let localEdges: EdgeEntity[] = []
          let localTotal = 0
          let hitCap = false
          let edgePage = startPage
          let edgeHasMore = true
          while (edgeHasMore && edgePage <= VIEWPORT_MAX_EDGE_PAGES_PER_TYPE) {
            if (ac.signal.aborted || gen !== fetchGenRef.current) {
              aborted = true
              return { edges: [], total: 0, hitCap: false }
            }
            const eq = `${apiBase}/edges?bbox=${bbox}&limit=${edgePageLimit}&page=${edgePage}&zoom=${Math.floor(zoom)}&type=${edgeType}`
            const edgeData = await jsonFetch<EdgesPaged | EdgeEntity[]>(eq, { signal: ac.signal })
            const chunk = normalizeEdges(Array.isArray(edgeData) ? edgeData : (edgeData.items ?? []))
            localEdges = mergeEdgesPreferDetail(localEdges, chunk)
            const et = Array.isArray(edgeData) ? chunk.length : (edgeData.total ?? chunk.length)
            localTotal = Math.max(localTotal, et)
            edgeHasMore =
              !Array.isArray(edgeData) &&
              chunk.length >= edgePageLimit &&
              edgePage * edgePageLimit < (edgeData.total ?? et)
            if (edgeHasMore && edgePage >= VIEWPORT_MAX_EDGE_PAGES_PER_TYPE) hitCap = true
            edgePage += 1
          }
          return { edges: localEdges, total: localTotal, hitCap }
        }

        if (useBundled) {
          const q = `${apiBase}/map/viewport?bbox=${bbox}&zoom=${Math.floor(zoom)}&page=1&limit=${pageLimit}&types=${types}&includeEdges=split&edgePage=1&edgeLimit=${edgePageLimit}`
          const data = await jsonFetch<ViewportResponse>(q, { signal: ac.signal })
          if (ac.signal.aborted || gen !== fetchGenRef.current) {
            aborted = true
            return
          }
          accNodes = mergeById(accNodes, normalizeNodes(data.nodes ?? []))
          totalNodes = data.totalNodes ?? accNodes.length
          const kanalChunk = normalizeEdges(data.kanalEdges ?? [])
          const volsChunk = normalizeEdges(data.volsEdges ?? [])
          accEdges = mergeEdgesPreferDetail(mergeEdgesPreferDetail(kanalChunk, volsChunk), accEdges)
          totalEdges = Math.max(data.kanalTotal ?? 0, data.volsTotal ?? 0, data.totalEdges ?? 0)
          if (data.kanalHasMore || data.volsHasMore) hitEdgePageCap = true
          const hasMoreNodes = Boolean(data.hasMore) && (data.nodes ?? []).length >= pageLimit
          if (hasMoreNodes && maxNodePages <= 1) hitNodePageCap = true
          pushPartial(accNodes, accEdges, totalNodes, totalEdges)

          for (let page = 2; hasMoreNodes && page <= maxNodePages; page++) {
            if (ac.signal.aborted || gen !== fetchGenRef.current) {
              aborted = true
              return
            }
            const nq = `${apiBase}/map/viewport?bbox=${bbox}&zoom=${Math.floor(zoom)}&page=${page}&limit=${pageLimit}&types=${types}&includeEdges=0`
            const nd = await jsonFetch<ViewportResponse>(nq, { signal: ac.signal })
            accNodes = mergeById(accNodes, normalizeNodes(nd.nodes ?? []))
            totalNodes = nd.totalNodes ?? totalNodes
            const more = Boolean(nd.hasMore) && (nd.nodes ?? []).length >= pageLimit
            if (more && page >= maxNodePages) hitNodePageCap = true
            if (!more) break
            if (page === 2) pushPartial(accNodes, accEdges, totalNodes, totalEdges)
          }

          const kanalMore = Boolean(data.kanalHasMore)
          const volsMore = Boolean(data.volsHasMore)
          if (kanalMore) {
            const kr = await fetchEdgesOfType('KANALIZACIYA', 2)
            if (aborted) return
            accEdges = mergeEdgesPreferDetail(accEdges, kr.edges)
            totalEdges = Math.max(totalEdges, kr.total)
            if (kr.hitCap) hitEdgePageCap = true
          }
          if (volsMore) {
            const vr = await fetchEdgesOfType('OPTOVOLOKNO', 2)
            if (aborted) return
            accEdges = mergeEdgesPreferDetail(accEdges, vr.edges)
            totalEdges = Math.max(totalEdges, vr.total)
            if (vr.hitCap) hitEdgePageCap = true
          }
        } else {
          const q1 = `${apiBase}/map/viewport?bbox=${bbox}&zoom=${Math.floor(zoom)}&page=1&limit=${pageLimit}&types=${types}&includeEdges=0`
          const data1 = await jsonFetch<ViewportResponse>(q1, { signal: ac.signal })
          if (ac.signal.aborted || gen !== fetchGenRef.current) {
            aborted = true
            return
          }
          accNodes = mergeById(accNodes, normalizeNodes(data1.nodes ?? []))
          totalNodes = data1.totalNodes ?? accNodes.length
          let hasMoreNodes = Boolean(data1.hasMore) && (data1.nodes ?? []).length >= pageLimit
          if (hasMoreNodes && maxNodePages <= 1) hitNodePageCap = true

          const [kanalP1, volsP1] = await Promise.all([
            fetchEdgesOfType('KANALIZACIYA', 1),
            fetchEdgesOfType('OPTOVOLOKNO', 1),
          ])
          if (aborted || ac.signal.aborted || gen !== fetchGenRef.current) {
            aborted = true
            return
          }
          accEdges = mergeEdgesPreferDetail(kanalP1.edges, volsP1.edges)
          totalEdges = Math.max(kanalP1.total, volsP1.total)
          hitEdgePageCap = kanalP1.hitCap || volsP1.hitCap
          pushPartial(accNodes, accEdges, totalNodes, totalEdges)

          for (let page = 2; hasMoreNodes && page <= maxNodePages; page++) {
            if (ac.signal.aborted || gen !== fetchGenRef.current) {
              aborted = true
              return
            }
            const q = `${apiBase}/map/viewport?bbox=${bbox}&zoom=${Math.floor(zoom)}&page=${page}&limit=${pageLimit}&types=${types}&includeEdges=0`
            const data = await jsonFetch<ViewportResponse>(q, { signal: ac.signal })
            accNodes = mergeById(accNodes, normalizeNodes(data.nodes ?? []))
            totalNodes = data.totalNodes ?? totalNodes
            hasMoreNodes = Boolean(data.hasMore) && (data.nodes ?? []).length >= pageLimit
            if (hasMoreNodes && page >= maxNodePages) hitNodePageCap = true
          }

          if (kanalP1.hitCap || volsP1.hitCap) {
            const [kanalRest, volsRest] = await Promise.all([
              fetchEdgesOfType('KANALIZACIYA', 2),
              fetchEdgesOfType('OPTOVOLOKNO', 2),
            ])
            if (!aborted && !ac.signal.aborted && gen === fetchGenRef.current) {
              accEdges = mergeEdgesPreferDetail(mergeEdgesPreferDetail(accEdges, kanalRest.edges), volsRest.edges)
              totalEdges = Math.max(totalEdges, kanalRest.total, volsRest.total)
              hitEdgePageCap = hitEdgePageCap || kanalRest.hitCap || volsRest.hitCap
            }
          }
        }

        if (aborted || ac.signal.aborted || gen !== fetchGenRef.current) {
          aborted = true
          return
        }

        touchCache(key, { nodes: accNodes, edges: accEdges, totalNodes, totalEdges })
        markSettled(key)
        applyMergedViewport(bounds)
        if (hitNodePageCap || hitEdgePageCap) setMapTruncated(true)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          aborted = true
          return
        }
        throw err
      } finally {
        if (aborted && inFlightKeyRef.current === key) {
          inFlightKeyRef.current = null
        }
        if (gen === fetchGenRef.current) setViewportLoading(false)
      }
    },
    [apiBase, jsonFetch, touchCache, applyMergedViewport, markSettled, commitPartialTile],
  )

  const forceBoundsReload = useCallback(
    (bounds: LatLngBounds, zoom: number) => {
      lastBboxKeyRef.current = null
      lastSettledKeyRef.current = null
      inFlightKeyRef.current = null
      lastLodTierRef.current = null
      void fetchViewport(bounds, zoom, true)
    },
    [fetchViewport],
  )

  const fetchMapNode = useCallback(
    async (id: number): Promise<NodeEntity | null> => {
      try {
        const row = await jsonFetch<NodeEntity>(`${apiBase}/nodes/${id}`)
        const normalized = normalizeNodes([row])[0]
        pinnedNodesRef.current.set(id, normalized)
        setNodes((prev) => {
          const merged = mergeById(prev, [normalized])
          nodesSigRef.current = idsSignature(merged)
          return merged
        })
        return normalized
      } catch {
        return null
      }
    },
    [apiBase, jsonFetch],
  )

  const fetchMapEdge = useCallback(
    async (id: number): Promise<EdgeEntity | null> => {
      try {
        const row = await jsonFetch<EdgeEntity>(`${apiBase}/edges/${id}`)
        const normalized = normalizeEdges([row])[0]
        pinnedEdgesRef.current.set(id, normalized)
        setEdges((prev) => {
          const merged = mergeById(prev, [normalized])
          edgesSigRef.current = idsSignature(merged)
          return merged
        })
        return normalized
      } catch {
        return null
      }
    },
    [apiBase, jsonFetch],
  )

  const loadInitial = useCallback(async () => {
    const summaryData = await jsonFetch<MapViewportSummary>(`${apiBase}/map/summary`).catch(() => ({
      totalNodes: 0,
      totalEdges: 0,
      bounds: null,
    }))
    setSummary({
      totalNodes: summaryData.totalNodes,
      totalEdges: summaryData.totalEdges,
      bounds: summaryData.bounds ?? null,
    })

    const viewportMode = bboxLoadWhenLarge && summaryData.totalNodes > VIEWPORT_NODE_THRESHOLD
    viewportModeRef.current = viewportMode
    setUseBboxLoad(viewportMode)
    nodesLoadedRef.current = false
    cacheRef.current.clear()
    cacheOrderRef.current = []
    pinnedNodesRef.current.clear()
    pinnedEdgesRef.current.clear()
    lastBboxKeyRef.current = null
    lastSettledKeyRef.current = null
    inFlightKeyRef.current = null
    lastLodTierRef.current = null

    try {
      if (viewportMode) {
        setViewportLoading(true)
        const b = mapBoundsRef.current
        const z = mapZoomRef.current
        if (b) await fetchViewport(b, z, true)
        else setViewportLoading(false)
      } else {
        nodesSigRef.current = ''
        edgesSigRef.current = ''
        await Promise.all([loadAllEdges(), loadAllDetailNodes()])
      }
    } catch (err) {
      setViewportLoading(false)
      window.alert(err instanceof Error ? err.message : String(err))
    }
  }, [apiBase, jsonFetch, bboxLoadWhenLarge, fetchViewport, loadAllEdges, loadAllDetailNodes])

  /** Sync / фоновое обновление: сводка + перезагрузка области без очистки всего кэша. */
  const refreshMapLight = useCallback(async () => {
    const summaryData = await jsonFetch<MapViewportSummary>(`${apiBase}/map/summary`).catch(() => null)
    if (summaryData) {
      setSummary({
        totalNodes: summaryData.totalNodes,
        totalEdges: summaryData.totalEdges,
        bounds: summaryData.bounds ?? null,
      })
    }
    if (!viewportModeRef.current) {
      await Promise.all([loadAllEdges(), loadAllDetailNodes()])
      return
    }
    const b = mapBoundsRef.current
    const z = mapZoomRef.current
    if (b) await forceBoundsReload(b, z)
  }, [apiBase, jsonFetch, forceBoundsReload, loadAllEdges, loadAllDetailNodes])

  const scheduleBoundsPreview = useCallback((bounds: LatLngBounds, zoom: number) => {
    mapBoundsRef.current = bounds
    mapZoomRef.current = zoom
  }, [])

  const scheduleBoundsSettled = useCallback(
    (bounds: LatLngBounds, zoom: number) => {
      mapBoundsRef.current = bounds
      mapZoomRef.current = zoom
      if (!viewportModeRef.current) return

      const debounceMs = getMapNetworkTiming().settleDebounceMs
      if (settleDebounceRef.current) clearTimeout(settleDebounceRef.current)
      settleDebounceRef.current = setTimeout(() => {
        settleDebounceRef.current = null
        const tier = edgeLodTier(zoom)
        const lodChanged = lastLodTierRef.current !== null && lastLodTierRef.current !== tier
        lastLodTierRef.current = tier
        const runFetch = () => {
          if (lodChanged) {
            lastSettledKeyRef.current = null
            inFlightKeyRef.current = null
            void fetchViewport(bounds, zoom, true)
          } else {
            void fetchViewport(bounds, zoom)
          }
        }
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(runFetch)
        } else {
          setTimeout(runFetch, 0)
        }
      }, debounceMs)
    },
    [fetchViewport],
  )

  const reloadFull = useCallback(async () => {
    nodesLoadedRef.current = false
    cacheRef.current.clear()
    cacheOrderRef.current = []
    pinnedNodesRef.current.clear()
    pinnedEdgesRef.current.clear()
    lastBboxKeyRef.current = null
    lastSettledKeyRef.current = null
    inFlightKeyRef.current = null
    lastLodTierRef.current = null
    if (viewportModeRef.current) {
      const b = mapBoundsRef.current
      const z = mapZoomRef.current
      if (b) await fetchViewport(b, z, true)
    } else {
      await Promise.all([loadAllEdges(), loadAllDetailNodes()])
    }
  }, [fetchViewport, loadAllEdges, loadAllDetailNodes])

  return {
    nodes,
    setNodes,
    edges,
    setEdges,
    useBboxLoad,
    viewportLoading,
    mapTruncated,
    summary,
    remoteApi,
    loadInitial,
    refreshMapLight,
    scheduleBoundsPreview,
    scheduleBoundsSettled,
    forceBoundsReload,
    fetchMapNode,
    fetchMapEdge,
    reloadFull,
    mapBoundsRef,
    mapZoomRef,
  }
}
