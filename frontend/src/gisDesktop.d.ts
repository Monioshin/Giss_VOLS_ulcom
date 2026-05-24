export type GisDesktopBridge = {
  apiUrl: string
  isDesktop: boolean
  configPath: string | null
}

declare global {
  interface Window {
    gisDesktop?: GisDesktopBridge
  }
}

export {}
