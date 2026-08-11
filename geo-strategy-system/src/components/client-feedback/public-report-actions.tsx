"use client"

import { Copy, Printer } from "lucide-react"
import { useEffect, useState } from "react"

export default function PublicReportActions() {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("print") !== "1") return
    const timer = window.setTimeout(() => window.print(), 450)
    return () => window.clearTimeout(timer)
  }, [])

  async function copyLink() {
    const url = new URL(window.location.href)
    url.searchParams.delete("print")
    await navigator.clipboard.writeText(url.toString())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_600)
  }

  return (
    <div className="no-print mx-auto mb-3 flex w-full max-w-6xl items-center gap-2 rounded-lg border border-white/35 bg-[#001D66]/92 p-2 text-white shadow-lg backdrop-blur sm:w-fit sm:justify-self-end">
      <button type="button" onClick={() => void copyLink()} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-xs font-semibold transition hover:bg-white/12 sm:flex-none">
        <Copy className="h-4 w-4" />{copied ? "已复制" : "复制链接"}
      </button>
      <button type="button" onClick={() => window.print()} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 text-xs font-semibold sm:flex-none">
        <Printer className="h-4 w-4" />打印 / PDF
      </button>
    </div>
  )
}
