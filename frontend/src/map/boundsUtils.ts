import L from 'leaflet'
import { edgeLodTier } from './mapZoomConstants'

export type LatLngBoundsBox = {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export function padBounds(bounds: L.LatLngBounds, ratio = 0.15, minPad = 0.002): L.LatLngBounds {
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  const padLat = (ne.lat - sw.lat) * ratio + minPad
  const padLng = (ne.lng - sw.lng) * ratio + minPad
  return L.latLngBounds(
    [sw.lat - padLat, sw.lng - padLng],
    [ne.lat + padLat, ne.lng + padLng],
  )
}

export function boundsFromBox(box: LatLngBoundsBox): L.LatLngBounds {
  return L.latLngBounds([box.minLat, box.minLng], [box.maxLat, box.maxLng])
}

export function boundsToQuery(bounds: L.LatLngBounds, ratio = 0.15, minPad = 0.002): string {
  const padded = padBounds(bounds, ratio, minPad)
  const sw = padded.getSouthWest()
  const ne = padded.getNorthEast()
  return `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`
}

export function boxToQuery(box: LatLngBoundsBox, ratio = 0.15, minPad = 0.002): string {
  return boundsToQuery(boundsFromBox(box), ratio, minPad)
}

export function boundsKey(bounds: L.LatLngBounds, precision = 4): string {
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  const r = (n: number) => n.toFixed(precision)
  return `${r(sw.lat)},${r(sw.lng)},${r(ne.lat)},${r(ne.lng)}`
}

/** Ключ кэша viewport: область + ступень LOD по zoom. */
export function viewportCacheKey(bounds: L.LatLngBounds, zoom: number, detailZoom = 15): string {
  return `${boundsKey(bounds)}|lod${edgeLodTier(zoom, detailZoom)}`
}

export function parseBoundsKey(key: string): L.LatLngBounds | null {
  const boundsPart = key.includes('|lod') ? key.slice(0, key.indexOf('|lod')) : key
  const parts = boundsPart.split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [minLat, minLng, maxLat, maxLng] = parts
  return L.latLngBounds([minLat, minLng], [maxLat, maxLng])
}

/** Пересечение видимой области и тайла кэша (с допуском). */
export function boundsOverlap(a: L.LatLngBounds, b: L.LatLngBounds, margin = 0.0001): boolean {
  const swA = a.getSouthWest()
  const neA = a.getNorthEast()
  const swB = b.getSouthWest()
  const neB = b.getNorthEast()
  return (
    neA.lat + margin >= swB.lat &&
    swA.lat - margin <= neB.lat &&
    neA.lng + margin >= swB.lng &&
    swA.lng - margin <= neB.lng
  )
}

function boundsCoordsFromCacheKey(key: string): number[] | null {
  const part = key.includes('|lod') ? key.slice(0, key.indexOf('|lod')) : key
  const nums = part.split(',').map(Number)
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null
  return nums
}

function lodFromCacheKey(key: string): string | null {
  const i = key.indexOf('|lod')
  return i >= 0 ? key.slice(i + 4) : null
}

export function boundsChangedSignificantly(prev: string | null, next: string, threshold = 0.0008): boolean {
  if (!prev) return true
  if (lodFromCacheKey(prev) !== lodFromCacheKey(next)) return true
  const a = boundsCoordsFromCacheKey(prev)
  const b = boundsCoordsFromCacheKey(next)
  if (!a || !b) return true
  for (let i = 0; i < 4; i++) {
    if (Math.abs(a[i] - b[i]) > threshold) return true
  }
  return false
}

export function pointInBounds(lat: number, lng: number, bounds: L.LatLngBounds): boolean {
  return bounds.contains([lat, lng])
}

export function polylineIntersectsBounds(geometry: [number, number][], bounds: L.LatLngBounds): boolean {
  if (!geometry.length) return false
  for (const [lat, lng] of geometry) {
    if (pointInBounds(lat, lng, bounds)) return true
  }
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  const west = sw.lng
  const east = ne.lng
  const south = sw.lat
  const north = ne.lat
  for (let i = 1; i < geometry.length; i++) {
    const [lat0, lng0] = geometry[i - 1]
    const [lat1, lng1] = geometry[i]
    if (segmentIntersectsRect(lat0, lng0, lat1, lng1, south, west, north, east)) return true
  }
  return false
}

function segmentIntersectsRect(
  lat0: number,
  lng0: number,
  lat1: number,
  lng1: number,
  south: number,
  west: number,
  north: number,
  east: number,
): boolean {
  if (pointInBounds(lat0, lng0, L.latLngBounds([south, west], [north, east]))) return true
  if (pointInBounds(lat1, lng1, L.latLngBounds([south, west], [north, east]))) return true
  const edges: [number, number, number, number][] = [
    [south, west, south, east],
    [north, west, north, east],
    [south, west, north, west],
    [south, east, north, east],
  ]
  for (const [aLat, aLng, bLat, bLng] of edges) {
    if (segmentsIntersect(lat0, lng0, lat1, lng1, aLat, aLng, bLat, bLng)) return true
  }
  return false
}

function segmentsIntersect(
  lat0: number,
  lng0: number,
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  lat3: number,
  lng3: number,
): boolean {
  const d = (lng1 - lng0) * (lat3 - lat2) - (lat1 - lat0) * (lng3 - lng2)
  if (Math.abs(d) < 1e-12) return false
  const ua = ((lng3 - lng2) * (lat0 - lat2) - (lat3 - lat2) * (lng0 - lng2)) / d
  const ub = ((lng1 - lng0) * (lat0 - lat2) - (lat1 - lat0) * (lng0 - lng2)) / d
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1
}
