import { useCallback, useEffect, useRef, useState } from 'react'
import type { DbEntityCategory, EdgeEntity, NodeEntity, NodeType } from '../gisTypes'

const PAGE_SIZE = 200

const NODE_CATEGORY_TYPE: Partial<Record<DbEntityCategory, NodeType>> = {
  tk: 'TK',
  mufta: 'MUFTA',
  piket: 'PIKET',
  kross: 'KROSS',
}

type JsonFetch = <T>(url: string, options?: RequestInit) => Promise<T>

type PagedResult<T> = { items: T[]; total: number; page: number; limit: number }

type DbSortKey = 'name' | 'id' | 'length' | 'status' | 'date'

function normalizeNodes(nd: NodeEntity[]): NodeEntity[] {
  return nd.map((n) => ({
    ...n,
    passport_data: n.passport_data ?? {},
  }))
}

export function useDatabasePage(
  apiBase: string,
  jsonFetch: JsonFetch,
  category: DbEntityCategory,
  search: string,
  enabled: boolean,
  sortKey: DbSortKey = 'name',
  sortAsc = true,
) {
  const [page, setPage] = useState(1)
  const [nodes, setNodes] = useState<NodeEntity[]>([])
  const [edges, setEdges] = useState<EdgeEntity[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const hasLoadedOnceRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const nodeType = NODE_CATEGORY_TYPE[category]
  const isNodeCategory = nodeType != null
  const isEdgeCategory = category === 'optical' || category === 'kanal'
  const serverSort = isNodeCategory && (sortKey === 'name' || sortKey === 'id')

  useEffect(() => {
    setPage(1)
  }, [category, search, sortKey, sortAsc])

  const load = useCallback(async () => {
    if (!enabled) return
    if (!isNodeCategory && !isEdgeCategory) {
      setNodes([])
      setEdges([])
      setTotal(0)
      setHasLoadedOnce(false)
      hasLoadedOnceRef.current = false
      return
    }

    setLoading(true)
    setError(null)
    try {
      const q = search.trim()
      if (isNodeCategory && nodeType) {
        let url = `${apiBase}/nodes?types=${nodeType}&page=${page}&limit=${PAGE_SIZE}`
        if (q) url += `&q=${encodeURIComponent(q)}`
        if (serverSort) url += `&sort=${sortKey === 'name' ? 'name' : 'id'}`
        const data = await jsonFetch<NodeEntity[] | PagedResult<NodeEntity>>(url)
        if (Array.isArray(data)) {
          setNodes(normalizeNodes(data))
          setTotal(data.length)
        } else {
          setNodes(normalizeNodes(data.items))
          setTotal(data.total)
        }
        setEdges([])
      } else if (isEdgeCategory) {
        const edgeType = category === 'optical' ? 'OPTOVOLOKNO' : 'KANALIZACIYA'
        let url = `${apiBase}/edges?type=${edgeType}&page=${page}&limit=${PAGE_SIZE}`
        if (q) url += `&q=${encodeURIComponent(q)}`
        const data = await jsonFetch<EdgeEntity[] | PagedResult<EdgeEntity>>(url)
        if (Array.isArray(data)) {
          setEdges(data)
          setTotal(data.length)
        } else {
          setEdges(data.items)
          setTotal(data.total)
        }
        setNodes([])
      }
      hasLoadedOnceRef.current = true
      setHasLoadedOnce(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      if (!hasLoadedOnceRef.current) {
        setNodes([])
        setEdges([])
        setTotal(0)
      }
    } finally {
      setLoading(false)
    }
  }, [
    apiBase,
    jsonFetch,
    enabled,
    isNodeCategory,
    isEdgeCategory,
    nodeType,
    category,
    page,
    search,
    serverSort,
    sortKey,
  ])

  useEffect(() => {
    if (!enabled) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void load()
    }, search.trim() ? 280 : 0)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [load, enabled, search])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return {
    nodes,
    edges,
    total,
    page,
    setPage,
    pageCount,
    pageSize: PAGE_SIZE,
    loading,
    error,
    hasLoadedOnce,
    usesServerPage: isNodeCategory || isEdgeCategory,
    serverSort,
  }
}
