"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowRight, Check, RotateCcw, Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { MODEL_LABELS } from "@/lib/model-labels"
import type {
  PenetrationJobRecord,
  PenetrationModelRerunSnapshot,
  PenetrationModelStats,
  PenetrationResult,
} from "@/types"

interface Props {
  jobId: string
  canExecute: boolean
  onPenetration: (penetration: PenetrationResult) => void
  onClear: () => void
}

type DecisionResponse = { job?: PenetrationJobRecord; penetration?: PenetrationResult; error?: string }

function rate(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 1000) / 10}%`
}

function share(count: number, total: number): string {
  return total > 0 ? `${count}/${total}` : "—"
}

function topDomain(stats: PenetrationModelStats | undefined): string {
  const top = stats?.topDomains[0]
  if (!top || !stats?.sourceCount) return "—"
  return `${top.domain} ${Math.round((top.count / stats.sourceCount) * 100)}%`
}

function Row({ label, before, after, emphasis = false }: {
  label: string
  before: string
  after: string
  emphasis?: boolean
}) {
  const changed = before !== after
  return (
    <tr className="border-t border-slate-100">
      <td className="py-1.5 pr-3 text-slate-500">{label}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{before}</td>
      <td className="px-1 py-1.5 text-center text-slate-300"><ArrowRight className="inline h-3 w-3" /></td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${changed ? "font-semibold text-[#0958d9]" : "text-slate-600"} ${emphasis ? "text-sm" : ""}`}>
        {after}
      </td>
    </tr>
  )
}

function ComparisonTable({ before, after }: {
  before?: PenetrationModelRerunSnapshot
  after?: PenetrationModelRerunSnapshot
}) {
  const b = before?.model
  const a = after?.model
  const brands = Array.from(new Set([
    ...(b?.topBrands || []).map(item => item.brand),
    ...(a?.topBrands || []).map(item => item.brand),
  ])).slice(0, 6)
  const brandRate = (stats: PenetrationModelStats | undefined, brand: string) => (
    stats?.topBrands.find(item => item.brand === brand)?.rate
  )
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-400">
            <th className="py-1 text-left font-medium">指标</th>
            <th className="px-2 py-1 text-right font-medium">原结果</th>
            <th />
            <th className="px-2 py-1 text-right font-medium">重测结果</th>
          </tr>
        </thead>
        <tbody>
          <Row label="总体渗透率" before={rate(before?.overallRate)} after={rate(after?.overallRate)} emphasis />
          <Row label="我方行业排名" before={before?.ourRanking ? `第 ${before.ourRanking}` : "未上榜"} after={after?.ourRanking ? `第 ${after.ourRanking}` : "未上榜"} />
          <Row label="该模型我方提及率" before={rate(b?.ourRate)} after={rate(a?.ourRate)} emphasis />
          <Row label="回答数" before={String(b?.answers ?? "—")} after={String(a?.answers ?? "—")} />
          <Row label="没推荐任何公司" before={share(b?.noBrandAnswers ?? 0, b?.recognisedAnswers ?? 0)} after={share(a?.noBrandAnswers ?? 0, a?.recognisedAnswers ?? 0)} />
          <Row label="品牌识别失败" before={String(b?.extractionFailed ?? "—")} after={String(a?.extractionFailed ?? "—")} />
          <Row label="模型判断无需联网" before={String(b?.searchDeclined ?? "—")} after={String(a?.searchDeclined ?? "—")} />
          <Row label="平均来源" before={b ? b.avgSources.toFixed(1) : "—"} after={a ? a.avgSources.toFixed(1) : "—"} />
          <Row label="占比最高的来源" before={topDomain(b)} after={topDomain(a)} />
        </tbody>
      </table>
      {brands.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400">
              <th className="py-1 text-left font-medium">头部品牌（该模型提及率）</th>
              <th className="px-2 py-1 text-right font-medium">原结果</th>
              <th />
              <th className="px-2 py-1 text-right font-medium">重测结果</th>
            </tr>
          </thead>
          <tbody>
            {brands.map(brand => (
              <Row key={brand} label={brand} before={rate(brandRate(b, brand))} after={rate(brandRate(a, brand))} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * After a single-model re-run: the comparison awaiting a decision, or, once
 * written into the report, a way to undo it.
 */
export default function ModelRerunReview({ jobId, canExecute, onPenetration, onClear }: Props) {
  const [job, setJob] = useState<PenetrationJobRecord | null>(null)
  const [pending, setPending] = useState<"apply" | "discard" | "undo" | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    void apiFetch(`/api/penetration/jobs/${jobId}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await readApiJson<PenetrationJobRecord & { error?: string }>(response, "重测任务查询")
        if (response.status === 404) {
          onClear()
          return
        }
        if (!response.ok) throw new Error(data.error || "重测任务查询失败")
        setJob(data)
        const decision = data.modelRerun?.decision
        if (decision === "discarded" || decision === "undone") onClear()
      })
      .catch(caught => {
        if (caught instanceof DOMException && caught.name === "AbortError") return
        setError(caught instanceof Error ? caught.message : "重测任务查询失败")
      })
    return () => controller.abort()
  }, [jobId, onClear])

  const decide = useCallback(async (action: "apply" | "discard" | "undo") => {
    if (action === "undo" && !window.confirm("确认撤销这次重测，恢复成覆盖前的检测结果吗？")) return
    setPending(action)
    setError("")
    try {
      const response = await apiFetch(`/api/penetration/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await readApiJson<DecisionResponse>(response, "重测结果处理")
      if (!response.ok) throw new Error(data.error || "操作失败，请稍后重试")
      if (data.job) setJob(data.job)
      if (data.penetration) onPenetration(data.penetration)
      if (action !== "apply") onClear()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试")
    } finally {
      setPending(null)
    }
  }, [jobId, onClear, onPenetration])

  const state = job?.modelRerun
  if (!state || job.status === "queued" || job.status === "running") return null
  const label = MODEL_LABELS[state.model]

  if (state.decision === "pending") {
    return (
      <div className="rounded-lg border border-[#91CAFF] bg-[#F5FAFF] p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-[#003EB3]">
              <RotateCcw className="h-4 w-4" />
              {label} 重新检测完成，请确认是否采用
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              共重测 {state.questionCount} 个问题 × {state.samplesPerQuestion} 次。下面是替换前后的对比，原结果在你采用前保持不变。
              {job.status === "blocked" ? " 有个别问题重测失败，采用后这些问题保留原回答。" : ""}
            </p>
          </div>
          {canExecute ? (
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void decide("discard")} className="gap-1.5">
                <X className="h-4 w-4" />
                {pending === "discard" ? "正在放弃…" : "放弃新结果"}
              </Button>
              <Button type="button" disabled={pending !== null} onClick={() => void decide("apply")} className="gap-1.5">
                <Check className="h-4 w-4" />
                {pending === "apply" ? "正在采用…" : "用新结果覆盖"}
              </Button>
            </div>
          ) : null}
        </div>
        <ComparisonTable before={state.before} after={state.after} />
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      </div>
    )
  }

  if (state.decision === "applied" && state.undoable) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800">
        <span>
          {label} 已单独重新检测并替换原结果
          {state.after?.model ? `：该模型我方提及率 ${rate(state.before?.model?.ourRate)} → ${rate(state.after.model.ourRate)}` : ""}。
        </span>
        {canExecute ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void decide("undo")}
            className="inline-flex items-center gap-1 font-medium text-emerald-900 underline-offset-2 hover:underline disabled:opacity-50"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {pending === "undo" ? "正在撤销…" : "撤销，恢复原结果"}
          </button>
        ) : null}
        {error ? <p className="w-full text-rose-600">{error}</p> : null}
      </div>
    )
  }
  return null
}
