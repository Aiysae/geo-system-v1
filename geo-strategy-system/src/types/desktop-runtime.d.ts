type ShituDesktopNotification = {
  id?: string
  title: string
  body: string
  actionUrl?: string
}

type ShituDesktopInfo = {
  name: string
  version: string
  platform: string
  arch: string
  networkMode: "system" | "direct"
}

interface ShituDesktopBridge {
  readonly isDesktop: true
  readonly platform: string
  getInfo(): Promise<ShituDesktopInfo>
  notify(payload: ShituDesktopNotification): Promise<boolean>
  setBadgeCount(count: number): Promise<number>
  openDesktopCenter(tab?: "downloads" | "network" | "settings" | "updates"): Promise<boolean>
  diagnoseNetwork(): Promise<Record<string, unknown>>
  retryApplication(): Promise<boolean>
  onNavigate(callback: (url: string) => void): () => void
}

declare global {
  type ShituPwaInstallChoice = {
    outcome: "accepted" | "dismissed"
    platform: string
  }

  interface ShituPwaInstallPromptEvent extends Event {
    prompt(): Promise<void>
    readonly userChoice: Promise<ShituPwaInstallChoice>
  }

  interface Navigator {
    readonly standalone?: boolean
  }

  interface Window {
    shituDesktop?: ShituDesktopBridge
    __shituPwaInstallPrompt?: ShituPwaInstallPromptEvent
  }
}

export {}
