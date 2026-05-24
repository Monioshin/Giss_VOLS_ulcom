import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { EdgeEntity, NodeEntity } from '../gisTypes'
import { buildKanalLinksTemplateWorkbook, downloadBlob } from '../import/excelImport'
import { Button } from '../ui/Button'
import { FormField } from '../ui/FormField'
import { Input } from '../ui/Input'
import { createKanalLink, KanalLinkApiError } from './createKanalLink'
import { importKanalLinksFromExcelBuffer } from './importKanalLinksExcel'

type Props = {
  apiBase: string
  getAuthHeaders: () => HeadersInit
  onClose: () => void
  onCreated: (edge: EdgeEntity) => void
  /** После массового импорта — перезагрузить данные с сервера */
  onBulkImported?: (summary: { ok: number; failed: number; total: number }) => void
}

function TkNameField({
  label,
  value,
  onChange,
  apiBase,
  getAuthHeaders,
  listId,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  apiBase: string
  getAuthHeaders: () => HeadersInit
  listId: string
}) {
  const [suggestions, setSuggestions] = useState<NodeEntity[]>([])
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = value.trim()
    if (q.length < 1) {
      setSuggestions([])
      return
    }
    const ac = new AbortController()
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const base = apiBase.replace(/\/+$/, '')
          const url = `${base}/nodes?types=TK&q=${encodeURIComponent(q)}&limit=15&sort=name`
          const headers = new Headers(getAuthHeaders())
          const res = await fetch(url, { headers, signal: ac.signal })
          if (!res.ok) return
          const raw = (await res.json()) as NodeEntity[] | { items: NodeEntity[] }
          const items = Array.isArray(raw) ? raw : raw.items
          if (!ac.signal.aborted) setSuggestions(items)
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return
        }
      })()
    }, 200)
    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [value, apiBase, getAuthHeaders])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current
      if (el && !el.contains(e.target as Node)) setSuggestions([])
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <FormField label={label}>
      <div className="kanal-link-tk-field" ref={wrapRef}>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => value.trim() && setSuggestions((s) => s)}
          list={listId}
          autoComplete="off"
          placeholder="Название колодца"
        />
        <datalist id={listId}>
          {suggestions.map((n) => (
            <option key={n.id} value={n.name} />
          ))}
        </datalist>
        {suggestions.length > 0 && value.trim().length > 0 ? (
          <ul className="kanal-link-suggestions" role="listbox">
            {suggestions.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  role="option"
                  className="kanal-link-suggestion-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(n.name)
                    setSuggestions([])
                  }}
                >
                  {n.name}
                  <span className="kanal-link-suggestion-meta">id {n.id}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </FormField>
  )
}

export function KanalLinkModal({ apiBase, getAuthHeaders, onClose, onCreated, onBulkImported }: Props) {
  const startListId = useId()
  const endListId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [startName, setStartName] = useState('')
  const [endName, setEndName] = useState('')
  const [lengthM, setLengthM] = useState('')
  const [pipeType, setPipeType] = useState('')
  const [diameterMm, setDiameterMm] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const getHeaders = useCallback(() => getAuthHeaders(), [getAuthHeaders])

  const submit = async () => {
    setError(null)
    const len = Number(lengthM.replace(',', '.'))
    if (!startName.trim() || !endName.trim()) {
      setError('Укажите начальный и конечный ТК')
      return
    }
    if (!Number.isFinite(len) || len <= 0) {
      setError('Длина должна быть положительным числом (метры)')
      return
    }
    const passport: Record<string, unknown> = {}
    if (pipeType.trim()) passport.pipe_type = pipeType.trim()
    const d = Number(diameterMm.replace(',', '.'))
    if (Number.isFinite(d) && d > 0) passport.diameter_mm = d
    if (notes.trim()) passport.notes = notes.trim()

    setBusy(true)
    try {
      const edge = await createKanalLink(apiBase, getHeaders, {
        start_tk_name: startName.trim(),
        end_tk_name: endName.trim(),
        length_m: len,
        passport_data: Object.keys(passport).length ? passport : undefined,
      })
      onCreated(edge)
    } catch (err) {
      if (err instanceof KanalLinkApiError) {
        let msg = err.message
        if (err.code === 'ambiguous' && err.candidates?.length) {
          msg += `\n${err.candidates.map((c) => `• ${c.name} (id ${c.id})`).join('\n')}`
        }
        setError(msg)
      } else {
        setError(err instanceof Error ? err.message : 'Не удалось создать участок')
      }
    } finally {
      setBusy(false)
    }
  }

  const importExcel = async (file: File) => {
    setError(null)
    setProgress(null)
    setBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      const report = await importKanalLinksFromExcelBuffer(buffer, apiBase, getHeaders, {
        onProgress: (done, total) => setProgress(`Загрузка: ${done} / ${total}…`),
      })
      if (report && report.created > 0) {
        onBulkImported?.({ ok: report.created, failed: report.skippedNotFound + report.skippedOther, total: report.total })
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка импорта Excel')
    } finally {
      setBusy(false)
      setProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal kanal-link-modal">
        <h3>Канализация по ТК</h3>
        <p className="hint">
          Одна связь вручную или Excel с колонками <strong>точка А</strong>, <strong>точка Б</strong>,{' '}
          <strong>длина</strong> (названия ТК как в базе). На карте — прямая между колодцами; длина в данных — по
          таблице.
        </p>

        <div className="kanal-link-excel-actions gis-btn-group">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => downloadBlob(buildKanalLinksTemplateWorkbook(), 'kanalizaciya-po-tk-shablon.xlsx')}
          >
            Скачать шаблон Excel
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            Загрузить Excel
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importExcel(f)
            }}
          />
        </div>

        <hr className="kanal-link-divider" />

        <TkNameField
          label="Начальный ТК"
          value={startName}
          onChange={setStartName}
          apiBase={apiBase}
          getAuthHeaders={getHeaders}
          listId={startListId}
        />
        <TkNameField
          label="Конечный ТК"
          value={endName}
          onChange={setEndName}
          apiBase={apiBase}
          getAuthHeaders={getHeaders}
          listId={endListId}
        />
        <FormField label="Длина, м">
          <Input
            type="number"
            min={0.01}
            step="any"
            value={lengthM}
            onChange={(e) => setLengthM(e.target.value)}
            placeholder="Например: 125"
          />
        </FormField>
        <FormField label="Тип трубы (необязательно)">
          <Input value={pipeType} onChange={(e) => setPipeType(e.target.value)} />
        </FormField>
        <FormField label="Диаметр, мм (необязательно)">
          <Input type="number" min={1} value={diameterMm} onChange={(e) => setDiameterMm(e.target.value)} />
        </FormField>
        <FormField label="Примечание (необязательно)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        {progress ? (
          <p className="hint" role="status">
            {progress}
          </p>
        ) : null}
        {error ? (
          <p className="hint modal-hint-warn" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </p>
        ) : null}
        <div className="passport-actions gis-btn-group">
          <Button type="button" variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Создание…' : 'Создать'}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
        </div>
      </div>
    </div>
  )
}
