import {
  countBusyInUsage,
  getEdgeFiberUsage,
  getSpliceV1,
  mergeEdgeFiberUsage,
  type EdgeFiberUsage,
} from '../muftaSpliceTypes'
import type { EdgeEntity, NodeEntity, NodeType, Project } from '../gisTypes'
import { normalizeFiberStatus } from '../gisTypes'

export type TkPassport = {
  status: string
  address: string
  depth_m: string
  inventory_no: string
  notes: string
}

export type MuftaPassport = {
  reserve_cores: string
  splice_type: string
  install_date: string
  notes: string
}

export type PiketPassport = {
  label: string
  mileage: string
  notes: string
}

export type KrossPassport = {
  cross_ports: number
  rack: string
  notes: string
}

export type KanalPassport = {
  pipe_type: string
  diameter_mm: string
  material: string
  notes: string
}

export type OpticalPassport = {
  notes: string
  marking: string
}

export type ProjectPassport = {
  notes: string
  contract: string
  customer: string
}

function str(v: unknown, fallback = ''): string {
  if (v == null) return fallback
  return String(v)
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function readTkPassport(raw: Record<string, unknown>): TkPassport {
  return {
    status: str(raw.status),
    address: str(raw.address),
    depth_m: raw.depth_m != null ? String(raw.depth_m) : '',
    inventory_no: str(raw.inventory_no),
    notes: str(raw.notes),
  }
}

export function writeTkPassport(form: TkPassport, base: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...form, depth_m: form.depth_m === '' ? null : Number(form.depth_m) }
}

export function readMuftaPassport(raw: Record<string, unknown>): MuftaPassport {
  return {
    reserve_cores: raw.reserve_cores != null ? String(raw.reserve_cores) : '',
    splice_type: str(raw.splice_type),
    install_date: str(raw.install_date),
    notes: str(raw.notes),
  }
}

export function writeMuftaPassport(form: MuftaPassport, base: Record<string, unknown>): Record<string, unknown> {
  return {
    ...base,
    reserve_cores: form.reserve_cores === '' ? null : Number(form.reserve_cores),
    splice_type: form.splice_type || undefined,
    install_date: form.install_date || undefined,
    notes: form.notes || undefined,
  }
}

export function readPiketPassport(raw: Record<string, unknown>): PiketPassport {
  return {
    label: str(raw.label),
    mileage: str(raw.mileage),
    notes: str(raw.notes),
  }
}

export function writePiketPassport(form: PiketPassport, base: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...form }
}

export function readKrossPassport(raw: Record<string, unknown>): KrossPassport {
  return {
    cross_ports: Math.min(288, Math.max(1, num(raw.cross_ports, 8))),
    rack: str(raw.rack),
    notes: str(raw.notes),
  }
}

export function writeKrossPassport(form: KrossPassport, base: Record<string, unknown>): Record<string, unknown> {
  return { ...base, cross_ports: form.cross_ports, rack: form.rack || undefined, notes: form.notes || undefined }
}

export function readKanalPassport(raw: Record<string, unknown>): KanalPassport {
  return {
    pipe_type: str(raw.pipe_type),
    diameter_mm: raw.diameter_mm != null ? String(raw.diameter_mm) : '',
    material: str(raw.material),
    notes: str(raw.notes),
  }
}

export function writeKanalPassport(form: KanalPassport, base: Record<string, unknown>): Record<string, unknown> {
  return {
    ...base,
    pipe_type: form.pipe_type || undefined,
    diameter_mm: form.diameter_mm === '' ? null : Number(form.diameter_mm),
    material: form.material || undefined,
    notes: form.notes || undefined,
  }
}

export function readOpticalPassport(raw: Record<string, unknown>): OpticalPassport {
  return {
    notes: str(raw.notes),
    marking: str(raw.marking),
  }
}

export function writeOpticalPassport(
  form: OpticalPassport,
  base: Record<string, unknown>,
  fiberUsage: EdgeFiberUsage,
): Record<string, unknown> {
  return mergeEdgeFiberUsage({ ...base, notes: form.notes || undefined, marking: form.marking || undefined }, fiberUsage)
}

export function readProjectPassport(raw: Record<string, unknown>): ProjectPassport {
  return {
    notes: str(raw.notes),
    contract: str(raw.contract),
    customer: str(raw.customer),
  }
}

export function writeProjectPassport(form: ProjectPassport, base: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...form }
}

export function passportMetaLabel(node: NodeEntity): string {
  const p = node.passport_data
  switch (node.type) {
    case 'MUFTA': {
      const m = readMuftaPassport(p)
      return m.reserve_cores ? `резерв ${m.reserve_cores}` : '—'
    }
    case 'KROSS': {
      const k = readKrossPassport(p)
      return `${k.cross_ports} порт.`
    }
    case 'TK': {
      const t = readTkPassport(p)
      return t.status || t.inventory_no || '—'
    }
    case 'PIKET': {
      const pk = readPiketPassport(p)
      return pk.label || pk.mileage || '—'
    }
    default:
      return '—'
  }
}

export type ValidationIssue = { field: string; message: string }

export function validateNode(node: NodeEntity, tkNodes: NodeEntity[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!node.name.trim()) issues.push({ field: 'name', message: 'Укажите название' })
  if (node.type === 'MUFTA' && !node.parent_tk_id) {
    issues.push({ field: 'parent_tk_id', message: 'Выберите родительский ТК' })
  }
  if (node.type === 'KROSS') {
    const k = readKrossPassport(node.passport_data)
    if (k.cross_ports < 1 || k.cross_ports > 288) issues.push({ field: 'cross_ports', message: 'Портов: 1–288' })
  }
  void tkNodes
  return issues
}

export function validateEdge(edge: EdgeEntity): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (edge.type === 'OPTOVOLOKNO') {
    if (!edge.cable_name?.trim()) issues.push({ field: 'cable_name', message: 'Укажите название кабеля' })
    const total = edge.total_fibers ?? 0
    const used = edge.used_fibers ?? 0
    if (total < 1) issues.push({ field: 'total_fibers', message: 'Волокон ≥ 1' })
    if (used > total) issues.push({ field: 'used_fibers', message: 'Занято не больше общего числа' })
    const usage = getEdgeFiberUsage(edge.passport_data)
    const busyFromUsage = countBusyInUsage(total, usage)
    if (busyFromUsage > total) issues.push({ field: 'fiber_usage', message: 'Занятых волокон в сетке больше, чем всего' })
  }
  if (edge.length_m < 0) issues.push({ field: 'length_m', message: 'Длина не может быть отрицательной' })
  return issues
}

export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!project.name.trim()) issues.push({ field: 'name', message: 'Укажите название проекта' })
  return issues
}

export function projectStats(projectId: number, edges: EdgeEntity[]) {
  const pe = edges.filter((e) => e.type === 'OPTOVOLOKNO' && e.project_id === projectId)
  const totalLen = pe.reduce((s, e) => s + e.length_m, 0)
  const accidents = pe.filter((e) => normalizeFiberStatus(e.cable_status) === 'ACCIDENT').length
  return { edgeCount: pe.length, totalLen, accidents }
}

export function nodeSpliceSummary(node: NodeEntity, edges: EdgeEntity[]) {
  const splice = getSpliceV1(node.passport_data)
  const optical = edges.filter((e) => e.type === 'OPTOVOLOKNO' && (e.start_node_id === node.id || e.end_node_id === node.id))
  return { linkCount: splice.links.length, cableCount: optical.length }
}

export type PassportTab = 'main' | 'relations' | 'extra'

export function nodeTypeTitle(type: NodeType): string {
  const map: Record<NodeType, string> = { TK: 'ТК', MUFTA: 'Муфта', PIKET: 'Пикет', KROSS: 'Кросс' }
  return map[type]
}

export function passportHeaderTitle(kind: 'node' | 'edge' | 'project', data: NodeEntity | EdgeEntity | Project): string {
  if (kind === 'project') return `Проект · ${(data as Project).name}`
  if (kind === 'node') return `${nodeTypeTitle((data as NodeEntity).type)} · ${(data as NodeEntity).name}`
  const e = data as EdgeEntity
  if (e.type === 'OPTOVOLOKNO') return `ВОЛС · ${e.cable_name || `#${e.id}`}`
  return `Канализация · #${e.id}`
}
