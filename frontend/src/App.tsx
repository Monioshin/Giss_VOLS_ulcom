import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMapEvents } from 'react-leaflet'
import L, { type LatLngExpression, type LeafletMouseEvent } from 'leaflet'
import './App.css'

type NodeType = 'TK' | 'MUFTA' | 'PIKET' | 'KROSS'
type EdgeType = 'KANALIZACIYA' | 'OPTOVOLOKNO'
type ToolType = 'SELECT' | 'TK' | 'MUFTA' | 'KROSS' | 'PIKET' | 'KANALIZACIYA' | 'OPTOVOLOKNO'
type SelectedObject = { kind: 'node'; data: NodeEntity } | { kind: 'edge'; data: EdgeEntity } | null
type ContextMenuState =
  | { x: number; y: number; kind: 'node' | 'edge'; id: number }
  | { x: number; y: number; kind: 'project'; id: number }
  | null

type Project = { id: number; name: string; description: string; created_at: string }
type NodeEntity = {
  id: number
  type: NodeType
  name: string
  lat: number
  lng: number
  parent_tk_id?: number | null
  passport_data: Record<string, unknown>
}
type EdgeEntity = {
  id: number
  type: EdgeType
  start_node_id: number
  end_node_id: number
  length_m: number
  geometry: [number, number][]
  cable_name?: string | null
  total_fibers?: number | null
  used_fibers?: number | null
  project_id: number
  project_name: string
  start_node_name: string
  end_node_name: string
  passport_data: Record<string, unknown>
}

type RoutesResponse = { routes: { edge_ids: number[]; node_ids: number[]; total_length_m: number }[] }

const API = 'http://localhost:4000'
const SNAP_METERS = 30
const bendIcon = L.divIcon({ className: 'bend-marker', html: '<span></span>', iconSize: [12, 12], iconAnchor: [6, 6] })

function haversineMeters(a: [number, number], b: [number, number]) {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(x))
}

function nearestNode(nodes: NodeEntity[], click: [number, number], allowed: NodeType[]) {
  let best: NodeEntity | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const node of nodes) {
    if (!allowed.includes(node.type)) continue
    const dist = haversineMeters([node.lat, node.lng], click)
    if (dist < bestDist) {
      bestDist = dist
      best = node
    }
  }
  if (!best || bestDist > SNAP_METERS) return null
  return best
}

async function jsonFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (response.status === 204) return undefined as T
  const data = await response.json()
  if (!response.ok) throw new Error(data?.message || 'API error')
  return data as T
}

function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [nodes, setNodes] = useState<NodeEntity[]>([])
  const [edges, setEdges] = useState<EdgeEntity[]>([])
  const [activeTool, setActiveTool] = useState<ToolType>('SELECT')
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [edgeDraft, setEdgeDraft] = useState<{ startMufta: NodeEntity; bends: [number, number][]; edgeType: EdgeType } | null>(null)
  const [activeLayers, setActiveLayers] = useState({ kanal: true, vols: true })
  const [selectedObject, setSelectedObject] = useState<SelectedObject>(null)
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [showCableModal, setShowCableModal] = useState(false)
  const [queuedEndNode, setQueuedEndNode] = useState<NodeEntity | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [nodeFilter, setNodeFilter] = useState('')
  const [edgeFilter, setEdgeFilter] = useState('')
  const [projectFilterId, setProjectFilterId] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [moveTarget, setMoveTarget] = useState<{ kind: 'node' | 'edge'; id: number } | null>(null)
  const [editingBendsEdgeId, setEditingBendsEdgeId] = useState<number | null>(null)
  const [cableName, setCableName] = useState('')
  const [totalFibers, setTotalFibers] = useState('24')
  const [usedFibers, setUsedFibers] = useState('0')
  const [routeFromId, setRouteFromId] = useState<number | null>(null)
  const [routeToId, setRouteToId] = useState<number | null>(null)
  const [requiredFreeFibers, setRequiredFreeFibers] = useState('1')
  const [routes, setRoutes] = useState<RoutesResponse['routes']>([])
  const [activeRouteEdgeIds, setActiveRouteEdgeIds] = useState<number[]>([])
  const [showLabels, setShowLabels] = useState(true)
  const [showCreateNodeModal, setShowCreateNodeModal] = useState(false)
  const [pendingNode, setPendingNode] = useState<{ type: NodeType; coords: [number, number]; tkId?: number | null } | null>(null)
  const [pendingNodeName, setPendingNodeName] = useState('')

  const computePathLength = (geometry: [number, number][]) => {
    let length = 0
    for (let i = 1; i < geometry.length; i += 1) length += haversineMeters(geometry[i - 1], geometry[i])
    return length
  }

  const loadAll = async () => {
    const [pr, nd, ed] = await Promise.all([
      jsonFetch<Project[]>(`${API}/projects`),
      jsonFetch<NodeEntity[]>(`${API}/nodes`),
      jsonFetch<EdgeEntity[]>(`${API}/edges`),
    ])
    setProjects(pr)
    setNodes(nd)
    setEdges(ed)
  }

  useEffect(() => {
    loadAll().catch((error) => window.alert(error.message))
  }, [])

  useEffect(() => {
    if (activeTool !== 'SELECT') setSelectedObject(null)
  }, [activeTool])

  useEffect(() => {
    const closeMenu = () => setContextMenu(null)
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [])

  const createNode = async (coords: [number, number], nodeType: NodeType) => {
    const tkForMufta = nodeType === 'MUFTA' ? nearestNode(nodes, coords, ['TK']) : null
    if (nodeType === 'MUFTA' && !tkForMufta) return window.alert('Муфта может быть создана только на ТК: кликните рядом с колодцем.')

    const suggested = `${nodeType}-${Date.now().toString().slice(-4)}`
    setPendingNode({ type: nodeType, coords, tkId: tkForMufta?.id ?? null })
    setPendingNodeName(suggested)
    setShowCreateNodeModal(true)
  }

  const confirmCreateNode = async () => {
    if (!pendingNode) return
    const tk = pendingNode.type === 'MUFTA' ? nodes.find((n) => n.id === pendingNode.tkId) ?? null : null
    const payload = {
      type: pendingNode.type,
      name: pendingNodeName.trim() || `${pendingNode.type}-${Date.now().toString().slice(-4)}`,
      lat: tk ? tk.lat : pendingNode.coords[0],
      lng: tk ? tk.lng : pendingNode.coords[1],
      parent_tk_id: tk ? tk.id : null,
      passport_data: {},
    }
    const created = await jsonFetch<NodeEntity>(`${API}/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setNodes((prev) => [created, ...prev])
    setShowCreateNodeModal(false)
    setPendingNode(null)
    setPendingNodeName('')
  }

  const saveEdge = async (
    start: NodeEntity,
    bends: [number, number][],
    end: NodeEntity,
    projectId: number,
    edgeType: EdgeType,
    opticalMeta?: { cable_name: string; total_fibers: number; used_fibers: number },
  ) => {
    const geometry: [number, number][] = [[start.lat, start.lng], ...bends, [end.lat, end.lng]]
    const payload = {
      type: edgeType,
      start_node_id: start.id,
      end_node_id: end.id,
      length_m: computePathLength(geometry),
      geometry,
      project_id: projectId,
      cable_name: opticalMeta?.cable_name ?? null,
      total_fibers: opticalMeta?.total_fibers ?? null,
      used_fibers: opticalMeta?.used_fibers ?? null,
      passport_data: {},
    }
    const created = await jsonFetch<EdgeEntity>(`${API}/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setEdges((prev) => [created, ...prev])
  }

  const tryStartOrFinishEdge = async (coords: [number, number]) => {
    const snappedMufta = nearestNode(nodes, coords, ['MUFTA'])
    if (!edgeDraft) {
      if (!snappedMufta) return window.alert('Кабель должен начинаться от муфты.')
      const edgeType: EdgeType = activeTool === 'KANALIZACIYA' ? 'KANALIZACIYA' : 'OPTOVOLOKNO'
      setEdgeDraft({ startMufta: snappedMufta, bends: [], edgeType })
      return
    }
    if (!snappedMufta) {
      setEdgeDraft((prev) => (prev ? { ...prev, bends: [...prev.bends, coords] } : prev))
      return
    }
    if (edgeDraft.startMufta.id === snappedMufta.id) return window.alert('Конечная муфта должна отличаться от начальной.')

    setQueuedEndNode(snappedMufta)
    if (edgeDraft.edgeType === 'OPTOVOLOKNO') {
      setShowCableModal(true)
      return
    }
    if (!selectedProjectId) {
      setShowProjectModal(true)
      return
    }
    await saveEdge(edgeDraft.startMufta, edgeDraft.bends, snappedMufta, selectedProjectId, edgeDraft.edgeType)
    setEdgeDraft({ startMufta: snappedMufta, bends: [], edgeType: edgeDraft.edgeType })
  }

  const visibleEdges = useMemo(
    () =>
      edges.filter((edge) => {
        if (!activeLayers.kanal && edge.type === 'KANALIZACIYA') return false
        if (!activeLayers.vols && edge.type === 'OPTOVOLOKNO') return false
        if (projectFilterId && edge.project_id !== projectFilterId) return false
        return true
      }),
    [edges, activeLayers, projectFilterId],
  )

  const filteredNodes = nodes.filter(
    (n) => n.name.toLowerCase().includes(nodeFilter.toLowerCase()) || n.type.toLowerCase().includes(nodeFilter.toLowerCase()),
  )
  const filteredEdges = edges.filter((e) => {
    if (projectFilterId && e.project_id !== projectFilterId) return false
    const text = edgeFilter.toLowerCase()
    return (
      (e.project_name || '').toLowerCase().includes(text) ||
      e.start_node_name.toLowerCase().includes(text) ||
      e.end_node_name.toLowerCase().includes(text) ||
      (e.cable_name || '').toLowerCase().includes(text)
    )
  })

  const muftas = nodes.filter((node) => node.type === 'MUFTA')
  const filteredProjects = projects.filter((p) => p.name.toLowerCase().includes(edgeFilter.toLowerCase()))

  const removeNode = async (nodeId: number) => {
    if (!window.confirm('Удалить объект?')) return
    await jsonFetch<void>(`${API}/nodes/${nodeId}`, { method: 'DELETE' })
    await loadAll()
    setSelectedObject(null)
  }

  const removeEdge = async (edgeId: number) => {
    if (!window.confirm('Удалить кабель/участок?')) return
    await jsonFetch<void>(`${API}/edges/${edgeId}`, { method: 'DELETE' })
    await loadAll()
    setSelectedObject(null)
  }

  const removeProject = async (projectId: number) => {
    if (!window.confirm('Удалить проект и все его участки?')) return
    await jsonFetch<void>(`${API}/projects/${projectId}`, { method: 'DELETE' })
    if (selectedProjectId === projectId) setSelectedProjectId(null)
    if (projectFilterId === projectId) setProjectFilterId(null)
    await loadAll()
  }

  const moveNode = async (node: NodeEntity, coords: [number, number]) => {
    let payload: Partial<NodeEntity> = { lat: coords[0], lng: coords[1] }
    if (node.type === 'MUFTA') {
      const tk = nearestNode(nodes, coords, ['TK'])
      if (!tk) return window.alert('Муфта при перемещении должна оставаться на ТК.')
      payload = { lat: tk.lat, lng: tk.lng, parent_tk_id: tk.id }
    }
    await jsonFetch<NodeEntity>(`${API}/nodes/${node.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    await loadAll()
  }

  const moveEdge = async (edge: EdgeEntity, target: [number, number]) => {
    const center = edge.geometry.reduce<[number, number]>(
      (acc, point) => [acc[0] + point[0] / edge.geometry.length, acc[1] + point[1] / edge.geometry.length],
      [0, 0],
    )
    const delta: [number, number] = [target[0] - center[0], target[1] - center[1]]
    const movedGeometry: [number, number][] = edge.geometry.map((point) => [point[0] + delta[0], point[1] + delta[1]])
    const startMufta = nearestNode(nodes, movedGeometry[0], ['MUFTA'])
    const endMufta = nearestNode(nodes, movedGeometry[movedGeometry.length - 1], ['MUFTA'])
    if (!startMufta || !endMufta) return window.alert('После перемещения начало и конец должны остаться на муфтах.')

    const normalized: [number, number][] = [
      [startMufta.lat, startMufta.lng],
      ...movedGeometry.slice(1, movedGeometry.length - 1),
      [endMufta.lat, endMufta.lng],
    ]
    await jsonFetch<EdgeEntity>(`${API}/edges/${edge.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_node_id: startMufta.id,
        end_node_id: endMufta.id,
        geometry: normalized,
        length_m: computePathLength(normalized),
      }),
    })
    await loadAll()
  }

  const updateBendPoint = async (edge: EdgeEntity, bendIndex: number, coords: [number, number]) => {
    const internalIndex = bendIndex + 1
    const nextGeometry = [...edge.geometry]
    nextGeometry[internalIndex] = coords
    await jsonFetch<EdgeEntity>(`${API}/edges/${edge.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geometry: nextGeometry, length_m: computePathLength(nextGeometry) }),
    })
    await loadAll()
  }

  const findRoutes = async () => {
    if (!routeFromId || !routeToId) return window.alert('Выберите A и B муфты.')
    const required = Number(requiredFreeFibers || 1)
    const response = await jsonFetch<RoutesResponse>(
      `${API}/routes?start_node_id=${routeFromId}&end_node_id=${routeToId}&required_free_fibers=${required}`,
    )
    setRoutes(response.routes)
    setActiveRouteEdgeIds(response.routes[0]?.edge_ids || [])
  }

  const MapClickHandler = () => {
    useMapEvents({
      click: async (event: LeafletMouseEvent) => {
        setContextMenu(null)
        const coords: [number, number] = [event.latlng.lat, event.latlng.lng]
        if (moveTarget) {
          const node = nodes.find((item) => moveTarget.kind === 'node' && item.id === moveTarget.id)
          const edge = edges.find((item) => moveTarget.kind === 'edge' && item.id === moveTarget.id)
          if (node) await moveNode(node, coords)
          if (edge) await moveEdge(edge, coords)
          setMoveTarget(null)
          return
        }
        if (activeTool === 'TK' || activeTool === 'MUFTA' || activeTool === 'KROSS' || activeTool === 'PIKET') await createNode(coords, activeTool)
        if (activeTool === 'KANALIZACIYA' || activeTool === 'OPTOVOLOKNO') await tryStartOrFinishEdge(coords)
      },
    })
    return null
  }

  const savePassport = async () => {
    if (!selectedObject) return
    if (selectedObject.kind === 'node') {
      const updated = await jsonFetch<NodeEntity>(`${API}/nodes/${selectedObject.data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedObject.data),
      })
      setNodes((prev) => prev.map((node) => (node.id === updated.id ? updated : node)))
      setSelectedObject({ kind: 'node', data: updated })
      return
    }
    const updated = await jsonFetch<EdgeEntity>(`${API}/edges/${selectedObject.data.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selectedObject.data),
    })
    setEdges((prev) => prev.map((edge) => (edge.id === updated.id ? updated : edge)))
    setSelectedObject({ kind: 'edge', data: updated })
  }

  const createAndSelectProject = async () => {
    if (!newProjectName.trim()) return
    const created = await jsonFetch<Project>(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newProjectName, description: newProjectDescription }),
    })
    setProjects((prev) => [created, ...prev])
    setNewProjectName('')
    setNewProjectDescription('')
    setSelectedProjectId(created.id)
    return created.id
  }

  const confirmProjectSelection = async (projectId: number) => {
    if (!edgeDraft || !queuedEndNode) return
    await saveEdge(edgeDraft.startMufta, edgeDraft.bends, queuedEndNode, projectId, edgeDraft.edgeType)
    setEdgeDraft({ startMufta: queuedEndNode, bends: [], edgeType: edgeDraft.edgeType })
    setQueuedEndNode(null)
    setShowProjectModal(false)
    setSelectedProjectId(projectId)
  }

  const confirmOpticalCable = async () => {
    if (!edgeDraft || !queuedEndNode) return
    let projectId = selectedProjectId
    if (!projectId && newProjectName.trim()) {
      projectId = (await createAndSelectProject()) ?? null
    }
    if (!projectId) return window.alert('Выберите или создайте проект.')

    const total = Number(totalFibers)
    const used = Number(usedFibers)
    if (!cableName.trim()) return window.alert('Укажите название кабеля.')
    if (!Number.isFinite(total) || !Number.isFinite(used) || total < 0 || used < 0 || used > total) {
      return window.alert('Проверьте значения волокон: занято не может быть больше общего.')
    }
    await saveEdge(edgeDraft.startMufta, edgeDraft.bends, queuedEndNode, projectId, 'OPTOVOLOKNO', {
      cable_name: cableName.trim(),
      total_fibers: total,
      used_fibers: used,
    })
    setEdgeDraft({ startMufta: queuedEndNode, bends: [], edgeType: 'OPTOVOLOKNO' })
    setQueuedEndNode(null)
    setShowCableModal(false)
    setCableName('')
    setTotalFibers('24')
    setUsedFibers('0')
  }

  return (
    <div className="app">
      <aside className="left-panel">
        <h2>Выбор инструмента</h2>
        <div className="tool-list">
          <button onClick={() => setActiveTool('SELECT')} className={activeTool === 'SELECT' ? 'active' : ''}>Выбор</button>
          <button onClick={() => setActiveTool('TK')} className={activeTool === 'TK' ? 'active' : ''}>ТК</button>
          <button onClick={() => setActiveTool('MUFTA')} className={activeTool === 'MUFTA' ? 'active' : ''}>Муфты</button>
          <button onClick={() => setActiveTool('KROSS')} className={activeTool === 'KROSS' ? 'active' : ''}>Кросс</button>
          <button onClick={() => setActiveTool('PIKET')} className={activeTool === 'PIKET' ? 'active' : ''}>Пикет</button>
          <button onClick={() => setActiveTool('KANALIZACIYA')} className={activeTool === 'KANALIZACIYA' ? 'active' : ''}>Канализация</button>
          <button onClick={() => setActiveTool('OPTOVOLOKNO')} className={activeTool === 'OPTOVOLOKNO' ? 'active' : ''}>Волоконный кабель</button>
        </div>
        <label>Текущий проект</label>
        <select value={selectedProjectId ?? ''} onChange={(e) => setSelectedProjectId(Number(e.target.value) || null)}>
          <option value="">Не выбран</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <div className="layer-switches">
          <label><input type="checkbox" checked={activeLayers.kanal} onChange={() => setActiveLayers((s) => ({ ...s, kanal: !s.kanal }))} /> Канализация</label>
          <label><input type="checkbox" checked={activeLayers.vols} onChange={() => setActiveLayers((s) => ({ ...s, vols: !s.vols }))} /> ВОЛС</label>
        </div>
        <label>
          <input type="checkbox" checked={showLabels} onChange={() => setShowLabels((v) => !v)} /> Подписи на карте
        </label>
        <p className="hint">Муфта ставится только на ТК. Кабель муфта-муфта, промежуточные клики создают изгибы.</p>
        {moveTarget && (
          <div className="hint-box">
            Режим перемещения активен.
            <button onClick={() => setMoveTarget(null)}>Отменить</button>
          </div>
        )}
        {edgeDraft && <button onClick={() => setEdgeDraft(null)}>Сбросить черновик кабеля</button>}
      </aside>

      <main className="map-wrap">
        <MapContainer center={[55.751244, 37.618423] as LatLngExpression} zoom={13} className="map">
          <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapClickHandler />

          {nodes.filter((n) => n.type !== 'MUFTA').map((node) => (
            <CircleMarker
              key={node.id}
              center={[node.lat, node.lng]}
              radius={node.type === 'TK' ? 12 : 8}
              pathOptions={{ color: node.type === 'TK' ? '#7e57c2' : '#3949ab', fillOpacity: 0.5 }}
              eventHandlers={{
                click: () => activeTool === 'SELECT' && setSelectedObject({ kind: 'node', data: node }),
                contextmenu: (e) => setContextMenu({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, kind: 'node', id: node.id }),
              }}
            >
              {showLabels ? <Tooltip permanent direction="top" offset={[0, -10]}>{node.name}</Tooltip> : <Tooltip>{node.name}</Tooltip>}
            </CircleMarker>
          ))}
          {nodes.filter((n) => n.type === 'MUFTA').map((node) => (
            <CircleMarker
              key={node.id}
              center={[node.lat, node.lng]}
              radius={5}
              pathOptions={{ color: '#00897b', fillOpacity: 1 }}
              eventHandlers={{
                click: () => activeTool === 'SELECT' && setSelectedObject({ kind: 'node', data: node }),
                contextmenu: (e) => setContextMenu({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, kind: 'node', id: node.id }),
              }}
            >
              {showLabels ? (
                <Tooltip permanent direction="top" offset={[0, -10]}>
                  {node.name}
                </Tooltip>
              ) : (
                <Tooltip>{node.name} (внутри ТК)</Tooltip>
              )}
            </CircleMarker>
          ))}

          {edgeDraft && (
            <Polyline
              positions={[[edgeDraft.startMufta.lat, edgeDraft.startMufta.lng], ...edgeDraft.bends] as LatLngExpression[]}
              pathOptions={{ color: '#2563eb', dashArray: '6 6', weight: 3 }}
            />
          )}

          {visibleEdges.map((edge) => (
            <Polyline
              key={edge.id}
              positions={edge.geometry as LatLngExpression[]}
              pathOptions={{
                color: activeRouteEdgeIds.includes(edge.id) ? '#22c55e' : edge.type === 'OPTOVOLOKNO' ? '#ef6c00' : '#5d4037',
                weight: activeRouteEdgeIds.includes(edge.id) ? 6 : 4,
              }}
              eventHandlers={{
                click: () => activeTool === 'SELECT' && setSelectedObject({ kind: 'edge', data: edge }),
                contextmenu: (e) => setContextMenu({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, kind: 'edge', id: edge.id }),
              }}
            />
          ))}

          {editingBendsEdgeId &&
            edges
              .find((edge) => edge.id === editingBendsEdgeId)
              ?.geometry.slice(1, -1)
              .map((point, index) => (
                <Marker
                  key={`bend-${editingBendsEdgeId}-${index}`}
                  position={point as LatLngExpression}
                  draggable
                  icon={bendIcon}
                  eventHandlers={{
                    dragend: async (event) => {
                      const marker = event.target
                      const latlng = marker.getLatLng()
                      const edge = edges.find((e) => e.id === editingBendsEdgeId)
                      if (!edge) return
                      await updateBendPoint(edge, index, [latlng.lat, latlng.lng])
                    },
                  }}
                />
              ))}
        </MapContainer>
      </main>

      <aside className="right-panel">
        <h2>Data Explorer</h2>
        <section>
          <h3>Проекты</h3>
          <div className="list">
            <button className={!projectFilterId ? 'active' : ''} onClick={() => setProjectFilterId(null)}>Показать все проекты</button>
            {filteredProjects.map((project) => (
              <div key={project.id} className="row-actions">
                <button className={projectFilterId === project.id ? 'active' : ''} onClick={() => setProjectFilterId(project.id)}>
                  {project.name}
                </button>
                <button
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ x: e.clientX, y: e.clientY, kind: 'project', id: project.id })
                  }}
                  title="Меню проекта (ПКМ)"
                >
                  ⋮
                </button>
                <button onClick={() => removeProject(project.id)}>Удалить</button>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3>Узлы</h3>
          <input placeholder="Фильтр узлов" value={nodeFilter} onChange={(e) => setNodeFilter(e.target.value)} />
          <div className="list">
            {filteredNodes.map((node) => (
              <button key={node.id} onClick={() => setSelectedObject({ kind: 'node', data: node })}>
                {node.type} | {node.name} | {node.lat.toFixed(5)}, {node.lng.toFixed(5)}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>Кабели/Участки</h3>
          <input placeholder="Фильтр участков" value={edgeFilter} onChange={(e) => setEdgeFilter(e.target.value)} />
          <div className="list">
            {filteredEdges.map((edge) => (
              <button key={edge.id} onClick={() => setSelectedObject({ kind: 'edge', data: edge })}>
                {edge.project_name} | {edge.cable_name || edge.type} | {edge.start_node_name} → {edge.end_node_name}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>Навигатор волокон</h3>
          <label>Точка A (муфта)</label>
          <select value={routeFromId ?? ''} onChange={(e) => setRouteFromId(Number(e.target.value) || null)}>
            <option value="">-- выбрать --</option>
            {muftas.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
          </select>
          <label>Точка B (муфта)</label>
          <select value={routeToId ?? ''} onChange={(e) => setRouteToId(Number(e.target.value) || null)}>
            <option value="">-- выбрать --</option>
            {muftas.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
          </select>
          <label>Минимум свободных волокон</label>
          <input value={requiredFreeFibers} onChange={(e) => setRequiredFreeFibers(e.target.value)} />
          <button onClick={findRoutes}>Найти маршруты</button>
          <div className="list">
            {routes.map((route, index) => (
              <button key={index} onClick={() => setActiveRouteEdgeIds(route.edge_ids)}>
                Маршрут {index + 1}: {route.total_length_m} м, участков {route.edge_ids.length}
              </button>
            ))}
          </div>
        </section>
      </aside>

      {selectedObject && (
        <div className="passport">
          <h3>Паспорт: {selectedObject.kind === 'node' ? 'Узел' : 'Линия'}</h3>
          {'name' in selectedObject.data && (
            <>
              <label>Название</label>
              <input
                value={selectedObject.data.name}
                onChange={(e) =>
                  setSelectedObject((prev) =>
                    prev && prev.kind === 'node' ? { kind: 'node', data: { ...prev.data, name: e.target.value } } : prev,
                  )
                }
              />
            </>
          )}
          {selectedObject.kind === 'edge' && (
            <>
              <label>Название кабеля</label>
              <input
                value={selectedObject.data.cable_name || ''}
                onChange={(e) =>
                  setSelectedObject((prev) =>
                    prev && prev.kind === 'edge' ? { kind: 'edge', data: { ...prev.data, cable_name: e.target.value } } : prev,
                  )
                }
              />
              <label>Всего волокон</label>
              <input
                value={selectedObject.data.total_fibers ?? ''}
                onChange={(e) =>
                  setSelectedObject((prev) =>
                    prev && prev.kind === 'edge'
                      ? { kind: 'edge', data: { ...prev.data, total_fibers: Number(e.target.value || 0) } }
                      : prev,
                  )
                }
              />
              <label>Занято волокон</label>
              <input
                value={selectedObject.data.used_fibers ?? ''}
                onChange={(e) =>
                  setSelectedObject((prev) =>
                    prev && prev.kind === 'edge'
                      ? { kind: 'edge', data: { ...prev.data, used_fibers: Number(e.target.value || 0) } }
                      : prev,
                  )
                }
              />
              <button onClick={() => setEditingBendsEdgeId(selectedObject.data.id)}>Редактировать изгибы</button>
            </>
          )}
          <label>Паспорт JSON</label>
          <textarea
            value={JSON.stringify(selectedObject.data.passport_data, null, 2)}
            onChange={(e) => {
              try {
                const next = JSON.parse(e.target.value)
                setSelectedObject((prev) => {
                  if (!prev) return prev
                  if (prev.kind === 'node') return { kind: 'node', data: { ...prev.data, passport_data: next } }
                  return { kind: 'edge', data: { ...prev.data, passport_data: next } }
                })
              } catch {
                // Ignore invalid JSON during typing.
              }
            }}
          />
          <div className="passport-actions">
            <button onClick={savePassport}>Сохранить</button>
            <button onClick={() => setSelectedObject(null)}>Закрыть</button>
            {editingBendsEdgeId && <button onClick={() => setEditingBendsEdgeId(null)}>Завершить изгибы</button>}
          </div>
        </div>
      )}

      {showProjectModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Выберите проект для кабеля</h3>
            <label>Существующий проект</label>
            <select onChange={(e) => e.target.value && confirmProjectSelection(Number(e.target.value))}>
              <option value="">-- выбрать --</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <p>или создать новый:</p>
            <input placeholder="Название проекта" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} />
            <textarea placeholder="Описание" value={newProjectDescription} onChange={(e) => setNewProjectDescription(e.target.value)} />
            <div className="passport-actions">
              <button
                onClick={async () => {
                  const id = await createAndSelectProject()
                  if (id) await confirmProjectSelection(id)
                }}
              >
                Создать и выбрать
              </button>
              <button onClick={() => setShowProjectModal(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {showCableModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Параметры оптоволоконного кабеля</h3>
            <label>Проект</label>
            <select value={selectedProjectId ?? ''} onChange={(e) => setSelectedProjectId(Number(e.target.value) || null)}>
              <option value="">-- выбрать --</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <label>Название кабеля</label>
            <input value={cableName} onChange={(e) => setCableName(e.target.value)} />
            <label>Количество волокон</label>
            <input value={totalFibers} onChange={(e) => setTotalFibers(e.target.value)} />
            <label>Занято волокон</label>
            <input value={usedFibers} onChange={(e) => setUsedFibers(e.target.value)} />
            <p>Если проект не выбран, можно создать:</p>
            <input placeholder="Новый проект" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} />
            <div className="passport-actions">
              <button onClick={confirmOpticalCable}>Сохранить кабель</button>
              <button onClick={() => setShowCableModal(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          {contextMenu.kind === 'project' ? (
            <>
              <button
                onClick={() => {
                  setProjectFilterId(contextMenu.id)
                  setContextMenu(null)
                }}
              >
                Показать только этот проект
              </button>
              <button
                onClick={() => {
                  setProjectFilterId(null)
                  setContextMenu(null)
                }}
              >
                Показать все проекты
              </button>
              <button
                onClick={() => {
                  window.alert('Заметки/файлы проекта добавлю следующим шагом (нужны API + UI).')
                  setContextMenu(null)
                }}
              >
                Заметки/файлы проекта…
              </button>
            </>
          ) : (
            <>
              <button
                onClick={async () => {
                  if (contextMenu.kind === 'node') await removeNode(contextMenu.id)
                  if (contextMenu.kind === 'edge') await removeEdge(contextMenu.id)
                  setContextMenu(null)
                }}
              >
                Удалить
              </button>
              <button
                onClick={() => {
                  setMoveTarget({ kind: contextMenu.kind, id: contextMenu.id })
                  setContextMenu(null)
                }}
              >
                Переместить
              </button>
            </>
          )}
        </div>
      )}

      {showCreateNodeModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Создание объекта</h3>
            <label>Имя</label>
            <input value={pendingNodeName} onChange={(e) => setPendingNodeName(e.target.value)} />
            <div className="passport-actions">
              <button onClick={confirmCreateNode}>Создать</button>
              <button
                onClick={() => {
                  setShowCreateNodeModal(false)
                  setPendingNode(null)
                  setPendingNodeName('')
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
