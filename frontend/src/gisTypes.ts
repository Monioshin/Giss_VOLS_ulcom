export type NodeType = 'TK' | 'MUFTA' | 'PIKET' | 'KROSS'
export type EdgeType = 'KANALIZACIYA' | 'OPTOVOLOKNO'
export type FiberCableStatus = 'READY' | 'IN_WORK' | 'OFFLINE' | 'ACCIDENT' | 'CONSTRUCTION'

export type Project = {
  id: number
  name: string
  description: string
  created_at: string
  updated_at?: string
  passport_data?: Record<string, unknown>
}

export type NodeEntity = {
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

export type EdgeEntity = {
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

export type SelectedObject =
  | { kind: 'node'; data: NodeEntity }
  | { kind: 'edge'; data: EdgeEntity }
  | { kind: 'project'; data: Project }

export type DbEntityCategory = 'projects' | 'optical' | 'kanal' | 'mufta' | 'tk' | 'piket' | 'kross'

export const FIBER_STATUS_LABELS: Record<FiberCableStatus, string> = {
  READY: 'Готов',
  IN_WORK: 'В работе',
  OFFLINE: 'Не работает',
  ACCIDENT: 'Авария',
  CONSTRUCTION: 'Строится',
}

export const FIBER_STATUS_ORDER: FiberCableStatus[] = ['READY', 'IN_WORK', 'CONSTRUCTION', 'OFFLINE', 'ACCIDENT']

export const FIBER_LINE_COLORS: Record<FiberCableStatus, string> = {
  READY: '#ea580c',
  IN_WORK: '#f59e0b',
  OFFLINE: '#64748b',
  ACCIDENT: '#ff0080',
  CONSTRUCTION: '#7c3aed',
}

export function normalizeFiberStatus(status: string | null | undefined): FiberCableStatus {
  if (status === 'IN_WORK' || status === 'OFFLINE' || status === 'ACCIDENT' || status === 'CONSTRUCTION') return status
  return 'READY'
}
