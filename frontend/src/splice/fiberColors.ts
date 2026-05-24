/** Акцентные цвета кабелей на схеме (по id участка). */
const CABLE_ACCENT = [
  '#0ea5e9',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#14b8a6',
  '#6366f1',
  '#84cc16',
  '#f97316',
  '#06b6d4',
  '#a855f7',
  '#22c55e',
]

export function cableAccentColor(edgeId: number): string {
  if (edgeId === 0) return '#6d28d9'
  return CABLE_ACCENT[Math.abs(edgeId) % CABLE_ACCENT.length]
}

/** ITU-T G.652 типовые цвета волокон 1–12 (справочно на подписи). */
export const ITU_T_FIBER_COLORS: Record<number, string> = {
  1: '#0072bc',
  2: '#ff7f00',
  3: '#00a651',
  4: '#8b4513',
  5: '#708090',
  6: '#ffffff',
  7: '#ff0000',
  8: '#000000',
  9: '#ffff00',
  10: '#9400d3',
  11: '#ff69b4',
  12: '#40e0d0',
}

export function ituFiberColor(fiberIndex: number): string | undefined {
  return ITU_T_FIBER_COLORS[fiberIndex]
}

export const FIBER_STATUS_STROKE: Record<string, string> = {
  READY: '#ea580c',
  IN_WORK: '#f59e0b',
  OFFLINE: '#64748b',
  ACCIDENT: '#ff0080',
  CONSTRUCTION: '#7c3aed',
}
