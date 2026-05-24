import type { EdgeEntity } from '../gisTypes'

export type KanalLinkPayload = {
  start_tk_name: string
  end_tk_name: string
  length_m: number
  passport_data?: Record<string, unknown>
}

export type KanalLinkErrorCode = 'not_found' | 'ambiguous' | 'same_node' | 'empty' | 'error'

export class KanalLinkApiError extends Error {
  readonly code: KanalLinkErrorCode
  readonly candidates?: { id: number; name: string }[]

  constructor(message: string, code: KanalLinkErrorCode, candidates?: { id: number; name: string }[]) {
    super(message)
    this.name = 'KanalLinkApiError'
    this.code = code
    this.candidates = candidates
  }
}

function mergeAuthHeaders(headers: Headers, auth: HeadersInit) {
  if (auth instanceof Headers) {
    auth.forEach((v, k) => headers.set(k, v))
  } else if (Array.isArray(auth)) {
    for (const [k, v] of auth) headers.set(k, v)
  } else {
    for (const [k, v] of Object.entries(auth)) headers.set(k, String(v))
  }
}

export async function createKanalLink(
  apiBase: string,
  getAuthHeaders: () => HeadersInit,
  payload: KanalLinkPayload,
): Promise<EdgeEntity> {
  const base = apiBase.replace(/\/+$/, '')
  const headers = new Headers({ 'Content-Type': 'application/json' })
  mergeAuthHeaders(headers, getAuthHeaders())

  const response = await fetch(`${base}/edges/kanal/link`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  let data: Record<string, unknown> | null = null
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error(`Ответ сервера не JSON (${response.status})`)
    }
  }

  if (!response.ok) {
    const code =
      ((typeof data?.code === 'string' ? data.code : undefined) as KanalLinkErrorCode | undefined) ??
      (response.status === 409 ? 'ambiguous' : 'error')
    const message = typeof data?.message === 'string' ? data.message : `Ошибка API (${response.status})`
    const candidates = Array.isArray(data?.candidates)
      ? (data.candidates as { id: number; name: string }[])
      : undefined
    throw new KanalLinkApiError(message, code, candidates)
  }

  return data as unknown as EdgeEntity
}

export type KanalLinkBulkRow = KanalLinkPayload & { row?: number }

export type KanalLinkBulkError = {
  row: number
  message: string
  code?: string
  candidates?: { id: number; name: string }[]
}

export type KanalLinkBulkResult = {
  created_ids: number[]
  errors: KanalLinkBulkError[]
  errors_truncated?: boolean
  summary: { ok: number; failed: number; total: number }
}

const BULK_CHUNK_SIZE = 500

async function createKanalLinksBulkOnce(
  apiBase: string,
  getAuthHeaders: () => HeadersInit,
  rows: KanalLinkBulkRow[],
): Promise<KanalLinkBulkResult> {
  const base = apiBase.replace(/\/+$/, '')
  const headers = new Headers({ 'Content-Type': 'application/json' })
  mergeAuthHeaders(headers, getAuthHeaders())

  const response = await fetch(`${base}/edges/kanal/link/bulk`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ rows }),
  })

  const text = await response.text()
  let data: Record<string, unknown> | null = null
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error(`Ответ сервера не JSON (${response.status})`)
    }
  }

  if (!response.ok) {
    if (response.status === 400 && Array.isArray(data?.errors)) {
      return data as unknown as KanalLinkBulkResult
    }
    let message = typeof data?.message === 'string' ? data.message : `Ошибка API (${response.status})`
    const fieldRows = (data as { fieldErrors?: { rows?: string[] } })?.fieldErrors?.rows
    if (fieldRows?.[0]) message = fieldRows[0]
    throw new KanalLinkApiError(message, 'error')
  }

  return data as unknown as KanalLinkBulkResult
}

/** Пакетное создание; большие файлы отправляются частями по 500 строк. */
export async function createKanalLinksBulk(
  apiBase: string,
  getAuthHeaders: () => HeadersInit,
  rows: KanalLinkBulkRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<KanalLinkBulkResult> {
  const total = rows.length
  const created_ids: number[] = []
  const errors: KanalLinkBulkError[] = []
  let errors_truncated = false

  for (let offset = 0; offset < total; offset += BULK_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + BULK_CHUNK_SIZE)
    const res = await createKanalLinksBulkOnce(apiBase, getAuthHeaders, chunk)
    created_ids.push(...res.created_ids)
    errors.push(...res.errors)
    if (res.errors_truncated) errors_truncated = true
    onProgress?.(Math.min(offset + chunk.length, total), total)
  }

  return {
    created_ids,
    errors: errors.slice(0, 300),
    errors_truncated: errors_truncated || errors.length > 300,
    summary: { ok: created_ids.length, failed: total - created_ids.length, total },
  }
}
