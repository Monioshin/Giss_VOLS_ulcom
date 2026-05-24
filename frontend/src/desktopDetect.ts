/** Собранное Electron-приложение (file://) или preload с isDesktop. */
export function isDesktopApp(): boolean {
  if (typeof window === 'undefined') return false
  if (window.gisDesktop?.isDesktop) return true
  return window.location.protocol === 'file:'
}
