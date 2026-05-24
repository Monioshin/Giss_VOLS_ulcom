import { useEffect } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'

type MapZoomBridgeProps = {
  /** Только по окончании жеста — без ре-рендера App на каждый кадр. */
  onZoomEnd: (zoom: number) => void
}

export function MapZoomBridge({ onZoomEnd }: MapZoomBridgeProps) {
  const map = useMap()
  useMapEvents({
    zoomend: (e) => onZoomEnd(e.target.getZoom()),
  })
  useEffect(() => {
    onZoomEnd(map.getZoom())
  }, [map, onZoomEnd])
  return null
}
