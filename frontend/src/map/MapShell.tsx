import { memo, type ReactNode } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import type { BasemapMode } from '../userPrefs'

const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const ESRI_IMAGERY_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_REF_TRANSPORT_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'
const ESRI_REF_PLACES_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
const ESRI_ATTRIBUTION = 'Tiles &copy; Esri'
const ESRI_REF_ATTRIBUTION = 'Labels &copy; Esri'

const TILE_OPTS = {
  maxNativeZoom: 18,
  keepBuffer: 2,
  updateWhenZooming: false,
  detectRetina: false,
} as const

export type MapShellProps = {
  center: LatLngExpression
  zoom: number
  basemap: BasemapMode
  className?: string
  children: ReactNode
  truncatedBanner?: ReactNode
  /** Меньше анимации зума при подгрузке по bbox (большие БД, LAN). */
  reduceZoomMotion?: boolean
}

export const MapShell = memo(function MapShell({
  center,
  zoom,
  basemap,
  className = 'map',
  children,
  truncatedBanner,
  reduceZoomMotion = false,
}: MapShellProps) {
  return (
    <div className="map-shell-wrap">
      <MapContainer
        center={center}
        zoom={zoom}
        minZoom={3}
        maxZoom={18}
        zoomSnap={0.5}
        wheelPxPerZoomLevel={reduceZoomMotion ? 120 : 90}
        zoomAnimation={!reduceZoomMotion}
        className={className}
        attributionControl={false}
        preferCanvas
      >
        {basemap === 'streets' && (
          <TileLayer
            {...TILE_OPTS}
            attribution="&copy; OpenStreetMap contributors"
            url={OSM_TILE_URL}
          />
        )}
        {basemap === 'satellite' && (
          <TileLayer {...TILE_OPTS} attribution={ESRI_ATTRIBUTION} url={ESRI_IMAGERY_URL} />
        )}
        {basemap === 'hybrid' && (
          <>
            <TileLayer {...TILE_OPTS} attribution={ESRI_ATTRIBUTION} url={ESRI_IMAGERY_URL} />
            <TileLayer {...TILE_OPTS} attribution={ESRI_REF_ATTRIBUTION} url={ESRI_REF_TRANSPORT_URL} />
            <TileLayer {...TILE_OPTS} attribution={ESRI_REF_ATTRIBUTION} url={ESRI_REF_PLACES_URL} />
          </>
        )}
        {children}
      </MapContainer>
      {truncatedBanner}
    </div>
  )
})
