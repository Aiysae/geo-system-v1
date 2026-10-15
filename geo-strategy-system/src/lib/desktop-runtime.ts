export type DesktopNotificationPayload = {
  id?: string
  title: string
  body: string
  actionUrl?: string
}

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && window.shituDesktop?.isDesktop === true
}

export function isInstalledWebApp(): boolean {
  return typeof window !== "undefined"
    && (
      window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true
    )
}

export function webNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"
  return Notification.permission
}

export async function requestWebNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export async function notifyDesktop(payload: DesktopNotificationPayload): Promise<boolean> {
  if (isDesktopRuntime()) {
    try {
      return await window.shituDesktop!.notify(payload)
    } catch {
      return false
    }
  }

  if (!isInstalledWebApp() || webNotificationPermission() !== "granted") return false

  try {
    const notification = new Notification(payload.title, {
      body: payload.body,
      icon: "/pwa/icon-192.png",
      tag: payload.id,
    })
    notification.onclick = () => {
      window.focus()
      if (!payload.actionUrl) return
      try {
        const target = new URL(payload.actionUrl, window.location.origin)
        if (target.origin === window.location.origin) {
          window.location.assign(`${target.pathname}${target.search}${target.hash}`)
        }
      } catch {
        // Invalid notification navigation is ignored.
      }
    }
    return true
  } catch {
    return false
  }
}
