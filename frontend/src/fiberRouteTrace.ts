import {
  coerceSpliceFiberRef,
  getCrossPortCount,
  getSpliceV1,
  type SpliceFiberRef,
  type SpliceLinkV1,
} from './muftaSpliceTypes'

export type TraceFiberRouteNode = { id: number; type: string; passport_data: Record<string, unknown> }
export type TraceFiberRouteEdge = {
  id: number
  type: string
  start_node_id: number
  end_node_id: number
  geometry?: [number, number][] | null
}

export type TraceEndKind = 'cross' | 'open_end' | 'cycle'

function rk(r: SpliceFiberRef): string {
  return `${r.edgeId}:${r.fiberIndex}`
}

function refIncidentToNode(
  nodeId: number,
  r: SpliceFiberRef,
  edgeById: Map<number, TraceFiberRouteEdge>,
  internalPorts: number,
): boolean {
  if (r.edgeId === 0) return internalPorts > 0 && r.fiberIndex >= 1 && r.fiberIndex <= internalPorts
  const e = edgeById.get(r.edgeId)
  return !!e && e.type === 'OPTOVOLOKNO' && (e.start_node_id === nodeId || e.end_node_id === nodeId)
}

function linkIncidentToNode(
  link: SpliceLinkV1,
  nodeId: number,
  edgeById: Map<number, TraceFiberRouteEdge>,
  internalPorts: number,
): boolean {
  return (
    refIncidentToNode(nodeId, link.from, edgeById, internalPorts) &&
    refIncidentToNode(nodeId, link.to, edgeById, internalPorts)
  )
}

function otherEnd(link: SpliceLinkV1, cur: SpliceFiberRef): SpliceFiberRef {
  return rk(link.from) === rk(cur) ? link.to : link.from
}

function combineEndKind(a: TraceEndKind, b: TraceEndKind): TraceEndKind {
  if (a === 'cycle' || b === 'cycle') return 'cycle'
  if (a === 'cross' || b === 'cross') return 'cross'
  return 'open_end'
}

function spliceHitsAtNode(
  nodeId: number,
  curRef: SpliceFiberRef,
  node: TraceFiberRouteNode,
  edgeById: Map<number, TraceFiberRouteEdge>,
): SpliceLinkV1[] {
  const internalPorts = String(node.type).toUpperCase() === 'KROSS' ? getCrossPortCount(node.passport_data) : 0
  const links = getSpliceV1(node.passport_data).links.filter((l) =>
    linkIncidentToNode(l, nodeId, edgeById, internalPorts),
  )
  return links.filter((l) => rk(l.from) === rk(curRef) || rk(l.to) === rk(curRef))
}

/** «Вперёд»: на узле сварка → по новому кабелю на соседний узел (как раньше, без шага только по кабелю). */
function traceRayForward(
  startNodeId: number,
  startRef: SpliceFiberRef,
  nodeById: Map<number, TraceFiberRouteNode>,
  edgeById: Map<number, TraceFiberRouteEdge>,
): { edgeIds: number[]; nodeIds: number[]; endKind: TraceEndKind } {
  const edgeIds: number[] = []
  const nodeIds: number[] = [startNodeId]
  let curNode = startNodeId
  let curRef: SpliceFiberRef = { ...startRef }
  const visited = new Set<string>()
  let endKind: TraceEndKind = 'open_end'

  for (let iter = 0; iter < 500; iter += 1) {
    const stateKey = `${curNode}|${rk(curRef)}|F`
    if (visited.has(stateKey)) {
      endKind = 'cycle'
      break
    }
    visited.add(stateKey)

    const node = nodeById.get(curNode)
    if (!node) break

    const hits = spliceHitsAtNode(curNode, curRef, node, edgeById)
    if (hits.length === 0) break

    const nextRef = otherEnd(hits[0], curRef)
    if (nextRef.edgeId === 0) {
      endKind = 'cross'
      break
    }

    const cable = edgeById.get(nextRef.edgeId)
    if (!cable || cable.type !== 'OPTOVOLOKNO') break
    if (cable.start_node_id !== curNode && cable.end_node_id !== curNode) break

    const nextNode = cable.start_node_id === curNode ? cable.end_node_id : cable.start_node_id
    if (edgeIds.length === 0 || edgeIds[edgeIds.length - 1] !== cable.id) edgeIds.push(cable.id)
    nodeIds.push(nextNode)
    curNode = nextNode
    curRef = nextRef
  }

  return { edgeIds, nodeIds, endKind }
}

/** «Назад»: по текущему кабелю на соседний узел → сварка → снова по кабелю … */
function traceRayBackward(
  startNodeId: number,
  startRef: SpliceFiberRef,
  nodeById: Map<number, TraceFiberRouteNode>,
  edgeById: Map<number, TraceFiberRouteEdge>,
): { edgeIds: number[]; nodeIds: number[]; endKind: TraceEndKind } {
  const edgeIds: number[] = []
  const nodeIds: number[] = [startNodeId]
  let curNode = startNodeId
  let curRef: SpliceFiberRef = { ...startRef }
  const visited = new Set<string>()
  let endKind: TraceEndKind = 'open_end'

  for (let iter = 0; iter < 500; iter += 1) {
    if (curRef.edgeId === 0) {
      endKind = 'cross'
      break
    }

    const preCableKey = `${curNode}|${rk(curRef)}|B`
    if (visited.has(preCableKey)) {
      endKind = 'cycle'
      break
    }
    visited.add(preCableKey)

    const cable = edgeById.get(curRef.edgeId)
    if (!cable || cable.type !== 'OPTOVOLOKNO') break
    if (cable.start_node_id !== curNode && cable.end_node_id !== curNode) break

    const nextNode = cable.start_node_id === curNode ? cable.end_node_id : cable.start_node_id
    edgeIds.push(cable.id)
    nodeIds.push(nextNode)
    curNode = nextNode

    const node = nodeById.get(curNode)
    if (!node) break

    const hits = spliceHitsAtNode(curNode, curRef, node, edgeById)
    if (hits.length === 0) break

    const nextRef = otherEnd(hits[0], curRef)
    if (nextRef.edgeId === 0) {
      endKind = 'cross'
      break
    }
    curRef = nextRef
  }

  return { edgeIds, nodeIds, endKind }
}

function appendEdgesDedupe(target: number[], more: number[]) {
  for (const id of more) {
    if (target.length > 0 && target[target.length - 1] === id) continue
    target.push(id)
  }
}

/**
 * Полный логический путь волокна: от точки выбора и в сторону «сварок→кабель», и в сторону «кабель→сварка»
 * (чтобы с крайних муфт был виден весь маршрут, а не только «половина» от середины).
 */
export function traceFiberLogicalRoute(
  startNodeId: number,
  startRef: SpliceFiberRef,
  nodes: TraceFiberRouteNode[],
  edges: TraceFiberRouteEdge[],
):
  | { ok: true; orderedEdgeIds: number[]; orderedNodeIds: number[]; endKind: TraceEndKind }
  | { ok: false; message: string } {
  const ref0 = coerceSpliceFiberRef(startRef)
  if (!ref0.fiberIndex || ref0.fiberIndex < 1) {
    return { ok: false, message: 'Некорректный номер волокна' }
  }

  const edgeById = new Map<number, TraceFiberRouteEdge>()
  for (const e of edges) {
    if (e.type === 'OPTOVOLOKNO') edgeById.set(e.id, e)
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  if (ref0.edgeId !== 0) {
    const e0 = edgeById.get(ref0.edgeId)
    if (!e0) return { ok: false, message: `Участок ВОЛС id ${ref0.edgeId} не найден` }
    if (e0.start_node_id !== startNodeId && e0.end_node_id !== startNodeId) {
      return { ok: false, message: 'Выбранный кабель не подключён к этому узлу' }
    }
  } else {
    const n0 = nodeById.get(startNodeId)
    if (String(n0?.type).toUpperCase() !== 'KROSS') {
      return { ok: false, message: 'Внутренний порт (edge 0) доступен только на кроссе' }
    }
    const ports = getCrossPortCount(n0!.passport_data)
    if (ref0.fiberIndex > ports) return { ok: false, message: 'Номер порта вне диапазона кросса' }
  }

  const back = traceRayBackward(startNodeId, ref0, nodeById, edgeById)
  const fwd = traceRayForward(startNodeId, ref0, nodeById, edgeById)

  const orderedEdgeIds: number[] = []
  appendEdgesDedupe(orderedEdgeIds, [...back.edgeIds].reverse())
  appendEdgesDedupe(orderedEdgeIds, fwd.edgeIds)

  let orderedNodeIds: number[] = []
  const bn = back.nodeIds
  const fn = fwd.nodeIds
  if (bn.length === 0) orderedNodeIds = fn
  else if (fn.length === 0) orderedNodeIds = [...bn].reverse()
  else orderedNodeIds = [...bn].reverse().concat(fn.slice(1))

  const endKind = combineEndKind(back.endKind, fwd.endKind)

  return { ok: true, orderedEdgeIds, orderedNodeIds, endKind }
}

