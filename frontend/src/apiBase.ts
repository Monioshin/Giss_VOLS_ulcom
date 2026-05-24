/** Базовый URL API: override (login) → desktop preload → VITE при сборке → localhost. */

const OVERRIDE_KEY = 'gis.desktop.apiUrl'

function normalizeApiUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function getApiBaseOverride(): string | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(OVERRIDE_KEY)
  return raw?.trim() ? normalizeApiUrl(raw) : null
}

export function setApiBaseOverride(url: string | null): void {
  if (typeof window === 'undefined') return
  if (!url?.trim()) localStorage.removeItem(OVERRIDE_KEY)
  else localStorage.setItem(OVERRIDE_KEY, normalizeApiUrl(url))
}

export function getApiBase(): string {
  const override = getApiBaseOverride()
  if (override) return override

  const fromBridge =
    typeof window !== 'undefined' && window.gisDesktop?.apiUrl
      ? normalizeApiUrl(window.gisDesktop.apiUrl)
      : null
  const env = import.meta.env.VITE_API_URL
  const fromVite = typeof env === 'string' && env.trim() ? normalizeApiUrl(env) : null

  if (fromBridge && fromBridge !== 'http://localhost:4000') return fromBridge
  if (fromVite) return fromVite
  if (fromBridge) return fromBridge
  return 'http://localhost:4000'
}

/** API не на этой машине (LAN / другой ПК в сети). */
export function isRemoteApiBase(url = getApiBase()): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h !== 'localhost' && h !== '127.0.0.1' && h !== '::1'
  } catch {
    return false
  }
}

export type MapNetworkTiming = {
  settleDebounceMs: number
  boundsThrottleMs: number
  maxNodePagesOverview: number
  useBundledViewportPhase1: boolean
}

export function getMapNetworkTiming(): MapNetworkTiming {
  if (isRemoteApiBase()) {
    return {
      settleDebounceMs: 450,
      boundsThrottleMs: 700,
      maxNodePagesOverview: 3,
      useBundledViewportPhase1: true,
    }
  }
  return {
    settleDebounceMs: 300,
    boundsThrottleMs: 550,
    maxNodePagesOverview: 6,
    useBundledViewportPhase1: false,
  }
}

/** Таймаут проверки /health (LAN). */
export const API_HEALTH_TIMEOUT_MS = 3000

/**
 * Для шаблонов `${API}/…` — всегда актуальный URL (override, json, VITE).
 */
export const API = {
  toString() {
    return getApiBase()
  },
  valueOf() {
    return getApiBase()
  },
} as unknown as string
