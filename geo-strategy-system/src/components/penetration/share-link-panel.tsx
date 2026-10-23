"use client"

import { useCallback, useState } from "react"
import { Check, Copy, ExternalLink, Link2, Loader2, Share2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch, readApiJson } from "@/lib/api-fetch"

interface ShareSummary {
  token: string
  sharePath: string
  createdAt: string
  generatedAt: string
}

interface Props {
  clientId: string
  teamId?: string
  /** When the report on the page was generated; a link made earlier shows an older one. */
  reportGeneratedAt: string
}

function dateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false })
}

function shareUrl(path: string): string {
  return typeof window === "undefined" ? path : new URL(path, window.location.origin).toString()
}

/**
 * Share links for the detection results. Each link shows the report as it
 * was when made, stays valid until turned off, and needs no sign-in.
 */
export default function ShareLinkPanel({ clientId, teamId, reportGeneratedAt }: Props) {
  const [open, setOpen] = useState(false)
  const [shares, setShares] = useState<ShareSummary[] | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState("")
  const query = new URLSearchParams({ clientId, ...(teamId ? { teamId } : {}) }).toString()

  const load = useCallback(async () => {
    setError("")
    try {
      const response = await apiFetch(`/api/penetration/shares?${query}`, { cache: "no-store" })
      const data = await readApiJson<{ shares?: ShareSummary[]; error?: string }>(response, "分享链接读取")
      if (!response.ok) throw new Error(data.error || "分享链接读取失败")
      setShares(data.shares || [])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分享链接读取失败")
      setShares([])
    }
  }, [query])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) void load()
  }

  async function copy(share: ShareSummary) {
    try {
      await navigator.clipboard.writeText(shareUrl(share.sharePath))
      setCopied(share.token)
      window.setTimeout(() => setCopied(current => current === share.token ? null : current), 1_600)
    } catch {
      setError("浏览器不允许自动复制，请手动选中链接复制")
    }
  }

  async function create() {
    setPending("create")
    setError("")
    try {
      const response = await apiFetch("/api/penetration/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, teamId }),
      })
      const data = await readApiJson<{ share?: ShareSummary; error?: string }>(response, "分享链接生成")
      if (!response.ok || !data.share) throw new Error(data.error || "分享链接生成失败")
      const share = data.share
      setShares(current => [share, ...(current || [])])
      await copy(share)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分享链接生成失败")
    } finally {
      setPending(null)
    }
  }

  async function revoke(share: ShareSummary) {
    if (!window.confirm("关闭后，这个链接立即失效，收到链接的人将无法再打开。确认关闭吗？")) return
    setPending(share.token)
    setError("")
    try {
      const response = await apiFetch(`/api/penetration/shares?${query}&token=${encodeURIComponent(share.token)}`, {
        method: "DELETE",
      })
      const data = await readApiJson<{ error?: string }>(response, "分享链接关闭")
      if (!response.ok) throw new Error(data.error || "分享链接关闭失败")
      setShares(current => (current || []).filter(item => item.token !== share.token))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分享链接关闭失败")
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="no-print">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={toggle}>
          <Share2 className="h-3.5 w-3.5" />
          分享结果
        </Button>
      </div>
      {open ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">分享检测结果</div>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                对方无需登录即可查看完整结果（含每条原始回答和来源）。链接内容固定为生成时的结果，之后重测不会改变它；可随时关闭。
              </p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="关闭" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <Button type="button" size="sm" className="gap-1.5" disabled={pending !== null} onClick={() => void create()}>
            {pending === "create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            {pending === "create" ? "正在生成…" : "生成分享链接并复制"}
          </Button>
          {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
          <div className="mt-3 space-y-2">
            {shares === null ? (
              <p className="text-xs text-slate-400">正在读取已有链接…</p>
            ) : shares.length === 0 ? (
              <p className="text-xs text-slate-400">还没有分享链接。</p>
            ) : shares.map(share => (
              <div key={share.token} className="rounded-md border border-slate-100 bg-slate-50/70 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <input
                    readOnly
                    value={shareUrl(share.sharePath)}
                    onFocus={event => event.currentTarget.select()}
                    className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-600"
                  />
                  <button type="button" onClick={() => void copy(share)} className="inline-flex items-center gap-1 text-xs text-[#1677FF] hover:underline">
                    {copied === share.token ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === share.token ? "已复制" : "复制"}
                  </button>
                  <a href={share.sharePath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
                    <ExternalLink className="h-3.5 w-3.5" />
                    打开
                  </a>
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void revoke(share)}
                    className="text-xs text-slate-500 hover:text-rose-600 disabled:opacity-50"
                  >
                    {pending === share.token ? "正在关闭…" : "关闭分享"}
                  </button>
                </div>
                <div className="mt-1 text-[10px] text-slate-400">
                  分享于 {dateTime(share.createdAt)} · 结果检测于 {dateTime(share.generatedAt)}
                  {share.generatedAt !== reportGeneratedAt ? " · 不是当前最新结果" : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
