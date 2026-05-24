export type WorkspaceSpliceNode = {
  id: number
  type: string
  name: string
  lat: number
  lng: number
  parent_tk_id?: number | null
  passport_data: Record<string, unknown>
}

export type WorkspaceEdge = {
  id: number
  type: string
  start_node_id: number
  end_node_id: number
  length_m?: number
  geometry?: [number, number][]
  cable_name?: string | null
  total_fibers?: number | null
  used_fibers?: number | null
  project_id?: number | null
  project_name: string | null
  cable_status?: string | null
  passport_data: Record<string, unknown>
}

export type SpliceNodeOption = { id: number; name: string; kind: 'MUFTA' | 'KROSS' }
