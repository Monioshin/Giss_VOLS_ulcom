import * as XLSX from 'xlsx'

export type ImportProjectRow = {
  id?: number
  name: string
  description?: string | null
  created_at?: string | null
}

export type ImportNodeRow = {
  id?: number
  type: 'TK' | 'MUFTA' | 'PIKET' | 'KROSS'
  name: string
  lat: number
  lng: number
  parent_tk_id?: number | null
  passport_data?: Record<string, unknown>
}

export type ImportEdgeRow = {
  id?: number
  type: 'KANALIZACIYA' | 'OPTOVOLOKNO'
  start_node_id: number
  end_node_id: number
  length_m: number
  geometry: [number, number][]
  cable_name?: string | null
  total_fibers?: number | null
  used_fibers?: number | null
  project_id?: number | null
  cable_status?: string | null
  passport_data?: Record<string, unknown>
}

export type ImportAppendPayload = {
  projects: ImportProjectRow[]
  nodes: ImportNodeRow[]
  edges: ImportEdgeRow[]
}

/** да | нет | позже | для MUFTA | для OPTOVOLOKNO */
export type ColumnRequiredKind = 'да' | 'нет' | 'позже' | 'для MUFTA' | 'для OPTOVOLOKNO'

export const COLUMN_REQUIRED_LABELS: Record<ColumnRequiredKind, string> = {
  да: 'Да — при импорте',
  нет: 'Нет',
  позже: 'Нет — в программе позже',
  'для MUFTA': 'Для MUFTA (можно позже)',
  'для OPTOVOLOKNO': 'Для ВОЛС (OPTOVOLOKNO)',
}

export type ColumnHelpRow = {
  column: string
  required: ColumnRequiredKind
  description: string
}

export type SheetColumnHelp = {
  sheet: string
  title: string
  columns: ColumnHelpRow[]
}

export const EXCEL_MASS_IMPORT_HINT =
  'Строка 1 — заголовки (type/тип, lat, lng, name, id…). Строки 2+ — по узлу в строке. Лист может называться nodes, узлы или Лист1. Тип: TK или ТК, MUFTA или муфта. Достаточно type + lat + lng; остальное — в программе позже.'

export const COLUMN_HELP: SheetColumnHelp[] = [
  {
    sheet: 'projects',
    title: 'Проекты',
    columns: [
      { column: 'id', required: 'нет', description: 'Пусто — следующий свободный id; иначе должен быть свободен' },
      { column: 'name', required: 'да', description: 'Название проекта' },
      { column: 'description', required: 'позже', description: 'Описание' },
      { column: 'created_at', required: 'позже', description: 'ISO-дата (2026-05-01T10:00:00Z)' },
    ],
  },
  {
    sheet: 'nodes',
    title: 'Узлы (колодец = TK, муфта = MUFTA)',
    columns: [
      { column: 'id', required: 'нет', description: 'Пусто — автонумерация при импорте' },
      { column: 'type', required: 'да', description: 'TK | MUFTA | PIKET | KROSS (колодец — TK)' },
      { column: 'name', required: 'позже', description: 'Подпись на карте; пусто — имя вида «ТК-2», «Муфта-3»' },
      { column: 'lat', required: 'да', description: 'Широта WGS84' },
      { column: 'lng', required: 'да', description: 'Долгота WGS84' },
      {
        column: 'parent_tk_id',
        required: 'для MUFTA',
        description: 'id колодца; можно пусто — привязку к ТК задать в паспорте. Если указан — муфта ≤ 2 м от ТК',
      },
      { column: 'status', required: 'позже', description: 'Паспорт ТК' },
      { column: 'address', required: 'позже', description: 'Паспорт ТК' },
      { column: 'depth_m', required: 'позже', description: 'Глубина, м (ТК)' },
      { column: 'inventory_no', required: 'позже', description: 'Инв. номер (ТК)' },
      { column: 'reserve_cores', required: 'позже', description: 'Паспорт муфты' },
      { column: 'splice_type', required: 'позже', description: 'Паспорт муфты' },
      { column: 'install_date', required: 'позже', description: 'Паспорт муфты' },
      { column: 'label', required: 'позже', description: 'Паспорт пикета' },
      { column: 'mileage', required: 'позже', description: 'Паспорт пикета' },
      { column: 'cross_ports', required: 'позже', description: 'Число портов кросса' },
      { column: 'rack', required: 'позже', description: 'Стойка / шкаф (кросс)' },
      { column: 'notes', required: 'позже', description: 'Заметки (все типы)' },
    ],
  },
  {
    sheet: 'edges',
    title: 'Участки',
    columns: [
      { column: 'id', required: 'нет', description: 'Пусто — автонумерация' },
      { column: 'type', required: 'да', description: 'KANALIZACIYA | OPTOVOLOKNO' },
      { column: 'start_node_id', required: 'да', description: 'id узла начала' },
      { column: 'end_node_id', required: 'да', description: 'id узла конца' },
      { column: 'length_m', required: 'да', description: 'Длина, м' },
      { column: 'geometry', required: 'да', description: 'lat,lng;lat,lng;… (минимум 2 точки)' },
      { column: 'project_id', required: 'для OPTOVOLOKNO', description: 'id проекта; для канализации — пусто' },
      { column: 'cable_name', required: 'для OPTOVOLOKNO', description: 'Имя кабеля' },
      { column: 'total_fibers', required: 'для OPTOVOLOKNO', description: 'Всего волокон' },
      { column: 'used_fibers', required: 'для OPTOVOLOKNO', description: 'Занято волокон' },
      { column: 'cable_status', required: 'позже', description: 'READY | IN_WORK | OFFLINE | ACCIDENT | CONSTRUCTION' },
      { column: 'pipe_type', required: 'позже', description: 'Канализация' },
      { column: 'diameter_mm', required: 'позже', description: 'Канализация' },
      { column: 'material', required: 'позже', description: 'Канализация' },
      { column: 'notes', required: 'позже', description: 'Заметки участка' },
    ],
  },
]

const PROJECT_HEADERS = ['id', 'name', 'description', 'created_at'] as const
const NODE_HEADERS = [
  'id',
  'type',
  'name',
  'lat',
  'lng',
  'parent_tk_id',
  'status',
  'address',
  'depth_m',
  'inventory_no',
  'reserve_cores',
  'splice_type',
  'install_date',
  'label',
  'mileage',
  'cross_ports',
  'rack',
  'notes',
] as const
/** Русские и альтернативные заголовки → каноническое имя колонки */
const HEADER_ALIASES: Record<string, string> = {
  id: 'id',
  ид: 'id',
  '№': 'id',
  type: 'type',
  тип: 'type',
  name: 'name',
  название: 'name',
  имя: 'name',
  наименование: 'name',
  lat: 'lat',
  широта: 'lat',
  latitude: 'lat',
  lng: 'lng',
  lon: 'lng',
  долгота: 'lng',
  longitude: 'lng',
  parent_tk_id: 'parent_tk_id',
  parent: 'parent_tk_id',
  tk_id: 'parent_tk_id',
  колодец: 'parent_tk_id',
  'id_тк': 'parent_tk_id',
  'id тк': 'parent_tk_id',
  status: 'status',
  статус: 'status',
  address: 'address',
  адрес: 'address',
  depth_m: 'depth_m',
  глубина: 'depth_m',
  inventory_no: 'inventory_no',
  инв: 'inventory_no',
  notes: 'notes',
  заметки: 'notes',
  description: 'description',
  описание: 'description',
  created_at: 'created_at',
  start_node_id: 'start_node_id',
  end_node_id: 'end_node_id',
  length_m: 'length_m',
  длина: 'length_m',
  geometry: 'geometry',
  геометрия: 'geometry',
  project_id: 'project_id',
  cable_name: 'cable_name',
  total_fibers: 'total_fibers',
  used_fibers: 'used_fibers',
  cable_status: 'cable_status',
  pipe_type: 'pipe_type',
  diameter_mm: 'diameter_mm',
  material: 'material',
  reserve_cores: 'reserve_cores',
  splice_type: 'splice_type',
  install_date: 'install_date',
  label: 'label',
  mileage: 'mileage',
  cross_ports: 'cross_ports',
  rack: 'rack',
  point_a: 'point_a',
  точка_а: 'point_a',
  'точка а': 'point_a',
  точкаa: 'point_a',
  'точка_a': 'point_a',
  pointa: 'point_a',
  start_tk: 'point_a',
  start_tk_name: 'point_a',
  начальный: 'point_a',
  начальный_тк: 'point_a',
  тк_начало: 'point_a',
  тк_а: 'point_a',
  колодец_а: 'point_a',
  point_b: 'point_b',
  точка_б: 'point_b',
  'точка б': 'point_b',
  точкаb: 'point_b',
  'точка_b': 'point_b',
  pointb: 'point_b',
  end_tk: 'point_b',
  end_tk_name: 'point_b',
  конечный: 'point_b',
  конечный_тк: 'point_b',
  тк_конец: 'point_b',
  тк_б: 'point_b',
  колодец_б: 'point_b',
  длина_м: 'length_m',
}

const SHEET_KANAL_LINKS_NAMES = [
  'kanal_links',
  'kanal',
  'kanalka',
  'канализация',
  'канализация_по_тк',
  'канал',
  'links',
]

/** Нормализация названия ТК из ячейки Excel */
export function normalizeTkNameFromCell(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return String(raw).trim().replace(/\s+/g, ' ')
}

export type KanalLinkImportRow = {
  row: number
  start_tk_name: string
  end_tk_name: string
  length_m: number
  passport_data?: Record<string, unknown>
}

function normalizeKanalLinkHeader(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, '_')
  return HEADER_ALIASES[key] ?? key
}

function sheetLooksLikeKanalLinks(ws: XLSX.WorkSheet): boolean {
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][]
  if (!data.length) return false
  const headers = (data[0] as unknown[]).map((h) => normalizeKanalLinkHeader(cellStr(h)))
  const set = new Set(headers.filter(Boolean))
  return set.has('point_a') && set.has('point_b') && set.has('length_m')
}

function parseKanalLinkSheet(ws: XLSX.WorkSheet, sheetLabel: string, errors: string[]): KanalLinkImportRow[] {
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][]
  if (!data.length) return []
  const headers = (data[0] as unknown[]).map((h) => normalizeKanalLinkHeader(cellStr(h)))
  const rows = data.slice(1).filter((r) => !isEmptyRow(r as unknown[]))
  const out: KanalLinkImportRow[] = []

  rows.forEach((cells, idx) => {
    const rowNum = idx + 2
    const ctx = `${sheetLabel}, строка ${rowNum}`
    try {
      const r = rowToRecord(headers, cells)
      const start = normalizeTkNameFromCell(r.point_a)
      const end = normalizeTkNameFromCell(r.point_b)
      if (!start || !end) throw new Error('нужны колонки «точка А» и «точка Б» (названия ТК)')
      const length_m = parseRequiredNumber(r.length_m, 'длина', ctx)
      if (length_m <= 0) throw new Error('длина должна быть > 0')
      const passport: Record<string, unknown> = { catalog_length_m: length_m }
      if (r.pipe_type) passport.pipe_type = r.pipe_type
      if (r.diameter_mm) passport.diameter_mm = r.diameter_mm
      if (r.notes) passport.notes = r.notes
      out.push({
        row: rowNum,
        start_tk_name: start,
        end_tk_name: end,
        length_m,
        passport_data: passport,
      })
    } catch (e) {
      errors.push(`${ctx}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  return out
}

function detectKanalLinksSheet(wb: XLSX.WorkBook): { sheet: XLSX.WorkSheet; sheetName: string } | null {
  for (const alias of SHEET_KANAL_LINKS_NAMES) {
    const hit = sheetByAliases(wb, [alias])
    if (hit && sheetLooksLikeKanalLinks(hit.sheet)) return hit
  }
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (sheetLooksLikeKanalLinks(sheet)) return { sheet, sheetName }
  }
  return null
}

/** Файл канализации по ТК (point_a / point_b / length_m), без листа nodes. */
export function detectKanalLinksWorkbook(buffer: ArrayBuffer): boolean {
  const wb = XLSX.read(buffer, { type: 'array' })
  return detectKanalLinksSheet(wb) != null
}

/** Excel: колонки «точка А», «точка Б», «длина» (м) — названия существующих ТК в базе. */
export function parseKanalLinksWorkbook(buffer: ArrayBuffer): { rows: KanalLinkImportRow[]; errors: string[] } {
  const errors: string[] = []
  const wb = XLSX.read(buffer, { type: 'array' })
  const detected = detectKanalLinksSheet(wb)
  if (!detected) {
    errors.push(
      'Не найден лист с колонками «точка А», «точка Б», «длина» (или point_a / point_b / length_m). Лист может называться kanal, канализация или быть единственным в файле.',
    )
    return { rows: [], errors }
  }
  const rows = parseKanalLinkSheet(detected.sheet, detected.sheetName, errors)
  if (!rows.length && errors.length === 0) errors.push('Файл не содержит строк данных')
  return { rows, errors }
}

export function buildKanalLinksTemplateWorkbook(): Blob {
  const wb = XLSX.utils.book_new()
  const data = [
    ['точка А', 'точка Б', 'длина', 'pipe_type', 'diameter_mm', 'notes'],
    ['Тк383-N197', 'Тк383-N198', 125.5, 'ПНД', 110, ''],
    ['Тк383-N198', 'Тк383-N199', 98, '', '', 'участок 2'],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'канализация')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function normalizeHeader(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, '_')
  return HEADER_ALIASES[key] ?? key
}

function defaultNodeName(type: string, rowNum: number): string {
  const labels: Record<string, string> = {
    TK: 'ТК',
    MUFTA: 'Муфта',
    PIKET: 'Пикет',
    KROSS: 'Кросс',
  }
  const base = labels[type] ?? type
  return `${base}-${rowNum}`
}

const NODE_TYPE_ALIASES: Record<string, ImportNodeRow['type']> = {
  tk: 'TK',
  тк: 'TK',
  колодец: 'TK',
  колодцы: 'TK',
  mufta: 'MUFTA',
  муфта: 'MUFTA',
  piket: 'PIKET',
  пикет: 'PIKET',
  kross: 'KROSS',
  кросс: 'KROSS',
}

function normalizeNodeType(raw: string): ImportNodeRow['type'] | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, '')
  if (!key) return null
  const upper = raw.trim().toUpperCase()
  if (['TK', 'MUFTA', 'PIKET', 'KROSS'].includes(upper)) return upper as ImportNodeRow['type']
  return NODE_TYPE_ALIASES[key] ?? null
}

const SHEET_NODES_NAMES = ['nodes', 'узлы', 'узел', 'nodes_ru', 'колодцы', 'тк']
const SHEET_PROJECTS_NAMES = ['projects', 'проекты', 'проект']
const SHEET_EDGES_NAMES = ['edges', 'участки', 'участок', 'edges_ru']

function sheetByAliases(wb: XLSX.WorkBook, names: string[]): { sheet: XLSX.WorkSheet; sheetName: string } | null {
  for (const alias of names) {
    const ws = sheetByName(wb, alias)
    if (ws) {
      const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === alias.toLowerCase()) ?? alias
      return { sheet: ws, sheetName }
    }
  }
  return null
}

function sheetLooksLikeNodes(ws: XLSX.WorkSheet): boolean {
  const { headers } = parseSheetRows(ws)
  const set = new Set(headers.filter(Boolean))
  return set.has('type') && set.has('lat') && set.has('lng')
}

function sheetLooksLikeProjects(ws: XLSX.WorkSheet): boolean {
  const { headers } = parseSheetRows(ws)
  const set = new Set(headers.filter(Boolean))
  return set.has('name') && !set.has('lat') && !set.has('type')
}

function sheetLooksLikeEdges(ws: XLSX.WorkSheet): boolean {
  const { headers } = parseSheetRows(ws)
  const set = new Set(headers.filter(Boolean))
  return set.has('geometry') || (set.has('start_node_id') && set.has('end_node_id'))
}

function detectImportSheets(wb: XLSX.WorkBook): {
  projects: { sheet: XLSX.WorkSheet; sheetName: string } | null
  nodes: { sheet: XLSX.WorkSheet; sheetName: string } | null
  edges: { sheet: XLSX.WorkSheet; sheetName: string } | null
} {
  let projects = sheetByAliases(wb, SHEET_PROJECTS_NAMES)
  let nodes = sheetByAliases(wb, SHEET_NODES_NAMES)
  let edges = sheetByAliases(wb, SHEET_EDGES_NAMES)

  if (!nodes || !projects || !edges) {
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName]
      if (!nodes && sheetLooksLikeNodes(sheet)) nodes = { sheet, sheetName }
      else if (!edges && sheetLooksLikeEdges(sheet)) edges = { sheet, sheetName }
      else if (!projects && sheetLooksLikeProjects(sheet)) projects = { sheet, sheetName }
    }
  }

  return { projects, nodes, edges }
}

const EDGE_HEADERS = [
  'id',
  'type',
  'start_node_id',
  'end_node_id',
  'length_m',
  'geometry',
  'project_id',
  'cable_name',
  'total_fibers',
  'used_fibers',
  'cable_status',
  'pipe_type',
  'diameter_mm',
  'material',
  'notes',
] as const

function cellStr(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return String(v).trim()
}

function parseOptionalInt(v: unknown): number | undefined {
  const s = cellStr(v)
  if (!s) return undefined
  const n = Number(s.replace(/\s/g, ''))
  if (!Number.isInteger(n) || n <= 0) return undefined
  return n
}

function parseRequiredNumber(v: unknown, label: string, ctx: string): number {
  const s = cellStr(v).replace(',', '.')
  if (!s) throw new Error(`${ctx}: не указано «${label}»`)
  const n = Number(s)
  if (!Number.isFinite(n)) throw new Error(`${ctx}: «${label}» не число`)
  return n
}

function parseGeometry(raw: unknown, ctx: string): [number, number][] {
  const s = cellStr(raw)
  if (!s) throw new Error(`${ctx}: не указано «geometry»`)
  const parts = s.split(';').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) throw new Error(`${ctx}: geometry — минимум 2 точки (lat,lng;lat,lng)`)
  const out: [number, number][] = []
  for (const part of parts) {
    const sep = part.includes(',') ? ',' : part.includes(';') ? ';' : null
    if (!sep) throw new Error(`${ctx}: неверная точка «${part}»`)
    const [a, b] = part.split(sep).map((x) => x.trim().replace(',', '.'))
    const lat = Number(a)
    const lng = Number(b)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`${ctx}: неверные координаты в «${part}»`)
    }
    out.push([lat, lng])
  }
  return out
}

function buildNodePassport(type: string, row: Record<string, string>): Record<string, unknown> {
  const notes = row.notes || ''
  if (type === 'TK') {
    return {
      status: row.status || '',
      address: row.address || '',
      depth_m: row.depth_m === '' ? null : row.depth_m,
      inventory_no: row.inventory_no || '',
      notes,
    }
  }
  if (type === 'MUFTA') {
    return {
      reserve_cores: row.reserve_cores || '',
      splice_type: row.splice_type || '',
      install_date: row.install_date || '',
      notes,
    }
  }
  if (type === 'PIKET') {
    return { label: row.label || '', mileage: row.mileage || '', notes }
  }
  if (type === 'KROSS') {
    const ports = row.cross_ports ? Number(row.cross_ports) : 8
    return {
      cross_ports: Number.isFinite(ports) ? ports : 8,
      rack: row.rack || '',
      notes,
    }
  }
  return notes ? { notes } : {}
}

function buildEdgePassport(type: string, row: Record<string, string>): Record<string, unknown> {
  const notes = row.notes || ''
  if (type === 'KANALIZACIYA') {
    return {
      pipe_type: row.pipe_type || '',
      diameter_mm: row.diameter_mm || '',
      material: row.material || '',
      notes,
    }
  }
  if (type === 'OPTOVOLOKNO') {
    return { marking: '', notes }
  }
  return notes ? { notes } : {}
}

function rowToRecord(headers: string[], rowCells: unknown[]): Record<string, string> {
  const rec: Record<string, string> = {}
  headers.forEach((h, i) => {
    if (!h) return
    rec[h] = cellStr(rowCells[i])
  })
  return rec
}

function isEmptyRow(cells: unknown[]): boolean {
  return cells.every((c) => cellStr(c) === '')
}

function sheetByName(wb: XLSX.WorkBook, name: string): XLSX.WorkSheet | null {
  const key = wb.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase())
  return key ? wb.Sheets[key] : null
}

function parseSheetRows(ws: XLSX.WorkSheet): { headers: string[]; rows: unknown[][] } {
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][]
  if (!data.length) return { headers: [], rows: [] }
  const headers = (data[0] as unknown[]).map((h) => normalizeHeader(cellStr(h)))
  const rows = data.slice(1).filter((r) => !isEmptyRow(r as unknown[]))
  return { headers, rows: rows as unknown[][] }
}

function parseProjects(ws: XLSX.WorkSheet, errors: string[]): ImportProjectRow[] {
  const { headers, rows } = parseSheetRows(ws)
  const out: ImportProjectRow[] = []
  rows.forEach((cells, idx) => {
    const rowNum = idx + 2
    const ctx = `projects, строка ${rowNum}`
    try {
      const r = rowToRecord(headers, cells)
      const name = r.name
      if (!name) throw new Error('нет name')
      const item: ImportProjectRow = {
        name,
        description: r.description || '',
        created_at: r.created_at || null,
      }
      const id = parseOptionalInt(r.id)
      if (id != null) item.id = id
      out.push(item)
    } catch (e) {
      errors.push(`${ctx}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  return out
}

function parseNodes(ws: XLSX.WorkSheet, errors: string[], sheetLabel = 'nodes'): ImportNodeRow[] {
  const { headers, rows } = parseSheetRows(ws)
  const out: ImportNodeRow[] = []
  rows.forEach((cells, idx) => {
    const rowNum = idx + 2
    const ctx = `${sheetLabel}, строка ${rowNum}`
    try {
      const r = rowToRecord(headers, cells)
      const type = normalizeNodeType(r.type)
      if (!type) {
        throw new Error(`неверный type «${r.type}» (ожидается TK/ТК, MUFTA/муфта, …)`)
      }
      const lat = parseRequiredNumber(r.lat, 'lat', ctx)
      const lng = parseRequiredNumber(r.lng, 'lng', ctx)
      const name = r.name || defaultNodeName(type, rowNum)
      const item: ImportNodeRow = {
        type: type as ImportNodeRow['type'],
        name,
        lat,
        lng,
        passport_data: buildNodePassport(type, r),
      }
      const id = parseOptionalInt(r.id)
      if (id != null) item.id = id
      const parent = parseOptionalInt(r.parent_tk_id)
      if (parent != null) item.parent_tk_id = parent
      else if (type === 'MUFTA') item.parent_tk_id = null
      out.push(item)
    } catch (e) {
      errors.push(`${ctx}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  return out
}

function parseEdges(ws: XLSX.WorkSheet, errors: string[]): ImportEdgeRow[] {
  const { headers, rows } = parseSheetRows(ws)
  const out: ImportEdgeRow[] = []
  rows.forEach((cells, idx) => {
    const rowNum = idx + 2
    const ctx = `edges, строка ${rowNum}`
    try {
      const r = rowToRecord(headers, cells)
      const type = r.type.toUpperCase()
      if (type !== 'KANALIZACIYA' && type !== 'OPTOVOLOKNO') {
        throw new Error(`неверный type «${r.type}»`)
      }
      const start = parseOptionalInt(r.start_node_id)
      const end = parseOptionalInt(r.end_node_id)
      if (!start || !end) throw new Error('нужны start_node_id и end_node_id')
      const length_m = parseRequiredNumber(r.length_m, 'length_m', ctx)
      const geometry = parseGeometry(r.geometry, ctx)
      const item: ImportEdgeRow = {
        type: type as ImportEdgeRow['type'],
        start_node_id: start,
        end_node_id: end,
        length_m,
        geometry,
        passport_data: buildEdgePassport(type, r),
      }
      const id = parseOptionalInt(r.id)
      if (id != null) item.id = id
      if (type === 'OPTOVOLOKNO') {
        const pid = parseOptionalInt(r.project_id)
        if (!pid) throw new Error('для OPTOVOLOKNO нужен project_id')
        item.project_id = pid
        item.cable_name = r.cable_name || null
        item.total_fibers = parseOptionalInt(r.total_fibers) ?? null
        item.used_fibers = parseOptionalInt(r.used_fibers) ?? 0
        item.cable_status = (r.cable_status || 'READY').toUpperCase()
      } else {
        item.project_id = null
      }
      out.push(item)
    } catch (e) {
      errors.push(`${ctx}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  return out
}

export function parseImportWorkbook(buffer: ArrayBuffer): { payload: ImportAppendPayload; errors: string[] } {
  const errors: string[] = []
  const wb = XLSX.read(buffer, { type: 'array' })
  const detected = detectImportSheets(wb)

  if (!detected.nodes && !detected.projects && !detected.edges) {
    errors.push(
      'Не найден лист с узлами. Нужны колонки type (или тип), lat, lng — на листе «nodes» / «узлы» или на любом листе (например «Лист1»).',
    )
    return { payload: { projects: [], nodes: [], edges: [] }, errors }
  }

  const projects = detected.projects ? parseProjects(detected.projects.sheet, errors) : []
  const nodes = detected.nodes ? parseNodes(detected.nodes.sheet, errors, detected.nodes.sheetName) : []
  const edges = detected.edges ? parseEdges(detected.edges.sheet, errors) : []

  if (!projects.length && !nodes.length && !edges.length && errors.length === 0) {
    errors.push('Файл не содержит строк данных')
  }

  return { payload: { projects, nodes, edges }, errors }
}

export function buildImportTemplateWorkbook(): Blob {
  const wb = XLSX.utils.book_new()

  const projectsData = [
    [...PROJECT_HEADERS],
    ['', 'Мой проект', 'Описание', ''],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(projectsData), 'projects')

  const emptyNodeTail = ['', '', '', '', '', '', '', '', '', '', '', '', '']
  const nodesData = [
    [...NODE_HEADERS],
    // Массовое добавление: несколько строк — только type + координаты (имя и паспорт позже)
    ['', 'TK', '', 55.751244, 37.618423, ...emptyNodeTail],
    ['', 'TK', '', 55.7521, 37.6195, ...emptyNodeTail],
    ['', 'TK', 'Колодец К-03', 55.753, 37.6205, ...emptyNodeTail],
    ['', 'MUFTA', '', 55.75125, 37.61843, '', ...emptyNodeTail],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(nodesData), 'nodes')

  const edgesData = [
    [...EDGE_HEADERS],
    [
      '',
      'KANALIZACIYA',
      1,
      2,
      85.5,
      '55.751244,37.618423;55.752100,37.619500',
      '',
      '',
      '',
      '',
      '',
      'ПНД',
      '110',
      'пластик',
      '',
    ],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(edgesData), 'edges')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export type ImportPreviewRow = {
  sheet: string
  row: number
  type: string
  name: string
  lat: string
  lng: string
  id: string
}

export function buildImportPreviewRows(payload: ImportAppendPayload, limit = 10): ImportPreviewRow[] {
  const out: ImportPreviewRow[] = []
  for (const n of payload.nodes) {
    if (out.length >= limit) break
    out.push({
      sheet: 'nodes',
      row: out.length + 2,
      type: n.type,
      name: n.name,
      lat: String(n.lat),
      lng: String(n.lng),
      id: n.id != null ? String(n.id) : '',
    })
  }
  for (const p of payload.projects) {
    if (out.length >= limit) break
    out.push({ sheet: 'projects', row: out.length + 2, type: '—', name: p.name, lat: '—', lng: '—', id: p.id != null ? String(p.id) : '' })
  }
  return out
}

export type ExportNodesFilter = {
  types?: ImportNodeRow['type'][]
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number }
}

function flattenPassportToRow(type: string, passport: Record<string, unknown>): Record<string, string> {
  const r: Record<string, string> = {
    status: '',
    address: '',
    depth_m: '',
    inventory_no: '',
    reserve_cores: '',
    splice_type: '',
    install_date: '',
    label: '',
    mileage: '',
    cross_ports: '',
    rack: '',
    notes: '',
  }
  if (type === 'TK') {
    r.status = String(passport.status ?? '')
    r.address = String(passport.address ?? '')
    r.depth_m = passport.depth_m != null ? String(passport.depth_m) : ''
    r.inventory_no = String(passport.inventory_no ?? '')
  }
  if (type === 'MUFTA') {
    r.reserve_cores = String(passport.reserve_cores ?? '')
    r.splice_type = String(passport.splice_type ?? '')
    r.install_date = String(passport.install_date ?? '')
  }
  if (type === 'PIKET') {
    r.label = String(passport.label ?? '')
    r.mileage = String(passport.mileage ?? '')
  }
  if (type === 'KROSS') {
    r.cross_ports = passport.cross_ports != null ? String(passport.cross_ports) : ''
    r.rack = String(passport.rack ?? '')
  }
  r.notes = String(passport.notes ?? '')
  return r
}

export function exportNodesWorkbook(
  nodes: Array<{
    id: number
    type: string
    name: string
    lat: number
    lng: number
    parent_tk_id?: number | null
    passport_data?: Record<string, unknown>
    created_at?: string
  }>,
  filter: ExportNodesFilter = {},
): Blob {
  let list = nodes
  if (filter.types?.length) {
    const set = new Set(filter.types)
    list = list.filter((n) => set.has(n.type as ImportNodeRow['type']))
  }
  if (filter.bbox) {
    const { minLat, maxLat, minLng, maxLng } = filter.bbox
    list = list.filter((n) => n.lat >= minLat && n.lat <= maxLat && n.lng >= minLng && n.lng <= maxLng)
  }
  const rows: unknown[][] = [[...NODE_HEADERS]]
  for (const n of list) {
    const p = flattenPassportToRow(n.type, n.passport_data ?? {})
    rows.push([
      n.id,
      n.type,
      n.name,
      n.lat,
      n.lng,
      n.parent_tk_id ?? '',
      p.status,
      p.address,
      p.depth_m,
      p.inventory_no,
      p.reserve_cores,
      p.splice_type,
      p.install_date,
      p.label,
      p.mileage,
      p.cross_ports,
      p.rack,
      p.notes,
    ])
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'nodes')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
