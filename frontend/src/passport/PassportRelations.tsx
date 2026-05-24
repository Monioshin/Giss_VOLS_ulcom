import { useMemo } from 'react'
import type { EdgeEntity, NodeEntity, Project, SelectedObject } from '../gisTypes'
import { FIBER_STATUS_LABELS, normalizeFiberStatus } from '../gisTypes'
import { nodeTypeTitle } from './schemas'

type Props = {
  selected: SelectedObject
  nodes: NodeEntity[]
  edges: EdgeEntity[]
  projects: Project[]
  onOpen: (obj: SelectedObject) => void
}

function RelationRow({
  badge,
  title,
  sub,
  onClick,
}: {
  badge: string
  title: string
  sub?: string
  onClick: () => void
}) {
  return (
    <button type="button" className="passport-relation-row" onClick={onClick}>
      <span className="passport-relation-badge">{badge}</span>
      <span className="passport-relation-body">
        <span className="passport-relation-title">{title}</span>
        {sub ? <span className="passport-relation-sub">{sub}</span> : null}
      </span>
    </button>
  )
}

export function PassportRelations({ selected, nodes, edges, projects, onOpen }: Props) {
  const nodeById = useMemo(() => new Map(nodes.map((x) => [x.id, x])), [nodes])
  const projectById = useMemo(() => new Map(projects.map((x) => [x.id, x])), [projects])

  if (selected.kind === 'node') {
    const n = selected.data
    const incident = edges.filter((e) => e.start_node_id === n.id || e.end_node_id === n.id)
    const parentTk = n.parent_tk_id ? nodeById.get(n.parent_tk_id) : undefined
    const siblingMuftas =
      n.type === 'MUFTA' && n.parent_tk_id
        ? nodes.filter((x) => x.type === 'MUFTA' && x.parent_tk_id === n.parent_tk_id && x.id !== n.id)
        : n.type === 'TK'
          ? nodes.filter((x) => x.type === 'MUFTA' && x.parent_tk_id === n.id)
          : []

    return (
      <div className="passport-relations">
        {parentTk ? (
          <section>
            <h4>Родительский ТК</h4>
            <RelationRow
              badge="ТК"
              title={parentTk.name}
              sub={`#${parentTk.id}`}
              onClick={() => onOpen({ kind: 'node', data: parentTk })}
            />
          </section>
        ) : null}
        {siblingMuftas.length > 0 ? (
          <section>
            <h4>Муфты на ТК</h4>
            {siblingMuftas.map((m) => (
              <RelationRow
                key={m.id}
                badge="М"
                title={m.name}
                sub={`#${m.id}`}
                onClick={() => onOpen({ kind: 'node', data: m })}
              />
            ))}
          </section>
        ) : null}
        <section>
          <h4>Участки ({incident.length})</h4>
          {incident.length === 0 ? <p className="passport-empty">Нет связанных участков</p> : null}
          {incident.map((e) => (
            <RelationRow
              key={e.id}
              badge={e.type === 'OPTOVOLOKNO' ? 'В' : 'К'}
              title={e.type === 'OPTOVOLOKNO' ? e.cable_name || `ВОЛС #${e.id}` : `Канал #${e.id}`}
              sub={`${e.start_node_name} → ${e.end_node_name} · ${Math.round(e.length_m)} м`}
              onClick={() => onOpen({ kind: 'edge', data: e })}
            />
          ))}
        </section>
      </div>
    )
  }

  if (selected.kind === 'edge') {
    const e = selected.data
    const start = nodeById.get(e.start_node_id)
    const end = nodeById.get(e.end_node_id)
    const project = e.project_id ? projectById.get(e.project_id) : undefined

    return (
      <div className="passport-relations">
        <section>
          <h4>Узлы</h4>
          {start ? (
            <RelationRow
              badge={nodeTypeTitle(start.type).slice(0, 2)}
              title={start.name}
              sub={`A · #${start.id}`}
              onClick={() => onOpen({ kind: 'node', data: start })}
            />
          ) : (
            <p className="passport-empty">Начальный узел #{e.start_node_id}</p>
          )}
          {end ? (
            <RelationRow
              badge={nodeTypeTitle(end.type).slice(0, 2)}
              title={end.name}
              sub={`B · #${end.id}`}
              onClick={() => onOpen({ kind: 'node', data: end })}
            />
          ) : (
            <p className="passport-empty">Конечный узел #{e.end_node_id}</p>
          )}
        </section>
        {e.type === 'OPTOVOLOKNO' && project ? (
          <section>
            <h4>Проект</h4>
            <RelationRow
              badge="П"
              title={project.name}
              sub={project.description?.slice(0, 60) || undefined}
              onClick={() => onOpen({ kind: 'project', data: project })}
            />
          </section>
        ) : null}
      </div>
    )
  }

  const p = selected.data
  const projectEdges = edges.filter((e) => e.type === 'OPTOVOLOKNO' && e.project_id === p.id)

  return (
    <div className="passport-relations">
      <section>
        <h4>Участки ВОЛС ({projectEdges.length})</h4>
        {projectEdges.length === 0 ? <p className="passport-empty">Нет участков в проекте</p> : null}
        {projectEdges.map((e) => {
          const st = normalizeFiberStatus(e.cable_status)
          return (
            <RelationRow
              key={e.id}
              badge="В"
              title={e.cable_name || `#${e.id}`}
              sub={`${FIBER_STATUS_LABELS[st]} · ${Math.round(e.length_m)} м`}
              onClick={() => onOpen({ kind: 'edge', data: e })}
            />
          )
        })}
      </section>
    </div>
  )
}
