import type Supercluster from 'supercluster'
import type { NodeEntity } from '../gisTypes'
import { buildNodeClusterIndex, type NodeClusterProps } from './superclusterIndex'

const INDEX_DEBOUNCE_MS = 300

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let buildToken = 0

export function scheduleClusterIndexBuild(
  nodes: NodeEntity[],
  zoom: number,
  onReady: (index: Supercluster<NodeClusterProps>) => void,
): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    const token = ++buildToken
    const run = () => {
      if (token !== buildToken) return
      onReady(buildNodeClusterIndex(nodes, zoom))
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 150 })
    } else {
      setTimeout(run, 0)
    }
  }, INDEX_DEBOUNCE_MS)
}

export function cancelScheduledClusterIndexBuild(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = null
  buildToken++
}
