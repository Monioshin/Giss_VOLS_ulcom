import { useMemo } from 'react'
import { countBusyInUsage, type EdgeFiberUsage } from '../muftaSpliceTypes'

type Props = {
  totalFibers: number
  usedFibers: number
  fiberUsage: EdgeFiberUsage
  onUsageChange: (usage: EdgeFiberUsage, usedCount: number) => void
}

export function EdgeOpticalFiberGrid({ totalFibers, usedFibers, fiberUsage, onUsageChange }: Props) {
  const total = Math.max(1, Math.min(288, totalFibers || 1))
  const indices = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total])

  const toggleBusy = (i: number) => {
    const key = String(i)
    const slot = fiberUsage[key] ?? {}
    const nextBusy = !slot.busy
    const next: EdgeFiberUsage = { ...fiberUsage, [key]: { ...slot, busy: nextBusy } }
    const used = countBusyInUsage(total, next)
    onUsageChange(next, used)
  }

  const setLabel = (i: number, label: string) => {
    const key = String(i)
    const slot = fiberUsage[key] ?? {}
    const next: EdgeFiberUsage = { ...fiberUsage, [key]: { ...slot, label: label || undefined } }
    onUsageChange(next, countBusyInUsage(total, next))
  }

  const syncFromUsedCount = () => {
    const next: EdgeFiberUsage = { ...fiberUsage }
    for (let i = 1; i <= total; i += 1) {
      const key = String(i)
      const busy = i <= usedFibers
      next[key] = { ...(next[key] ?? {}), busy }
    }
    onUsageChange(next, Math.min(usedFibers, total))
  }

  const busyCount = countBusyInUsage(total, fiberUsage)

  return (
    <div className="fiber-grid-block">
      <div className="fiber-grid-block__head">
        <label>Волокна (сетка)</label>
        <span className="hint">
          Занято в сетке: {busyCount} / {total}
          {busyCount !== usedFibers ? ` · в поле «занято»: ${usedFibers}` : ''}
        </span>
        {busyCount !== usedFibers ? (
          <button type="button" className="fiber-grid-sync-btn" onClick={syncFromUsedCount}>
            Синхр. с полем «занято»
          </button>
        ) : null}
      </div>
      <div className="fiber-grid" role="grid" aria-label="Сетка волокон">
        {indices.map((i) => {
          const slot = fiberUsage[String(i)]
          const busy = !!slot?.busy
          return (
            <div key={i} className={`fiber-grid__cell ${busy ? 'fiber-grid__cell--busy' : ''}`}>
              <button
                type="button"
                className="fiber-grid__toggle"
                title={busy ? 'Свободно' : 'Занято'}
                onClick={() => toggleBusy(i)}
                aria-pressed={busy}
              >
                {i}
              </button>
              <input
                className="fiber-grid__label"
                placeholder="подпись"
                value={slot?.label ?? ''}
                onChange={(e) => setLabel(i, e.target.value)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
