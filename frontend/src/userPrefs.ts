export type ThemePreference = 'light' | 'dark' | 'auto'
export type UiDensity = 'normal' | 'compact'
export type BasemapMode = 'streets' | 'satellite' | 'hybrid'
export type FlySpeed = 'fast' | 'normal' | 'slow'
export type DeleteConfirmMode = 'always' | 'edges_only' | 'never'

export type Project = {
  id: number
  name: string
  description: string
  created_at: string
  updated_at?: string
}
export type FiberCableStatus = 'READY' | 'IN_WORK' | 'OFFLINE' | 'ACCIDENT' | 'CONSTRUCTION'
export type ShellTab = 'map' | 'database' | 'fiber_orders' | 'users' | 'settings' | 'analytics' | 'splice'
export type StartupTabMode = 'last' | ShellTab

export type ActivityLogEntry = { at: string; user: string; action: string }

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export type UserPrefsPatch = DeepPartial<UserPrefs>

export type UserPrefs = {
  version: 1
  theme: ThemePreference
  uiDensity: UiDensity
  map: {
    basemap: BasemapMode
    hideMapLabels: boolean
    layersKanal: boolean
    layersVols: boolean
    clusterEnabled: boolean
    autoClusterWhenLarge: boolean
    layerTkOnly: boolean
    layerTodayOnly: boolean
    bboxLoadWhenLarge: boolean
    labelMinZoom: number
    labelMaxCount: number
    tkDetailZoom: number
    minEdgeZoom: number
    smoothFly: boolean
    flySpeed: FlySpeed
    rememberLastView: boolean
    lastCenter: [number, number] | null
    lastZoom: number | null
    defaultZoom: number
  }
  workflow: {
    defaultProjectId: number | null
    startupTab: StartupTabMode
    lastActiveTab: ShellTab
    hideMapToolsHint: boolean
    showRoutePanel: boolean
    requiredFreeFibers: string
    routeReserveFibers: string
    deleteConfirm: DeleteConfirmMode
    /** Интервал опроса /sync/summary на вкладке «Карта» (секунды). */
    syncPollIntervalSec: number
  }
  cableDefaults: {
    totalFibers: string
    usedFibers: string
    cableStatus: FiberCableStatus
    nameTemplate: string
  }
  kmlExport: {
    projectId: number | ''
    volsOnly: boolean
    includeNodes: boolean
  }
  security: {
    sessionTimeoutMinutes: number
  }
}

export const PREFS_STORAGE_KEY = 'gis-prefs-v1'

export const DEFAULT_USER_PREFS: UserPrefs = {
  version: 1,
  theme: 'light',
  uiDensity: 'normal',
  map: {
    basemap: 'streets',
    hideMapLabels: false,
    layersKanal: true,
    layersVols: true,
    clusterEnabled: false,
    autoClusterWhenLarge: true,
    layerTkOnly: false,
    layerTodayOnly: false,
    bboxLoadWhenLarge: true,
    labelMinZoom: 16,
    labelMaxCount: 400,
    tkDetailZoom: 16,
    minEdgeZoom: 15,
    smoothFly: true,
    flySpeed: 'normal',
    rememberLastView: true,
    lastCenter: null,
    lastZoom: null,
    defaultZoom: 13,
  },
  workflow: {
    defaultProjectId: null,
    startupTab: 'last',
    lastActiveTab: 'map',
    hideMapToolsHint: false,
    showRoutePanel: false,
    requiredFreeFibers: '1',
    routeReserveFibers: '1',
    deleteConfirm: 'always',
    syncPollIntervalSec: 12,
  },
  cableDefaults: {
    totalFibers: '24',
    usedFibers: '0',
    cableStatus: 'READY',
    nameTemplate: 'ОК-{n}',
  },
  kmlExport: {
    projectId: '',
    volsOnly: false,
    includeNodes: true,
  },
  security: {
    sessionTimeoutMinutes: 0,
  },
}

const ACTIVITY_LOG_KEY = 'gis-activity-log'
const MAX_ACTIVITY = 20

export function loadUserPrefs(): UserPrefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_USER_PREFS, map: { ...DEFAULT_USER_PREFS.map } }
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY)
    if (!raw) return mergeUserPrefs(DEFAULT_USER_PREFS, {})
    const parsed = JSON.parse(raw) as Partial<UserPrefs>
    return mergeUserPrefs(DEFAULT_USER_PREFS, parsed)
  } catch {
    return mergeUserPrefs(DEFAULT_USER_PREFS, {})
  }
}

export function saveUserPrefs(prefs: UserPrefs) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
}

let mapViewSaveTimer: ReturnType<typeof setTimeout> | null = null

/** Сохраняет вид карты в localStorage без React setState (debounce). */
export function saveMapViewToStorage(center: [number, number], zoom: number, debounceMs = 800) {
  if (typeof localStorage === 'undefined') return
  if (mapViewSaveTimer) clearTimeout(mapViewSaveTimer)
  mapViewSaveTimer = setTimeout(() => {
    mapViewSaveTimer = null
    try {
      const prefs = loadUserPrefs()
      prefs.map.lastCenter = center
      prefs.map.lastZoom = zoom
      saveUserPrefs(prefs)
    } catch {
      /* ignore */
    }
  }, debounceMs)
}

export function mergeUserPrefs(base: UserPrefs, patch: UserPrefsPatch): UserPrefs {
  const merged = {
    ...base,
    ...patch,
    map: { ...base.map, ...(patch.map ?? {}) },
    workflow: { ...base.workflow, ...(patch.workflow ?? {}) },
    cableDefaults: { ...base.cableDefaults, ...(patch.cableDefaults ?? {}) },
    kmlExport: { ...base.kmlExport, ...(patch.kmlExport ?? {}) },
    security: { ...base.security, ...(patch.security ?? {}) },
  }
  const z = merged.map.tkDetailZoom
  if (typeof z !== 'number' || z < 16) {
    merged.map.tkDetailZoom = 16
  } else if (z > 18) {
    merged.map.tkDetailZoom = 18
  }
  const poll = merged.workflow.syncPollIntervalSec
  if (typeof poll !== 'number' || poll < 8 || poll > 60) {
    merged.workflow.syncPollIntervalSec = DEFAULT_USER_PREFS.workflow.syncPollIntervalSec
  }
  return merged
}

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'auto' && typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return pref === 'dark' ? 'dark' : 'light'
}

export function flyDurationMultiplier(speed: FlySpeed): number {
  if (speed === 'fast') return 0.65
  if (speed === 'slow') return 1.45
  return 1
}

export function loadActivityLog(): ActivityLogEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(ACTIVITY_LOG_KEY)
    return raw ? (JSON.parse(raw) as ActivityLogEntry[]) : []
  } catch {
    return []
  }
}

export function pushActivityLog(user: string, action: string) {
  if (typeof localStorage === 'undefined') return
  const prev = loadActivityLog()
  const next = [{ at: new Date().toISOString(), user, action }, ...prev].slice(0, MAX_ACTIVITY)
  localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(next))
}

export function applyCableNameTemplate(template: string, seq: number, projectName?: string) {
  return template
    .replace(/\{n\}/gi, String(seq))
    .replace(/\{project\}/gi, projectName ?? '')
    .trim()
}

export function nextCableSequence(edges: { cable_name?: string | null; type: string }[]) {
  let max = 0
  for (const e of edges) {
    if (e.type !== 'OPTOVOLOKNO') continue
    const m = String(e.cable_name ?? '').match(/(\d+)\s*$/)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}
