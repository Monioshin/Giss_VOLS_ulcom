import { useMemo, useState } from 'react'
import type { SpliceBusyLineStyle, SpliceFiberRef, SpliceLinkV1, SpliceV1 } from '../muftaSpliceTypes'
import type { SpliceValidationIssue } from './validation'
import type { SpliceNodeOption, WorkspaceEdge, WorkspaceSpliceNode } from './types'
import { cableDisplayName, refKey } from './utils'

type FiberDisplay = { busy?: boolean; ownerLabel?: string; busyLineColor?: string; busyLineStyle?: SpliceBusyLineStyle }

type CableSection = {
  key: string
  ordinal: number
  title: string
  meta: string
  edgeId: number
  totalFibers: number
}

type Props = {
  node: WorkspaceSpliceNode
  internalPorts: number
  splice: SpliceV1
  validationIssues: SpliceValidationIssue[]
  allSpliceNodes: SpliceNodeOption[]
  saving: boolean
  panelFiberFocus: SpliceFiberRef | null
  selectedLinkIndex: number | null
  incident: WorkspaceEdge[]
  cableSections: CableSection[]
  getFiberDisplay: (edgeId: number, fiberIndex: number) => FiberDisplay
  linkLabel: (ref: SpliceFiberRef) => string
  passportPreview: string
  fiberFilter: 'all' | 'busy' | 'free' | 'linked'
  fiberJumpQuery: string
  onFiberFilterChange: (f: Props['fiberFilter']) => void
  onFiberJumpQueryChange: (q: string) => void
  onSelectNode: (id: number) => void
  onExit: () => void
  onShowOnMap: () => void
  onClearAllLinks: () => void
  onSave: () => void
  onPanelFiberFocus: (ref: SpliceFiberRef | null) => void
  onShowFiberRouteOnMap: (ref: SpliceFiberRef) => void
  onTraceOnDiagram: (ref: SpliceFiberRef) => void
  onRemoveLink: (idx: number) => void
  onClearLinkWaypoints: (idx: number) => void
  onSetLabel: (edgeId: number, fi: number, label: string) => void
  onToggleBusy: (edgeId: number, fi: number) => void
  onSetFiberMeta: (edgeId: number, fi: number, patch: Partial<FiberDisplay>) => void
  onBatchSplice: (edgeA: number, edgeB: number, from: number, to: number) => void
  readOnly?: boolean
}

export function SpliceSidePanel({
  node,
  internalPorts,
  splice,
  validationIssues,
  allSpliceNodes,
  saving,
  panelFiberFocus,
  selectedLinkIndex,
  incident,
  cableSections,
  getFiberDisplay,
  linkLabel,
  passportPreview,
  fiberFilter,
  fiberJumpQuery,
  onFiberFilterChange,
  onFiberJumpQueryChange,
  onSelectNode,
  onExit,
  onShowOnMap,
  onClearAllLinks,
  onSave,
  onPanelFiberFocus,
  onShowFiberRouteOnMap,
  onTraceOnDiagram,
  onRemoveLink,
  onClearLinkWaypoints,
  onSetLabel,
  onToggleBusy,
  onSetFiberMeta,
  onBatchSplice,
  readOnly = false,
}: Props) {
  const [batchA, setBatchA] = useState(incident[0]?.id ?? 0)
  const [batchB, setBatchB] = useState(incident[1]?.id ?? incident[0]?.id ?? 0)
  const [batchFrom, setBatchFrom] = useState(1)
  const [batchTo, setBatchTo] = useState(12)

  const linkedKeys = useMemo(() => {
    const s = new Set<string>()
    for (const l of splice.links) {
      s.add(refKey(l.from))
      s.add(refKey(l.to))
    }
    return s
  }, [splice.links])

  const matchesFilter = (edgeId: number, fi: number) => {
    const k = `${edgeId}:${fi}`
    const d = getFiberDisplay(edgeId, fi)
    if (fiberFilter === 'busy') return !!d.busy
    if (fiberFilter === 'free') return !d.busy && !linkedKeys.has(k)
    if (fiberFilter === 'linked') return linkedKeys.has(k)
    return true
  }

  const handleFiberJump = () => {
    const n = Number(fiberJumpQuery)
    if (!Number.isFinite(n) || n < 1) return
    for (const sec of cableSections) {
      if (n <= sec.totalFibers) {
        onPanelFiberFocus({ edgeId: sec.edgeId, fiberIndex: n })
        return
      }
    }
  }

  return (
  <>
    <div className="splice-workspace__side-top">
      <label className="splice-mufta-picker">
        <span className="splice-mufta-picker__label">Муфта / кросс</span>
        <select className="gis-select" value={node.id} onChange={(ev) => onSelectNode(Number(ev.target.value))}>
          {allSpliceNodes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.kind === 'KROSS' ? 'Кросс' : 'Муфта'} · {m.name} (id {m.id})
            </option>
          ))}
        </select>
      </label>
      <h2 className="splice-workspace__title">Сварка</h2>
      <div className="splice-workspace__side-actions gis-btn-group">
        <button type="button" className="splice-workspace__btn gis-btn gis-btn--secondary" onClick={onExit}>
          К выбору узла
        </button>
        <button type="button" className="splice-workspace__btn gis-btn gis-btn--secondary" onClick={onShowOnMap}>
          На карту
        </button>
        {!readOnly ? (
          <button type="button" className="splice-workspace__btn splice-workspace__btn--warn gis-btn gis-btn--danger" onClick={onClearAllLinks} disabled={splice.links.length === 0}>
            Разварка
          </button>
        ) : null}
        {!readOnly ? (
          <button type="button" className="splice-workspace__btn splice-workspace__btn--primary gis-btn gis-btn--primary" disabled={saving} onClick={onSave}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        ) : (
          <span className="hint">Режим просмотра</span>
        )}
      </div>
    </div>
    <aside className="splice-workspace__side-scroll">
      {validationIssues.length > 0 && (
        <>
          <h3>Проверка</h3>
          <ul className="splice-validation-list">
            {validationIssues.map((iss, i) => (
              <li key={i} className={iss.level === 'warn' ? 'splice-validation-list--warn' : ''}>
                {iss.message}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Паспорт узла</h3>
      <dl className="splice-passport-dl">
        <dt>Координаты</dt>
        <dd>
          {node.lat.toFixed(6)}, {node.lng.toFixed(6)}
        </dd>
        <dt>ID</dt>
        <dd>{node.id}</dd>
        <dt>Тип</dt>
        <dd>{node.type === 'KROSS' ? 'Кросс' : node.type === 'MUFTA' ? 'Муфта' : node.type}</dd>
        {node.type === 'KROSS' && (
          <>
            <dt>Портов</dt>
            <dd>{internalPorts}</dd>
          </>
        )}
      </dl>
      <details className="splice-passport-json">
        <summary>passport_data (JSON)</summary>
        <pre>{passportPreview}</pre>
      </details>

      <h3>Связи</h3>
      {splice.links.length === 0 ? (
        <p className="hint">Нет сварок. Режим связей + клик по двум волокнам.</p>
      ) : (
        <ul className="splice-link-list">
          {splice.links.map((link: SpliceLinkV1, idx: number) => (
            <li key={`${refKey(link.from)}-${refKey(link.to)}-${idx}`} className={selectedLinkIndex === idx ? 'splice-link-list__item--active' : ''}>
              <span className="splice-link-list__pair">
                {linkLabel(link.from)} ↔ {linkLabel(link.to)}
                {link.waypoints?.length ? ` · изгибов: ${link.waypoints.length}` : ''}
              </span>
              <div className="splice-link-list__actions">
                {link.waypoints?.length ? (
                  <button type="button" className="splice-link-remove gis-btn gis-btn--ghost gis-btn--sm" onClick={() => onClearLinkWaypoints(idx)}>
                    Сброс изгиба
                  </button>
                ) : null}
                <button type="button" className="splice-link-remove gis-btn gis-btn--ghost gis-btn--sm" onClick={() => onRemoveLink(idx)}>
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {incident.length >= 2 && (
        <details className="splice-batch">
          <summary>Пакетная сварка N↔N</summary>
          <div className="splice-batch__form">
            <label>
              Кабель A
              <select className="gis-select" value={batchA} onChange={(e) => setBatchA(Number(e.target.value))}>
                {incident.map((e) => (
                  <option key={e.id} value={e.id}>
                    {cableDisplayName(e)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Кабель B
              <select className="gis-select" value={batchB} onChange={(e) => setBatchB(Number(e.target.value))}>
                {incident.map((e) => (
                  <option key={e.id} value={e.id}>
                    {cableDisplayName(e)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              С #<input className="gis-input" type="number" min={1} value={batchFrom} onChange={(e) => setBatchFrom(Number(e.target.value) || 1)} />
            </label>
            <label>
              По #<input className="gis-input" type="number" min={batchFrom} value={batchTo} onChange={(e) => setBatchTo(Number(e.target.value) || batchFrom)} />
            </label>
            <button
              type="button"
              className="gis-btn gis-btn--primary"
              disabled={batchA === batchB}
              onClick={() => onBatchSplice(batchA, batchB, batchFrom, batchTo)}
            >
              Связать диапазон
            </button>
          </div>
        </details>
      )}

      <h3>Кабели и волокна</h3>
      <div className="splice-fiber-filters gis-toolbar">
        <select className="gis-select gis-select--sm" value={fiberFilter} onChange={(e) => onFiberFilterChange(e.target.value as Props['fiberFilter'])}>
          <option value="all">Все</option>
          <option value="busy">Занятые</option>
          <option value="free">Свободные</option>
          <option value="linked">Со сваркой</option>
        </select>
        <input
          className="gis-input gis-input--sm"
          type="search"
          placeholder="# волокна…"
          value={fiberJumpQuery}
          onChange={(e) => onFiberJumpQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFiberJump()}
        />
        <button type="button" className="gis-btn gis-btn--secondary gis-btn--sm" onClick={handleFiberJump}>
          Перейти
        </button>
      </div>

      {panelFiberFocus && (
        <div className="splice-fiber-panel-actions gis-btn-group">
          <button type="button" className="gis-btn gis-btn--secondary gis-btn--sm" onClick={() => onPanelFiberFocus(null)}>
            Снять выбор
          </button>
          <button type="button" className="gis-btn gis-btn--secondary gis-btn--sm" onClick={() => onTraceOnDiagram(panelFiberFocus)}>
            Маршрут на схеме
          </button>
          <button type="button" className="gis-btn gis-btn--primary gis-btn--sm" onClick={() => onShowFiberRouteOnMap(panelFiberFocus)}>
            На карте
          </button>
        </div>
      )}

      <div className="splice-fiber-forms">
        {cableSections.map((sec) => (
          <details key={sec.key} className="splice-cable-acc" open={panelFiberFocus?.edgeId === sec.edgeId}>
            <summary className="splice-cable-acc__summary">
              <span className="splice-cable-acc__n">{sec.ordinal}.</span>
              <span className="splice-cable-acc__title">{sec.title}</span>
              <span className="splice-cable-acc__meta">{sec.meta}</span>
            </summary>
            <div className="splice-cable-acc__body">
              <div className="splice-fiber-grid">
                {Array.from({ length: sec.totalFibers }, (_, i) => i + 1)
                  .filter((fi) => matchesFilter(sec.edgeId, fi))
                  .map((fi) => {
                    const d = getFiberDisplay(sec.edgeId, fi)
                    const focused = panelFiberFocus && refKey(panelFiberFocus) === refKey({ edgeId: sec.edgeId, fiberIndex: fi })
                    return (
                      <div
                        key={fi}
                        className={`splice-fiber-block ${focused ? 'splice-fiber-block--focused' : ''}`}
                        data-splice-fiber={refKey({ edgeId: sec.edgeId, fiberIndex: fi })}
                        onClick={() => onPanelFiberFocus({ edgeId: sec.edgeId, fiberIndex: fi })}
                      >
                        <div className="splice-fiber-row">
                          <span className="splice-fiber-row-num">#{fi}</span>
                          <input
                            className="gis-input gis-input--sm"
                            type="text"
                            placeholder="подпись"
                            value={d.ownerLabel ?? ''}
                            onChange={(ev) => onSetLabel(sec.edgeId, fi, ev.target.value)}
                          />
                          <label className="splice-fiber-busy">
                            <input type="checkbox" checked={!!d.busy} onChange={() => onToggleBusy(sec.edgeId, fi)} />
                            занято
                          </label>
                        </div>
                        {d.busy ? (
                          <div className="splice-fiber-busy-style">
                            <input
                              type="color"
                              title="Цвет линии"
                              value={d.busyLineColor?.trim() || '#ea580c'}
                              onChange={(ev) => onSetFiberMeta(sec.edgeId, fi, { busyLineColor: ev.target.value })}
                            />
                            <select
                              className="gis-select gis-select--sm"
                              value={d.busyLineStyle ?? 'solid'}
                              onChange={(ev) => onSetFiberMeta(sec.edgeId, fi, { busyLineStyle: ev.target.value as SpliceBusyLineStyle })}
                            >
                              <option value="solid">сплошная</option>
                              <option value="dashed">штрихи</option>
                              <option value="dotted">точки</option>
                              <option value="dashdot">штрих-пунктир</option>
                            </select>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
              </div>
            </div>
          </details>
        ))}
      </div>
    </aside>
  </>
  )
}
