import type { Map } from 'leaflet'

type Painter = () => void

const painters = new Set<Painter>()
let rafId: number | null = null
let boundMap: Map | null = null
let bindCount = 0

const interactStart = new Set<() => void>()
const interactEnd = new Set<() => void>()

function flushPainters() {
  rafId = null
  for (const paint of painters) paint()
}

export function scheduleMapPaint() {
  if (rafId != null) return
  rafId = requestAnimationFrame(flushPainters)
}

function onMapFrame() {
  scheduleMapPaint()
}

function onInteractStart() {
  for (const fn of interactStart) fn()
}

function onInteractEnd() {
  for (const fn of interactEnd) fn()
  scheduleMapPaint()
}

function bindMap(map: Map) {
  if (boundMap === map) return
  if (boundMap) unbindMap(boundMap)
  boundMap = map
  map.on('move', onMapFrame)
  map.on('zoomanim', onMapFrame)
  map.on('zoom', onMapFrame)
  map.on('drag', onMapFrame)
  map.on('viewreset', onMapFrame)
  map.on('resize', onMapFrame)
  map.on('movestart', onInteractStart)
  map.on('zoomstart', onInteractStart)
  map.on('moveend', onInteractEnd)
  map.on('zoomend', onInteractEnd)
  map.on('dragend', onInteractEnd)
}

function unbindMap(map: Map) {
  map.off('move', onMapFrame)
  map.off('zoomanim', onMapFrame)
  map.off('zoom', onMapFrame)
  map.off('drag', onMapFrame)
  map.off('viewreset', onMapFrame)
  map.off('resize', onMapFrame)
  map.off('movestart', onInteractStart)
  map.off('zoomstart', onInteractStart)
  map.off('moveend', onInteractEnd)
  map.off('zoomend', onInteractEnd)
  map.off('dragend', onInteractEnd)
  if (boundMap === map) boundMap = null
}

/** Подписка на отрисовку в общем RAF (вызывать из onAdd canvas-слоя). */
export function registerMapPainter(paint: Painter): () => void {
  painters.add(paint)
  return () => {
    painters.delete(paint)
  }
}

export function registerMapInteractHandlers(onStart: () => void, onEnd: () => void): () => void {
  interactStart.add(onStart)
  interactEnd.add(onEnd)
  return () => {
    interactStart.delete(onStart)
    interactEnd.delete(onEnd)
  }
}

/** Привязка move/zoom к map (ref-count: несколько слоёв). */
export function attachMapPaintSync(map: Map): () => void {
  bindCount += 1
  bindMap(map)
  return () => {
    bindCount = Math.max(0, bindCount - 1)
    if (bindCount === 0 && boundMap) {
      unbindMap(boundMap)
    }
  }
}
