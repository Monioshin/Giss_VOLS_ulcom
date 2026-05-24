import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { CircleMarker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L, { type LatLngExpression, type LeafletMouseEvent } from 'leaflet'
import './App.css'
const MuftaSpliceWorkspace = lazy(() =>
  import('./MuftaSpliceWorkspace').then((m) => ({ default: m.MuftaSpliceWorkspace })),
)
import { traceFiberLogicalRoute } from './fiberRouteTrace'
import {
  buildImportPreviewRows,
  buildImportTemplateWorkbook,
  detectKanalLinksWorkbook,
  downloadBlob,
  exportNodesWorkbook,
  parseImportWorkbook,
  type ExportNodesFilter,
} from './import/excelImport'
import { importKanalLinksFromExcelBuffer } from './map/importKanalLinksExcel'
const SettingsPanel = lazy(() => import('./SettingsPanel').then((m) => ({ default: m.SettingsPanel })))
const AnalyticsTab = lazy(() => import('./AnalyticsTab').then((m) => ({ default: m.AnalyticsTab })))
const DatabaseTab = lazy(() => import('./DatabaseTab').then((m) => ({ default: m.DatabaseTab })))
import { PassportDrawer } from './passport/PassportDrawer'
import { UsersTab } from './UsersTab'
import { Button } from './ui/Button'
import { FormField } from './ui/FormField'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { Textarea } from './ui/Textarea'
import { canEditData, canImportExportDatabase } from './users/permissions'
import type { UserRole as UsersTabRole, UserRow as UsersTabRow } from './users/types'
import type { FiberCableStatus as GisFiberStatus } from './gisTypes'
import type { BackupConfig, BackupEntry } from './settingsTypes'
import {
  applyCableNameTemplate,
  flyDurationMultiplier,
  loadActivityLog,
  loadUserPrefs,
  mergeUserPrefs,
  nextCableSequence,
  pushActivityLog,
  resolveTheme,
  saveMapViewToStorage,
  saveUserPrefs,
  type BasemapMode,
  type DeleteConfirmMode,
  type ShellTab as PrefsShellTab,
  type UserPrefs,
  type UserPrefsPatch,
} from './userPrefs'
import { MapInstanceBridge } from './map/MapInstanceBridge'
import { MapBoundsWatcher } from './map/MapBoundsWatcher'
import { MapCanvasCoordinator } from './map/MapCanvasCoordinator'
import { MapStatusBell } from './map/MapStatusBell'
import { MapEdgesOverlay } from './map/MapEdgesOverlay'
import { MapLabelsLayer } from './map/MapLabelsLayer'
import { MapNodesOverlay } from './map/MapNodesOverlay'
import { MapShell } from './map/MapShell'
import { MapTab } from './map/MapTab'
import { MapZoomBridge } from './map/MapZoomBridge'
import { useMapViewport } from './map/useMapViewport'
import { isDetailNodeType, TK_DETAIL_ZOOM } from './map/mapZoomConstants'
import { countMuftasOnTk } from './map/muftaTkLayout'
import {
  API,
  API_HEALTH_TIMEOUT_MS,
  getApiBase,
  getApiBaseOverride,
  getMapNetworkTiming,
  setApiBaseOverride,
} from './apiBase'
import { isDesktopApp } from './desktopDetect'
import { KanalLinkModal } from './map/KanalLinkModal'

type NodeType = 'TK' | 'MUFTA' | 'PIKET' | 'KROSS'
type EdgeType = 'KANALIZACIYA' | 'OPTOVOLOKNO'
type ToolType = 'SELECT' | 'TK' | 'MUFTA' | 'KROSS' | 'PIKET' | 'KANALIZACIYA' | 'OPTOVOLOKNO' | 'MEASURE'
type SelectedObject =
  | { kind: 'node'; data: NodeEntity }
  | { kind: 'edge'; data: EdgeEntity }
  | { kind: 'project'; data: Project }
  | null
type ContextMenuState =
  | { x: number; y: number; kind: 'node' | 'edge'; id: number }
  | { x: number; y: number; kind: 'project'; id: number }
  | { x: number; y: number; kind: 'database-item'; object: 'project' | 'node' | 'edge'; id: number }
  | null

type DbEntityCategory = 'projects' | 'optical' | 'kanal' | 'mufta' | 'tk' | 'piket' | 'kross'

type GlobalSearchHit = { kind: 'node' | 'edge' | 'project'; id: number; label: string; sub: string }

type MapFlyPayload = { kind: 'node' | 'edge' | 'project'; id: number; smooth?: boolean }

type Project = {
  id: number
  name: string
  description: string
  created_at: string
  updated_at?: string
  passport_data?: Record<string, unknown>
}
type FiberCableStatus = 'READY' | 'IN_WORK' | 'OFFLINE' | 'ACCIDENT' | 'CONSTRUCTION'
type NodeEntity = {
  id: number
  type: NodeType
  name: string
  lat: number
  lng: number
  parent_tk_id?: number | null
  passport_data: Record<string, unknown>
  created_at?: string
  updated_at?: string
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
  project_id: number | null
  project_name: string | null
  start_node_name: string
  end_node_name: string
  passport_data: Record<string, unknown>
  cable_status?: FiberCableStatus | string | null
  created_at?: string
  updated_at?: string
}

type FiberOrder = {
  id: number
  name: string
  description: string
  fiber_count: number
  start_mufta_id: number
  end_mufta_id: number
  edge_ids: number[]
  total_length_m: number
  created_at: string
  start_mufta_name: string
  end_mufta_name: string
}

type RoutesResponse = { routes: { edge_ids: number[]; node_ids: number[]; total_length_m: number }[] }
type ShellTab = PrefsShellTab

const SHELL_TAB_TITLE: Record<ShellTab, string> = {
  map: 'Карта',
  database: 'База данных',
  fiber_orders: 'Заказы по волокну',
  splice: 'Сварка',
  users: 'Пользователи',
  settings: 'Настройки',
  analytics: 'Аналитика',
}

type AuthUser = {
  id: number
  username: string
  role: UsersTabRole
  embed?: boolean
  embedIssuerUserId?: number | null
}

type AuthMeResponse = {
  user: AuthUser | null
  embed?: {
    highlightEdgeId: number | null
    highlightNodeId: number | null
    highlightProjectId: number | null
  } | null
}
type UserRow = { id: number; username: string; role: UsersTabRole; created_at: string }
type WorkspaceRow = {
  id: number
  name: string
  created_at: string
  is_active: boolean
  is_mine?: boolean
  is_server_default?: boolean
}
type ThemeMode = 'light' | 'dark'

const AUTH_TOKEN_KEY = 'gis_auth_token'
const EMBED_TOKEN_KEY = 'gis_embed_token'

type BearerSource = 'embed' | 'local'

function getBearerContext(): { token: string; source: BearerSource } | null {
  if (typeof window === 'undefined') return null
  const embed = sessionStorage.getItem(EMBED_TOKEN_KEY)
  if (embed?.trim()) return { token: embed.trim(), source: 'embed' }
  const loc = localStorage.getItem(AUTH_TOKEN_KEY)
  if (loc?.trim()) return { token: loc.trim(), source: 'local' }
  return null
}
const SNAP_METERS = 30
/** Подсказки для полей волокон при вводе нового ВОЛС (можно ввести своё число). */
const OPTICAL_FIBER_TOTAL_PRESETS = [4, 6, 8, 12, 16, 24, 32, 48, 72, 96, 144, 192, 288] as const
const OPTICAL_FIBER_USED_PRESETS = [0, 1, 2, 4, 8, 12, 16, 24, 32, 48, 72, 96, 144] as const

const FIBER_STATUS_LABELS: Record<FiberCableStatus, string> = {
  READY: 'Готов',
  IN_WORK: 'В работе',
  OFFLINE: 'Не работает',
  ACCIDENT: 'Авария',
  CONSTRUCTION: 'Строится',
}

const FIBER_STATUS_ORDER: FiberCableStatus[] = ['READY', 'IN_WORK', 'CONSTRUCTION', 'OFFLINE', 'ACCIDENT']

const FIBER_LINE_COLORS: Record<FiberCableStatus, string> = {
  READY: '#ea580c',
  IN_WORK: '#f59e0b',
  OFFLINE: '#64748b',
  ACCIDENT: '#ff0080',
  CONSTRUCTION: '#7c3aed',
}

function normalizeFiberStatus(status: string | null | undefined): FiberCableStatus {
  if (status === 'IN_WORK' || status === 'OFFLINE' || status === 'ACCIDENT' || status === 'CONSTRUCTION') return status
  return 'READY'
}

function opticalLineStrokeColor(edge: EdgeEntity) {
  const st = normalizeFiberStatus(edge.cable_status)
  return FIBER_LINE_COLORS[st]
}

const DATABASE_IMPORT_HELP = `Формат JSON для импорта (полная замена базы):

• Корень: объект с полями "format": "gis-database", "version": 1, "projects", "nodes", "edges".
• projects[]: id, name, description, created_at (ISO-строка или опустить).
• nodes[]: id, type (TK | MUFTA | PIKET | KROSS), name, lat, lng, parent_tk_id (только у MUFTA — id ТК), passport_data (объект).
• edges[]: OPTOVOLOKNO — муфта–муфта, муфта–кросс или кросс–кросс; project_id обязателен; KANALIZACIYA — ТК–ТК, project_id = null; geometry [[lat,lng],...].
• Для OPTOVOLOKNO обязательны: cable_name, total_fibers, used_fibers (used ≤ total).
• Для OPTOVOLOKNO опционально: cable_status — READY | IN_WORK | OFFLINE | ACCIDENT | CONSTRUCTION (по умолчанию READY).
• На одном ТК может быть несколько муфт (один parent_tk_id); координаты могут совпадать с ТК — при импорте сервер разнесёт их по кругу вокруг колодца.
• Муфта должна быть в пределах 2 м от координат своего ТК.

Пример минимального фрагмента:
{
  "format": "gis-database",
  "version": 1,
  "projects": [{ "id": 1, "name": "Проект А", "description": "" }],
  "nodes": [
    { "id": 1, "type": "TK", "name": "ТК-1", "lat": 55.751, "lng": 37.618, "passport_data": {} },
    { "id": 2, "type": "MUFTA", "name": "М-1", "lat": 55.751, "lng": 37.618, "parent_tk_id": 1, "passport_data": {} }
  ],
  "edges": [
    {
      "id": 1,
      "type": "OPTOVOLOKNO",
      "start_node_id": 2,
      "end_node_id": 3,
      "length_m": 100,
      "geometry": [[55.751,37.618],[55.752,37.619]],
      "cable_name": "ОК-1",
      "total_fibers": 24,
      "used_fibers": 0,
      "project_id": 1,
      "cable_status": "READY",
      "passport_data": {}
    }
  ]
}

Экспорт через кнопку «Скачать JSON» даёт файл в этом же формате.`

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
  const allowedU = new Set(allowed.map((t) => t.toUpperCase()))
  let best: NodeEntity | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const node of nodes) {
    if (!allowedU.has(String(node.type).toUpperCase())) continue
    const dist = haversineMeters([node.lat, node.lng], click)
    if (dist < bestDist) {
      bestDist = dist
      best = node
    }
  }
  if (!best || bestDist > SNAP_METERS) return null
  return best
}

/** Конец ВОЛС: ближайшая муфта/кросс, опционально исключая уже выбранный начальный узел (чтобы не «прилипало» к той же точке, что ТК+муфта). */
function nearestOpticalEndpoint(nodes: NodeEntity[], click: [number, number], opts?: { excludeId?: number }): NodeEntity | null {
  const ex = opts?.excludeId
  let best: NodeEntity | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const node of nodes) {
    const t = String(node.type).toUpperCase()
    if (t !== 'MUFTA' && t !== 'KROSS') continue
    if (ex != null && node.id === ex) continue
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
  const bearer = typeof window !== 'undefined' ? getBearerContext() : null
  const headers = new Headers(options?.headers as HeadersInit | undefined)
  if (bearer) headers.set('Authorization', `Bearer ${bearer.token}`)
  if (options?.body != null && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  let response: Response
  try {
    response = await fetch(url, { ...options, headers })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      throw new Error(
        `Нет связи с API ${getApiBase()}. Внизу окна проверьте «Сервер API». В браузере откройте ${getApiBase()}/health — если там OK, пересоберите desktop после обновления electron/preload.`,
      )
    }
    throw err
  }
  if (response.status === 401 && bearer) {
    if (bearer.source === 'embed') sessionStorage.removeItem(EMBED_TOKEN_KEY)
    else localStorage.removeItem(AUTH_TOKEN_KEY)
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  let data: { message?: string } | null = null
  if (text) {
    try {
      data = JSON.parse(text) as { message?: string }
    } catch {
      const snippet = text.replace(/\s+/g, ' ').slice(0, 120)
      const hint = text.trimStart().startsWith('<')
        ? ' Сервер вернул HTML вместо JSON — перезапустите backend (порт 4000) или проверьте, что API доступен.'
        : ''
      throw new Error(`Ответ сервера не JSON (${response.status}): ${snippet}${hint}`)
    }
  }
  if (!response.ok) throw new Error(data?.message || `Ошибка API (${response.status})`)
  return data as T
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** Возвращает точку на полилинии, ближайшую к клику, и индекс сегмента (вставка после этой вершины). */
function closestPointOnPolyline(
  geometry: [number, number][],
  click: [number, number],
): { insertAfter: number; point: [number, number]; distM: number } | null {
  if (geometry.length < 2) return null
  let bestDist = Number.POSITIVE_INFINITY
  let best: { insertAfter: number; point: [number, number] } | null = null
  for (let i = 0; i < geometry.length - 1; i += 1) {
    const a = geometry[i]
    const b = geometry[i + 1]
    const ab: [number, number] = [b[0] - a[0], b[1] - a[1]]
    const ap: [number, number] = [click[0] - a[0], click[1] - a[1]]
    const ab2 = ab[0] * ab[0] + ab[1] * ab[1]
    const t = ab2 < 1e-12 ? 0 : clamp((ap[0] * ab[0] + ap[1] * ab[1]) / ab2, 0, 1)
    const p: [number, number] = [a[0] + t * ab[0], a[1] + t * ab[1]]
    const d = haversineMeters(click, p)
    if (d < bestDist) {
      bestDist = d
      best = { insertAfter: i, point: p }
    }
  }
  if (!best || bestDist > 70) return null
  return { ...best, distM: bestDist }
}

function computePathLengthStatic(geometry: [number, number][]) {
  let length = 0
  for (let i = 1; i < geometry.length; i += 1) length += haversineMeters(geometry[i - 1], geometry[i])
  return length
}

function polylineLengthMeters(points: [number, number][]): number {
  let length = 0
  for (let i = 1; i < points.length; i += 1) length += haversineMeters(points[i - 1], points[i])
  return length
}

function formatLengthMeters(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} км`
  return `${Math.round(m)} м`
}

/** Рисование изгиба: зажать на линии и потянуть (вставка + перетаскивание до отпускания). */
function LineBendDragLayer({
  edge,
  enabled,
  onSaved,
}: {
  edge: EdgeEntity
  enabled: boolean
  onSaved: () => void
}) {
  const map = useMap()
  const [geo, setGeo] = useState<[number, number][]>(() => [...edge.geometry] as [number, number][])
  const geoRef = useRef(geo)
  geoRef.current = geo

  useEffect(() => {
    if (enabled) setGeo([...edge.geometry] as [number, number][])
  }, [edge.id, enabled, edge.geometry])

  const color = edge.type === 'OPTOVOLOKNO' ? opticalLineStrokeColor(edge) : '#5d4037'
  const lineClass =
    edge.type === 'OPTOVOLOKNO' && normalizeFiberStatus(edge.cable_status) === 'ACCIDENT'
      ? 'map-edge-line map-edge-line--accident'
      : 'map-edge-line'

  const onMouseDown = useCallback(
    (e: LeafletMouseEvent) => {
      if (!enabled) return
      L.DomEvent.stopPropagation(e.originalEvent)
      L.DomEvent.preventDefault(e.originalEvent)
      const hit = closestPointOnPolyline(geoRef.current, [e.latlng.lat, e.latlng.lng])
      if (!hit) return
      const insertIdx = hit.insertAfter + 1
      const base = [...geoRef.current]
      base.splice(insertIdx, 0, hit.point)
      setGeo(base)
      geoRef.current = base
      let idx = insertIdx
      const el = map.getContainer()
      const onMove = (ev: MouseEvent) => {
        const ll = map.mouseEventToLatLng(ev)
        setGeo((prev) => {
          const copy = [...prev]
          if (idx <= 0 || idx >= copy.length - 1) return prev
          copy[idx] = [ll.lat, ll.lng]
          geoRef.current = copy
          return copy
        })
      }
      const onUp = async () => {
        el.removeEventListener('mousemove', onMove)
        el.removeEventListener('mouseup', onUp)
        const final = geoRef.current
        if (final.length < 2) return
        try {
          await jsonFetch<EdgeEntity>(`${API}/edges/${edge.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ geometry: final, length_m: computePathLengthStatic(final) }),
          })
          onSaved()
        } catch (err) {
          window.alert(err instanceof Error ? err.message : 'Ошибка сохранения изгиба')
        }
      }
      el.addEventListener('mousemove', onMove)
      el.addEventListener('mouseup', onUp)
    },
    [edge.id, enabled, map, onSaved],
  )

  if (!enabled) return null

  return (
    <>
      <Polyline
        positions={geo as LatLngExpression[]}
        pathOptions={{
          color,
          weight: edge.type === 'OPTOVOLOKNO' && normalizeFiberStatus(edge.cable_status) === 'ACCIDENT' ? 6 : 4,
          interactive: false,
          className: lineClass,
        }}
      />
      <Polyline
        positions={geo as LatLngExpression[]}
        pathOptions={{ opacity: 0, weight: 28, interactive: true, className: 'bend-hit-line' }}
        eventHandlers={{ mousedown: onMouseDown }}
      />
    </>
  )
}

function MapViewPersist({ enabled }: { enabled: boolean }) {
  useMapEvents({
    moveend: (e) => {
      if (!enabled) return
      const c = e.target.getCenter()
      saveMapViewToStorage([c.lat, c.lng], e.target.getZoom())
    },
  })
  return null
}

function App() {
  const fiberTotalDatalistId = `opt-total-${useId().replace(/:/g, '')}`
  const fiberUsedDatalistId = `opt-used-${useId().replace(/:/g, '')}`
  const initialPrefs = useMemo(() => loadUserPrefs(), [])
  const [prefs, setPrefs] = useState<UserPrefs>(initialPrefs)
  const patchPrefs = useCallback((patch: UserPrefsPatch) => {
    setPrefs((prev) => {
      const next = mergeUserPrefs(prev, patch)
      saveUserPrefs(next)
      return next
    })
  }, [])
  const [activityLog, setActivityLog] = useState(() => loadActivityLog())
  const [appVersion, setAppVersion] = useState('—')
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([])
  const [workspaceSelect, setWorkspaceSelect] = useState('')
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const lastActivityRef = useRef(Date.now())
  const syncRevisionRef = useRef(0)
  const passportEditUpdatedAtRef = useRef<string | undefined>(undefined)
  const [remoteSyncPending, setRemoteSyncPending] = useState(false)
  const [isMapDragging, setIsMapDragging] = useState(false)
  const isMapDraggingRef = useRef(false)
  const [projects, setProjects] = useState<Project[]>([])
  const {
    nodes,
    setNodes,
    edges,
    setEdges,
    mapTruncated,
    useBboxLoad,
    viewportLoading,
    summary: mapSummary,
    loadInitial: loadMapViewport,
    refreshMapLight,
    remoteApi,
    scheduleBoundsSettled,
    forceBoundsReload,
    fetchMapNode,
    fetchMapEdge,
    mapZoomRef,
  } = useMapViewport(API, jsonFetch, prefs.map.bboxLoadWhenLarge, prefs.map.tkDetailZoom ?? TK_DETAIL_ZOOM)
  const detailZoom = prefs.map.tkDetailZoom ?? TK_DETAIL_ZOOM
  const nodesCanvasLayerRef = useRef<import('./map/NodesCanvasLayer').NodesCanvasLayer | null>(null)
  const edgesCanvasLayerRef = useRef<import('./map/EdgesCanvasLayer').EdgesCanvasLayer | null>(null)
  const [fiberOrders, setFiberOrders] = useState<FiberOrder[]>([])
  const [activeTool, setActiveTool] = useState<ToolType>('SELECT')
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(initialPrefs.workflow.defaultProjectId)
  const [edgeDraft, setEdgeDraft] = useState<{ startNode: NodeEntity; bends: [number, number][]; edgeType: EdgeType } | null>(null)
  /** Позиция курсора на карте: пунктир «хвост» черновика ВОЛС/канализации до завершения. */
  const [edgeDraftPreviewPos, setEdgeDraftPreviewPos] = useState<[number, number] | null>(null)
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([])
  const [measurePreviewPos, setMeasurePreviewPos] = useState<[number, number] | null>(null)
  const [activeLayers, setActiveLayers] = useState({
    kanal: initialPrefs.map.layersKanal,
    vols: initialPrefs.map.layersVols,
  })
  const [selectedObject, setSelectedObject] = useState<SelectedObject>(null)
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [showCableModal, setShowCableModal] = useState(false)
  const [showKanalLinkModal, setShowKanalLinkModal] = useState(false)
  const [queuedEndNode, setQueuedEndNode] = useState<NodeEntity | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [projectFilterId, setProjectFilterId] = useState<number | null>(null)
  const [dbCategory, setDbCategory] = useState<DbEntityCategory>('projects')
  const [dbFiberStatusFilter, setDbFiberStatusFilter] = useState<GisFiberStatus | 'ALL'>('ALL')
  const [dbSearch, setDbSearch] = useState('')
  const [mapHighlight, setMapHighlight] = useState<{ kind: 'node' | 'edge' | 'project'; id: number } | null>(null)
  const [mapFlyPending, setMapFlyPending] = useState<MapFlyPayload | null>(null)
  const [importJsonText, setImportJsonText] = useState('')
  const mapRef = useRef<L.Map | null>(null)
  const globalSearchRef = useRef<HTMLDivElement>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchActiveIdx, setGlobalSearchActiveIdx] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [moveTarget, setMoveTarget] = useState<{ kind: 'node' | 'edge'; id: number } | null>(null)
  const [activeShellTab, setActiveShellTab] = useState<ShellTab>(() => {
    const t = initialPrefs.workflow.startupTab
    return t === 'last' ? initialPrefs.workflow.lastActiveTab : t
  })
  const [spliceOpticalNodeId, setSpliceOpticalNodeId] = useState<number | null>(null)
  const [backupConfig, setBackupConfig] = useState<BackupConfig>({ enabled: false, intervalMinutes: 60, maxBackups: 30 })
  const [backupList, setBackupList] = useState<BackupEntry[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const initialMapZoom =
    initialPrefs.map.rememberLastView && initialPrefs.map.lastZoom != null
      ? initialPrefs.map.lastZoom
      : initialPrefs.map.defaultZoom
  const [mapZoom, setMapZoom] = useState(initialMapZoom)
  const mapZoomTier = Math.floor(mapZoom)

  useEffect(() => {
    mapZoomRef.current = mapZoom
  }, [mapZoom, mapZoomRef])
  const [lineBendEdgeId, setLineBendEdgeId] = useState<number | null>(null)
  const [showRoutePanel, setShowRoutePanel] = useState(initialPrefs.workflow.showRoutePanel)
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number | null>(null)
  const [showFiberOrderModal, setShowFiberOrderModal] = useState(false)
  const [fiberOrderName, setFiberOrderName] = useState('')
  const [fiberOrderDescription, setFiberOrderDescription] = useState('')
  const [fiberOrderFiberCount, setFiberOrderFiberCount] = useState('1')
  const [fiberOrderBitrixDealId, setFiberOrderBitrixDealId] = useState('')
  const [selectedFiberOrder, setSelectedFiberOrder] = useState<FiberOrder | null>(null)
  const [routeReserveFibers, setRouteReserveFibers] = useState(initialPrefs.workflow.routeReserveFibers)
  const [cableName, setCableName] = useState('')
  const [totalFibers, setTotalFibers] = useState(initialPrefs.cableDefaults.totalFibers)
  const [usedFibers, setUsedFibers] = useState(initialPrefs.cableDefaults.usedFibers)
  const [newCableStatus, setNewCableStatus] = useState<FiberCableStatus>(initialPrefs.cableDefaults.cableStatus)
  const [routeFromId, setRouteFromId] = useState<number | null>(null)
  const [routeToId, setRouteToId] = useState<number | null>(null)
  const [requiredFreeFibers, setRequiredFreeFibers] = useState(initialPrefs.workflow.requiredFreeFibers)
  const [routes, setRoutes] = useState<RoutesResponse['routes']>([])
  const [activeRouteEdgeIds, setActiveRouteEdgeIds] = useState<number[]>([])
  const [fiberTraceEdgeIds, setFiberTraceEdgeIds] = useState<number[]>([])
  const [hideMapLabels, setHideMapLabels] = useState(initialPrefs.map.hideMapLabels)
  const [basemap, setBasemap] = useState<BasemapMode>(initialPrefs.map.basemap)
  const mapCenter = useMemo((): [number, number] => {
    if (initialPrefs.map.rememberLastView && initialPrefs.map.lastCenter) return initialPrefs.map.lastCenter
    return [55.751244, 37.618423]
  }, [])
  const [showCreateNodeModal, setShowCreateNodeModal] = useState(false)
  const [pendingNode, setPendingNode] = useState<{ type: NodeType; coords: [number, number]; tkId?: number | null } | null>(null)
  const [pendingNodeName, setPendingNodeName] = useState('')
  const [pendingCrossPorts, setPendingCrossPorts] = useState(8)

  const [authPhase, setAuthPhase] = useState<'loading' | 'guest' | 'user'>('loading')
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [regPassword2, setRegPassword2] = useState('')
  const [authPanel, setAuthPanel] = useState<'login' | 'register'>('login')
  const [desktopApiUrl, setDesktopApiUrl] = useState(() => {
    const saved = getApiBaseOverride()
    if (saved) return saved
    const cur = getApiBase()
    return cur === 'http://localhost:4000' ? '' : cur
  })
  const [desktopApiCheck, setDesktopApiCheck] = useState<string | null>(null)
  const [usersList, setUsersList] = useState<UserRow[]>([])
  const [postAuthEmbedMap, setPostAuthEmbedMap] = useState<AuthMeResponse['embed']>(undefined)

  const themeMode: ThemeMode = resolveTheme(prefs.theme)
  const canEdit = canEditData(authUser?.role)
  const canImportData = canImportExportDatabase(authUser?.role)
  const isAdmin = authUser?.role === 'ADMIN'

  const logActivity = useCallback(
    (action: string) => {
      if (!authUser) return
      pushActivityLog(authUser.username, action)
      setActivityLog(loadActivityLog())
    },
    [authUser],
  )

  const confirmDelete = useCallback(
    (kind: 'node' | 'edge' | 'project', message: string) => {
      const mode: DeleteConfirmMode = prefs.workflow.deleteConfirm
      if (mode === 'never') return true
      if (mode === 'edges_only' && kind === 'node') return true
      return window.confirm(message)
    },
    [prefs.workflow.deleteConfirm],
  )

  const syncMapPrefs = useCallback(
    (patch: UserPrefsPatch['map']) => {
      patchPrefs({ map: patch })
    },
    [patchPrefs],
  )

  const applyCableDefaults = useCallback(() => {
    const seq = nextCableSequence(edges)
    const proj = projects.find((p) => p.id === selectedProjectId)
    setCableName(applyCableNameTemplate(prefs.cableDefaults.nameTemplate, seq, proj?.name))
    setTotalFibers(prefs.cableDefaults.totalFibers)
    setUsedFibers(prefs.cableDefaults.usedFibers)
    setNewCableStatus(prefs.cableDefaults.cableStatus)
  }, [edges, prefs.cableDefaults, projects, selectedProjectId])

  const computePathLength = (geometry: [number, number][]) => computePathLengthStatic(geometry)

  useEffect(() => {
    if (!edgeDraft) setEdgeDraftPreviewPos(null)
  }, [edgeDraft])

  const clearMeasure = useCallback(() => {
    setMeasurePoints([])
    setMeasurePreviewPos(null)
  }, [])

  const clearEdgeDraft = useCallback(() => {
    setEdgeDraft(null)
    setEdgeDraftPreviewPos(null)
    setQueuedEndNode(null)
  }, [])

  const selectMapTool = useCallback(
    (tool: ToolType) => {
      if (!canEdit && tool !== 'SELECT' && tool !== 'MEASURE') return
      if (tool !== 'MEASURE') clearMeasure()
      if (tool !== 'KANALIZACIYA' && tool !== 'OPTOVOLOKNO') clearEdgeDraft()
      setActiveTool(tool)
    },
    [canEdit, clearMeasure, clearEdgeDraft],
  )

  useEffect(() => {
    if (!canEdit && activeTool !== 'SELECT' && activeTool !== 'MEASURE') setActiveTool('SELECT')
  }, [canEdit, activeTool])

  useEffect(() => {
    if (activeShellTab !== 'map') clearMeasure()
  }, [activeShellTab, clearMeasure])

  useEffect(() => {
    if (activeTool !== 'MEASURE') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearMeasure()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTool, clearMeasure])

  useEffect(() => {
    if (!edgeDraft) return
    if (activeTool !== 'KANALIZACIYA' && activeTool !== 'OPTOVOLOKNO') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearEdgeDraft()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTool, edgeDraft, clearEdgeDraft])

  const measureLengthTotal = useMemo(() => {
    const pts = [...measurePoints]
    if (measurePreviewPos && pts.length) pts.push(measurePreviewPos)
    return polylineLengthMeters(pts)
  }, [measurePoints, measurePreviewPos])

  const handleMapBoundsSettled = useCallback(
    (bounds: L.LatLngBounds, zoom: number) => {
      scheduleBoundsSettled(bounds, zoom)
    },
    [scheduleBoundsSettled],
  )

  const handleMapDragStart = useCallback(() => {
    isMapDraggingRef.current = true
    setIsMapDragging(true)
  }, [])

  const handleMapDragEnd = useCallback(() => {
    isMapDraggingRef.current = false
    setIsMapDragging(false)
  }, [])

  const refreshLists = useCallback(async () => {
    const [fo, pr] = await Promise.all([
      jsonFetch<FiberOrder[]>(`${API}/fiber-orders`),
      jsonFetch<Project[]>(`${API}/projects`),
    ])
    setFiberOrders(fo)
    setProjects(pr)
  }, [])

  const loadAll = async () => {
    await refreshLists()
    await loadMapViewport()
  }

  const refreshDataLight = useCallback(async () => {
    await refreshLists()
    if (useBboxLoad) await refreshMapLight()
    else await loadMapViewport()
  }, [refreshLists, refreshMapLight, useBboxLoad, loadMapViewport])

  useEffect(() => {
    let cancelled = false
    if (typeof window !== 'undefined') {
      const h = window.location.hash || ''
      if (h.startsWith('#embed=')) {
        const raw = h.slice('#embed='.length)
        try {
          const token = decodeURIComponent(raw)
          if (token) sessionStorage.setItem(EMBED_TOKEN_KEY, token)
        } catch {
          /* ignore malformed hash */
        }
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#map`)
      }
    }
    const run = async () => {
      const bearer = typeof window !== 'undefined' ? getBearerContext() : null
      if (!bearer) {
        if (!cancelled) setAuthPhase('guest')
        return
      }
      try {
        const data = await jsonFetch<AuthMeResponse>(`${API}/auth/me`)
        if (cancelled) return
        if (data.user) {
          setAuthUser(data.user)
          const emb = data.user.embed && data.embed ? data.embed : undefined
          const hasHighlight =
            emb &&
            (emb.highlightEdgeId != null ||
              emb.highlightNodeId != null ||
              emb.highlightProjectId != null)
          setPostAuthEmbedMap(hasHighlight ? emb : undefined)
          setAuthPhase('user')
        } else {
          sessionStorage.removeItem(EMBED_TOKEN_KEY)
          localStorage.removeItem(AUTH_TOKEN_KEY)
          setAuthUser(null)
          setPostAuthEmbedMap(undefined)
          setAuthPhase('guest')
        }
      } catch {
        if (!cancelled) {
          sessionStorage.removeItem(EMBED_TOKEN_KEY)
          localStorage.removeItem(AUTH_TOKEN_KEY)
          setAuthUser(null)
          setPostAuthEmbedMap(undefined)
          setAuthPhase('guest')
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (authPhase !== 'user' || !postAuthEmbedMap) return
    setActiveShellTab('map')
    const e = postAuthEmbedMap.highlightEdgeId
    const n = postAuthEmbedMap.highlightNodeId
    const p = postAuthEmbedMap.highlightProjectId
    if (e != null) {
      setMapHighlight({ kind: 'edge', id: e })
      setMapFlyPending({ kind: 'edge', id: e, smooth: true })
    } else if (n != null) {
      setMapHighlight({ kind: 'node', id: n })
      setMapFlyPending({ kind: 'node', id: n, smooth: true })
    } else if (p != null) {
      setMapHighlight({ kind: 'project', id: p })
      setMapFlyPending({ kind: 'project', id: p, smooth: true })
    }
    setPostAuthEmbedMap(undefined)
  }, [authPhase, postAuthEmbedMap])

  const refreshWorkspaces = useCallback(async () => {
    const data = await jsonFetch<{ workspaces: WorkspaceRow[]; active: WorkspaceRow }>(
      `${API}/database/workspaces/mine`,
    )
    setWorkspaces(data.workspaces)
    if (data.active) setWorkspaceSelect(data.active.name)
  }, [])

  useEffect(() => {
    if (authPhase !== 'user') return
    Promise.all([loadAll(), refreshWorkspaces()]).catch((error) => {
      window.alert(error instanceof Error ? error.message : String(error))
      if (!getBearerContext()) {
        setAuthUser(null)
        setAuthPhase('guest')
      }
    })
  }, [authPhase, refreshWorkspaces])

  useEffect(() => {
    if (activeTool !== 'SELECT') setSelectedObject(null)
  }, [activeTool])

  useEffect(() => {
    if (!selectedObject) {
      passportEditUpdatedAtRef.current = undefined
      return
    }
    if (selectedObject.kind === 'node' || selectedObject.kind === 'edge' || selectedObject.kind === 'project') {
      passportEditUpdatedAtRef.current = selectedObject.data.updated_at
    }
  }, [selectedObject])

  const syncPaused =
    showProjectModal ||
    showCableModal ||
    showKanalLinkModal ||
    showCreateNodeModal ||
    showFiberOrderModal ||
    edgeDraft != null ||
    isMapDragging

  useEffect(() => {
    if (authPhase !== 'user' || activeShellTab !== 'map') return
    const intervalMs = Math.max(8000, Math.min(60000, (prefs.workflow.syncPollIntervalSec ?? 12) * 1000))
    const tick = async () => {
      if (document.hidden || syncPaused || isMapDraggingRef.current) return
      try {
        const summary = await jsonFetch<{ revision: number }>(`${API}/sync/summary`)
        if (syncRevisionRef.current === 0) {
          syncRevisionRef.current = summary.revision
          return
        }
        if (summary.revision !== syncRevisionRef.current) {
          if (!selectedObject) {
            syncRevisionRef.current = summary.revision
            setRemoteSyncPending(false)
            await refreshDataLight()
          } else {
            setRemoteSyncPending(true)
          }
        }
      } catch {
        /* ignore poll errors */
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), intervalMs)
    return () => window.clearInterval(timer)
  }, [
    authPhase,
    activeShellTab,
    syncPaused,
    selectedObject,
    prefs.workflow.syncPollIntervalSec,
    refreshDataLight,
    useBboxLoad,
  ])

  const applyRemoteSync = async () => {
    try {
      const summary = await jsonFetch<{ revision: number }>(`${API}/sync/summary`)
      syncRevisionRef.current = summary.revision
      setRemoteSyncPending(false)
      await refreshDataLight()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Не удалось обновить данные')
    }
  }

  useEffect(() => {
    const closeMenu = () => setContextMenu(null)
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    document.documentElement.dataset.density = prefs.uiDensity
  }, [themeMode, prefs.uiDensity])

  useEffect(() => {
    if (prefs.theme !== 'auto' || typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      document.documentElement.dataset.theme = resolveTheme('auto')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [prefs.theme])

  useEffect(() => {
    if (authPhase !== 'user') return
    void jsonFetch<{ version?: string }>(`${API}/health`)
      .then((h) => setAppVersion(h.version ?? '—'))
      .catch(() => setAppVersion('—'))
  }, [authPhase])

  useEffect(() => {
    const touch = () => {
      lastActivityRef.current = Date.now()
    }
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    return () => {
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
    }
  }, [])

  useEffect(() => {
    if (authUser?.embed && activeShellTab !== 'map') setActiveShellTab('map')
  }, [authUser?.embed, activeShellTab])

  useEffect(() => {
    if (authPhase !== 'user' || prefs.workflow.startupTab !== 'last') return
    patchPrefs({ workflow: { lastActiveTab: activeShellTab } })
  }, [activeShellTab, authPhase, prefs.workflow.startupTab, patchPrefs])

  useEffect(() => {
    setBasemap(prefs.map.basemap)
    setHideMapLabels(prefs.map.hideMapLabels)
    setActiveLayers({ kanal: prefs.map.layersKanal, vols: prefs.map.layersVols })
    setShowRoutePanel(prefs.workflow.showRoutePanel)
    setRequiredFreeFibers(prefs.workflow.requiredFreeFibers)
    setRouteReserveFibers(prefs.workflow.routeReserveFibers)
  }, [
    prefs.map.basemap,
    prefs.map.hideMapLabels,
    prefs.map.layersKanal,
    prefs.map.layersVols,
    prefs.workflow.showRoutePanel,
    prefs.workflow.requiredFreeFibers,
    prefs.workflow.routeReserveFibers,
  ])

  const loadBackupsPanel = async () => {
    try {
      const data = await jsonFetch<{ config: BackupConfig; backups: BackupEntry[] }>(`${API}/backups`)
      setBackupConfig(data.config)
      setBackupList(data.backups)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Не удалось загрузить резервные копии')
    }
  }

  useEffect(() => {
    if (authPhase !== 'user' || activeShellTab !== 'settings') return
    loadBackupsPanel()
  }, [authPhase, activeShellTab])

  useEffect(() => {
    if (!mapFlyPending) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const map = mapRef.current
        if (!map || cancelled) {
          if (!cancelled) setMapFlyPending(null)
          return
        }
        const { kind, id, smooth } = mapFlyPending
        const mult = flyDurationMultiplier(prefs.map.flySpeed)
        const useSmooth = smooth ?? prefs.map.smoothFly
        const dur = (useSmooth ? 1.45 : 1.15) * mult
        const ease = useSmooth ? 0.2 : 0.25

        const afterFly = () => {
          if (useBboxLoad) {
            const b = map.getBounds()
            forceBoundsReload(b, map.getZoom())
          }
        }

        if (kind === 'node') {
          let n = nodes.find((x) => x.id === id)
          if (!n) n = (await fetchMapNode(id)) ?? undefined
          if (!n) {
            window.alert('Узел не найден на карте.')
            setMapFlyPending(null)
            return
          }
          map.flyTo([n.lat, n.lng], Math.max(map.getZoom(), 16), { duration: dur, easeLinearity: ease })
          map.once('moveend', afterFly)
        } else if (kind === 'edge') {
          let e = edges.find((x) => x.id === id)
          if (!e) e = (await fetchMapEdge(id)) ?? undefined
          if (e?.geometry?.length) {
            const ll = e.geometry.map(([la, ln]) => L.latLng(la, ln))
            map.flyToBounds(L.latLngBounds(ll), { padding: [56, 56], maxZoom: 17, duration: useSmooth ? 1.5 : 1.2, easeLinearity: ease })
            map.once('moveend', afterFly)
          } else {
            window.alert('Участок не найден или без геометрии.')
          }
        } else if (kind === 'project') {
          let pe = edges.filter((x) => x.project_id === id)
          if (!pe.length && useBboxLoad) {
            const data = await jsonFetch<EdgeEntity[] | { items: EdgeEntity[] }>(
              `${API}/edges?type=OPTOVOLOKNO&limit=500&page=1`,
            )
            const list = Array.isArray(data) ? data : (data.items ?? [])
            pe = list.filter((x) => x.project_id === id)
            if (pe.length) setEdges((prev) => {
              const mapById = new Map(prev.map((x) => [x.id, x]))
              for (const edge of pe) mapById.set(edge.id, edge)
              return [...mapById.values()]
            })
          }
          const pts: L.LatLng[] = []
          for (const edge of pe) {
            for (const [la, ln] of edge.geometry ?? []) pts.push(L.latLng(la, ln))
          }
          const pn = new Set<number>()
          for (const edge of pe) {
            pn.add(edge.start_node_id)
            pn.add(edge.end_node_id)
          }
          for (const nid of pn) {
            let n = nodes.find((x) => x.id === nid)
            if (!n) n = (await fetchMapNode(nid)) ?? undefined
            if (n) pts.push(L.latLng(n.lat, n.lng))
          }
          if (pts.length) {
            map.flyToBounds(L.latLngBounds(pts), {
              padding: [64, 64],
              maxZoom: 16,
              duration: useSmooth ? 1.55 : 1.25,
              easeLinearity: ease,
            })
            map.once('moveend', afterFly)
          } else {
            window.alert('У проекта нет участков на карте — нечего показать.')
          }
        }
        if (!cancelled) setMapFlyPending(null)
      })()
    }, 320)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    mapFlyPending,
    nodes,
    edges,
    prefs.map.flySpeed,
    prefs.map.smoothFly,
    useBboxLoad,
    fetchMapNode,
    fetchMapEdge,
    forceBoundsReload,
  ])

  useEffect(() => {
    if (!mapHighlight || authUser?.embed) return
    const t = window.setTimeout(() => setMapHighlight(null), 12000)
    return () => clearTimeout(t)
  }, [mapHighlight, authUser?.embed])

  useEffect(() => {
    if (!spliceOpticalNodeId) return
    const n = nodes.find((x) => x.id === spliceOpticalNodeId)
    if (!n) void fetchMapNode(spliceOpticalNodeId)
  }, [spliceOpticalNodeId, nodes, fetchMapNode])

  const mapDisplayNodes = useMemo(() => {
    let list = nodes.filter((n) => isDetailNodeType(n.type))
    if (prefs.map.layerTkOnly) list = list.filter((n) => n.type === 'TK')
    if (prefs.map.layerTodayOnly) {
      const today = new Date().toISOString().slice(0, 10)
      list = list.filter((n) => (n.created_at ?? '').slice(0, 10) === today)
    }
    return list
  }, [nodes, prefs.map.layerTkOnly, prefs.map.layerTodayOnly])

  const edgesForCanvas = useMemo(() => {
    const visibleIds = new Set(
      edges
        .filter((edge) => {
          if (!activeLayers.kanal && edge.type === 'KANALIZACIYA') return false
          if (!activeLayers.vols && edge.type === 'OPTOVOLOKNO') return false
          if (projectFilterId && edge.project_id != null && edge.project_id !== projectFilterId) return false
          return true
        })
        .map((e) => e.id),
    )
    const traceExtras =
      fiberTraceEdgeIds.length === 0
        ? []
        : edges.filter(
            (e) => e.type === 'OPTOVOLOKNO' && fiberTraceEdgeIds.includes(e.id) && !visibleIds.has(e.id),
          )
    const merged =
      traceExtras.length === 0
        ? edges.filter((e) => visibleIds.has(e.id))
        : [...edges.filter((e) => visibleIds.has(e.id)), ...traceExtras]
    return merged.filter((e) => e.id !== lineBendEdgeId)
  }, [edges, activeLayers, projectFilterId, fiberTraceEdgeIds, lineBendEdgeId])

  /** Маркеры — фиксированный размер в px; кластеры отключены (смещают «центр» точки). */
  const effectiveCluster = false

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  useEffect(() => {
    if (activeShellTab !== 'map') return
    const map = mapRef.current
    if (!map) return
    window.setTimeout(() => map.invalidateSize({ animate: false }), 0)
  }, [activeShellTab])

  const createNode = async (coords: [number, number], nodeType: NodeType) => {
    const tkForMufta = nodeType === 'MUFTA' ? nearestNode(nodes, coords, ['TK']) : null
    if (nodeType === 'MUFTA' && !tkForMufta) return window.alert('Муфта может быть создана только на ТК: кликните рядом с колодцем.')

    const suggested = `${nodeType}-${Date.now().toString().slice(-4)}`
    setPendingNode({ type: nodeType, coords, tkId: tkForMufta?.id ?? null })
    setPendingNodeName(suggested)
    if (nodeType === 'KROSS') setPendingCrossPorts(8)
    setShowCreateNodeModal(true)
  }

  const confirmCreateNode = async () => {
    if (!pendingNode) return
    const tk = pendingNode.type === 'MUFTA' ? nodes.find((n) => n.id === pendingNode.tkId) ?? null : null
    const crossPorts =
      pendingNode.type === 'KROSS'
        ? Math.min(288, Math.max(1, Math.floor(Number.isFinite(pendingCrossPorts) ? pendingCrossPorts : 8)))
        : null
    const payload = {
      type: pendingNode.type,
      name: pendingNodeName.trim() || `${pendingNode.type}-${Date.now().toString().slice(-4)}`,
      lat: tk ? tk.lat : pendingNode.coords[0],
      lng: tk ? tk.lng : pendingNode.coords[1],
      parent_tk_id: tk ? tk.id : null,
      passport_data: pendingNode.type === 'KROSS' && crossPorts != null ? { cross_ports: crossPorts } : {},
    }
    const created = await jsonFetch<NodeEntity>(`${API}/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (pendingNode.type === 'MUFTA' && tk) await loadAll()
    else setNodes((prev) => [created, ...prev])
    setShowCreateNodeModal(false)
    setPendingNode(null)
    setPendingNodeName('')
    setPendingCrossPorts(8)
  }

  const saveEdge = async (
    start: NodeEntity,
    bends: [number, number][],
    end: NodeEntity,
    projectId: number | null,
    edgeType: EdgeType,
    opticalMeta?: { cable_name: string; total_fibers: number; used_fibers: number; cable_status?: FiberCableStatus },
  ) => {
    const geometry: [number, number][] = [[start.lat, start.lng], ...bends, [end.lat, end.lng]]
    const payload = {
      type: edgeType,
      start_node_id: start.id,
      end_node_id: end.id,
      length_m: Math.max(computePathLength(geometry), 0.001),
      geometry,
      project_id: projectId,
      cable_name: opticalMeta?.cable_name ?? null,
      total_fibers: opticalMeta?.total_fibers ?? null,
      used_fibers: opticalMeta?.used_fibers ?? null,
      cable_status: edgeType === 'OPTOVOLOKNO' ? opticalMeta?.cable_status ?? 'READY' : null,
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
    const toolEdgeType: EdgeType = activeTool === 'KANALIZACIYA' ? 'KANALIZACIYA' : 'OPTOVOLOKNO'

    if (!edgeDraft) {
      if (toolEdgeType === 'OPTOVOLOKNO') {
        const m = nearestNode(nodes, coords, ['MUFTA', 'KROSS'])
        if (!m) return window.alert('Оптика начинается от муфты или кросса: кликните по узлу.')
        setEdgeDraft({ startNode: m, bends: [], edgeType: 'OPTOVOLOKNO' })
        return
      }
      const tk = nearestNode(nodes, coords, ['TK'])
      if (!tk) return window.alert('Канализация начинается от ТК: кликните по колодцу.')
      setEdgeDraft({ startNode: tk, bends: [], edgeType: 'KANALIZACIYA' })
      return
    }

    if (edgeDraft.edgeType === 'OPTOVOLOKNO') {
      const snappedEnd = nearestOpticalEndpoint(nodes, coords, { excludeId: edgeDraft.startNode.id })
      if (!snappedEnd) {
        setEdgeDraft((prev) => (prev ? { ...prev, bends: [...prev.bends, coords] } : prev))
        return
      }
      if (edgeDraft.startNode.id === snappedEnd.id) return window.alert('Конечный узел (муфта/кросс) должен отличаться от начального.')
      setQueuedEndNode(snappedEnd)
      setSelectedProjectId((prev) => prev ?? prefs.workflow.defaultProjectId ?? projects[0]?.id ?? null)
      applyCableDefaults()
      setShowCableModal(true)
      return
    }

    const snappedTk = nearestNode(nodes, coords, ['TK'])
    if (!snappedTk) {
      setEdgeDraft((prev) => (prev ? { ...prev, bends: [...prev.bends, coords] } : prev))
      return
    }
    if (edgeDraft.startNode.id === snappedTk.id) return window.alert('Конечный ТК должен отличаться от начального.')
    await saveEdge(edgeDraft.startNode, edgeDraft.bends, snappedTk, null, 'KANALIZACIYA')
    setEdgeDraft({ startNode: snappedTk, bends: [], edgeType: 'KANALIZACIYA' })
  }

  const routeEndpointNodes = useMemo(
    () => nodes.filter((node) => node.type === 'MUFTA' || node.type === 'KROSS'),
    [nodes],
  )

  const dbSelectedId = useMemo(() => {
    if (!selectedObject) return null
    return { kind: selectedObject.kind, id: selectedObject.data.id } as const
  }, [selectedObject])

  const [globalSearchHits, setGlobalSearchHits] = useState<GlobalSearchHit[]>([])

  useEffect(() => {
    const raw = globalSearch.trim()
    if (raw.length < 1) {
      setGlobalSearchHits([])
      return
    }
    const q = raw.toLowerCase()
    const qNum = Number(raw)
    const idExact = Number.isFinite(qNum) && String(qNum) === raw.trim()
    const ac = new AbortController()
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const [nRaw, eRaw] = await Promise.all([
            jsonFetch<NodeEntity[] | { items: NodeEntity[] }>(
              `${API}/nodes?q=${encodeURIComponent(raw)}&limit=32`,
              { signal: ac.signal },
            ),
            jsonFetch<EdgeEntity[] | { items: EdgeEntity[] }>(
              `${API}/edges?q=${encodeURIComponent(raw)}&limit=32`,
              { signal: ac.signal },
            ),
          ])
          const nodeItems = Array.isArray(nRaw) ? nRaw : nRaw.items
          const edgeItems = Array.isArray(eRaw) ? eRaw : eRaw.items
          const out: GlobalSearchHit[] = []
          const push = (h: GlobalSearchHit) => {
            if (out.length >= 32) return
            out.push(h)
          }
          for (const n of nodeItems) {
            push({ kind: 'node', id: n.id, label: `${n.type} · ${n.name}`, sub: `Узел · id ${n.id}` })
          }
          for (const e of edgeItems) {
            const isOpt = e.type === 'OPTOVOLOKNO'
            push({
              kind: 'edge',
              id: e.id,
              label: isOpt ? e.cable_name || `ВОЛС #${e.id}` : `Канализация #${e.id}`,
              sub: `${e.start_node_name} → ${e.end_node_name} · ${Math.round(e.length_m)} м`,
            })
          }
          for (const p of projects) {
            const blob = `${p.name} ${p.description || ''} ${p.id}`.toLowerCase()
            if (!blob.includes(q) && !(idExact && p.id === qNum)) continue
            push({ kind: 'project', id: p.id, label: p.name, sub: `Проект · id ${p.id}` })
          }
          const rank = (h: GlobalSearchHit) => {
            if (idExact && h.id === qNum) return 0
            const lab = h.label.toLowerCase()
            if (lab === q) return 1
            if (lab.startsWith(q)) return 2
            return 3
          }
          out.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'ru'))
          if (!ac.signal.aborted) setGlobalSearchHits(out)
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return
        }
      })()
    }, 220)
    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [globalSearch, projects])

  useEffect(() => {
    setGlobalSearchActiveIdx(0)
  }, [globalSearch])

  useEffect(() => {
    setGlobalSearchActiveIdx((i) =>
      globalSearchHits.length === 0 ? 0 : Math.min(i, globalSearchHits.length - 1)
    )
  }, [globalSearchHits])

  useEffect(() => {
    if (!globalSearchOpen) return
    const onDoc = (e: MouseEvent) => {
      const el = globalSearchRef.current
      if (el && !el.contains(e.target as Node)) setGlobalSearchOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [globalSearchOpen])

  const removeNode = async (nodeId: number) => {
    if (!confirmDelete('node', 'Удалить объект?')) return
    await jsonFetch<void>(`${API}/nodes/${nodeId}`, { method: 'DELETE' })
    await loadAll()
    setSelectedObject(null)
  }

  const removeEdge = async (edgeId: number) => {
    if (!confirmDelete('edge', 'Удалить кабель/участок?')) return
    await jsonFetch<void>(`${API}/edges/${edgeId}`, { method: 'DELETE' })
    await loadAll()
    setSelectedObject(null)
  }

  const removeProject = async (projectId: number) => {
    if (!confirmDelete('project', 'Удалить проект и все его участки?')) return
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
    const snapTypes: NodeType[] = edge.type === 'KANALIZACIYA' ? ['TK'] : ['MUFTA', 'KROSS']
    const startSnap = nearestNode(nodes, movedGeometry[0], snapTypes)
    const endSnap = nearestNode(nodes, movedGeometry[movedGeometry.length - 1], snapTypes)
    if (!startSnap || !endSnap) {
      return window.alert(
        edge.type === 'KANALIZACIYA'
          ? 'После перемещения начало и конец канализации должны оставаться на ТК.'
          : 'После перемещения начало и конец должны остаться на муфтах или кроссах.',
      )
    }

    const normalized: [number, number][] = [
      [startSnap.lat, startSnap.lng],
      ...movedGeometry.slice(1, movedGeometry.length - 1),
      [endSnap.lat, endSnap.lng],
    ]
    await jsonFetch<EdgeEntity>(`${API}/edges/${edge.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_node_id: startSnap.id,
        end_node_id: endSnap.id,
        geometry: normalized,
        length_m: computePathLength(normalized),
      }),
    })
    await loadAll()
  }

  const findRoutes = async () => {
    if (!routeFromId || !routeToId) return window.alert('Выберите точки A и B (муфта или кросс).')
    const required = Number(requiredFreeFibers || 1)
    const response = await jsonFetch<RoutesResponse>(
      `${API}/routes?start_node_id=${routeFromId}&end_node_id=${routeToId}&required_free_fibers=${required}`,
    )
    setRoutes(response.routes)
    const first = response.routes[0]
    if (first) {
      setSelectedRouteIndex(0)
      setFiberTraceEdgeIds([])
      setActiveRouteEdgeIds(first.edge_ids)
    } else {
      setSelectedRouteIndex(null)
      setActiveRouteEdgeIds([])
    }
  }

  const clearRouteView = () => {
    setActiveRouteEdgeIds([])
    setFiberTraceEdgeIds([])
    setSelectedRouteIndex(null)
    setRoutes([])
  }

  const showFiberRouteFromSplice = useCallback(
    (payload: { startNodeId: number; edgeId: number; fiberIndex: number }) => {
      const res = traceFiberLogicalRoute(
        payload.startNodeId,
        { edgeId: payload.edgeId, fiberIndex: payload.fiberIndex },
        nodes,
        edges,
      )
      if (!res.ok) {
        window.alert(res.message)
        return
      }
      setFiberTraceEdgeIds(res.orderedEdgeIds)
      setActiveRouteEdgeIds([])
      setMapHighlight(null)

      const pts: L.LatLng[] = []
      for (const id of res.orderedEdgeIds) {
        const e = edges.find((x) => x.id === id)
        if (e?.geometry) for (const [la, ln] of e.geometry) pts.push(L.latLng(la, ln))
      }
      for (const nid of res.orderedNodeIds) {
        const n = nodes.find((x) => x.id === nid)
        if (n) pts.push(L.latLng(n.lat, n.lng))
      }

      setActiveShellTab('map')
      window.setTimeout(() => {
        const map = mapRef.current
        if (!map || pts.length === 0) return
        map.fitBounds(L.latLngBounds(pts), { padding: [52, 52], maxZoom: 17 })
      }, 90)

      if (res.endKind === 'cycle') {
        window.alert('По данным связей маршрут замкнулся — проверьте схемы сварки на узлах.')
      }
    },
    [nodes, edges],
  )

  const reserveRouteFibers = async () => {
    const idx = selectedRouteIndex
    if (idx == null || !routes[idx]) return window.alert('Выберите маршрут из списка.')
    const n = Number(routeReserveFibers)
    if (!Number.isFinite(n) || n < 1) return window.alert('Введите целое число волокон ≥ 1.')
    const ids = routes[idx].edge_ids
    for (const id of ids) {
      const edge = edges.find((e) => e.id === id)
      if (!edge || edge.type !== 'OPTOVOLOKNO') continue
      const free = (edge.total_fibers ?? 0) - (edge.used_fibers ?? 0)
      if (free < n) return window.alert(`Недостаточно свободных волокон на участке «${edge.cable_name || id}». Свободно: ${free}, нужно: ${n}.`)
    }
    for (const id of ids) {
      const edge = edges.find((e) => e.id === id)
      if (!edge || edge.type !== 'OPTOVOLOKNO') continue
      const newUsed = (edge.used_fibers ?? 0) + n
      await jsonFetch(`${API}/edges/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ used_fibers: newUsed }),
      })
    }
    await loadAll()
    window.alert('Резерв волокон применён к участкам маршрута.')
  }

  const openFiberOrderModal = () => {
    const idx = selectedRouteIndex
    if (idx == null || !routes[idx]) return window.alert('Выберите маршрут в списке.')
    if (!routeFromId || !routeToId) return window.alert('Задайте узлы A и B (муфта или кросс).')
    setFiberOrderFiberCount(routeReserveFibers || requiredFreeFibers || '1')
    setFiberOrderBitrixDealId('')
    setShowFiberOrderModal(true)
  }

  const submitFiberOrder = async () => {
    const idx = selectedRouteIndex
    if (!routeFromId || !routeToId || idx == null || !routes[idx]) return window.alert('Нет выбранного маршрута.')
    if (!fiberOrderName.trim()) return window.alert('Введите название заказа.')
    const fc = Number(fiberOrderFiberCount)
    if (!Number.isFinite(fc) || fc < 1) return window.alert('Количество волокон должно быть целым числом ≥ 1.')
    let bitrixDealId: number | undefined
    const rawDeal = fiberOrderBitrixDealId.trim()
    if (rawDeal) {
      const n = Number(rawDeal)
      if (!Number.isInteger(n) || n < 1) return window.alert('ID сделки Bitrix — целое положительное число или пусто.')
      bitrixDealId = n
    }
    try {
      const created = await jsonFetch<FiberOrder>(`${API}/fiber-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fiberOrderName.trim(),
          description: fiberOrderDescription.trim(),
          fiber_count: fc,
          start_mufta_id: routeFromId,
          end_mufta_id: routeToId,
          edge_ids: routes[idx].edge_ids,
          total_length_m: routes[idx].total_length_m,
          ...(bitrixDealId != null ? { bitrix_deal_id: bitrixDealId } : {}),
        }),
      })
      await loadAll()
      setSelectedFiberOrder(created)
      setActiveShellTab('fiber_orders')
      setShowFiberOrderModal(false)
      setFiberOrderName('')
      setFiberOrderDescription('')
      setFiberOrderBitrixDealId('')
      window.alert('Заказ сохранён: волокна списаны на всех участках выбранного маршрута.')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Ошибка сохранения заказа')
    }
  }

  const handleNodeContextMenu = useCallback(
    (e: LeafletMouseEvent, node: NodeEntity) => {
      if (edgeDraft && (activeTool === 'OPTOVOLOKNO' || activeTool === 'KANALIZACIYA')) {
        e.originalEvent.preventDefault()
        setEdgeDraft((prev) => (prev ? { ...prev, bends: [...prev.bends, [node.lat, node.lng]] } : prev))
        return
      }
      setContextMenu({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, kind: 'node', id: node.id })
    },
    [edgeDraft, activeTool],
  )

  const handleEdgePolyContextMenu = useCallback(
    (e: LeafletMouseEvent, edge: EdgeEntity) => {
      if (edgeDraft && (activeTool === 'OPTOVOLOKNO' || activeTool === 'KANALIZACIYA')) {
        e.originalEvent.preventDefault()
        const ll = e.latlng
        setEdgeDraft((prev) => (prev ? { ...prev, bends: [...prev.bends, [ll.lat, ll.lng]] } : prev))
        return
      }
      setContextMenu({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, kind: 'edge', id: edge.id })
    },
    [edgeDraft, activeTool],
  )

  const MapClickHandler = () => {
    useMapEvents({
      click: async (event: LeafletMouseEvent) => {
        setContextMenu(null)
        if (lineBendEdgeId && !moveTarget) return
        const coords: [number, number] = [event.latlng.lat, event.latlng.lng]
        if (activeTool === 'MEASURE') {
          setMeasurePoints((prev) => [...prev, coords])
          return
        }
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
      dblclick: (event: LeafletMouseEvent) => {
        if (activeTool === 'MEASURE') {
          event.originalEvent.preventDefault()
          setMeasurePreviewPos(null)
        }
      },
      contextmenu: (event: LeafletMouseEvent) => {
        if (activeTool === 'MEASURE') {
          event.originalEvent.preventDefault()
          clearMeasure()
          return
        }
        if (lineBendEdgeId && !moveTarget) return
        if (!edgeDraft) return
        if (activeTool !== 'KANALIZACIYA' && activeTool !== 'OPTOVOLOKNO') return
        event.originalEvent.preventDefault()
        const coords: [number, number] = [event.latlng.lat, event.latlng.lng]
        setEdgeDraft((prev) => (prev ? { ...prev, bends: [...prev.bends, coords] } : prev))
      },
      mousemove: (event: LeafletMouseEvent) => {
        if (activeTool === 'MEASURE') {
          if (measurePoints.length) setMeasurePreviewPos([event.latlng.lat, event.latlng.lng])
          return
        }
        if (lineBendEdgeId && !moveTarget) return
        if (!edgeDraft) return
        if (activeTool !== 'KANALIZACIYA' && activeTool !== 'OPTOVOLOKNO') return
        setEdgeDraftPreviewPos([event.latlng.lat, event.latlng.lng])
      },
      mouseout: () => {
        if (activeTool === 'MEASURE') {
          setMeasurePreviewPos(null)
          return
        }
        setEdgeDraftPreviewPos(null)
      },
    })
    return null
  }

  const savePassport = async () => {
    if (!selectedObject) return
    const expectedUpdatedAt = passportEditUpdatedAtRef.current
    const withExpected = <T extends Record<string, unknown>>(body: T) =>
      expectedUpdatedAt != null && expectedUpdatedAt !== ''
        ? { ...body, expected_updated_at: expectedUpdatedAt }
        : body
    try {
    if (selectedObject.kind === 'project') {
      const updated = await jsonFetch<Project>(`${API}/projects/${selectedObject.data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withExpected({
          name: selectedObject.data.name,
          description: selectedObject.data.description,
          passport_data: selectedObject.data.passport_data ?? {},
        }),
        ),
      })
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
      setSelectedObject({ kind: 'project', data: updated })
      passportEditUpdatedAtRef.current = updated.updated_at
      return
    }
    if (selectedObject.kind === 'node') {
      const updated = await jsonFetch<NodeEntity>(`${API}/nodes/${selectedObject.data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withExpected(selectedObject.data as Record<string, unknown>)),
      })
      setNodes((prev) => prev.map((node) => (node.id === updated.id ? updated : node)))
      setSelectedObject({ kind: 'node', data: updated })
      passportEditUpdatedAtRef.current = updated.updated_at
      return
    }
    const updated = await jsonFetch<EdgeEntity>(`${API}/edges/${selectedObject.data.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withExpected(selectedObject.data as Record<string, unknown>)),
    })
    setEdges((prev) => prev.map((edge) => (edge.id === updated.id ? updated : edge)))
    setSelectedObject({ kind: 'edge', data: updated })
    passportEditUpdatedAtRef.current = updated.updated_at
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('изменён другим пользователем')) {
        const reload = window.confirm(
          `${msg}\n\nПерезагрузить объект с сервера? Несохранённые правки в форме будут потеряны.`,
        )
        if (reload) await applyRemoteSync()
      } else {
        throw e
      }
    }
  }

  const setServerDefaultWorkspace = async (nameOverride?: string) => {
    const targetName = (nameOverride ?? workspaceSelect).trim()
    if (!targetName || !isAdmin) return
    setWorkspaceBusy(true)
    try {
      await jsonFetch(`${API}/database/workspaces/active`, {
        method: 'PUT',
        body: JSON.stringify({ name: targetName }),
      })
      await refreshWorkspaces()
      logActivity(`База по умолчанию: ${targetName}`)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setWorkspaceBusy(false)
    }
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
    await saveEdge(edgeDraft.startNode, edgeDraft.bends, queuedEndNode, projectId, edgeDraft.edgeType)
    setEdgeDraft({ startNode: queuedEndNode, bends: [], edgeType: edgeDraft.edgeType })
    setQueuedEndNode(null)
    setShowProjectModal(false)
    setSelectedProjectId(projectId)
  }

  const confirmOpticalCable = async () => {
    if (!edgeDraft || !queuedEndNode) return
    try {
      let projectId = selectedProjectId
      if (!projectId && newProjectName.trim()) {
        projectId = (await createAndSelectProject()) ?? null
      }
      if (!projectId) {
        window.alert('Выберите проект в списке или создайте новый (поле «Новый проект» + кнопка сохранения).')
        return
      }

      const total = Number(totalFibers)
      const used = Number(usedFibers)
      if (!cableName.trim()) {
        window.alert('Укажите название кабеля.')
        return
      }
      if (!Number.isFinite(total) || !Number.isFinite(used) || !Number.isInteger(total) || total < 1 || used < 0 || used > total) {
        window.alert('Проверьте волокна: укажите целое число волокон ≥ 1; занято не больше общего.')
        return
      }
      await saveEdge(edgeDraft.startNode, edgeDraft.bends, queuedEndNode, projectId, 'OPTOVOLOKNO', {
        cable_name: cableName.trim(),
        total_fibers: total,
        used_fibers: used,
        cable_status: newCableStatus,
      })
      setEdgeDraft({ startNode: queuedEndNode, bends: [], edgeType: 'OPTOVOLOKNO' })
      setQueuedEndNode(null)
      setShowCableModal(false)
      applyCableDefaults()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Не удалось сохранить кабель')
    }
  }

  const exportDatabaseJson = async () => {
    try {
      const data = await jsonFetch<unknown>(`${API}/database/export`)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gis-database-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
      a.click()
      URL.revokeObjectURL(url)
      logActivity('Экспорт JSON')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Ошибка экспорта')
    }
  }

  const switchWorkspace = async (nameOverride?: string) => {
    const targetName = (nameOverride ?? workspaceSelect).trim()
    if (!targetName) return
    setWorkspaceBusy(true)
    try {
      await jsonFetch(`${API}/database/workspaces/mine`, {
        method: 'PUT',
        body: JSON.stringify({ name: targetName }),
      })
      await refreshWorkspaces()
      syncRevisionRef.current = 0
      setRemoteSyncPending(false)
      await loadAll()
      setProjectFilterId(null)
      setSelectedObject(null)
      setSpliceOpticalNodeId(null)
      setWorkspaceSelect(targetName)
      logActivity(`База: ${targetName}`)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Ошибка переключения базы')
    } finally {
      setWorkspaceBusy(false)
    }
  }

  const createWorkspace = async (name: string): Promise<WorkspaceRow> => {
    if (!isAdmin) {
      throw new Error('Создание баз доступно только администратору')
    }
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      throw new Error('Название: от 2 до 64 символов')
    }
    setWorkspaceBusy(true)
    try {
      const created = await jsonFetch<WorkspaceRow>(`${API}/database/workspaces`, {
        method: 'POST',
        body: JSON.stringify({ name: trimmed }),
      })
      await refreshWorkspaces()
      setWorkspaceSelect(created.name)
      logActivity(`Создана база: ${created.name}`)
      return created
    } finally {
      setWorkspaceBusy(false)
    }
  }

  const deleteWorkspace = async (name: string): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Удаление баз доступно только администратору')
    }
    const trimmed = name.trim()
    if (!trimmed) return
    setWorkspaceBusy(true)
    try {
      const result = await jsonFetch<{ deleted: { name: string }; active: WorkspaceRow }>(
        `${API}/database/workspaces`,
        {
          method: 'DELETE',
          body: JSON.stringify({ name: trimmed }),
        },
      )
      await refreshWorkspaces()
      if (result.active) {
        setWorkspaceSelect(result.active.name)
        await loadAll()
        setProjectFilterId(null)
        setSelectedObject(null)
        setSpliceOpticalNodeId(null)
      }
      logActivity(`Удалена база: ${result.deleted.name}`)
    } finally {
      setWorkspaceBusy(false)
    }
  }

  const importDatabaseFromText = async () => {
    if (!canImportData) {
      window.alert('Импорт доступен только администратору')
      return
    }
    if (!window.confirm('Импорт полностью заменит текущую базу (проекты, узлы, участки). Продолжить?')) return
    try {
      const body = JSON.parse(importJsonText || '{}')
      await jsonFetch(`${API}/database/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await loadAll()
      setProjectFilterId(null)
      setSelectedObject(null)
      setImportJsonText('')
      logActivity('Импорт JSON')
      window.alert('Импорт завершён')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Ошибка импорта')
    }
  }

  const downloadImportTemplateExcel = () => {
    const blob = buildImportTemplateWorkbook()
    downloadBlob(blob, 'gis-import-template.xlsx')
    logActivity('Шаблон Excel')
  }

  const postImportAppend = async (payload: object, remapTakenIds: boolean) =>
    jsonFetch<{
      ok: boolean
      added: { projects: number; nodes: number; edges: number }
      remapped?: { table: string; from: number; to: number; name?: string }[]
    }>(`${API}/database/import/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, remapTakenIds }),
    })

  const kanalAuthHeaders = useCallback((): HeadersInit => {
    const bearer = getBearerContext()
    const h: Record<string, string> = {}
    if (bearer) h.Authorization = `Bearer ${bearer.token}`
    return h
  }, [])

  const importDatabaseFromExcel = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()

      if (detectKanalLinksWorkbook(buffer)) {
        if (!canEdit) {
          window.alert('Импорт канализации по ТК доступен пользователям с правом редактирования данных')
          return
        }
        const report = await importKanalLinksFromExcelBuffer(buffer, API, kanalAuthHeaders)
        if (report && report.created > 0) {
          await loadAll()
          logActivity('Импорт канализации Excel')
          setActiveShellTab('map')
        }
        return
      }

      if (!canImportData) {
        window.alert('Импорт узлов доступен только администратору. Для канализации по ТК используйте файл с колонками «точка А», «точка Б», «длина» или кнопку на карте.')
        return
      }

      const { payload, errors } = parseImportWorkbook(buffer)
      const total = payload.projects.length + payload.nodes.length + payload.edges.length
      if (total === 0) {
        const preview = errors.slice(0, 12).join('\n')
        window.alert(errors.length ? `Нет строк для импорта:\n${preview}` : 'В файле нет строк для импорта')
        return
      }
      const previewRows = buildImportPreviewRows(payload, 10)
      const previewText = previewRows
        .map((r) => `${r.sheet} #${r.row}: ${r.type} ${r.name} (${r.lat}, ${r.lng}) id=${r.id || 'авто'}`)
        .join('\n')
      const summary = [
        payload.projects.length ? `проектов: ${payload.projects.length}` : null,
        payload.nodes.length ? `узлов: ${payload.nodes.length}` : null,
        payload.edges.length ? `участков: ${payload.edges.length}` : null,
      ]
        .filter(Boolean)
        .join(', ')
      let confirmMsg = `Добавить в базу (${summary})?\n\nПервые строки:\n${previewText}\n\nСуществующие объекты не удаляются.`
      if (errors.length) {
        confirmMsg += `\n\nОшибок разбора: ${errors.length} (будут пропущены). Импортировать корректные строки?`
      }
      if (!window.confirm(confirmMsg)) return

      let remapTakenIds = window.confirm(
        'Если id из файла уже есть в базе — назначить новые id автоматически?\n\n«ОК» — да, «Отмена» — отменить импорт при конфликте id.',
      )

      let res: Awaited<ReturnType<typeof postImportAppend>>
      try {
        res = await postImportAppend(payload, remapTakenIds)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!remapTakenIds && msg.includes('занят')) {
          if (window.confirm(`${msg}\n\nНазначить новые id автоматически?`)) {
            remapTakenIds = true
            res = await postImportAppend(payload, true)
          } else return
        } else throw e
      }

      await loadAll()
      logActivity('Импорт Excel')
      const remapped = res.remapped?.length ?? 0
      const errNote = errors.length ? `\nОшибок в файле (не импортировано): ${errors.length}` : ''
      const remapNote = remapped ? `\nПереназначено id: ${remapped}` : ''
      window.alert(
        `Добавлено: проектов ${res.added.projects}, узлов ${res.added.nodes}, участков ${res.added.edges}${remapNote}${errNote}`,
      )
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Ошибка импорта Excel')
    }
  }

  const exportNodesToExcel = (filter: ExportNodesFilter) => {
    const blob = exportNodesWorkbook(nodes, filter)
    downloadBlob(blob, `gis-nodes-export-${new Date().toISOString().slice(0, 10)}.xlsx`)
    logActivity('Экспорт узлов Excel')
  }

  const exportNodesExcelAll = () => exportNodesToExcel({ types: ['TK'] })

  const exportNodesExcelMapView = () => {
    const map = mapRef.current
    if (!map) {
      window.alert('Карта не готова')
      return
    }
    const b = map.getBounds()
    exportNodesToExcel({
      types: ['TK'],
      bbox: {
        minLat: b.getSouth(),
        minLng: b.getWest(),
        maxLat: b.getNorth(),
        maxLng: b.getEast(),
      },
    })
  }

  const exportGeoJsonTk = async (): Promise<void> => {
    const map = mapRef.current
    const qs = new URLSearchParams({ types: 'TK', download: '1' })
    if (map) {
      const b = map.getBounds()
      qs.set('bbox', `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`)
    }
    const token = getBearerContext()?.token
    const res = await fetch(`${API}/export/geojson?${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { message?: string }).message || res.statusText)
    const blob = await res.blob()
    downloadBlob(blob, `gis-tk-${new Date().toISOString().slice(0, 10)}.geojson`)
    logActivity('Экспорт GeoJSON ТК')
  }

  const importGeoJsonTk = async (file: File): Promise<void> => {
    if (!canImportData) {
      window.alert('Импорт доступен только администратору')
      return
    }
    const text = await file.text()
    const geojson = JSON.parse(text) as unknown
    const remapTakenIds = window.confirm(
      'Добавить точки из GeoJSON?\n\n«ОК» — при занятом id назначить новый; «Отмена» — отменить при конфликте.',
    )
    const res = await jsonFetch<{
      ok: boolean
      added: { nodes: number }
      remapped?: unknown[]
      parseWarnings?: string[]
    }>(`${API}/import/geojson`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geojson, defaultType: 'TK', remapTakenIds }),
    })
    await loadAll()
    logActivity('Импорт GeoJSON')
    window.alert(
      `Добавлено узлов: ${res.added.nodes}` +
        (res.remapped?.length ? `\nПереназначено id: ${res.remapped.length}` : '') +
        (res.parseWarnings?.length ? `\nПредупреждений: ${res.parseWarnings.length}` : ''),
    )
  }

  const fetchDatabaseHealthReport = async () => {
    return jsonFetch<{
      ok: boolean
      summary: { errors: number; warnings: number }
      issues: { severity: string; message: string; entity: string; id: number }[]
    }>(`${API}/database/health-report`)
  }

  const exportKmlTrassy = async () => {
    try {
      const token = getBearerContext()?.token
      const qs = new URLSearchParams()
      const k = prefs.kmlExport
      if (k.projectId !== '') qs.set('project_id', String(k.projectId))
      if (!k.includeNodes) qs.set('nodes', '0')
      if (k.volsOnly) qs.set('vols_only', '1')
      const res = await fetch(`${API}/export/kml?${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { message?: string }).message || res.statusText)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gis-trassy-${new Date().toISOString().slice(0, 10)}.kml`
      a.click()
      URL.revokeObjectURL(url)
      logActivity('Экспорт KML')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Ошибка экспорта KML')
    }
  }

  const changePassword = async (current: string, next: string) => {
    await jsonFetch(`${API}/auth/change-password`, {
      method: 'POST',
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    })
  }

  const fetchBackupInfo = (filename: string) =>
    jsonFetch<{ projects: number; nodes: number; edges: number }>(
      `${API}/backups/${encodeURIComponent(filename)}/info`,
    )

  const downloadBackupFile = async (filename: string) => {
    const token = getBearerContext()?.token
    const res = await fetch(`${API}/backups/${encodeURIComponent(filename)}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error('Не удалось скачать копию')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const saveBackupConfig = async (patch: Partial<BackupConfig>) => {
    const next = { ...backupConfig, ...patch }
    try {
      const data = await jsonFetch<{ config: BackupConfig }>(`${API}/backups/config`, {
        method: 'PUT',
        body: JSON.stringify(next),
      })
      setBackupConfig(data.config)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Не удалось сохранить настройки резервирования')
    }
  }

  const createBackupNow = async () => {
    setBackupBusy(true)
    try {
      const data = await jsonFetch<{ backups: BackupEntry[] }>(`${API}/backups/run`, { method: 'POST' })
      setBackupList(data.backups)
      logActivity('Создана резервная копия')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Ошибка создания копии')
    } finally {
      setBackupBusy(false)
    }
  }

  const restoreBackupFile = async (
    filename: string,
    info?: { projects: number; nodes: number; edges: number },
  ) => {
    if (!canImportData) {
      window.alert('Восстановление доступно только администратору')
      return
    }
    const detail = info
      ? `\n\nВ копии: проектов ${info.projects}, узлов ${info.nodes}, участков ${info.edges}.`
      : ''
    if (!window.confirm(`Восстановить базу из «${filename}»? Текущие данные будут заменены.${detail}`)) return
    setBackupBusy(true)
    try {
      await jsonFetch(`${API}/backups/${encodeURIComponent(filename)}/restore`, { method: 'POST' })
      await loadAll()
      await loadBackupsPanel()
      logActivity(`Восстановление: ${filename}`)
      window.alert('Восстановление завершено')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Ошибка восстановления')
    } finally {
      setBackupBusy(false)
    }
  }

  const removeBackupFile = async (filename: string) => {
    if (!window.confirm(`Удалить копию «${filename}»?`)) return
    try {
      const data = await jsonFetch<{ backups: BackupEntry[] }>(`${API}/backups/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      })
      setBackupList(data.backups)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Ошибка удаления')
    }
  }

  const openObjectPassport = (object: 'project' | 'node' | 'edge', id: number) => {
    if (object === 'project') {
      const p = projects.find((x) => x.id === id)
      if (p) setSelectedObject({ kind: 'project', data: p })
      return
    }
    if (object === 'node') {
      const n = nodes.find((x) => x.id === id)
      if (n) {
        setSelectedObject({ kind: 'node', data: n })
        return
      }
      void fetchMapNode(id).then((loaded) => {
        if (loaded) setSelectedObject({ kind: 'node', data: loaded })
        else window.alert('Узел не найден.')
      })
      return
    }
    const e = edges.find((x) => x.id === id)
    if (e) {
      setSelectedObject({ kind: 'edge', data: e })
      return
    }
    void fetchMapEdge(id).then((loaded) => {
      if (loaded) setSelectedObject({ kind: 'edge', data: loaded })
      else window.alert('Участок не найден.')
    })
  }

  const showObjectOnMap = (object: 'project' | 'node' | 'edge', id: number, opts?: { smooth?: boolean }) => {
    setMapFlyPending({
      kind: object === 'node' ? 'node' : object === 'edge' ? 'edge' : 'project',
      id,
      smooth: opts?.smooth ?? prefs.map.smoothFly,
    })
    setMapHighlight({ kind: object === 'node' ? 'node' : object === 'edge' ? 'edge' : 'project', id })
    setActiveShellTab('map')
  }

  useEffect(() => {
    if (authPhase !== 'user' || activeShellTab !== 'users') return
    jsonFetch<UserRow[]>(`${API}/users`)
      .then(setUsersList)
      .catch((e) => window.alert(e instanceof Error ? e.message : 'Ошибка загрузки пользователей'))
  }, [authPhase, activeShellTab])

  const applyDesktopApiUrl = useCallback(() => {
    const url = desktopApiUrl.trim()
    if (!url) {
      setApiBaseOverride(null)
      return false
    }
    if (!/^https?:\/\//i.test(url)) {
      setDesktopApiCheck('Адрес должен начинаться с http:// или https://')
      return false
    }
    setApiBaseOverride(url)
    setDesktopApiCheck(null)
    return true
  }, [desktopApiUrl])

  const checkDesktopApiHealth = useCallback(async () => {
    if (!applyDesktopApiUrl()) return
    const base = getApiBase()
    setDesktopApiCheck('Проверка…')
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(API_HEALTH_TIMEOUT_MS) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as { ok?: boolean }
      if (!data.ok) throw new Error('Ответ без ok')
      setDesktopApiCheck(`Связь OK: ${base}`)
    } catch (err) {
      setDesktopApiCheck(
        `Нет связи с ${base}. Запустите backend на сервере и откройте этот адрес в браузере.`,
      )
    }
  }, [applyDesktopApiUrl])

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault()
    if (isDesktopApp() && desktopApiUrl.trim() && !applyDesktopApiUrl()) return
    sessionStorage.removeItem(EMBED_TOKEN_KEY)
    localStorage.removeItem(AUTH_TOKEN_KEY)
    try {
      const data = await jsonFetch<{ token: string; user: AuthUser }>(`${API}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ username: authUsername.trim(), password: authPassword }),
      })
      localStorage.setItem(AUTH_TOKEN_KEY, data.token)
      setAuthUser(data.user)
      setAuthPassword('')
      setRegPassword2('')
      setAuthPhase('user')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Ошибка входа')
    }
  }

  const submitRegister = async (e: FormEvent) => {
    e.preventDefault()
    if (isDesktopApp() && desktopApiUrl.trim() && !applyDesktopApiUrl()) return
    sessionStorage.removeItem(EMBED_TOKEN_KEY)
    localStorage.removeItem(AUTH_TOKEN_KEY)
    if (authPassword !== regPassword2) {
      window.alert('Пароли не совпадают')
      return
    }
    try {
      const data = await jsonFetch<{ token: string; user: AuthUser }>(`${API}/auth/register`, {
        method: 'POST',
        body: JSON.stringify({ username: authUsername.trim(), password: authPassword }),
      })
      localStorage.setItem(AUTH_TOKEN_KEY, data.token)
      setAuthUser(data.user)
      setAuthPassword('')
      setRegPassword2('')
      setAuthPhase('user')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Ошибка регистрации')
    }
  }

  const logout = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    sessionStorage.removeItem(EMBED_TOKEN_KEY)
    setAuthUser(null)
    setUsersList([])
    setAuthPhase('guest')
    setNodes([])
    setEdges([])
    setProjects([])
    setFiberOrders([])
    setSelectedObject(null)
  }

  useEffect(() => {
    if (authPhase !== 'user' || prefs.security.sessionTimeoutMinutes <= 0) return
    const id = window.setInterval(() => {
      const limit = prefs.security.sessionTimeoutMinutes * 60 * 1000
      if (Date.now() - lastActivityRef.current >= limit) logout()
    }, 30_000)
    return () => clearInterval(id)
  }, [authPhase, prefs.security.sessionTimeoutMinutes])

  const refreshUsersList = async () => {
    const rows = await jsonFetch<UsersTabRow[]>(`${API}/users`)
    setUsersList(rows)
  }

  const patchUserRole = async (id: number, role: UsersTabRole) => {
    try {
      const u = await jsonFetch<UserRow>(`${API}/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      })
      setUsersList((prev) => prev.map((x) => (x.id === id ? u : x)))
      if (authUser?.id === id) setAuthUser({ id: u.id, username: u.username, role: u.role })
      logActivity(`Смена роли пользователя #${id} → ${role}`)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Не удалось сменить роль')
    }
  }

  const createUserAdmin = async (payload: { username: string; password: string; role: UsersTabRole }) => {
    const u = await jsonFetch<UserRow>(`${API}/users`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    setUsersList((prev) => [...prev, u].sort((a, b) => a.id - b.id))
    logActivity(`Создан пользователь ${u.username}`)
  }

  const resetUserPasswordAdmin = async (id: number, password: string) => {
    await jsonFetch(`${API}/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
    const u = usersList.find((x) => x.id === id)
    logActivity(`Сброс пароля пользователя ${u?.username ?? id}`)
  }

  const deleteUserAdmin = async (id: number) => {
    const u = usersList.find((x) => x.id === id)
    await jsonFetch<void>(`${API}/users/${id}`, { method: 'DELETE' })
    setUsersList((prev) => prev.filter((x) => x.id !== id))
    if (authUser?.id === id) logout()
    else logActivity(`Удалён пользователь ${u?.username ?? id}`)
  }

  if (authPhase === 'loading') {
    return (
      <div className="auth-gate">
        <p>Загрузка…</p>
      </div>
    )
  }

  if (authPhase === 'guest') {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <h1>GIS</h1>
          <div className="gis-segmented auth-tabs">
            <Button
              type="button"
              variant="ghost"
              className={authPanel === 'login' ? 'active' : ''}
              onClick={() => setAuthPanel('login')}
            >
              Вход
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={authPanel === 'register' ? 'active' : ''}
              onClick={() => setAuthPanel('register')}
            >
              Регистрация
            </Button>
          </div>
          {isDesktopApp() ? (
            <div className="auth-server-block">
              <FormField label="Адрес сервера API (Mac)">
                <Input
                  value={desktopApiUrl}
                  onChange={(e) => setDesktopApiUrl(e.target.value)}
                  placeholder="http://192.168.1.177:4000"
                  autoComplete="off"
                />
              </FormField>
              <div className="auth-server-block__actions">
                <Button type="button" variant="secondary" onClick={() => void checkDesktopApiHealth()}>
                  Проверить связь
                </Button>
              </div>
              {desktopApiCheck ? <p className="auth-server-block__status">{desktopApiCheck}</p> : null}
              <p className="auth-server-block__hint">
                Сейчас запросы идут на <strong>{getApiBase()}</strong>. После «Проверить связь» адрес сохраняется на этом ПК.
                Файлы <code>gis-desktop.json</code> / <code>.bat</code> подхватятся в новой сборке; здесь можно задать IP вручную.
              </p>
            </div>
          ) : null}
          {authPanel === 'login' ? (
            <form className="auth-form" onSubmit={submitLogin}>
              <FormField label="Логин">
                <Input value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} autoComplete="username" required />
              </FormField>
              <FormField label="Пароль">
                <Input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </FormField>
              <Button type="submit" variant="primary" block>
                Войти
              </Button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={submitRegister}>
              <FormField label="Логин">
                <Input value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} autoComplete="username" required />
              </FormField>
              <FormField label="Пароль">
                <Input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </FormField>
              <FormField label="Повтор пароля">
                <Input
                  type="password"
                  value={regPassword2}
                  onChange={(e) => setRegPassword2(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </FormField>
              <Button type="submit" variant="primary" block>
                Зарегистрироваться
              </Button>
            </form>
          )}
          <p className="auth-hint">
            Учётная запись администратора: логин <strong>Админ</strong>, пароль <strong>Админ</strong>. Роли: администратор, архитектор (редактирование без импорта базы), пользователь (только просмотр). Назначать роли может только администратор (вкладка «Пользователи»).
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="shell-topbar">
        {viewportLoading && activeShellTab === 'map' ? (
          <div className="shell-topbar__load-strip" aria-hidden />
        ) : null}
        <div className="shell-topbar__brand">
          <span className="shell-topbar__logo">GIS</span>
          <span className="shell-topbar__divider" aria-hidden />
          <span className="shell-topbar__crumb">
            {authUser?.embed ? 'Карта · встраивание Bitrix24' : SHELL_TAB_TITLE[activeShellTab]}
          </span>
        </div>
        <MapStatusBell
          visible={activeShellTab === 'map'}
          useBboxLoad={useBboxLoad}
          remoteApi={remoteApi}
          viewportLoading={viewportLoading}
          mapTruncated={mapTruncated}
          summary={mapSummary}
          loadedNodes={nodes.length}
          loadedEdges={edges.length}
        />
        <div className="shell-topbar__search-wrap" ref={globalSearchRef}>
          <input
            className="shell-topbar__search-input gis-input"
            type="search"
            placeholder="Поиск: узлы, кабели, проекты…"
            value={globalSearch}
            onChange={(e) => {
              const v = e.target.value
              setGlobalSearch(v)
              setGlobalSearchOpen(v.trim().length > 0)
            }}
            onFocus={() => {
              if (globalSearch.trim().length > 0) setGlobalSearchOpen(true)
            }}
            onKeyDown={(e) => {
              if (!globalSearchHits.length) {
                if (e.key === 'Escape') setGlobalSearchOpen(false)
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setGlobalSearchActiveIdx((i) => Math.min(globalSearchHits.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setGlobalSearchActiveIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const hit = globalSearchHits[globalSearchActiveIdx]
                if (hit) {
                  setGlobalSearchOpen(false)
                  setGlobalSearch('')
                  showObjectOnMap(hit.kind, hit.id, { smooth: true })
                }
              } else if (e.key === 'Escape') {
                setGlobalSearchOpen(false)
              }
            }}
            aria-label="Поиск по объектам на карте"
            aria-expanded={globalSearchOpen}
            aria-controls="global-search-results"
            autoComplete="off"
          />
          {globalSearchOpen && globalSearch.trim().length > 0 && (
            <div id="global-search-results" className="shell-topbar__results" role="listbox">
              {globalSearchHits.length === 0 ? (
                <div className="shell-topbar__results-empty">Ничего не найдено</div>
              ) : (
                globalSearchHits.map((hit, idx) => (
                  <button
                    key={`${hit.kind}-${hit.id}`}
                    type="button"
                    role="option"
                    aria-selected={idx === globalSearchActiveIdx}
                    className={`shell-topbar__hit ${idx === globalSearchActiveIdx ? 'is-active' : ''}`}
                    onMouseEnter={() => setGlobalSearchActiveIdx(idx)}
                    onClick={() => {
                      setGlobalSearchOpen(false)
                      setGlobalSearch('')
                      showObjectOnMap(hit.kind, hit.id, { smooth: true })
                    }}
                  >
                    <span className="shell-topbar__hit-kind">
                      {hit.kind === 'node' ? 'Узел' : hit.kind === 'edge' ? 'Линия' : 'Проект'}
                    </span>
                    <span className="shell-topbar__hit-label">{hit.label}</span>
                    <span className="shell-topbar__hit-sub">{hit.sub}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <div className="shell-topbar__user">
          <span className="shell-topbar__avatar" aria-hidden>
            {(authUser?.username ?? '?').slice(0, 2).toUpperCase()}
          </span>
          <span className="shell-topbar__username">{authUser?.username}</span>
        </div>
      </header>
      <div className="shell-status-strip" role="status" aria-label="Сводка данных сессии">
        {isDesktopApp() ? (
          <span className="shell-status-strip__item" title={window.gisDesktop?.configPath ?? undefined}>
            Сервер API <strong>{getApiBase()}</strong>
          </span>
        ) : null}
        {workspaces.length > 0 ? (
          <span className="shell-status-strip__item">
            База <strong>{workspaces.find((w) => w.is_mine ?? w.is_active)?.name ?? (workspaceSelect || '—')}</strong>
          </span>
        ) : null}
        <span className="shell-status-strip__item">
          Проекты <strong className="gis-num">{projects.length}</strong>
        </span>
        <span className="shell-status-strip__item">
          Узлы <strong className="gis-num">{nodes.length}</strong>
        </span>
        <span className="shell-status-strip__item">
          Линии <strong className="gis-num">{edges.length}</strong>
        </span>
        {selectedProjectId != null ? (
          <span className="shell-status-strip__item">
            Фильтр проекта <strong className="gis-num">#{selectedProjectId}</strong>
          </span>
        ) : null}
      </div>
      <div className="shell-body">
        <nav className="nav-rail" aria-label="Разделы приложения">
          <div className="nav-rail__tabs">
            <button
              type="button"
              className={activeShellTab === 'map' ? 'active' : ''}
              title="Карта"
              onClick={() => setActiveShellTab('map')}
            >
              <span className="nav-rail__ico" aria-hidden>
                ◫
              </span>
              <span className="nav-rail__txt">Карта</span>
            </button>
            {!authUser?.embed ? (
              <>
            <button
              type="button"
              className={activeShellTab === 'database' ? 'active' : ''}
              title="База данных"
              onClick={() => setActiveShellTab('database')}
            >
              <span className="nav-rail__ico" aria-hidden>
                ≡
              </span>
              <span className="nav-rail__txt">База данных</span>
            </button>
            <button
              type="button"
              className={activeShellTab === 'fiber_orders' ? 'active' : ''}
              title="Заказы по волокну"
              onClick={() => {
                setActiveShellTab('fiber_orders')
                setSelectedFiberOrder(null)
              }}
            >
              <span className="nav-rail__ico" aria-hidden>
                ⧉
              </span>
              <span className="nav-rail__txt">Заказы по волокну</span>
            </button>
            <button
              type="button"
              className={activeShellTab === 'splice' ? 'active' : ''}
              title="Сварка / схема (муфта, кросс)"
              onClick={() => setActiveShellTab('splice')}
            >
              <span className="nav-rail__ico" aria-hidden>
                ⨀
              </span>
              <span className="nav-rail__txt">Сварка</span>
            </button>
            <button
              type="button"
              className={activeShellTab === 'users' ? 'active' : ''}
              title="Пользователи"
              onClick={() => setActiveShellTab('users')}
            >
              <span className="nav-rail__ico" aria-hidden>
                ◎
              </span>
              <span className="nav-rail__txt">Пользователи</span>
            </button>
            <button
              type="button"
              className={activeShellTab === 'settings' ? 'active' : ''}
              title="Настройки"
              onClick={() => setActiveShellTab('settings')}
            >
              <span className="nav-rail__ico" aria-hidden>
                ⚙
              </span>
              <span className="nav-rail__txt">Настройки</span>
            </button>
            <button
              type="button"
              className={activeShellTab === 'analytics' ? 'active' : ''}
              title="Аналитика"
              onClick={() => setActiveShellTab('analytics')}
            >
              <span className="nav-rail__ico" aria-hidden>
                ▤
              </span>
              <span className="nav-rail__txt">Аналитика</span>
            </button>
              </>
            ) : null}
          </div>
          <button
            type="button"
            className="nav-rail__logout gis-btn gis-btn--ghost gis-btn--sm"
            title={
              authUser?.embed
                ? 'Закрыть встроенную карту (очистит токен в этой вкладке)'
                : `Выйти из учётной записи (${authUser?.username ?? ''})`
            }
            onClick={logout}
          >
            {authUser?.embed ? 'Закрыть' : 'Выход'}
          </button>
        </nav>

      <div className="shell-main shell-main--stacked">
        <MapTab active={activeShellTab === 'map'} mapRef={mapRef} detailZoom={detailZoom}>
            <aside className="map-tools-column">
              <h2>Инструменты карты</h2>
              {remoteSyncPending ? (
                <div className="map-fiber-trace-banner map-sync-banner" role="status">
                  <span>На карте есть более новые данные от коллеги.</span>
                  <button type="button" className="map-fiber-trace-banner__btn" onClick={() => void applyRemoteSync()}>
                    Обновить
                  </button>
                </div>
              ) : null}
              {fiberTraceEdgeIds.length > 0 && (
                <div className="map-fiber-trace-banner" role="status">
                  <span>
                    Маршрут волокна: {fiberTraceEdgeIds.length}{' '}
                    {fiberTraceEdgeIds.length === 1 ? 'участок' : 'участков'}
                  </span>
                  <button type="button" className="map-fiber-trace-banner__btn" onClick={() => setFiberTraceEdgeIds([])}>
                    Сбросить
                  </button>
                </div>
              )}
              <div className="map-tool-grid" role="group" aria-label="Режимы размещения объектов">
                <button type="button" className={`gis-btn gis-btn--secondary ${activeTool === 'SELECT' ? 'active' : ''}`} onClick={() => selectMapTool('SELECT')}>
                  Выбор
                </button>
                <button type="button" className={`gis-btn gis-btn--secondary ${activeTool === 'TK' ? 'active' : ''}`} disabled={!canEdit} onClick={() => selectMapTool('TK')}>
                  ТК
                </button>
                <button type="button" className={`gis-btn gis-btn--secondary ${activeTool === 'MUFTA' ? 'active' : ''}`} disabled={!canEdit} onClick={() => selectMapTool('MUFTA')}>
                  Муфты
                </button>
                <button type="button" className={`gis-btn gis-btn--secondary ${activeTool === 'KROSS' ? 'active' : ''}`} disabled={!canEdit} onClick={() => selectMapTool('KROSS')}>
                  Кросс
                </button>
                <button type="button" className={`gis-btn gis-btn--secondary ${activeTool === 'PIKET' ? 'active' : ''}`} disabled={!canEdit} onClick={() => selectMapTool('PIKET')}>
                  Пикет
                </button>
                <button type="button" className={`gis-btn gis-btn--secondary ${activeTool === 'KANALIZACIYA' ? 'active' : ''}`} disabled={!canEdit} onClick={() => selectMapTool('KANALIZACIYA')}>
                  Канализация
                </button>
                <button type="button" className={`gis-btn gis-btn--secondary ${activeTool === 'OPTOVOLOKNO' ? 'active' : ''}`} disabled={!canEdit} onClick={() => selectMapTool('OPTOVOLOKNO')}>
                  ВОЛС
                </button>
                <button type="button" className={`gis-btn gis-btn--secondary ${activeTool === 'MEASURE' ? 'active' : ''}`} onClick={() => selectMapTool('MEASURE')}>
                  Линейка
                </button>
              </div>
              <div className="map-sidebar-actions">
                <button
                  type="button"
                  className="gis-btn gis-btn--secondary"
                  disabled={!canEdit}
                  onClick={() => setShowKanalLinkModal(true)}
                >
                  Канализация по ТК
                </button>
              </div>
              {edgeDraft && (
                <div className="map-fiber-trace-banner" role="status">
                  <span>
                    Рисование линии: {edgeDraft.edgeType === 'KANALIZACIYA' ? 'канализация' : 'ВОЛС'}
                  </span>
                  <button type="button" className="map-fiber-trace-banner__btn" onClick={clearEdgeDraft}>
                    Сбросить линию
                  </button>
                </div>
              )}
              {activeTool === 'MEASURE' && (
                <p className="hint map-measure-hint">
                  Линейка: клики — вершины, ПКМ или Esc — сброс. В базу не сохраняется.
                  {measurePoints.length > 0 ? (
                    <span className="map-measure-readout">
                      {' '}
                      Σ <strong>{formatLengthMeters(measureLengthTotal)}</strong> ({measurePoints.length}{' '}
                      {measurePoints.length === 1 ? 'точка' : measurePoints.length < 5 ? 'точки' : 'точек'})
                    </span>
                  ) : null}
                </p>
              )}
              <label>Текущий проект</label>
              <select value={selectedProjectId ?? ''} onChange={(e) => setSelectedProjectId(Number(e.target.value) || null)}>
                <option value="">Не выбран</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <div className="layer-switches">
                <label>
                  <input
                    type="checkbox"
                    checked={activeLayers.kanal}
                    onChange={() => {
                      setActiveLayers((s) => {
                        const kanal = !s.kanal
                        syncMapPrefs({ layersKanal: kanal })
                        return { ...s, kanal }
                      })
                    }}
                  />{' '}
                  Канализация
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={activeLayers.vols}
                    onChange={() => {
                      setActiveLayers((s) => {
                        const vols = !s.vols
                        syncMapPrefs({ layersVols: vols })
                        return { ...s, vols }
                      })
                    }}
                  />{' '}
                  ВОЛС
                </label>
              </div>
              <label>
                Подложка
                <select
                  value={basemap}
                  onChange={(e) => {
                    const v = e.target.value as BasemapMode
                    setBasemap(v)
                    syncMapPrefs({ basemap: v })
                  }}
                  className="map-basemap-select"
                >
                  <option value="streets">Схема (OSM)</option>
                  <option value="satellite">Спутник</option>
                  <option value="hybrid">Гибрид</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={hideMapLabels}
                  onChange={() => {
                    setHideMapLabels((v) => {
                      const next = !v
                      syncMapPrefs({ hideMapLabels: next })
                      return next
                    })
                  }}
                />{' '}
                Отключить подписи на карте
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={prefs.map.layerTkOnly}
                  onChange={() => patchPrefs({ map: { layerTkOnly: !prefs.map.layerTkOnly } })}
                />{' '}
                На карте только ТК
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={prefs.map.layerTodayOnly}
                  onChange={() => patchPrefs({ map: { layerTodayOnly: !prefs.map.layerTodayOnly } })}
                />{' '}
                Только добавленные сегодня
              </label>
              {mapZoomTier < detailZoom && nodes.length > 0 ? (
                <p className="hint map-tk-zoom-hint">
                  Приблизьте карту (zoom ≥ {detailZoom}) для колодцев, муфт и кроссов. Линии ВОЛС и канализации видны всегда.
                </p>
              ) : null}
              {activeLayers.vols && (
                <div className="map-tools-legend" aria-hidden>
                  <div className="map-tools-legend__title">ВОЛС — легенда</div>
                  {FIBER_STATUS_ORDER.map((st) => (
                    <div key={st} className="map-tools-legend__row">
                      <span className="map-cable-legend__sw" style={{ background: FIBER_LINE_COLORS[st] }} />
                      <span>
                        {FIBER_STATUS_LABELS[st]}
                        {st === 'ACCIDENT' ? ' — свечение' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" className={showRoutePanel ? 'active' : ''} onClick={() => setShowRoutePanel((v) => !v)}>
                Маршруты по свободным волокнам
              </button>
              {!prefs.workflow.hideMapToolsHint && (
                <p className="hint">
                  ВОЛС: муфта–муфта, муфта–кросс или кросс–кросс, только в проекте. Канализация: ТК–ТК, без проекта. ЛКМ по карте — изгиб; ПКМ — тоже изгиб; пунктир — до курсора до второго узла. Изгиб готовой линии: паспорт участка → «Изгиб по линии».
                </p>
              )}
              {moveTarget && (
                <div className="hint-box">
                  Режим перемещения активен.
                  <button type="button" onClick={() => setMoveTarget(null)}>
                    Отменить
                  </button>
                </div>
              )}
            </aside>

            <main className="map-wrap">
              <MapShell
                center={mapCenter as LatLngExpression}
                zoom={mapZoom}
                basemap={basemap}
                reduceZoomMotion={useBboxLoad}
              >
                <MapInstanceBridge
                  mapRef={mapRef}
                  active={activeShellTab === 'map'}
                  onAfterInvalidate={() => {
                    nodesCanvasLayerRef.current?.paintFrame()
                    edgesCanvasLayerRef.current?.paintFrame()
                  }}
                />
                <MapZoomBridge
                  onZoomEnd={(z) => {
                    setMapZoom(z)
                    if (prefs.map.rememberLastView && mapRef.current) {
                      const c = mapRef.current.getCenter()
                      saveMapViewToStorage([c.lat, c.lng], z)
                    }
                  }}
                />
                <MapViewPersist enabled={prefs.map.rememberLastView} />
                <MapClickHandler />
                <MapBoundsWatcher
                  onBoundsSettled={handleMapBoundsSettled}
                  onDragStart={handleMapDragStart}
                  onDragEnd={handleMapDragEnd}
                  settledThrottleMs={useBboxLoad ? getMapNetworkTiming().boundsThrottleMs : 350}
                />
                <MapCanvasCoordinator />
                <MapEdgesOverlay
                  edges={edgesForCanvas}
                  highlightEdgeId={mapHighlight?.kind === 'edge' ? mapHighlight.id : null}
                  routeEdgeIds={activeRouteEdgeIds}
                  fiberTraceEdgeIds={fiberTraceEdgeIds}
                  excludedEdgeId={lineBendEdgeId}
                  edgeDetailZoom={prefs.map.minEdgeZoom ?? 15}
                  paused={activeShellTab !== 'map'}
                  nodesLayerRef={nodesCanvasLayerRef}
                  onLayerReady={(layer) => {
                    edgesCanvasLayerRef.current = layer
                  }}
                  onEdgeClick={(edge) => activeTool === 'SELECT' && setSelectedObject({ kind: 'edge', data: edge })}
                  onEdgeContextMenu={handleEdgePolyContextMenu}
                />
                <MapNodesOverlay
                  nodes={mapDisplayNodes}
                  nodesById={nodesById}
                  clusterEnabled={effectiveCluster}
                  detailZoom={detailZoom}
                  paused={activeShellTab !== 'map'}
                  highlightNodeId={mapHighlight?.kind === 'node' ? mapHighlight.id : null}
                  onLayerReady={(layer) => {
                    nodesCanvasLayerRef.current = layer
                  }}
                  onNodeClick={(node) => activeTool === 'SELECT' && setSelectedObject({ kind: 'node', data: node })}
                  onNodeContextMenu={handleNodeContextMenu}
                  onClusterClick={(lat, lng, expansionZoom, clusterId, count) => {
                    const map = mapRef.current
                    if (!map) return
                    if (clusterId != null && count != null && count < 20) {
                      const index = nodesCanvasLayerRef.current?.getSuperclusterIndex()
                      if (index) {
                        const leaves = index.getLeaves(clusterId, Infinity)
                        if (leaves.length > 0) {
                          const bounds = L.latLngBounds(
                            leaves.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [number, number]),
                          )
                          map.flyToBounds(bounds, {
                            padding: [48, 48],
                            maxZoom: detailZoom,
                            duration: 0.85,
                            easeLinearity: 0.25,
                          })
                          return
                        }
                      }
                    }
                    const targetZoom = Math.min(Math.max(map.getZoom() + 2, expansionZoom + 1, detailZoom), 18)
                    map.flyTo([lat, lng], targetZoom, { duration: 0.85, easeLinearity: 0.25 })
                  }}
                />
                <MapLabelsLayer
                  nodes={mapDisplayNodes}
                  allNodes={nodes}
                  hideMapLabels={hideMapLabels}
                  labelMaxCount={prefs.map.labelMaxCount ?? 200}
                  mapZoom={mapZoom}
                  tkDetailZoom={detailZoom}
                  labelsWithNodes
                  paused={activeShellTab !== 'map'}
                  highlightNodeId={
                    mapHighlight?.kind === 'node'
                      ? mapHighlight.id
                      : selectedObject?.kind === 'node'
                        ? selectedObject.data.id
                        : null
                  }
                />

                {measurePoints.length > 0 && (
                  <>
                    <Polyline
                      positions={measurePoints as LatLngExpression[]}
                      pathOptions={{ color: '#0ea5e9', weight: 3, dashArray: '6 8', opacity: 0.9, className: 'map-measure-line' }}
                    />
                    {measurePreviewPos && (
                      <Polyline
                        positions={[measurePoints[measurePoints.length - 1], measurePreviewPos] as LatLngExpression[]}
                        pathOptions={{ color: '#0284c7', weight: 2, dashArray: '4 6', opacity: 0.75, className: 'map-measure-line' }}
                      />
                    )}
                    {measurePoints.map((p, i) => (
                      <CircleMarker
                        key={`measure-v-${i}`}
                        center={p}
                        radius={5}
                        pathOptions={{ color: '#0369a1', fillColor: '#0ea5e9', fillOpacity: 1, weight: 2 }}
                      />
                    ))}
                    {measurePoints.map((p, i) => {
                      if (i === 0) return null
                      const a = measurePoints[i - 1]
                      const b = p
                      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
                      return (
                        <CircleMarker
                          key={`measure-seg-${i}`}
                          center={mid}
                          radius={0}
                          pathOptions={{ opacity: 0, fillOpacity: 0 }}
                        >
                          <Tooltip permanent direction="center" className="map-measure-seg-label">
                            {formatLengthMeters(haversineMeters(a, b))}
                          </Tooltip>
                        </CircleMarker>
                      )
                    })}
                    {measurePreviewPos && measurePoints.length > 0 && (
                      <CircleMarker
                        center={[
                          (measurePoints[measurePoints.length - 1][0] + measurePreviewPos[0]) / 2,
                          (measurePoints[measurePoints.length - 1][1] + measurePreviewPos[1]) / 2,
                        ]}
                        radius={0}
                        pathOptions={{ opacity: 0, fillOpacity: 0 }}
                      >
                        <Tooltip permanent direction="center" className="map-measure-seg-label map-measure-seg-label--preview">
                          {formatLengthMeters(haversineMeters(measurePoints[measurePoints.length - 1], measurePreviewPos))}
                        </Tooltip>
                      </CircleMarker>
                    )}
                  </>
                )}

                {edgeDraft && (
                  <>
                    <Polyline
                      positions={[[edgeDraft.startNode.lat, edgeDraft.startNode.lng], ...edgeDraft.bends] as LatLngExpression[]}
                      pathOptions={{ color: '#1d4ed8', weight: 3, opacity: 0.95 }}
                    />
                {edgeDraft && edgeDraftPreviewPos && (
                  <Polyline
                    key="edge-draft-preview"
                    positions={
                      [
                        edgeDraft.bends.length > 0
                          ? edgeDraft.bends[edgeDraft.bends.length - 1]
                          : ([edgeDraft.startNode.lat, edgeDraft.startNode.lng] as [number, number]),
                        edgeDraftPreviewPos,
                      ] as LatLngExpression[]
                    }
                    pathOptions={{ color: '#2563eb', dashArray: '8 10', weight: 3, opacity: 0.75 }}
                  />
                )}
                  </>
                )}

                {lineBendEdgeId &&
                  (() => {
                    const edge = edges.find((e) => e.id === lineBendEdgeId)
                    if (!edge) return null
                    return (
                      <LineBendDragLayer
                        key={`bend-${edge.id}-${normalizeFiberStatus(edge.cable_status)}`}
                        edge={edge}
                        enabled
                        onSaved={() => {
                          loadAll().catch((error) => window.alert(error.message))
                        }}
                      />
                    )
                  })()}
              </MapShell>

              <div className="map-attribution">
                {basemap === 'streets' && '© OpenStreetMap contributors'}
                {basemap === 'satellite' && '© Esri, Maxar, Earthstar Geographics и др.'}
                {basemap === 'hybrid' && '© Esri (спутник + дороги и подписи)'}
              </div>

              {activeLayers.vols && (
                <div className="map-cable-legend" aria-hidden>
                  <div className="map-cable-legend__title">ВОЛС</div>
                  <ul>
                    {FIBER_STATUS_ORDER.map((st) => (
                      <li key={st}>
                        <span className="map-cable-legend__sw" style={{ background: FIBER_LINE_COLORS[st] }} />
                        <span>
                          {FIBER_STATUS_LABELS[st]}
                          {st === 'ACCIDENT' ? ' — свечение' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {showRoutePanel && (
                <div className="route-panel">
                  <div className="route-panel__head">
                    <h3>Маршруты</h3>
                    <button type="button" className="route-panel__close" onClick={() => setShowRoutePanel(false)} aria-label="Закрыть">
                      ×
                    </button>
                  </div>
                  <label>Точка A (муфта / кросс)</label>
                  <select value={routeFromId ?? ''} onChange={(e) => setRouteFromId(Number(e.target.value) || null)}>
                    <option value="">-- выбрать --</option>
                    {routeEndpointNodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.type === 'KROSS' ? 'Кросс' : 'Муфта'} · {node.name}
                      </option>
                    ))}
                  </select>
                  <label>Точка B (муфта / кросс)</label>
                  <select value={routeToId ?? ''} onChange={(e) => setRouteToId(Number(e.target.value) || null)}>
                    <option value="">-- выбрать --</option>
                    {routeEndpointNodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.type === 'KROSS' ? 'Кросс' : 'Муфта'} · {node.name}
                      </option>
                    ))}
                  </select>
                  <label>Минимум свободных волокон</label>
                  <input value={requiredFreeFibers} onChange={(e) => setRequiredFreeFibers(e.target.value)} />
                  <div className="route-panel__row">
                    <button type="button" onClick={findRoutes}>
                      Найти маршруты
                    </button>
                    <button type="button" onClick={clearRouteView}>
                      Закончить просмотр
                    </button>
                  </div>
                  <div className="list route-list">
                    {routes.map((route, index) => (
                      <button
                        key={index}
                        type="button"
                        className={selectedRouteIndex === index ? 'active' : ''}
                        onClick={() => {
                          setSelectedRouteIndex(index)
                          setFiberTraceEdgeIds([])
                          setActiveRouteEdgeIds(route.edge_ids)
                        }}
                      >
                        Маршрут {index + 1}: {route.total_length_m} м, участков {route.edge_ids.length}
                      </button>
                    ))}
                  </div>
                  <label>Зарезервировать волокон на маршруте</label>
                  <input value={routeReserveFibers} onChange={(e) => setRouteReserveFibers(e.target.value)} />
                  <button type="button" disabled={!canEdit} onClick={reserveRouteFibers}>
                    Применить резерв
                  </button>
                  <button type="button" disabled={!canEdit} onClick={openFiberOrderModal}>
                    Сохранить заказ по волокну…
                  </button>
                </div>
              )}
            </main>
        </MapTab>

        {activeShellTab === 'database' && (
          <Suspense fallback={<div className="tab-loading">Загрузка…</div>}>
          <DatabaseTab
            category={dbCategory}
            onCategoryChange={setDbCategory}
            search={dbSearch}
            onSearchChange={setDbSearch}
            projectFilterId={projectFilterId}
            onProjectFilterChange={setProjectFilterId}
            projects={projects}
            apiBase={API}
            jsonFetch={jsonFetch}
            tabActive={activeShellTab === 'database'}
            selectedObjectId={dbSelectedId}
            fiberStatusFilter={dbFiberStatusFilter}
            onFiberStatusFilterChange={setDbFiberStatusFilter}
            onOpenPassport={openObjectPassport}
            onShowOnMap={showObjectOnMap}
            onContextMenu={(e, object, id) => {
              e.preventDefault()
              e.stopPropagation()
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                kind: 'database-item',
                object,
                id,
              })
            }}
            onCreate={
              canEdit
                ? () => {
              if (dbCategory === 'projects') {
                void (async () => {
                  const name = window.prompt('Название нового проекта')
                  if (!name?.trim()) return
                  const created = await jsonFetch<Project>(`${API}/projects`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name.trim(), description: '' }),
                  })
                  setProjects((prev) => [created, ...prev])
                  openObjectPassport('project', created.id)
                })()
              } else {
                setActiveShellTab('map')
              }
                }
                : undefined
            }
          />
          </Suspense>
        )}

        {activeShellTab === 'splice' && (
          <Suspense fallback={<div className="tab-loading">Загрузка…</div>}>
          <div className="splice-tab stack-front">
            {!spliceOpticalNodeId ? (
              <div className="splice-tab-placeholder">
                <h2>Сварка / схема</h2>
                <p className="hint">
                  Откройте паспорт муфты или кросса на карте и нажмите «Сварка / схема», либо выберите узел из списка.
                </p>
                <label className="splice-tab-picker">
                  Муфта или кросс
                  <select
                    value=""
                    onChange={(e) => {
                      const id = Number(e.target.value)
                      if (id) setSpliceOpticalNodeId(id)
                    }}
                  >
                    <option value="">— выберите —</option>
                    {nodes
                      .filter((n) => n.type === 'MUFTA' || n.type === 'KROSS')
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.type === 'KROSS' ? 'Кросс' : 'Муфта'} · {n.name} (id {n.id})
                        </option>
                      ))}
                  </select>
                </label>
                <button type="button" className="splice-tab-map-link" onClick={() => setActiveShellTab('map')}>
                  Показать на карте
                </button>
              </div>
            ) : (
              (() => {
                const spliceNode = nodes.find((n) => n.id === spliceOpticalNodeId)
                if (!spliceNode || (spliceNode.type !== 'MUFTA' && spliceNode.type !== 'KROSS')) {
                  return (
                    <div className="splice-tab-placeholder">
                      <p className="hint">Узел не найден или тип не поддерживает схему сварки.</p>
                      <button type="button" onClick={() => setSpliceOpticalNodeId(null)}>
                        Назад к выбору
                      </button>
                    </div>
                  )
                }
                return (
                  <MuftaSpliceWorkspace
                    key={spliceOpticalNodeId}
                    apiBase={API}
                    node={spliceNode}
                    selfLoadGraph={useBboxLoad}
                    allEdges={edges}
                    allNodes={nodes.map((n) => ({ id: n.id, type: n.type, passport_data: n.passport_data ?? {} }))}
                    allSpliceNodes={nodes
                      .filter((n) => n.type === 'MUFTA' || n.type === 'KROSS')
                      .map((n) => ({ id: n.id, name: n.name, kind: n.type === 'KROSS' ? 'KROSS' : 'MUFTA' }))}
                    onExit={() => {
                      setFiberTraceEdgeIds([])
                      setSpliceOpticalNodeId(null)
                    }}
                    onSelectNode={(id) => setSpliceOpticalNodeId(id)}
                    onSaved={(savedNode, savedEdges) => {
                      setNodes((prev) =>
                        prev.map((n) => (n.id === savedNode.id ? { ...n, ...(savedNode as NodeEntity) } : n)),
                      )
                      setEdges((prev) =>
                        prev.map((e) => {
                          const s = savedEdges.find((x) => x.id === e.id)
                          return s ? ({ ...e, ...s } as EdgeEntity) : e
                        }),
                      )
                    }}
                    onShowOnMap={() => {
                      setMapHighlight({ kind: 'node', id: spliceNode.id })
                      setMapFlyPending({ kind: 'node', id: spliceNode.id })
                      setActiveShellTab('map')
                    }}
                    onShowFiberRouteOnMap={showFiberRouteFromSplice}
                    readOnly={!canEdit}
                  />
                )
              })()
            )}
          </div>
          </Suspense>
        )}

        {activeShellTab === 'fiber_orders' && (
          <div className="fiber-orders-tab stack-front fiber-orders-app">
            <div className="fiber-orders-app__head">
              <div>
                <h2>Заказы по волокну</h2>
                <p className="hint">
                  На карте откройте «Маршруты по свободным волокнам», найдите путь между муфтами, выберите строку маршрута и нажмите «Сохранить заказ по волокну» — волокна сразу списываются на всех участках
                  маршрута.
                </p>
              </div>
            </div>
            <div className="fiber-orders-toolbar" aria-label="Фильтры (заглушка)">
              <span className="fiber-orders-chip">Все статусы</span>
              <span className="fiber-orders-chip">Все бригады</span>
              <span className="fiber-orders-chip">Период: всё время</span>
            </div>
            <div className="fiber-orders-layout">
              <ul className="fiber-orders-list">
                {fiberOrders.length === 0 ? (
                  <li className="hint">Пока нет заказов.</li>
                ) : (
                  fiberOrders.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        className={selectedFiberOrder?.id === o.id ? 'active' : ''}
                        onClick={() => setSelectedFiberOrder(o)}
                      >
                        {o.name}
                        <span className="fiber-orders-list__meta">
                          {o.fiber_count} вол. · {o.total_length_m} м
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              {selectedFiberOrder && (
                <div className="fiber-orders-detail">
                  <h3>{selectedFiberOrder.name}</h3>
                  <p className="fiber-orders-detail__desc">{selectedFiberOrder.description || '—'}</p>
                  <dl className="fiber-orders-dl">
                    <dt>Волокон по заказу</dt>
                    <dd>{selectedFiberOrder.fiber_count}</dd>
                    <dt>Длина маршрута</dt>
                    <dd>{selectedFiberOrder.total_length_m} м</dd>
                    <dt>Начало</dt>
                    <dd>
                      {selectedFiberOrder.start_mufta_name} (муфта id {selectedFiberOrder.start_mufta_id})
                    </dd>
                    <dt>Конец</dt>
                    <dd>
                      {selectedFiberOrder.end_mufta_name} (муфта id {selectedFiberOrder.end_mufta_id})
                    </dd>
                    <dt>Участки (id)</dt>
                    <dd>{selectedFiberOrder.edge_ids.join(', ')}</dd>
                    <dt>Создан</dt>
                    <dd>{selectedFiberOrder.created_at}</dd>
                  </dl>
                </div>
              )}
            </div>
          </div>
        )}

        {activeShellTab === 'settings' && (
          <Suspense fallback={<div className="tab-loading">Загрузка…</div>}>
          <div className="settings-tab stack-front">
            <SettingsPanel
              prefs={prefs}
              onPatchPrefs={patchPrefs}
              authUser={authUser}
              projects={projects}
              importHelp={DATABASE_IMPORT_HELP}
              importJsonText={importJsonText}
              onImportJsonText={setImportJsonText}
              onExportJson={exportDatabaseJson}
              onImportJson={importDatabaseFromText}
              onDownloadImportTemplateExcel={downloadImportTemplateExcel}
              onImportExcelFile={importDatabaseFromExcel}
              onExportNodesExcelAll={exportNodesExcelAll}
              onExportNodesExcelMapView={exportNodesExcelMapView}
              onExportGeoJsonTk={exportGeoJsonTk}
              onImportGeoJsonTk={importGeoJsonTk}
              onFetchDatabaseHealthReport={fetchDatabaseHealthReport}
              onExportKml={exportKmlTrassy}
              canImportData={!!canImportData}
              backupConfig={backupConfig}
              backupList={backupList}
              backupBusy={backupBusy}
              onSaveBackupConfig={saveBackupConfig}
              onCreateBackup={createBackupNow}
              onRestoreBackup={restoreBackupFile}
              onDeleteBackup={removeBackupFile}
              onDownloadBackup={downloadBackupFile}
              onFetchBackupInfo={fetchBackupInfo}
              activityLog={activityLog}
              appVersion={appVersion}
              onLogout={logout}
              onChangePassword={changePassword}
              isAdmin={isAdmin}
              workspaces={workspaces}
              workspaceSelect={workspaceSelect}
              onWorkspaceSelectChange={setWorkspaceSelect}
              onSwitchWorkspace={switchWorkspace}
              onCreateWorkspace={createWorkspace}
              onDeleteWorkspace={deleteWorkspace}
              onSetServerDefaultWorkspace={setServerDefaultWorkspace}
              workspaceBusy={workspaceBusy}
            />
          </div>
          </Suspense>
        )}

        {activeShellTab === 'users' && (
          <UsersTab
            users={usersList}
            authUser={authUser}
            activityLog={activityLog}
            onRefresh={refreshUsersList}
            onCreateUser={createUserAdmin}
            onPatchRole={patchUserRole}
            onResetPassword={resetUserPasswordAdmin}
            onDeleteUser={deleteUserAdmin}
          />
        )}

        {activeShellTab === 'analytics' && (
          <Suspense fallback={<div className="tab-loading">Загрузка…</div>}>
            <AnalyticsTab
              apiBase={API}
              useServerSummary={useBboxLoad}
              nodes={nodes}
              edges={edges}
              projects={projects}
              activityLog={activityLog}
              onOpenPassport={(object, id) => openObjectPassport(object, id)}
              onShowOnMap={showObjectOnMap}
            />
          </Suspense>
        )}
      </div>
      </div>

      {selectedObject && (
        <PassportDrawer
          selected={selectedObject}
          nodes={nodes}
          edges={edges}
          projects={projects}
          onChange={setSelectedObject}
          onClose={() => setSelectedObject(null)}
          onSave={savePassport}
          onDelete={
            selectedObject.kind === 'node'
              ? () => void removeNode(selectedObject.data.id)
              : selectedObject.kind === 'edge'
                ? () => void removeEdge(selectedObject.data.id)
                : undefined
          }
          onShowOnMap={() => {
            showObjectOnMap(selectedObject.kind, selectedObject.data.id)
          }}
          onOpenPassport={setSelectedObject}
          onSplice={(nodeId) => {
            void (async () => {
              const n = nodes.find((x) => x.id === nodeId) ?? (await fetchMapNode(nodeId))
              if (!n || (n.type !== 'MUFTA' && n.type !== 'KROSS')) {
                window.alert('Сварка доступна только для муфты или кросса.')
                return
              }
              setSpliceOpticalNodeId(nodeId)
              setActiveShellTab('splice')
            })()
          }}
          onLineBend={(edgeId) => {
            setLineBendEdgeId(edgeId)
            setActiveShellTab('map')
          }}
          lineBendEdgeId={lineBendEdgeId}
          readOnly={!canEdit}
          onFinishBend={() => setLineBendEdgeId(null)}
        />
      )}

      {showProjectModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Выберите проект для кабеля</h3>
            <FormField label="Существующий проект">
              <Select onChange={(e) => e.target.value && void confirmProjectSelection(Number(e.target.value))} defaultValue="">
                <option value="">-- выбрать --</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <p>или создать новый:</p>
            <FormField label="Название проекта">
              <Input placeholder="Название проекта" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} />
            </FormField>
            <FormField label="Описание">
              <Textarea placeholder="Описание" value={newProjectDescription} onChange={(e) => setNewProjectDescription(e.target.value)} />
            </FormField>
            <div className="passport-actions gis-btn-group">
              <Button
                variant="primary"
                onClick={async () => {
                  const id = await createAndSelectProject()
                  if (id) await confirmProjectSelection(id)
                }}
              >
                Создать и выбрать
              </Button>
              <Button variant="secondary" onClick={() => setShowProjectModal(false)}>
                Отмена
              </Button>
            </div>
          </div>
        </div>
      )}

      {showKanalLinkModal && (
        <KanalLinkModal
          apiBase={API}
          getAuthHeaders={() => {
            const bearer = getBearerContext()
            const h: Record<string, string> = {}
            if (bearer) h.Authorization = `Bearer ${bearer.token}`
            return h
          }}
          onClose={() => setShowKanalLinkModal(false)}
          onCreated={(edge) => {
            setEdges((prev) => [edge, ...prev])
            setSelectedObject({ kind: 'edge', data: edge })
            setShowKanalLinkModal(false)
            setMapFlyPending({ kind: 'edge', id: edge.id, smooth: prefs.map.smoothFly })
            setMapHighlight({ kind: 'edge', id: edge.id })
            setActiveShellTab('map')
          }}
          onBulkImported={() => {
            setShowKanalLinkModal(false)
            setActiveShellTab('map')
            void loadAll()
          }}
        />
      )}

      {showCableModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Параметры оптоволоконного кабеля</h3>
            <FormField label="Проект">
              <Select value={selectedProjectId ?? ''} onChange={(e) => setSelectedProjectId(Number(e.target.value) || null)}>
                <option value="">-- выбрать --</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </FormField>
            {projects.length === 0 ? (
              <p className="hint modal-hint-warn">Нет ни одного проекта — создайте проект в приложении или введите название нового в поле ниже и сохраните кабель.</p>
            ) : null}
            <FormField label="Название кабеля">
              <Input value={cableName} onChange={(e) => setCableName(e.target.value)} />
            </FormField>
            <FormField label="Всего волокон (ввод или подсказки из списка)">
              <Input
                type="number"
                min={1}
                step={1}
                value={totalFibers}
                onChange={(e) => setTotalFibers(e.target.value)}
                list={fiberTotalDatalistId}
                autoComplete="off"
              />
            </FormField>
            <datalist id={fiberTotalDatalistId}>
              {OPTICAL_FIBER_TOTAL_PRESETS.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <FormField label="Занято волокон">
              <Input
                type="number"
                min={0}
                step={1}
                value={usedFibers}
                onChange={(e) => setUsedFibers(e.target.value)}
                list={fiberUsedDatalistId}
                autoComplete="off"
              />
            </FormField>
            <datalist id={fiberUsedDatalistId}>
              {OPTICAL_FIBER_USED_PRESETS.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <FormField label="Состояние участка">
              <Select value={newCableStatus} onChange={(e) => setNewCableStatus(e.target.value as FiberCableStatus)}>
                {FIBER_STATUS_ORDER.map((st) => (
                  <option key={st} value={st}>
                    {FIBER_STATUS_LABELS[st]}
                  </option>
                ))}
              </Select>
            </FormField>
            <p className="hint">Если проект не выбран, укажите название нового проекта — он будет создан при сохранении кабеля.</p>
            <FormField label="Новый проект">
              <Input placeholder="Новый проект" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} />
            </FormField>
            <div className="passport-actions gis-btn-group">
              <Button type="button" variant="primary" onClick={confirmOpticalCable}>
                Сохранить кабель
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowCableModal(false)}>
                Отмена
              </Button>
            </div>
          </div>
        </div>
      )}

      {showFiberOrderModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Сохранить заказ по волокну</h3>
            <p className="hint">Будет создана запись заказа и на каждом участке выбранного маршрута увеличится занятое число волокон.</p>
            <FormField label="Название заказа">
              <Input value={fiberOrderName} onChange={(e) => setFiberOrderName(e.target.value)} />
            </FormField>
            <FormField label="Описание">
              <Textarea value={fiberOrderDescription} onChange={(e) => setFiberOrderDescription(e.target.value)} rows={3} />
            </FormField>
            <FormField label="Количество волокон">
              <Input value={fiberOrderFiberCount} onChange={(e) => setFiberOrderFiberCount(e.target.value)} />
            </FormField>
            <FormField label="ID сделки Bitrix (опционально)">
              <Input
                value={fiberOrderBitrixDealId}
                onChange={(e) => setFiberOrderBitrixDealId(e.target.value)}
                placeholder="Например: 123"
                inputMode="numeric"
              />
            </FormField>
            <div className="passport-actions gis-btn-group">
              <Button type="button" variant="primary" onClick={submitFiberOrder}>
                Сохранить и списать
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowFiberOrderModal(false)}>
                Отмена
              </Button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          {contextMenu.kind === 'database-item' ? (
            <>
              <button type="button" className="gis-btn gis-btn--ghost gis-btn--sm"
                onClick={() => {
                  openObjectPassport(contextMenu.object, contextMenu.id)
                  setContextMenu(null)
                }}
              >
                Открыть паспорт объекта
              </button>
              <button type="button" className="gis-btn gis-btn--ghost gis-btn--sm"
                onClick={() => {
                  showObjectOnMap(contextMenu.object, contextMenu.id)
                  setContextMenu(null)
                }}
              >
                Показать на карте
              </button>
              <button type="button" className="gis-btn gis-btn--ghost gis-btn--sm"
                onClick={() => {
                  void navigator.clipboard.writeText(String(contextMenu.id))
                  setContextMenu(null)
                }}
              >
                Копировать id
              </button>
              {canEdit ? (
                <button type="button" className="gis-btn gis-btn--ghost gis-btn--sm"
                  onClick={async () => {
                    if (!window.confirm('Удалить этот объект из базы?')) {
                      setContextMenu(null)
                      return
                    }
                    if (contextMenu.object === 'project') await removeProject(contextMenu.id)
                    if (contextMenu.object === 'node') await removeNode(contextMenu.id)
                    if (contextMenu.object === 'edge') await removeEdge(contextMenu.id)
                    setContextMenu(null)
                  }}
                >
                  Удалить
                </button>
              ) : null}
            </>
          ) : contextMenu.kind === 'project' ? (
            <>
              <button type="button" className="gis-btn gis-btn--ghost gis-btn--sm"
                onClick={() => {
                  setProjectFilterId(contextMenu.id)
                  setContextMenu(null)
                }}
              >
                Показать только этот проект
              </button>
              <button type="button" className="gis-btn gis-btn--ghost gis-btn--sm"
                onClick={() => {
                  setProjectFilterId(null)
                  setContextMenu(null)
                }}
              >
                Показать все проекты
              </button>
              <button type="button" className="gis-btn gis-btn--ghost gis-btn--sm"
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
              <button type="button" className="gis-btn gis-btn--ghost gis-btn--sm"
                onClick={async () => {
                  if (contextMenu.kind === 'node') await removeNode(contextMenu.id)
                  if (contextMenu.kind === 'edge') await removeEdge(contextMenu.id)
                  setContextMenu(null)
                }}
              >
                Удалить
              </button>
              <button type="button" className="gis-btn gis-btn--ghost gis-btn--sm"
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
            <FormField label="Имя">
              <Input value={pendingNodeName} onChange={(e) => setPendingNodeName(e.target.value)} />
            </FormField>
            {pendingNode?.type === 'KROSS' && (
              <FormField label="Число портов кросса (1–288)">
                <Input
                  type="number"
                  min={1}
                  max={288}
                  value={pendingCrossPorts}
                  onChange={(e) => setPendingCrossPorts(Number(e.target.value) || 8)}
                />
              </FormField>
            )}
            {pendingNode?.type === 'MUFTA' && pendingNode.tkId != null && (
              <p className="hint">
                На этом ТК уже {countMuftasOnTk(nodes, pendingNode.tkId)} муфт(ы). Новая выстроится по кругу вокруг
                колодца вместе с остальными.
              </p>
            )}
            <div className="passport-actions gis-btn-group">
              <Button variant="primary" onClick={confirmCreateNode}>
                Создать
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowCreateNodeModal(false)
                  setPendingNode(null)
                  setPendingNodeName('')
                  setPendingCrossPorts(8)
                }}
              >
                Отмена
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App