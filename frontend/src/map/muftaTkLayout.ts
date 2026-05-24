/** Орбитальная раскладка муфт вокруг ТК (география + экранная отрисовка). */

import type { NodeEntity } from '../gisTypes'
import { NODE_STYLE } from './nodeStyles'
import type L from 'leaflet'

export const TK_BODY_RADIUS_M = 0.35
export const MUFTA_BODY_RADIUS_M = 0.28
const LAYOUT_START_ANGLE = -Math.PI / 2
export const NEAR_TK_CENTER_EPS_M = 0.05
export const MUFTA_ATTACH_MAX_METERS = 2

const TK_SCREEN_R = NODE_STYLE.TK.radius
const MUFTA_SCREEN_R = NODE_STYLE.MUFTA.radius

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

function offsetLatLng(lat: number, lng: number, bearingRad: number, distanceM: number): [number, number] {
  const R = 6371000
  const lat1 = (lat * Math.PI) / 180
  const lng1 = (lng * Math.PI) / 180
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceM / R) +
      Math.cos(lat1) * Math.sin(distanceM / R) * Math.cos(bearingRad),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(distanceM / R) * Math.cos(lat1),
      Math.cos(distanceM / R) - Math.sin(lat1) * Math.sin(lat2),
    )
  return [(lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI]
}

function orbitRadiusMeters(count: number, maxAttachMeters: number) {
  const base = TK_BODY_RADIUS_M + MUFTA_BODY_RADIUS_M
  if (count <= 1) return Math.min(maxAttachMeters, base)
  const minForSpacing = MUFTA_BODY_RADIUS_M / Math.sin(Math.PI / count)
  const geometric = Math.max(base, minForSpacing)
  const minChord = 2 * MUFTA_BODY_RADIUS_M + 0.35
  let r = Math.min(maxAttachMeters, Math.max(geometric, maxAttachMeters * 0.92))
  const chord = 2 * r * Math.sin(Math.PI / count)
  if (chord < minChord) {
    const rNeeded = minChord / (2 * Math.sin(Math.PI / count))
    r = Math.min(maxAttachMeters, Math.max(r, rNeeded))
  }
  return r
}

export function computeMuftaPositionsOnTk(
  tkLat: number,
  tkLng: number,
  count: number,
  maxAttachMeters = MUFTA_ATTACH_MAX_METERS,
): [number, number][] | null {
  if (count <= 0) return []
  if (count === 1) return [[tkLat, tkLng]]
  const R = orbitRadiusMeters(count, maxAttachMeters)
  if (R > maxAttachMeters + 1e-6) return null
  const out: [number, number][] = []
  for (let i = 0; i < count; i += 1) {
    const angle = LAYOUT_START_ANGLE + (2 * Math.PI * i) / count
    out.push(offsetLatLng(tkLat, tkLng, angle, R))
  }
  return out
}

export function isNearTkCenter(
  lat: number,
  lng: number,
  tk: { lat: number; lng: number },
  epsM = NEAR_TK_CENTER_EPS_M,
) {
  return haversineMeters([lat, lng], [tk.lat, tk.lng]) <= epsM
}

/** Сколько муфт уже на этом ТК (для подсказки в модалке). */
export function countMuftasOnTk(nodes: { type: string; parent_tk_id?: number | null }[], tkId: number) {
  return nodes.filter((n) => n.type === 'MUFTA' && n.parent_tk_id === tkId).length
}

/** Радиус кольца муфт вокруг ТК на экране (px), чтобы маркеры не перекрывали друг друга и ТК. */
export function muftaOrbitScreenRadiusPx(count: number): number {
  const touchRing = TK_SCREEN_R + MUFTA_SCREEN_R + 4
  if (count <= 1) return touchRing
  const minForSpacing = (MUFTA_SCREEN_R + 3) / Math.sin(Math.PI / count)
  return Math.max(touchRing, minForSpacing + TK_SCREEN_R * 0.25)
}

/**
 * Позиции муфт на canvas (container px), сгруппированных по parent_tk_id.
 * Ключ — id муфты. Только при 2+ муфтах на одном ТК; одна муфта — по lat/lng (центр ТК).
 */
export function buildMuftaScreenPositions(
  nodes: NodeEntity[],
  map: L.Map,
): Map<number, { x: number; y: number }> {
  const tkById = new Map<number, NodeEntity>()
  const muftasByTk = new Map<number, NodeEntity[]>()
  for (const n of nodes) {
    if (n.type === 'TK') tkById.set(n.id, n)
    if (n.type === 'MUFTA' && n.parent_tk_id != null) {
      const list = muftasByTk.get(n.parent_tk_id) ?? []
      list.push(n)
      muftasByTk.set(n.parent_tk_id, list)
    }
  }
  const out = new Map<number, { x: number; y: number }>()
  for (const [tkId, muftas] of muftasByTk) {
    if (muftas.length < 2) continue
    const tk = tkById.get(tkId)
    if (!tk) continue
    const sorted = [...muftas].sort((a, b) => a.id - b.id)
    const tkPt = map.latLngToContainerPoint([tk.lat, tk.lng])
    const Rpx = muftaOrbitScreenRadiusPx(sorted.length)
    for (let i = 0; i < sorted.length; i += 1) {
      const angle = LAYOUT_START_ANGLE + (2 * Math.PI * i) / sorted.length
      out.set(sorted[i].id, {
        x: tkPt.x + Rpx * Math.cos(angle),
        y: tkPt.y + Rpx * Math.sin(angle),
      })
    }
  }
  return out
}
