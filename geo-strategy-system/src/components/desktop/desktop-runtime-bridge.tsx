"use client"

import { useEffect } from "react"

export function DesktopRuntimeBridge() {
  useEffect(() => {
    const bridge = window.shituDesktop
    if (!bridge?.isDesktop) return

    document.documentElement.dataset.runtime = "desktop"
    void bridge.getInfo().then(info => {
      document.documentElement.dataset.desktopPlatform = info.platform
      document.documentElement.dataset.desktopVersion = info.version
    }).catch(() => undefined)

    const unsubscribe = bridge.onNavigate(value => {
      try {
        const target = new URL(value, window.location.origin)
        if (target.origin !== window.location.origin) return
        window.location.assign(`${target.pathname}${target.search}${target.hash}`)
      } catch {
        // Invalid native navigation payloads are ignored.
      }
    })

    return () => {
      unsubscribe()
      delete document.documentElement.dataset.runtime
      delete document.documentElement.dataset.desktopPlatform
      delete document.documentElement.dataset.desktopVersion
    }
  }, [])

  return null
}
