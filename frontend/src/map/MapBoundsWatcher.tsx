import { useEffect, useMemo, useRef } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import type L from 'leaflet'
import { throttle } from './throttle'

type MapBoundsWatcherProps = {
  /** После отпускания карты / зума — подгрузка с сервера. */
  onBoundsSettled: (bounds: L.LatLngBounds, zoom: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  settledThrottleMs?: number
}

export function MapBoundsWatcher({
  onBoundsSettled,
  onDragStart,
  onDragEnd,
  settledThrottleMs = 350,
}: MapBoundsWatcherProps) {
  const map = useMap()
  const skipMoveEndUntilRef = useRef(0)

  const emitSettled = useMemo(
    () =>
      throttle((bounds: L.LatLngBounds, zoom: number) => {
        onBoundsSettled(bounds, zoom)
      }, settledThrottleMs),
    [onBoundsSettled, settledThrottleMs],
  )

  useMapEvents({
    dragstart: () => onDragStart?.(),
    dragend: () => onDragEnd?.(),
    zoomend: () => {
      onDragEnd?.()
      skipMoveEndUntilRef.current = Date.now() + 80
      emitSettled(map.getBounds(), map.getZoom())
    },
    moveend: () => {
      onDragEnd?.()
      if (Date.now() < skipMoveEndUntilRef.current) return
      emitSettled(map.getBounds(), map.getZoom())
    },
  })

  useEffect(() => {
    emitSettled(map.getBounds(), map.getZoom())
  }, [map, emitSettled])

  return null
}
