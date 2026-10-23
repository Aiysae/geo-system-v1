"use client"

import { useState } from "react"
import { Ban, RotateCcw } from "lucide-react"
import { sharedRank } from "@/lib/score-utils"
import type { IndustryShareItem } from "@/types"

interface Props {
  /** The overall ranking after exclusions, to pick from. */
  ranking: IndustryShareItem[]
  /** Excluded names found in the answers, with how often they came up. */
  excludedShare: IndustryShareItem[]
  clientExcluded: string[]
  globalExcluded: string[]
  pending: string | null
  error: string
  onExclude: (name: string) => void
  onRestore: (name: string) => void
}

const PICK_LIMIT = 15

function rate(value: number): string {
  return `${Math.round(value * 100)}%`
}

function key(value: string): string {
  return value.replace(/[（(].*?[）)]/g, "").replace(/\s+/g, "").toLowerCase()
}

/**
 * Names that are not competitors, such as a government platform the answers
 * point to: left out of every ranking (overall, per question, the PDF and
 * share links) and listed here with how often they came up.
 */
export default function ExcludedSubjectsPanel({
  ranking,
  excludedShare,
  clientExcluded,
  globalExcluded,
  pending,
  error,
  onExclude,
  onRestore,
}: Props) {
  const [draft, setDraft] = useState("")
  const counts = ranking.map(item => item.count)
  const seen = (name: string) => excludedShare.find(item => item.brand === name || key(item.brand) === key(name))
  const rows = [
    ...globalExcluded.map(name => ({ name, scope: "global" as const })),
    ...clientExcluded.filter(name => !globalExcluded.includes(name)).map(name => ({ name, scope: "client" as const })),
  ]

  function submit() {
    const name = draft.trim()
    if (!name) return
    onExclude(name)
    setDraft("")
  }

  return (
    <div className="geo-data-panel min-w-0 rounded-lg p-4">
      <div className="geo-section-kicker mb-1">不算竞品的名称</div>
      <p className="mb-3 text-[11px] leading-5 text-slate-500">
        政府平台、行业机构这类不是竞品的名称，可以从所有排行中去掉（总榜、单题排名、PDF 报告和分享链接都会去掉），随时可以恢复。
      </p>

      {rows.length ? (
        <div className="mb-3 space-y-1.5">
          {rows.map(row => {
            const found = seen(row.name)
            return (
              <div key={`${row.scope}-${row.name}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50/70 px-3 py-1.5 text-xs">
                <span className="min-w-0 text-slate-700">
                  <span className="font-medium">{row.name}</span>
                  <span className="ml-2 text-[10px] text-slate-400">
                    {found ? `${rate(found.penetrationRate)} 的回答提到（${found.count} 次）` : "本次结果中没有出现"}
                  </span>
                </span>
                {row.scope === "global" ? (
                  <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] text-slate-500" title="由管理员设置，对所有客户生效">
                    全局排除
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => onRestore(row.name)}
                    className="inline-flex items-center gap-1 text-[11px] text-[#1677FF] hover:underline disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                    {pending === row.name ? "正在恢复…" : "恢复"}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="mb-2 text-[11px] font-medium text-slate-600">从总榜前 {PICK_LIMIT} 名中排除：</div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {ranking.slice(0, PICK_LIMIT).map(item => (
          <button
            key={item.brand}
            type="button"
            disabled={pending !== null}
            onClick={() => onExclude(item.brand)}
            title={`把「${item.brand}」从所有排行中去掉`}
            className="group inline-flex max-w-[240px] items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-50"
          >
            <span className="tabular-nums text-slate-400">{sharedRank(counts, item.count)}</span>
            <span className="truncate">{item.brand}</span>
            <Ban className="h-3 w-3 shrink-0 text-slate-300 group-hover:text-rose-500" />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") submit()
          }}
          placeholder="或输入要排除的名称，例如：全国建筑市场监管公共服务平台"
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-[#1677FF]"
        />
        <button
          type="button"
          disabled={pending !== null || !draft.trim()}
          onClick={submit}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-slate-800 px-3 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          <Ban className="h-3.5 w-3.5" />
          {pending && !rows.some(row => row.name === pending) ? "正在排除…" : "不算竞品"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  )
}
