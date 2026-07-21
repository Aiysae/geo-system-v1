"use client"

import { Copy, Printer } from "lucide-react"
import { useState } from "react"

export default function PublicReportActions() {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_600)
  }

  return (
    <div className="no-print fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-lg border border-white/35 bg-[#001D66]/92 p-2 text-white shadow-2xl backdrop-blur">
      <button type="button" onClick={() => void copyLink()} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold transition hover:bg-white/12">
        <Copy className="h-4 w-4" />{copied ? "已复制" : "复制链接"}
      </button>
      <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 text-xs font-semibold">
        <Printer className="h-4 w-4" />打印 / PDF
      </button>
    </div>
  )
}
