export type DesktopNotificationPayload = {
  id?: string
  title: string
  body: string
  actionUrl?: string
}

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && window.shituDesktop?.isDesktop === true
}

export async function notifyDesktop(payload: DesktopNotificationPayload): Promise<boolean> {
  if (!isDesktopRuntime()) return false
  try {
    return await window.shituDesktop!.notify(payload)
  } catch {
    return false
  }
}
