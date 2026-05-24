import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import type { EdgeEntity, FiberCableStatus, NodeEntity, Project, SelectedObject } from '../gisTypes'
import {
  FIBER_LINE_COLORS,
  FIBER_STATUS_LABELS,
  FIBER_STATUS_ORDER,
  normalizeFiberStatus,
} from '../gisTypes'
import { getEdgeFiberUsage } from '../muftaSpliceTypes'
import { EdgeOpticalFiberGrid } from './EdgeOpticalFiberGrid'
import { PassportRelations } from './PassportRelations'
import {
  passportHeaderTitle,
  nodeTypeTitle,
  nodeSpliceSummary,
  projectStats,
  readKanalPassport,
  readKrossPassport,
  readMuftaPassport,
  readOpticalPassport,
  readPiketPassport,
  readProjectPassport,
  readTkPassport,
  validateEdge,
  validateNode,
  validateProject,
  writeKanalPassport,
  writeKrossPassport,
  writeMuftaPassport,
  writeOpticalPassport,
  writePiketPassport,
  writeProjectPassport,
  writeTkPassport,
  type PassportTab,
} from './schemas'

type Props = {
  selected: SelectedObject
  nodes: NodeEntity[]
  edges: EdgeEntity[]
  projects: Project[]
  onChange: (obj: SelectedObject) => void
  onClose: () => void
  onSave: () => void | Promise<void>
  onDelete?: () => void
  onShowOnMap: () => void
  onOpenPassport: (obj: SelectedObject) => void
  onSplice: (nodeId: number) => void
  onLineBend: (edgeId: number) => void
  lineBendEdgeId: number | null
  onFinishBend?: () => void
  readOnly?: boolean
}

function formatTs(ts?: string) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('ru-RU')
  } catch {
    return ts
  }
}

function CoordsReadonly({ lat, lng }: { lat: number; lng: number }) {
  const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
  return (
    <div className="passport-coords">
      <input readOnly value={text} />
      <button type="button" onClick={() => void navigator.clipboard.writeText(text)}>
        Копировать
      </button>
    </div>
  )
}

export function PassportDrawer({
  selected,
  nodes,
  edges,
  projects,
  onChange,
  onClose,
  onSave,
  onDelete,
  onShowOnMap,
  onOpenPassport,
  onSplice,
  onLineBend,
  lineBendEdgeId,
  onFinishBend,
  readOnly = false,
}: Props) {
  const [tab, setTab] = useState<PassportTab>('main')
  const [jsonRaw, setJsonRaw] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  useEffect(() => {
    setTab('main')
    setJsonError(null)
    setValidationErrors([])
    if (selected.kind === 'node' || selected.kind === 'edge') {
      setJsonRaw(JSON.stringify(selected.data.passport_data, null, 2))
    } else {
      setJsonRaw(JSON.stringify(selected.data.passport_data ?? {}, null, 2))
    }
  }, [selected])

  const tkNodes = nodes.filter((n) => n.type === 'TK')

  const patchNode = useCallback(
    (patch: Partial<NodeEntity>) => {
      if (selected.kind !== 'node') return
      onChange({ kind: 'node', data: { ...selected.data, ...patch } })
    },
    [selected, onChange],
  )

  const patchEdge = useCallback(
    (patch: Partial<EdgeEntity>) => {
      if (selected.kind !== 'edge') return
      onChange({ kind: 'edge', data: { ...selected.data, ...patch } })
    },
    [selected, onChange],
  )

  const patchProject = useCallback(
    (patch: Partial<Project>) => {
      if (selected.kind !== 'project') return
      onChange({ kind: 'project', data: { ...selected.data, ...patch } })
    },
    [selected, onChange],
  )

  const patchPassport = useCallback(
    (nextPd: Record<string, unknown>) => {
      if (selected.kind === 'node') onChange({ kind: 'node', data: { ...selected.data, passport_data: nextPd } })
      else if (selected.kind === 'edge') onChange({ kind: 'edge', data: { ...selected.data, passport_data: nextPd } })
    },
    [selected, onChange],
  )

  const handleSaveClick = () => {
    let issues: { message: string }[] = []
    if (selected.kind === 'node') issues = validateNode(selected.data, tkNodes)
    else if (selected.kind === 'edge') issues = validateEdge(selected.data)
    else issues = validateProject(selected.data)
    if (issues.length) {
      setValidationErrors(issues.map((i) => i.message))
      return
    }
    setValidationErrors([])
    void onSave()
  }

  const resetJsonFromForm = () => {
    if (selected.kind === 'node' || selected.kind === 'edge') {
      setJsonRaw(JSON.stringify(selected.data.passport_data, null, 2))
    }
    setJsonError(null)
  }

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonRaw) as Record<string, unknown>
      if (selected.kind === 'project') {
        onChange({ kind: 'project', data: { ...selected.data, passport_data: parsed } })
      } else if (selected.kind === 'node') {
        patchNode({ passport_data: parsed })
      } else {
        patchEdge({ passport_data: parsed })
      }
      setJsonError(null)
    } catch {
      setJsonError('Некорректный JSON')
    }
  }

  const metaId = selected.data.id
  const createdAt =
    selected.kind === 'project'
      ? selected.data.created_at
      : (selected.data as NodeEntity | EdgeEntity).created_at
  const updatedAt = selected.kind !== 'project' ? (selected.data as NodeEntity | EdgeEntity).updated_at : undefined

  const headerAccent =
    selected.kind === 'edge' && selected.data.type === 'OPTOVOLOKNO'
      ? FIBER_LINE_COLORS[normalizeFiberStatus(selected.data.cable_status)]
      : selected.kind === 'node'
        ? '#0ea5e9'
        : '#6366f1'

  return (
    <>
      <div className="passport-backdrop" role="presentation" onClick={onClose} />
      <aside className={`passport passport--drawer${readOnly ? ' passport--readonly' : ''}`} role="dialog" aria-labelledby="passport-drawer-title">
        <div className="passport-drawer__head passport-drawer__head--rich">
          <div className="passport-drawer__title-block" style={{ borderLeftColor: headerAccent }}>
            <h3 id="passport-drawer-title">{passportHeaderTitle(selected.kind, selected.data)}</h3>
            <p className="passport-drawer__meta">
              id {metaId}
              {createdAt ? ` · создан ${formatTs(createdAt)}` : ''}
              {updatedAt ? ` · обновлён ${formatTs(updatedAt)}` : ''}
            </p>
          </div>
          <div className="passport-drawer__head-actions gis-btn-group">
            <Button type="button" variant="secondary" size="sm" onClick={onShowOnMap}>
              На карте
            </Button>
            {!readOnly ? (
              <Button type="button" variant="primary" size="sm" onClick={handleSaveClick}>
                Сохранить
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="icon" className="passport-drawer__close" onClick={onClose} aria-label="Закрыть">
              ×
            </Button>
          </div>
        </div>

        <nav className="passport-tabs" aria-label="Разделы паспорта">
          {(['main', 'relations', 'extra'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'active' : ''}
              onClick={() => setTab(t)}
            >
              {t === 'main' ? 'Основное' : t === 'relations' ? 'Связи' : 'Дополнительно'}
            </button>
          ))}
        </nav>

        <div className="passport-drawer__body">
          {validationErrors.length > 0 ? (
            <ul className="passport-validation">
              {validationErrors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}

          {tab === 'main' && selected.kind === 'project' && (
            <ProjectMainForm selected={selected.data} edges={edges} onChange={patchProject} />
          )}
          {tab === 'main' && selected.kind === 'node' && (
            <NodeMainForm
              node={selected.data}
              tkNodes={tkNodes}
              edges={edges}
              onPatch={patchNode}
              onSplice={onSplice}
            />
          )}
          {tab === 'main' && selected.kind === 'edge' && (
            <EdgeMainForm edge={selected.data} onPatch={patchEdge} onLineBend={onLineBend} readOnly={readOnly} />
          )}

          {tab === 'relations' && (
            <PassportRelations
              selected={selected}
              nodes={nodes}
              edges={edges}
              projects={projects}
              onOpen={onOpenPassport}
            />
          )}

          {tab === 'extra' && (
            <ExtraTab
              selected={selected}
              jsonRaw={jsonRaw}
              jsonError={jsonError}
              onJsonChange={setJsonRaw}
              onApplyJson={applyJson}
              onResetJson={resetJsonFromForm}
              onNotesChange={(notes) => {
                if (selected.kind === 'node' || selected.kind === 'edge') {
                  patchPassport({ ...selected.data.passport_data, notes })
                } else if (selected.kind === 'project') {
                  onChange({
                    kind: 'project',
                    data: {
                      ...selected.data,
                      passport_data: writeProjectPassport(
                        { ...readProjectPassport(selected.data.passport_data ?? {}), notes },
                        selected.data.passport_data ?? {},
                      ),
                    },
                  })
                }
              }}
            />
          )}
        </div>

        <div className="passport-drawer__foot">
          <div className="passport-actions gis-btn-group">
            {onDelete && !readOnly && selected.kind !== 'project' ? (
              <button type="button" className="gis-btn gis-btn--danger passport-delete-btn" onClick={onDelete}>
                Удалить
              </button>
            ) : null}
            {lineBendEdgeId && selected.kind === 'edge' && selected.data.id === lineBendEdgeId && onFinishBend ? (
              <button type="button" className="gis-btn gis-btn--secondary" onClick={onFinishBend}>
                Завершить изгибы
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  )
}

function ProjectMainForm({
  selected,
  edges,
  onChange,
}: {
  selected: Project
  edges: EdgeEntity[]
  onChange: (p: Partial<Project>) => void
}) {
  const pd = readProjectPassport(selected.passport_data ?? {})
  const stats = projectStats(selected.id, edges)
  const setPd = (patch: Partial<typeof pd>) => {
    const next = writeProjectPassport({ ...pd, ...patch }, selected.passport_data ?? {})
    onChange({ passport_data: next })
  }

  return (
    <div className="passport-fields">
      <label>Название</label>
      <input className="gis-input" value={selected.name} onChange={(e) => onChange({ name: e.target.value })} />
      <label>Описание</label>
      <textarea className="gis-textarea" value={selected.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} />
      <label>Заказчик</label>
      <input className="gis-input" value={pd.customer} onChange={(e) => setPd({ customer: e.target.value })} />
      <label>Договор</label>
      <input className="gis-input" value={pd.contract} onChange={(e) => setPd({ contract: e.target.value })} />
      <div className="passport-summary">
        <p>
          Участков ВОЛС: <strong>{stats.edgeCount}</strong> · суммарная длина:{' '}
          <strong>{Math.round(stats.totalLen)} м</strong>
        </p>
        {stats.accidents > 0 ? (
          <p className="passport-summary--warn">Аварийных участков: {stats.accidents}</p>
        ) : null}
      </div>
    </div>
  )
}

function NodeMainForm({
  node,
  tkNodes,
  edges,
  onPatch,
  onSplice,
}: {
  node: NodeEntity
  tkNodes: NodeEntity[]
  edges: EdgeEntity[]
  onPatch: (p: Partial<NodeEntity>) => void
  onSplice: (id: number) => void
}) {
  const pd = node.passport_data

  return (
    <div className="passport-fields">
      <label>Название</label>
      <input className="gis-input" value={node.name} onChange={(e) => onPatch({ name: e.target.value })} />
      <label>Тип</label>
      <input className="gis-input" readOnly value={nodeTypeTitle(node.type)} />
      <label>Координаты</label>
      <CoordsReadonly lat={node.lat} lng={node.lng} />
      <p className="hint">Переместить узел можно на карте инструментом выбора.</p>

      {node.type === 'TK' && <TkFields pd={pd} onPatch={onPatch} />}
      {node.type === 'MUFTA' && (
        <MuftaFields node={node} tkNodes={tkNodes} edges={edges} pd={pd} onPatch={onPatch} onSplice={onSplice} />
      )}
      {node.type === 'KROSS' && (
        <KrossFields node={node} pd={pd} edges={edges} onPatch={onPatch} onSplice={onSplice} />
      )}
      {node.type === 'PIKET' && <PiketFields pd={pd} onPatch={onPatch} />}
    </div>
  )
}

function TkFields({
  pd,
  onPatch,
}: {
  pd: Record<string, unknown>
  onPatch: (p: Partial<NodeEntity>) => void
}) {
  const form = readTkPassport(pd)
  const set = (patch: Partial<typeof form>) =>
    onPatch({ passport_data: writeTkPassport({ ...form, ...patch }, pd) })
  return (
    <>
      <label>Статус</label>
      <input value={form.status} onChange={(e) => set({ status: e.target.value })} />
      <label>Адрес</label>
      <input value={form.address} onChange={(e) => set({ address: e.target.value })} />
      <label>Глубина, м</label>
      <input value={form.depth_m} onChange={(e) => set({ depth_m: e.target.value })} />
      <label>Инв. номер</label>
      <input value={form.inventory_no} onChange={(e) => set({ inventory_no: e.target.value })} />
    </>
  )
}

function MuftaFields({
  node,
  tkNodes,
  edges,
  pd,
  onPatch,
  onSplice,
}: {
  node: NodeEntity
  tkNodes: NodeEntity[]
  edges: EdgeEntity[]
  pd: Record<string, unknown>
  onPatch: (p: Partial<NodeEntity>) => void
  onSplice: (id: number) => void
}) {
  const form = readMuftaPassport(pd)
  const summary = nodeSpliceSummary(node, edges)
  const set = (patch: Partial<typeof form>) =>
    onPatch({ passport_data: writeMuftaPassport({ ...form, ...patch }, pd) })
  return (
    <>
      <label>Родительский ТК</label>
      <select
        value={node.parent_tk_id ?? ''}
        onChange={(e) => onPatch({ parent_tk_id: Number(e.target.value) || null })}
      >
        <option value="">— выбрать —</option>
        {tkNodes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <label>Резерв волокон</label>
      <input value={form.reserve_cores} onChange={(e) => set({ reserve_cores: e.target.value })} />
      <label>Тип сварки</label>
      <input value={form.splice_type} onChange={(e) => set({ splice_type: e.target.value })} />
      <label>Дата установки</label>
      <input type="date" value={form.install_date} onChange={(e) => set({ install_date: e.target.value })} />
      <button type="button" className="gis-btn gis-btn--primary passport-mufta-splice-btn" onClick={() => onSplice(node.id)}>
        Сварка / схема
      </button>
      <p className="hint">
        Связей в схеме: {summary.linkCount} · инцидентных кабелей: {summary.cableCount}
      </p>
    </>
  )
}

function KrossFields({
  node,
  pd,
  edges,
  onPatch,
  onSplice,
}: {
  node: NodeEntity
  pd: Record<string, unknown>
  edges: EdgeEntity[]
  onPatch: (p: Partial<NodeEntity>) => void
  onSplice: (id: number) => void
}) {
  const form = readKrossPassport(pd)
  const summary = nodeSpliceSummary(node, edges)
  const set = (patch: Partial<typeof form>) =>
    onPatch({ passport_data: writeKrossPassport({ ...form, ...patch }, pd) })
  return (
    <>
      <label>Портов</label>
      <input
        type="number"
        min={1}
        max={288}
        value={form.cross_ports}
        onChange={(e) => set({ cross_ports: Number(e.target.value) || 8 })}
      />
      <label>Стойка / шкаф</label>
      <input value={form.rack} onChange={(e) => set({ rack: e.target.value })} />
      <button type="button" className="gis-btn gis-btn--primary passport-mufta-splice-btn" onClick={() => onSplice(node.id)}>
        Сварка / схема
      </button>
      <p className="hint">
        Связей: {summary.linkCount} · кабелей: {summary.cableCount}
      </p>
    </>
  )
}

function PiketFields({
  pd,
  onPatch,
}: {
  pd: Record<string, unknown>
  onPatch: (p: Partial<NodeEntity>) => void
}) {
  const form = readPiketPassport(pd)
  const set = (patch: Partial<typeof form>) =>
    onPatch({ passport_data: writePiketPassport({ ...form, ...patch }, pd) })
  return (
    <>
      <label>Метка</label>
      <input value={form.label} onChange={(e) => set({ label: e.target.value })} />
      <label>Пикетаж</label>
      <input value={form.mileage} onChange={(e) => set({ mileage: e.target.value })} />
    </>
  )
}

function EdgeMainForm({
  edge,
  onPatch,
  onLineBend,
  readOnly = false,
}: {
  edge: EdgeEntity
  onPatch: (p: Partial<EdgeEntity>) => void
  onLineBend: (id: number) => void
  readOnly?: boolean
}) {
  if (edge.type === 'KANALIZACIYA') {
    const form = readKanalPassport(edge.passport_data)
    const set = (patch: Partial<typeof form>) =>
      onPatch({ passport_data: writeKanalPassport({ ...form, ...patch }, edge.passport_data) })
    return (
      <div className="passport-fields">
        <label>Длина, м</label>
        <input
          className="gis-input"
          type="number"
          min={0}
          value={edge.length_m}
          onChange={(e) => onPatch({ length_m: Number(e.target.value) || 0 })}
        />
        <label>Тип трубы</label>
        <input className="gis-input" value={form.pipe_type} onChange={(e) => set({ pipe_type: e.target.value })} />
        <label>Диаметр, мм</label>
        <input className="gis-input" value={form.diameter_mm} onChange={(e) => set({ diameter_mm: e.target.value })} />
        <label>Материал</label>
        <input className="gis-input" value={form.material} onChange={(e) => set({ material: e.target.value })} />
      </div>
    )
  }

  const opticalPd = readOpticalPassport(edge.passport_data)
  const usage = getEdgeFiberUsage(edge.passport_data)
  const st = normalizeFiberStatus(edge.cable_status)

  const setOpticalPd = (patch: Partial<typeof opticalPd>, usageNext = usage) => {
    onPatch({
      passport_data: writeOpticalPassport({ ...opticalPd, ...patch }, edge.passport_data, usageNext),
    })
  }

  return (
    <div className="passport-fields">
      <label>Название кабеля</label>
      <input className="gis-input" value={edge.cable_name || ''} onChange={(e) => onPatch({ cable_name: e.target.value })} />
      <label>Длина, м</label>
      <input
        className="gis-input"
        type="number"
        min={0}
        value={edge.length_m}
        onChange={(e) => onPatch({ length_m: Number(e.target.value) || 0 })}
      />
      <label>Всего волокон</label>
      <input
        className="gis-input"
        type="number"
        min={1}
        value={edge.total_fibers ?? ''}
        onChange={(e) => onPatch({ total_fibers: Number(e.target.value) || 0 })}
      />
      <label>Занято волокон</label>
      <input
        className="gis-input"
        type="number"
        min={0}
        value={edge.used_fibers ?? ''}
        onChange={(e) => onPatch({ used_fibers: Number(e.target.value) || 0 })}
      />
      <label>Статус участка</label>
      <select
        className="gis-select"
        value={st}
        onChange={(e) => onPatch({ cable_status: e.target.value as FiberCableStatus })}
        style={{ borderLeft: `4px solid ${FIBER_LINE_COLORS[st]}` }}
      >
        {FIBER_STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {FIBER_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <label>Маркировка</label>
      <input className="gis-input" value={opticalPd.marking} onChange={(e) => setOpticalPd({ marking: e.target.value })} />
      <EdgeOpticalFiberGrid
        totalFibers={edge.total_fibers ?? 1}
        usedFibers={edge.used_fibers ?? 0}
        fiberUsage={usage}
        onUsageChange={(usageNext, usedCount) => {
          onPatch({
            used_fibers: usedCount,
            passport_data: writeOpticalPassport(opticalPd, edge.passport_data, usageNext),
          })
        }}
      />
      {!readOnly ? (
        <button type="button" className="gis-btn gis-btn--secondary" onClick={() => onLineBend(edge.id)}>
          Изгиб по линии (на карте)
        </button>
      ) : null}
    </div>
  )
}

function ExtraTab({
  selected,
  jsonRaw,
  jsonError,
  onJsonChange,
  onApplyJson,
  onResetJson,
  onNotesChange,
}: {
  selected: SelectedObject
  jsonRaw: string
  jsonError: string | null
  onJsonChange: (s: string) => void
  onApplyJson: () => void
  onResetJson: () => void
  onNotesChange: (notes: string) => void
}) {
  const notes =
    selected.kind === 'node' || selected.kind === 'edge'
      ? String(selected.data.passport_data.notes ?? '')
      : readProjectPassport(selected.kind === 'project' ? selected.data.passport_data ?? {} : {}).notes

  return (
    <div className="passport-fields">
      <label>Заметки</label>
      <textarea className="gis-textarea" value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={4} />
      <div className="passport-attachments-stub">
        <h4>Вложения</h4>
        <p className="hint">Загрузка файлов — в следующей версии.</p>
      </div>
      <details className="passport-json-details">
        <summary>JSON (для опытных)</summary>
        <textarea
          className={jsonError ? 'passport-json--error' : ''}
          value={jsonRaw}
          onChange={(e) => onJsonChange(e.target.value)}
          rows={12}
        />
        {jsonError ? <p className="passport-json-error">{jsonError}</p> : null}
        <div className="passport-json-actions gis-btn-group">
          <button type="button" className="gis-btn gis-btn--primary" onClick={onApplyJson}>
            Применить JSON
          </button>
          <button type="button" className="gis-btn gis-btn--secondary" onClick={onResetJson}>
            Сбросить к форме
          </button>
        </div>
      </details>
    </div>
  )
}
