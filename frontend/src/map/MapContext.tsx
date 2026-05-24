import { createContext, useContext, type RefObject } from 'react'
import type { Map as LeafletMap } from 'leaflet'

export type MapContextValue = {
  paused: boolean
  mapRef: RefObject<LeafletMap | null>
  detailZoom: number
}

export const MapContext = createContext<MapContextValue | null>(null)

export function useMapContext(): MapContextValue {
  const ctx = useContext(MapContext)
  if (!ctx) throw new Error('useMapContext must be used within MapContext.Provider')
  return ctx
}

export function useMapPaused(): boolean {
  return useContext(MapContext)?.paused ?? false
}
