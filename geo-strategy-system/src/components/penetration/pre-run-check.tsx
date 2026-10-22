"use client"

import { AlertTriangle, Gauge } from "lucide-react"
import { MODEL_LABELS } from "@/lib/model-labels"
import ModelAvatar from "@/components/model-avatar"
import type { ModelKey } from "@/types"

export interface PreRunModelStatus {
  model: ModelKey
  ready: boolean
  reason?: string
  concurrency?: number
  accounts?: { usable: number; total: number }
  warnings?: string[]
  secondsPerAnswer?: number
}

interface Props {
  models: PreRunModelStatus[]
  /** Answers each model will collect: questions times samples. */
  answersPerModel: number
}

function minutesLabel(seconds: number): string {
  if (seconds < 90) return "约 1 分钟"
  return `约 ${Math.round(seconds / 60)} 分钟`
}

/**
 * Shows, before a run starts, how fast each selected model will go and which
 * of its accounts stopped, so a slow or partial run is no surprise.
 */
export default function PreRunCheck({ models, answersPerModel }: Props) {
  const rows = models.filter(model => model.ready && model.concurrency)
  if (rows.length === 0 || answersPerModel <= 0) return null
  const estimates = rows.map(model => ({
    ...model,
    seconds: Math.ceil(answersPerModel / Math.max(1, model.concurrency || 1)) * (model.secondsPerAnswer || 20),
  }))
  // Models run side by side, so the slowest one sets the time.
  const slowest = estimates.reduce((longest, item) => (item.seconds > longest.seconds ? item : longest))
  const warned = estimates.filter(item => (item.warnings || []).length > 0)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <Gauge className="h-3.5 w-3.5 text-[#1677FF]" />
          检测前体检
        </div>
        <div className="text-[11px] text-slate-500">
          预计耗时 <span className="font-semibold text-slate-700">{minutesLabel(slowest.seconds)}</span>
          {rows.length > 1 ? `（${rows.length} 个模型同时进行，最慢的是${MODEL_LABELS[slowest.model]}）` : ""}
        </div>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {estimates.map(item => (
          <div
            key={item.model}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] ${
              (item.warnings || []).length ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"
            }`}
            title={(item.warnings || []).join("；") || undefined}
          >
            <ModelAvatar model={item.model} size="xs" />
            <span className="font-medium">{MODEL_LABELS[item.model]}</span>
            <span className="ml-auto tabular-nums">
              {item.accounts ? `账号 ${item.accounts.usable}/${item.accounts.total} · ` : ""}
              并发 {item.concurrency} · {minutesLabel(item.seconds)}
            </span>
          </div>
        ))}
      </div>
      {warned.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] leading-5 text-amber-700">
          {warned.map(item => (
            <li key={item.model} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{MODEL_LABELS[item.model]}：{(item.warnings || []).join("；")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
