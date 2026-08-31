"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import {
  AppWindow,
  CheckCircle2,
  ChevronDown,
  Download,
  Laptop,
  MonitorDown,
  ShieldAlert,
  X,
} from "lucide-react"
import {
  isStandalonePwa,
  PWA_INSTALLED_EVENT,
  PWA_INSTALL_READY_EVENT,
} from "@/components/pwa/pwa-runtime"
import {
  requestWebNotificationPermission,
  webNotificationPermission,
} from "@/lib/desktop-runtime"
import { DESKTOP_APP_VERSION, DESKTOP_DOWNLOADS } from "@/lib/desktop-downloads"

type DesktopDownloadDialogProps = {
  variant: "header" | "hero"
}

type Platform = "windows" | "mac" | null
type Browser = "chromium" | "safari" | "other"

function detectedPlatform(): Platform {
  if (typeof navigator === "undefined") return null
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes("windows")) return "windows"
  if (userAgent.includes("macintosh") || userAgent.includes("mac os")) return "mac"
  return null
}

function detectedBrowser(): Browser {
  if (typeof navigator === "undefined") return "other"
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes("edg/") || userAgent.includes("chrome/") || userAgent.includes("crios/")) {
    return "chromium"
  }
  if (userAgent.includes("safari/") && !userAgent.includes("chrome/")) return "safari"
  return "other"
}

function manualInstallSteps(platform: Platform, browser: Browser): string[] {
  if (platform === "mac" && browser === "safari") {
    return [
      "在 Safari 顶部菜单栏选择“文件”",
      "点击“添加到 Dock”并确认应用名称",
      "从 Dock、启动台或 Spotlight 打开势途 GEO",
    ]
  }

  if (browser === "chromium") {
    return [
      "点击浏览器地址栏右侧的安装图标，或打开右上角菜单",
      "选择“投放、保存和分享”中的“将页面安装为应用”",
      `确认后从${platform === "mac" ? " Dock 或启动台" : "桌面或开始菜单"}打开势途 GEO`,
    ]
  }

  return [
    "建议使用最新版 Chrome、Edge，Mac 也可以使用 Safari",
    "重新打开势途 GEO 首页并点击“安装桌面端”",
    "按照浏览器显示的安装提示完成操作",
  ]
}

export default function DesktopDownloadDialog({ variant }: DesktopDownloadDialogProps) {
  const [open, setOpen] = useState(false)
  const [platform, setPlatform] = useState<Platform>(null)
  const [browser, setBrowser] = useState<Browser>("other")
  const [installReady, setInstallReady] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [nativeDesktop, setNativeDesktop] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installMessage, setInstallMessage] = useState("")
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported")
  const titleId = useId()
  const orderedDownloads = useMemo(() => {
    const downloads = [DESKTOP_DOWNLOADS.windows, DESKTOP_DOWNLOADS.mac]
    return platform ? downloads.sort(item => item.platform === platform ? -1 : 1) : downloads
  }, [platform])
  const installSteps = useMemo(() => manualInstallSteps(platform, browser), [browser, platform])

  useEffect(() => {
    const syncInstallState = () => {
      setInstallReady(Boolean(window.__shituPwaInstallPrompt))
      setInstalled(isStandalonePwa() || Boolean(window.shituDesktop?.isDesktop))
      setNativeDesktop(Boolean(window.shituDesktop?.isDesktop))
      setNotificationPermission(webNotificationPermission())
    }

    syncInstallState()
    window.addEventListener(PWA_INSTALL_READY_EVENT, syncInstallState)
    window.addEventListener(PWA_INSTALLED_EVENT, syncInstallState)
    return () => {
      window.removeEventListener(PWA_INSTALL_READY_EVENT, syncInstallState)
      window.removeEventListener(PWA_INSTALLED_EVENT, syncInstallState)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  const openDialog = () => {
    setPlatform(detectedPlatform())
    setBrowser(detectedBrowser())
    setInstallReady(Boolean(window.__shituPwaInstallPrompt))
    setInstalled(isStandalonePwa() || Boolean(window.shituDesktop?.isDesktop))
    setNativeDesktop(Boolean(window.shituDesktop?.isDesktop))
    setNotificationPermission(webNotificationPermission())
    setInstallMessage("")
    setOpen(true)
  }

  const enableNotifications = async () => {
    setNotificationPermission(await requestWebNotificationPermission())
  }

  const installPwa = async () => {
    const prompt = window.__shituPwaInstallPrompt
    if (!prompt) return

    setInstalling(true)
    setInstallMessage("")
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      delete window.__shituPwaInstallPrompt
      setInstallReady(false)
      if (choice.outcome === "accepted") {
        setInstalled(true)
        setInstallMessage(`安装完成，可从${platform === "mac" ? " Dock 或启动台" : "桌面或开始菜单"}打开。`)
      } else {
        setInstallMessage("本次没有完成安装，稍后仍可从这里重新安装。")
      }
    } catch {
      delete window.__shituPwaInstallPrompt
      setInstallReady(false)
      setInstallMessage("浏览器暂未打开安装窗口，请按下方步骤手动安装。")
    } finally {
      setInstalling(false)
    }
  }

  const trigger = variant === "header" ? (
    <button
      type="button"
      onClick={openDialog}
      className="inline-flex h-9 w-9 items-center justify-center gap-1 rounded-lg border border-cyan-200/24 bg-cyan-200/10 p-0 text-xs font-semibold text-cyan-50 transition-colors hover:bg-cyan-200/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BE9FF] sm:w-auto sm:gap-1.5 sm:px-3"
      title="安装桌面端"
    >
      <AppWindow className="h-4 w-4" />
      <span className="hidden sm:inline">桌面端</span>
    </button>
  ) : (
    <button
      type="button"
      onClick={openDialog}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-cyan-100/28 bg-[#071A4A]/66 px-5 text-sm font-semibold text-[#EAFBFF] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md transition-colors hover:bg-[#0B2C68]/82 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BE9FF]"
    >
      <AppWindow className="h-4 w-4" />
      安装桌面端
    </button>
  )

  const dialog = open ? createPortal(
    <div
      className="fixed inset-0 z-[12000] flex items-end justify-center bg-[#010A24]/76 p-0 backdrop-blur-md sm:items-center sm:p-5"
      role="presentation"
      onMouseDown={event => {
        if (event.currentTarget === event.target) setOpen(false)
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[100dvh] w-full overflow-y-auto rounded-t-lg border border-cyan-200/20 bg-[#F7FBFF] shadow-[0_36px_100px_-30px_rgba(0,207,255,0.62)] sm:max-h-[92dvh] sm:max-w-2xl sm:rounded-lg"
      >
        <header className="relative overflow-hidden bg-[linear-gradient(112deg,#001D66_0%,#075BDB_56%,#00AEEA_100%)] px-5 py-5 pr-14 text-white sm:px-6">
          <div className="absolute inset-y-0 right-12 w-36 rotate-12 bg-[linear-gradient(90deg,transparent,rgba(139,233,255,.16),transparent)]" aria-hidden="true" />
          <p className="text-[10px] font-semibold uppercase text-cyan-100/68">Shitu GEO Web App</p>
          <h2 id={titleId} className="mt-1 text-xl font-semibold">安装势途 GEO 桌面端</h2>
          <p className="mt-2 max-w-lg text-xs leading-5 text-blue-100/82">免费安装、自动更新，与网页版使用同一账号和云端数据。</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md text-white/75 transition-colors hover:bg-white/12 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="关闭安装窗口"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-4 sm:p-6">
          <section className="overflow-hidden rounded-lg border border-[#A9D7FF] bg-white shadow-[0_20px_48px_-34px_rgba(22,119,255,0.6)]">
            <div className="flex items-start gap-4 px-4 py-5 sm:px-5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(145deg,#0637A6,#00AEEA)] text-white shadow-[0_14px_30px_-18px_rgba(7,91,219,0.9)]">
                <AppWindow className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-[#102A43]">免费安装为桌面应用</h3>
                  <span className="rounded bg-[#E6F7FF] px-2 py-0.5 text-[10px] font-semibold text-[#0569B8]">推荐</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">无需下载安装包，也不会触发 Mac 未认证开发者拦截。</p>
              </div>
            </div>

            <div className="border-t border-[#DDEAF7] bg-[#F7FBFF] px-4 py-4 sm:px-5">
              {installed ? (
                <div className="flex items-start gap-3 text-sm text-[#0E6B50]">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <div className="font-semibold">当前设备已安装</div>
                    <p className="mt-1 text-xs leading-5 text-[#397663]">可以从 Dock、启动台、桌面或开始菜单直接打开势途 GEO。</p>
                    {!nativeDesktop && notificationPermission === "default" ? (
                      <button
                        type="button"
                        onClick={() => void enableNotifications()}
                        className="mt-3 inline-flex h-9 items-center rounded-md border border-[#8DCCB8] bg-white px-3 text-xs font-semibold text-[#0E6B50] transition-colors hover:bg-[#EDFBF6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#13A777]"
                      >
                        开启任务完成通知
                      </button>
                    ) : null}
                    {!nativeDesktop && notificationPermission === "granted" ? (
                      <p className="mt-2 text-xs font-medium text-[#0E6B50]">任务完成后会发送系统通知。</p>
                    ) : null}
                    {!nativeDesktop && notificationPermission === "denied" ? (
                      <p className="mt-2 text-xs leading-5 text-amber-700">系统通知已关闭，可在浏览器或系统通知设置中重新开启。</p>
                    ) : null}
                  </div>
                </div>
              ) : installReady ? (
                <button
                  type="button"
                  onClick={() => void installPwa()}
                  disabled={installing}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[linear-gradient(90deg,#075BDB,#00AEEA)] px-5 text-sm font-semibold text-white shadow-[0_14px_28px_-18px_rgba(7,91,219,0.9)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677FF] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
                >
                  <AppWindow className="h-4 w-4" />
                  {installing ? "正在打开安装窗口" : "立即免费安装"}
                </button>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-[#1F4B7A]">在当前浏览器中安装：</p>
                  <ol className="mt-2 space-y-2">
                    {installSteps.map((step, index) => (
                      <li key={step} className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#DCEEFF] text-[9px] font-bold text-[#075BDB]">{index + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {installMessage ? <p className="mt-3 text-xs leading-5 text-[#1F5F8F]">{installMessage}</p> : null}
            </div>
          </section>

          <details className="group mt-4 overflow-hidden border-t border-[#C9DDF4]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-semibold text-[#294966] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677FF]">
              <span>原生内测安装包</span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="overflow-hidden rounded-lg border border-[#C9DDF4] bg-white">
              {orderedDownloads.map((download, index) => {
                const Icon = download.platform === "windows" ? MonitorDown : Laptop
                const recommended = download.platform === platform
                return (
                  <a
                    key={download.platform}
                    href={`/api/desktop/download/${download.platform}`}
                    className={`group/download flex min-h-20 items-center gap-3 px-4 py-3 transition-colors hover:bg-[#EDF7FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1677FF] ${index > 0 ? "border-t border-[#DDEAF7]" : ""}`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#E7F2FF] text-[#075BDB]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[#102A43]">{download.label} 测试包</span>
                        {recommended ? <span className="rounded bg-[#EEF6FF] px-2 py-0.5 text-[10px] font-semibold text-[#3974AD]">当前设备</span> : null}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-5 text-slate-500">{download.detail}</span>
                    </span>
                    <Download className="h-4 w-4 shrink-0 text-[#1677FF] transition-transform group-hover/download:translate-y-0.5" />
                  </a>
                )
              })}
            </div>

            <div className="mt-3 flex items-start gap-3 border-l-2 border-amber-400 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>v{DESKTOP_APP_VERSION} 原生包尚未购买商业代码签名，系统可能要求手动放行。普通用户建议使用上方免费桌面应用。</p>
            </div>
          </details>
        </div>
      </section>
    </div>,
    document.body,
  ) : null

  return (
    <>
      {trigger}
      {dialog}
    </>
  )
}
