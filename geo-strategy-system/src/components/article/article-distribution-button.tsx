"use client"

import { useState } from "react"
import { Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { toUserFacingError } from "@/lib/user-facing-errors"

export type ArticleDistributionRequest = {
  kind: "current"
  clientId: string
  title: string
  markdown: string
  metadata?: {
    digest?: string
    tags?: string[]
    coverUrl?: string
    original?: boolean
  }
} | {
  kind: "batch"
  batchId: string
  itemIds?: string[]
  variant: "original" | "media"
} | {
  kind: "production_run"
  runId: string
  clientId: string
  itemIds: string[]
}

export default function ArticleDistributionButton({
  request,
  disabled,
  children = "加入分发台",
  className,
  compact = false,
}: {
  request: ArticleDistributionRequest | ArticleDistributionRequest[]
  disabled?: boolean
  children?: React.ReactNode
  className?: string
  compact?: boolean
}) {
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState("")

  async function importArticles() {
    if (disabled || importing) return
    setImporting(true)
    setError("")
    const articleIds = new Set<string>()
    try {
      const teamId = new URL(window.location.href).searchParams.get("teamId") || undefined
      for (const item of Array.isArray(request) ? request : [request]) {
        const response = await apiFetch("/api/local-publishing/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...item, teamId }),
        })
        const data = await readApiJson<{ articleIds?: string[]; error?: string }>(response, "导入分发台")
        if (!response.ok) throw new Error(data.error || "稿件导入失败")
        for (const id of data.articleIds || []) articleIds.add(id)
      }
      if (articleIds.size === 0) throw new Error("没有可导入的文章正文")
      // The distribution console is its own page; a full navigation also keeps this
      // button usable where no App Router is mounted.
      window.location.assign(articleIds.size === 1
        ? `/publishing?article=${encodeURIComponent([...articleIds][0])}`
        : "/publishing?tab=articles")
    } catch (failure) {
      const message = toUserFacingError(failure, { fallback: "稿件导入失败，请稍后重试。", subject: "导入分发台" })
      setError(articleIds.size > 0 ? `已保存 ${articleIds.size} 篇稿件，可在分发台查看；${message}` : message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" size={compact ? "icon" : "sm"} variant="outline" onClick={() => void importArticles()} disabled={disabled || importing} className={className} title="保存到分发内容库，之后选择账号和分发方式" aria-label={typeof children === "string" ? children : "加入分发台"}>
        {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        {!compact ? importing ? "正在导入…" : children : null}
      </Button>
      {error ? <span role="alert" className="max-w-72 text-[11px] leading-5 text-rose-600">{error}</span> : null}
    </span>
  )
}
