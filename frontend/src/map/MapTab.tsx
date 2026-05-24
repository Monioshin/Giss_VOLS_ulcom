import { useMemo, type ReactNode, type RefObject } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import { MapContext } from './MapContext'

type Props = {
  active: boolean
  mapRef: RefObject<LeafletMap | null>
  detailZoom: number
  children: ReactNode
}

/** Обёртка вкладки карты: изолирует canvas/labels от лишних пропсов и задаёт pause вне активной вкладки. */
export function MapTab({ active, mapRef, detailZoom, children }: Props) {
  const value = useMemo(
    () => ({ paused: !active, mapRef, detailZoom }),
    [active, mapRef, detailZoom],
  )
  return (
    <MapContext.Provider value={value}>
      <div className={`map-tab ${active ? 'stack-front' : 'stack-back'}`}>{children}</div>
    </MapContext.Provider>
  )
}
