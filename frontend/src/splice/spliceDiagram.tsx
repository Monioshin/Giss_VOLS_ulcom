import { forwardRef, useMemo, type CSSProperties, type ReactNode } from 'react'
import {
  busyLineDashArray,
  type SpliceFiberMeta,
  type SpliceFiberRef,
  type SpliceLinkV1,
  type SpliceLinkWaypoint,
} from '../muftaSpliceTypes'
import { cableAccentColor, ituFiberColor } from './fiberColors'
import type { CableBand, CableLabelMode, FiberLabelMode, LayoutResult, PortGeom } from './layout'
import { bundleOffsetForLinkIndex, linkPathForSplice } from './linkGeometry'
import { FIBER_OWNER_DIAGRAM_PITCH_MIN } from './layout'
import { FIBER_HIT_R, FIBER_VIS_R, spliceLinkStrokeStyle } from './spliceStyles'
import type { WorkspaceEdge, WorkspaceSpliceNode } from './types'
import { cableDisplayName, refKey } from './utils'

type FiberDisplay = SpliceFiberMeta

type Props = {
  gridPatternId: string
  layout: LayoutResult
  node: WorkspaceSpliceNode
  incident: WorkspaceEdge[]
  internalPorts: number
  links: SpliceLinkV1[]
  connectMode: boolean
  linkPick: SpliceFiberRef | null
  linkDraftWaypoints: SpliceLinkWaypoint[]
  cursorSvg: { x: number; y: number } | null
  selectedLinkIndex: number | null
  panelFiberFocus: SpliceFiberRef | null
  hoverFiberRef: SpliceFiberRef | null
  traceHighlightKeys: Set<string>
  showItuColors: boolean
  edgeById: Map<number, WorkspaceEdge>
  getFiberDisplay: (edgeId: number, fiberIndex: number) => FiberDisplay
  onSvgContextMenu: (e: React.MouseEvent<SVGSVGElement>) => void
  onSvgPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void
  onFiberPointerDown: (ref: SpliceFiberRef, e: React.PointerEvent) => void
  onFiberClick: (ref: SpliceFiberRef) => void
  onFiberHover: (ref: SpliceFiberRef | null) => void
  onLinkClick: (index: number) => void
  onWaypointPointerDown: (linkIndex: number, wpIndex: number, e: React.PointerEvent) => void
  onWaypointContextMenu: (linkIndex: number, wpIndex: number, e: React.MouseEvent) => void
}

function findLinkForFiber(links: SpliceLinkV1[], ref: SpliceFiberRef): SpliceLinkV1 | null {
  const k = refKey(ref)
  return links.find((l) => refKey(l.from) === k || refKey(l.to) === k) ?? null
}

function partnerRef(link: SpliceLinkV1, ref: SpliceFiberRef): SpliceFiberRef {
  return refKey(link.from) === refKey(ref) ? link.to : link.from
}

function fiberLabelTransform(mode: FiberLabelMode, pivotX: number, pivotY: number): string | null {
  if (mode === 'vertical-above') return `rotate(90 ${pivotX} ${pivotY})`
  if (mode === 'vertical-below') return `rotate(-90 ${pivotX} ${pivotY})`
  return null
}

function cableTitleLimit(mode: CableLabelMode): number {
  return mode === 'vertical-left' || mode === 'vertical-right' ? 18 : 22
}

function renderCableBandLabel(band: CableBand, title: string, meta: string): ReactNode {
  const lim = cableTitleLimit(band.labelMode)
  const titleShow = title.length > lim ? `${title.slice(0, lim)}…` : title
  const accent = cableAccentColor(band.edgeId)

  if (band.labelMode === 'horizontal-below' || band.labelMode === 'horizontal-above') {
    const metaDy = band.labelMode === 'horizontal-above' ? -11 : 11
    const titleDy = band.labelMode === 'horizontal-above' ? -22 : 0
    return (
      <g key={`band-${band.edgeId}-${band.side}-${band.x}`} className="splice-cable-band">
        <rect x={band.x} y={band.y} width={band.w} height={band.h} rx={4} className="splice-cable-band__bg" style={{ stroke: accent }} />
        <text
          x={band.labelAnchorX}
          y={band.labelAnchorY + titleDy}
          textAnchor="middle"
          className="splice-cable-band__title"
        >
          {titleShow}
        </text>
        <text
          x={band.labelAnchorX}
          y={band.labelAnchorY + metaDy}
          textAnchor="middle"
          className="splice-cable-band__meta"
        >
          {meta}
        </text>
      </g>
    )
  }

  const rot = band.labelMode === 'vertical-left' ? -90 : 90
  return (
    <g key={`band-${band.edgeId}-${band.side}-${band.x}`} className="splice-cable-band">
      <rect x={band.x} y={band.y} width={band.w} height={band.h} rx={4} className="splice-cable-band__bg" style={{ stroke: accent }} />
      <g
        className="splice-cable-band__label-vertical"
        transform={`translate(${band.labelAnchorX},${band.labelAnchorY}) rotate(${rot})`}
      >
        <text x={0} y={0} textAnchor="middle" className="splice-cable-band__title splice-cable-band__title--vertical">
          {titleShow}
        </text>
        <text x={0} y={12} textAnchor="middle" className="splice-cable-band__meta splice-cable-band__meta--vertical">
          {meta}
        </text>
      </g>
    </g>
  )
}

function renderFiberPort(
  p: PortGeom,
  edgeId: number,
  fi: number,
  disp: FiberDisplay,
  accent: string,
  opts: {
    picked: boolean
    panelHi: boolean
    traceHi: boolean
    hoverHi: boolean
    showItu: boolean
    isInternal: boolean
    tooltip: string
    onPointerDown: (e: React.PointerEvent) => void
    onClick: () => void
    onHover: (on: boolean) => void
  },
): ReactNode {
  const busyDash = disp.busy ? busyLineDashArray(disp.busyLineStyle) : undefined
  const busyStroke = disp.busy ? disp.busyLineColor?.trim() || '#ea580c' : undefined
  const owner = (disp.ownerLabel || '').trim()
  const ownerShow = owner.length > 26 ? `${owner.slice(0, 26)}…` : owner
  const labelRot = fiberLabelTransform(p.fiberLabelMode, p.xLabel, p.yLabel)
  const itu = opts.showItu && fi <= 12 ? ituFiberColor(fi) : undefined
  const numFill = itu ?? (opts.traceHi ? '#0891b2' : '#0f172a')

  const showOwnerOnDiagram =
    !!ownerShow &&
    (p.fiberPitch === 0 || p.fiberPitch >= FIBER_OWNER_DIAGRAM_PITCH_MIN || owner.length <= 8)

  const ownerClass = `splice-fiber-owner ${opts.isInternal ? 'splice-fiber-owner--internal' : ''}`

  const labelsBlock = (
    <>
      <text x={p.xLabel} y={p.yLabel} textAnchor={p.textAnchor} className="splice-fiber-num" dominantBaseline="middle" fill={numFill}>
        #{fi}
        {disp.busy ? ' ●' : ''}
      </text>
      {showOwnerOnDiagram ? (
        <text
          x={p.ownerX}
          y={p.ownerY}
          textAnchor={p.textAnchor}
          className={ownerClass}
          dominantBaseline="middle"
        >
          {ownerShow}
        </text>
      ) : null}
    </>
  )

  const visClass = [
    'splice-fiber-vis',
    opts.isInternal ? 'splice-fiber-vis--internal' : '',
    disp.busy ? 'splice-fiber-vis--busy' : '',
    opts.picked ? 'splice-fiber-vis--pick' : '',
    opts.panelHi ? 'splice-fiber-vis--panel-focus' : '',
    opts.hoverHi ? 'splice-fiber-vis--hover' : '',
    opts.traceHi ? 'splice-fiber-vis--trace' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <g key={`f-${edgeId}-${fi}`}>
      <line
        x1={p.hitCx}
        y1={p.hitCy}
        x2={p.xIn}
        y2={p.yIn}
        className={
          disp.busy
            ? `splice-fiber-line splice-fiber-line--busy${opts.isInternal ? ' splice-fiber-line--cross-busy' : ''}`
            : `splice-fiber-line splice-fiber-line--free${opts.isInternal ? ' splice-fiber-line--cross-free' : ''}`
        }
        style={disp.busy ? { stroke: busyStroke, strokeDasharray: busyDash } : { stroke: accent, opacity: 0.85 }}
      />
      <circle
        cx={p.hitCx}
        cy={p.hitCy}
        r={FIBER_VIS_R}
        className={visClass}
        pointerEvents="none"
        style={{ fill: accent }}
      />
      <circle
        cx={p.hitCx}
        cy={p.hitCy}
        r={FIBER_HIT_R}
        className="splice-fiber-hit-area"
        data-fiber-ref={JSON.stringify({ edgeId, fiberIndex: fi })}
        onPointerDown={opts.onPointerDown}
        onClick={(ev) => {
          ev.stopPropagation()
          opts.onClick()
        }}
        onMouseEnter={() => opts.onHover(true)}
        onMouseLeave={() => opts.onHover(false)}
        style={{ cursor: 'pointer' }}
      >
        <title>{opts.tooltip}</title>
      </circle>
      {labelRot ? <g transform={labelRot}>{labelsBlock}</g> : labelsBlock}
    </g>
  )
}

export const SpliceDiagram = forwardRef<SVGSVGElement, Props>(function SpliceDiagram({
  gridPatternId,
  layout,
  node,
  incident,
  internalPorts,
  links,
  linkPick,
  linkDraftWaypoints,
  cursorSvg,
  selectedLinkIndex,
  panelFiberFocus,
  hoverFiberRef,
  traceHighlightKeys,
  showItuColors,
  edgeById,
  getFiberDisplay,
  onSvgContextMenu,
  onSvgPointerMove,
  onFiberPointerDown,
  onFiberClick,
  onFiberHover,
  onLinkClick,
  onWaypointPointerDown,
  onWaypointContextMenu,
}, ref) {
  const linkCount = links.length

  const cableBandLabels = useMemo(() => {
    return layout.cableBands.map((band) => {
      if (band.edgeId === 0) return { band, title: 'Порты кросса', meta: `${internalPorts} порт.` }
      const e = edgeById.get(band.edgeId)
      if (!e) return { band, title: `id ${band.edgeId}`, meta: '' }
      return {
        band,
        title: cableDisplayName(e),
        meta: `${e.used_fibers ?? 0}/${e.total_fibers ?? '—'} · id ${e.id}`,
      }
    })
  }, [layout.cableBands, edgeById, internalPorts])

  const isFiberHighlighted = (edgeId: number, fi: number) => {
    const k = `${edgeId}:${fi}`
    if (traceHighlightKeys.has(k)) return true
    if (panelFiberFocus && refKey(panelFiberFocus) === k) return true
    if (hoverFiberRef && refKey(hoverFiberRef) === k) return true
    if (linkPick && refKey(linkPick) === k) return true
    if (selectedLinkIndex != null) {
      const l = links[selectedLinkIndex]
      if (l && (refKey(l.from) === k || refKey(l.to) === k)) return true
    }
    return false
  }

  const fiberTooltip = (edgeId: number, fi: number) => {
    const disp = getFiberDisplay(edgeId, fi)
    const e = edgeById.get(edgeId)
    const name = edgeId === 0 ? 'Порты кросса' : e ? cableDisplayName(e) : `id ${edgeId}`
    const link = findLinkForFiber(links, { edgeId, fiberIndex: fi })
    const partner = link ? partnerRef(link, { edgeId, fiberIndex: fi }) : null
    const partnerStr = partner
      ? ` → ${partner.edgeId === 0 ? 'порт' : 'каб.'} #${partner.fiberIndex}`
      : ''
    return `${name} · #${fi}${disp.ownerLabel ? ` · ${disp.ownerLabel}` : ''}${partnerStr}`
  }

  return (
    <svg
      ref={ref}
      className="splice-workspace__svg"
      width={layout.worldW}
      height={layout.worldH}
      viewBox={`0 0 ${layout.worldW} ${layout.worldH}`}
      role="img"
      aria-label={node.type === 'KROSS' ? 'Схема кросса' : 'Схема муфты'}
      onContextMenu={onSvgContextMenu}
      onPointerMove={onSvgPointerMove}
    >
      <defs>
        <pattern id={gridPatternId} width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M 28 0 L 0 0 0 28" fill="none" className="splice-grid-line" />
        </pattern>
      </defs>
      <rect x={0} y={0} width={layout.worldW} height={layout.worldH} fill={`url(#${gridPatternId})`} className="splice-grid-bg" />
      <rect x={layout.body.x} y={layout.body.y} width={layout.body.w} height={layout.body.h} rx={12} className="splice-body" />
      <text x={layout.body.x + layout.body.w / 2} y={layout.body.y + layout.body.h / 2} textAnchor="middle" className="splice-body-label">
        {node.type === 'KROSS' ? 'КРОСС' : 'МУФТА'}
      </text>

      {cableBandLabels.map(({ band, title, meta }) => renderCableBandLabel(band, title, meta))}

      {links.map((link, li) => {
        const a = layout.ports.get(refKey(link.from))
        const b = layout.ports.get(refKey(link.to))
        if (!a || !b) return null
        const dA = getFiberDisplay(link.from.edgeId, link.from.fiberIndex)
        const dB = getFiberDisplay(link.to.edgeId, link.to.fiberIndex)
        const active = selectedLinkIndex === li
        const traceActive =
          traceHighlightKeys.has(refKey(link.from)) || traceHighlightKeys.has(refKey(link.to))
        const offset = bundleOffsetForLinkIndex(li, linkCount)
        const d = linkPathForSplice(a, b, link.waypoints, offset)
        const style: CSSProperties = {
          ...spliceLinkStrokeStyle(dA, dB),
          ...(active || traceActive ? { stroke: '#0891b2', strokeWidth: 3, opacity: 1 } : {}),
        }
        return (
          <g key={`lnk-${li}`}>
            <path
              d={d}
              className={`splice-link-path ${active ? 'splice-link-path--active' : ''} ${traceActive ? 'splice-link-path--trace' : ''}`}
              fill="none"
              style={style}
            />
            <path
              d={d}
              className="splice-link-hit"
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              onClick={(e) => {
                e.stopPropagation()
                onLinkClick(li)
              }}
              style={{ cursor: 'pointer' }}
            />
          </g>
        )
      })}

      {selectedLinkIndex != null &&
        links[selectedLinkIndex]?.waypoints?.map((w, wi) => (
          <circle
            key={`wp-${selectedLinkIndex}-${wi}`}
            cx={w.x}
            cy={w.y}
            r={6}
            className="splice-waypoint-handle"
            onPointerDown={(e) => onWaypointPointerDown(selectedLinkIndex, wi, e)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onWaypointContextMenu(selectedLinkIndex, wi, e)
            }}
          />
        ))}

      {linkPick && linkDraftWaypoints.length > 0 && (() => {
        const a = layout.ports.get(refKey(linkPick))
        if (!a) return null
        const draftD = `M ${a.hitCx} ${a.hitCy}` + linkDraftWaypoints.map((w) => ` L ${w.x} ${w.y}`).join('')
        return <path key="link-draft-wp" d={draftD} fill="none" className="splice-link-draft" />
      })()}

      {linkPick && cursorSvg && (() => {
        const a = layout.ports.get(refKey(linkPick))
        if (!a) return null
        const draftD =
          `M ${a.hitCx} ${a.hitCy}` +
          linkDraftWaypoints.map((w) => ` L ${w.x} ${w.y}`).join('') +
          ` L ${cursorSvg.x} ${cursorSvg.y}`
        return <path key="link-draft-cursor" d={draftD} fill="none" className="splice-link-draft splice-link-draft--cursor" />
      })()}

      {incident.flatMap((edge) => {
        const T = Math.max(1, edge.total_fibers ?? 1)
        const accent = cableAccentColor(edge.id)
        const els: ReactNode[] = []
        for (let fi = 1; fi <= T; fi += 1) {
          const p = layout.ports.get(`${edge.id}:${fi}`)
          if (!p) continue
          const ref = { edgeId: edge.id, fiberIndex: fi }
          els.push(
            renderFiberPort(p, edge.id, fi, getFiberDisplay(edge.id, fi), accent, {
              picked: !!(linkPick && refKey(linkPick) === refKey(ref)),
              panelHi: !!(panelFiberFocus && refKey(panelFiberFocus) === refKey(ref)),
              traceHi: isFiberHighlighted(edge.id, fi),
              hoverHi: !!(hoverFiberRef && refKey(hoverFiberRef) === refKey(ref)),
              showItu: showItuColors,
              isInternal: false,
              tooltip: fiberTooltip(edge.id, fi),
              onPointerDown: (e) => onFiberPointerDown(ref, e),
              onClick: () => onFiberClick(ref),
              onHover: (on) => onFiberHover(on ? ref : null),
            }),
          )
        }
        return els
      })}

      {internalPorts > 0
        ? Array.from({ length: internalPorts }, (_, i) => i + 1).map((fi) => {
            const p = layout.ports.get(`0:${fi}`)
            if (!p) return null
            const ref = { edgeId: 0, fiberIndex: fi }
            return renderFiberPort(p, 0, fi, getFiberDisplay(0, fi), cableAccentColor(0), {
              picked: !!(linkPick && refKey(linkPick) === refKey(ref)),
              panelHi: !!(panelFiberFocus && refKey(panelFiberFocus) === refKey(ref)),
              traceHi: isFiberHighlighted(0, fi),
              hoverHi: !!(hoverFiberRef && refKey(hoverFiberRef) === refKey(ref)),
              showItu: showItuColors,
              isInternal: true,
              tooltip: fiberTooltip(0, fi),
              onPointerDown: (e) => onFiberPointerDown(ref, e),
              onClick: () => onFiberClick(ref),
              onHover: (on) => onFiberHover(on ? ref : null),
            })
          })
        : null}
    </svg>
  )
})
