import { useEffect, useRef, useState } from 'react'
import type { MapViewportSummary } from './useMapViewport'

type Props = {
  visible: boolean
  useBboxLoad: boolean
  /** API на другом ПК в LAN (не localhost). */
  remoteApi?: boolean
  viewportLoading: boolean
  mapTruncated: boolean
  summary: MapViewportSummary
  loadedNodes: number
  loadedEdges: number
}

export function MapStatusBell({
  visible,
  useBboxLoad,
  remoteApi = false,
  viewportLoading,
  mapTruncated,
  summary,
  loadedNodes,
  loadedEdges,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const hasNotice = useBboxLoad || mapTruncated || viewportLoading

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!visible) return null

  return (
    <div className="map-status-bell" ref={wrapRef}>
      <button
        type="button"
        className={`map-status-bell__btn ${open ? 'is-open' : ''}`}
        aria-label="Состояние карты и загрузки данных"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        <svg className="map-status-bell__icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path
            fill="currentColor"
            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2Z"
          />
        </svg>
        {hasNotice ? <span className="map-status-bell__badge" aria-hidden /> : null}
      </button>
      {open ? (
        <div className="map-status-bell__panel" role="dialog" aria-label="Информация о данных на карте">
          <div className="map-status-bell__title">Данные на карте</div>
          <ul className="map-status-bell__list">
            {useBboxLoad ? (
              <li className="map-status-bell__item map-status-bell__item--info">
                Режим области: подгрузка по видимой части карты (большая база).
              </li>
            ) : null}
            {remoteApi ? (
              <li className="map-status-bell__item map-status-bell__item--info">
                Удалённый сервер API (LAN): после зума дождитесь окончания загрузки области.
              </li>
            ) : null}
            {viewportLoading ? (
              <li className="map-status-bell__item map-status-bell__item--loading">Идёт загрузка области…</li>
            ) : null}
            {mapTruncated ? (
              <li className="map-status-bell__item map-status-bell__item--warn">
                Показана часть объектов в текущей области — приблизьте карту или сузьте вид.
              </li>
            ) : null}
            <li className="map-status-bell__item map-status-bell__item--muted">
              В базе: узлов {summary.totalNodes.toLocaleString('ru-RU')}, линий{' '}
              {summary.totalEdges.toLocaleString('ru-RU')}.
            </li>
            <li className="map-status-bell__item map-status-bell__item--muted">
              Загружено в сессию: узлов {loadedNodes.toLocaleString('ru-RU')}, линий{' '}
              {loadedEdges.toLocaleString('ru-RU')}.
            </li>
            {!useBboxLoad && !mapTruncated && !viewportLoading ? (
              <li className="map-status-bell__item map-status-bell__item--ok">Все объекты базы доступны на карте.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
