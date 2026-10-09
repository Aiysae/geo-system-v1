"use client"

import { useEffect } from "react"

export const PWA_INSTALL_READY_EVENT = "shitu:pwa-install-ready"
export const PWA_INSTALLED_EVENT = "shitu:pwa-installed"

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true
}

function dispatch(name: string) {
  window.dispatchEvent(new Event(name))
}

export function PwaRuntime() {
  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)")

    const syncRuntime = () => {
      if (isStandalonePwa() && !window.shituDesktop?.isDesktop) {
        document.documentElement.dataset.runtime = "pwa"
      } else if (document.documentElement.dataset.runtime === "pwa") {
        delete document.documentElement.dataset.runtime
      }
    }

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      window.__shituPwaInstallPrompt = event as ShituPwaInstallPromptEvent
      dispatch(PWA_INSTALL_READY_EVENT)
    }

    const handleInstalled = () => {
      delete window.__shituPwaInstallPrompt
      syncRuntime()
      dispatch(PWA_INSTALLED_EVENT)
    }

    syncRuntime()
    displayMode.addEventListener("change", syncRuntime)
    window.addEventListener("beforeinstallprompt", handleInstallPrompt)
    window.addEventListener("appinstalled", handleInstalled)

    if (
      process.env.NODE_ENV === "production"
      && window.isSecureContext
      && "serviceWorker" in navigator
    ) {
      void navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      }).then(registration => registration.update()).catch(() => undefined)
    }

    return () => {
      displayMode.removeEventListener("change", syncRuntime)
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt)
      window.removeEventListener("appinstalled", handleInstalled)
      if (document.documentElement.dataset.runtime === "pwa") {
        delete document.documentElement.dataset.runtime
      }
    }
  }, [])

  return null
}
