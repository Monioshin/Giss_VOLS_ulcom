import { useEffect, type MutableRefObject, type RefObject } from 'react'
import { useMap } from 'react-leaflet'
import type L from 'leaflet'

type MapInstanceBridgeProps = {
  mapRef: RefObject<L.Map | null>
  active: boolean
  onMapReady?: (map: L.Map) => void
  onAfterInvalidate?: () => void
}

export function MapInstanceBridge({ mapRef, active, onMapReady, onAfterInvalidate }: MapInstanceBridgeProps) {
  const map = useMap()

  useEffect(() => {
    ;(mapRef as MutableRefObject<L.Map | null>).current = map
    onMapReady?.(map)
    return () => {
      mapRef.current = null
    }
  }, [map, mapRef, onMapReady])

  useEffect(() => {
    if (!active) return
    const fixSize = () => {
      map.invalidateSize({ animate: false })
      onAfterInvalidate?.()
    }
    fixSize()
    const rafId = requestAnimationFrame(fixSize)
    const t1 = window.setTimeout(fixSize, 50)
    const t2 = window.setTimeout(fixSize, 250)
    return () => {
      cancelAnimationFrame(rafId)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [active, map, onAfterInvalidate])

  return null
}
