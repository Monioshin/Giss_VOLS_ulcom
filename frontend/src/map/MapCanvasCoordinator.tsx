/**
 * Раньше координировал RAF из react-leaflet useMapEvents — move при drag там не всегда срабатывает.
 * Отрисовка canvas перенесена в mapPaintBus (прямые map.on('move'|'drag')).
 * Компонент оставлен пустым для совместимости разметки App.tsx.
 */
export function MapCanvasCoordinator() {
  return null
}
