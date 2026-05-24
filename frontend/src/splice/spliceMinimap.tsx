import type { LayoutResult } from './layout'

type Props = {
  layout: LayoutResult
  pan: { x: number; y: number }
  zoom: number
  viewportW: number
  viewportH: number
  onPanTo: (wx: number, wy: number) => void
}

export function SpliceMinimap({ layout, pan, zoom, viewportW, viewportH, onPanTo }: Props) {
  const mw = 120
  const mh = 90
  const vw = viewportW / zoom
  const vh = viewportH / zoom
  const vx = (-pan.x) / zoom
  const vy = (-pan.y) / zoom

  return (
    <div className="splice-minimap" aria-hidden>
      <svg width={mw} height={mh} viewBox={`0 0 ${layout.worldW} ${layout.worldH}`}>
        <rect x={layout.body.x} y={layout.body.y} width={layout.body.w} height={layout.body.h} className="splice-minimap__body" />
        {Array.from(layout.ports.values()).map((p) => (
          <circle key={`${p.edgeId}:${p.fiberIndex}`} cx={p.hitCx} cy={p.hitCy} r={3} className="splice-minimap__port" />
        ))}
        <rect
          x={vx}
          y={vy}
          width={vw}
          height={vh}
          className="splice-minimap__view"
          fill="none"
        />
      </svg>
      <button
        type="button"
        className="splice-minimap__hit"
        onClick={(e) => {
          const rect = (e.currentTarget.previousElementSibling as SVGSVGElement)?.getBoundingClientRect()
          if (!rect) return
          const mx = e.clientX - rect.left
          const my = e.clientY - rect.top
          const wx = (mx / rect.width) * layout.worldW
          const wy = (my / rect.height) * layout.worldH
          onPanTo(wx, wy)
        }}
        aria-label="Мини-карта"
      />
    </div>
  )
}
