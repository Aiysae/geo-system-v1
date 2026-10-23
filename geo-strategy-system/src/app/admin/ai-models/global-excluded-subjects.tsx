"use client"

import { useState } from "react"
import { Ban, Loader2 } from "lucide-react"
import { apiFetch, readApiJson } from "@/lib/api-fetch"

/**
 * Names every client's question-detection rankings leave out as not
 * competitors, such as government platforms. One per line.
 */
export function GlobalExcludedSubjects({ initial }: { initial: string[] }) {
  const [saved, setSaved] = useState(initial)
  const [draft, setDraft] = useState(initial.join("\n"))
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const names = draft.split("\n").map(line => line.trim()).filter(Boolean)
  const changed = names.join("\n") !== saved.join("\n")

  async function save() {
    setPending(true)
    setNotice(null)
    try {
      const response = await apiFetch("/api/penetration/excluded-subjects", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ global: names }),
      })
      const data = await readApiJson<{ global?: string[]; error?: string }>(response, "全局排除名单保存")
      if (!response.ok || !data.global) throw new Error(data.error || "保存失败")
      setSaved(data.global)
      setDraft(data.global.join("\n"))
      setNotice({ ok: true, text: `已保存 ${data.global.length} 个名称，所有客户的排行即时生效。` })
    } catch (caught) {
      setNotice({ ok: false, text: caught instanceof Error ? caught.message : "保存失败" })
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800">
        <Ban className="h-4 w-4 text-slate-500" />
        疑问句检测 · 全局“不算竞品”名单
      </div>
      <p className="mb-3 text-xs leading-5 text-slate-500">
        这里的名称会从所有客户的渗透率排行中去掉（总榜、单题排名、PDF 报告和分享链接），适合政府平台、官方机构这类对所有客户都不算竞品的名称。每行一个，写 AI 回答里出现的名称即可，同一名称的不同写法会一起去掉。单个客户的排除在检测结果页里设置。
      </p>
      <textarea
        value={draft}
        onChange={event => setDraft(event.target.value)}
        rows={6}
        placeholder={"全国建筑市场监管公共服务平台\n中国政府采购网"}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-[#1677FF]"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs ${notice ? (notice.ok ? "text-emerald-600" : "text-rose-600") : "text-slate-400"}`}>
          {notice?.text || `共 ${names.length} 个名称`}
        </span>
        <button
          type="button"
          disabled={pending || !changed}
          onClick={() => void save()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1677FF] px-4 text-xs font-semibold text-white transition hover:bg-[#0958D9] disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          保存名单
        </button>
      </div>
    </section>
  )
}
