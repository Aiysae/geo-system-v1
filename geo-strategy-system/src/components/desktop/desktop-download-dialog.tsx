"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Download, Laptop, MonitorDown, ShieldAlert, X } from "lucide-react"
import { DESKTOP_APP_VERSION, DESKTOP_DOWNLOADS } from "@/lib/desktop-downloads"

type DesktopDownloadDialogProps = {
  variant: "header" | "hero"
}

function detectedPlatform(): "windows" | "mac" | null {
  if (typeof navigator === "undefined") return null
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes("windows")) return "windows"
  if (userAgent.includes("macintosh") || userAgent.includes("mac os")) return "mac"
  return null
}

export default function DesktopDownloadDialog({ variant }: DesktopDownloadDialogProps) {
  const [open, setOpen] = useState(false)
  const [platform, setPlatform] = useState<"windows" | "mac" | null>(null)
  const titleId = useId()
  const orderedDownloads = useMemo(() => {
    const downloads = [DESKTOP_DOWNLOADS.windows, DESKTOP_DOWNLOADS.mac]
    return platform ? downloads.sort(item => item.platform === platform ? -1 : 1) : downloads
  }, [platform])

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
    setOpen(true)
  }

  const trigger = variant === "header" ? (
    <button
      type="button"
      onClick={openDialog}
      className="inline-flex h-9 w-9 items-center justify-center gap-1 rounded-lg border border-cyan-200/24 bg-cyan-200/10 p-0 text-xs font-semibold text-cyan-50 transition-colors hover:bg-cyan-200/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BE9FF] sm:w-auto sm:gap-1.5 sm:px-3"
      title="下载桌面端"
    >
      <Download className="h-4 w-4" />
      <span className="hidden sm:inline">桌面端</span>
    </button>
  ) : (
    <button
      type="button"
      onClick={openDialog}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-cyan-100/28 bg-[#071A4A]/66 px-5 text-sm font-semibold text-[#EAFBFF] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md transition-colors hover:bg-[#0B2C68]/82 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BE9FF]"
    >
      <Download className="h-4 w-4" />
      下载桌面端
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
        className="w-full overflow-hidden rounded-t-lg border border-cyan-200/20 bg-[#F7FBFF] shadow-[0_36px_100px_-30px_rgba(0,207,255,0.62)] sm:max-w-xl sm:rounded-lg"
      >
        <header className="relative overflow-hidden bg-[linear-gradient(112deg,#001D66_0%,#075BDB_56%,#00AEEA_100%)] px-5 py-5 pr-14 text-white sm:px-6">
          <div className="absolute inset-y-0 right-12 w-36 rotate-12 bg-[linear-gradient(90deg,transparent,rgba(139,233,255,.16),transparent)]" aria-hidden="true" />
          <p className="text-[10px] font-semibold uppercase text-cyan-100/68">Shitu GEO Desktop</p>
          <h2 id={titleId} className="mt-1 text-xl font-semibold">下载势途 GEO 桌面端</h2>
          <p className="mt-2 text-xs leading-5 text-blue-100/78">登录同一账号，即可继续查看客户资料、后台任务与历史报告。</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md text-white/75 transition-colors hover:bg-white/12 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="关闭下载窗口"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-4 sm:p-6">
          <div className="overflow-hidden rounded-lg border border-[#C9DDF4] bg-white">
            {orderedDownloads.map((download, index) => {
              const Icon = download.platform === "windows" ? MonitorDown : Laptop
              const recommended = download.platform === platform
              return (
                <a
                  key={download.platform}
                  href={`/api/desktop/download/${download.platform}`}
                  className={`group flex min-h-24 items-center gap-4 px-4 py-4 transition-colors hover:bg-[#EDF7FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1677FF] sm:px-5 ${index > 0 ? "border-t border-[#DDEAF7]" : ""}`}
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(145deg,#075BDB,#00AEEA)] text-white shadow-[0_12px_28px_-15px_rgba(7,91,219,0.88)]">
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-[#102A43]">{download.label}</span>
                      {recommended ? <span className="rounded bg-[#E6F7FF] px-2 py-0.5 text-[10px] font-semibold text-[#0569B8]">适合当前设备</span> : null}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">{download.detail}</span>
                  </span>
                  <Download className="h-5 w-5 shrink-0 text-[#1677FF] transition-transform group-hover:translate-y-0.5" />
                </a>
              )
            })}
          </div>

          <div className="mt-4 flex items-start gap-3 border-l-2 border-amber-400 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>当前为 v{DESKTOP_APP_VERSION} 免费内测包，尚未购买商业代码签名。首次安装时，系统可能要求确认开发者或选择继续运行。</p>
          </div>
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
