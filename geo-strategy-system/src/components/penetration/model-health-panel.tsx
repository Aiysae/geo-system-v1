"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react"
import { MODEL_LABELS } from "@/lib/model-labels"
import {
  buildPenetrationModelStats,
  detectPenetrationModelAnomalies,
} from "@/lib/penetration/model-diagnostics"
import ModelAvatar from "@/components/model-avatar"
import ModelRerunDialog from "./model-rerun-dialog"
import type {
  AnalysisSubjectType,
  ModelKey,
  PenetrationModelRerunMode,
  PenetrationResult,
} from "@/types"

export interface ModelRerunRequest {
  model: ModelKey
  questions: string[]
  samplesPerQuestion: number
  mode: PenetrationModelRerunMode
}

interface Props {
  result: PenetrationResult
  subjectType: AnalysisSubjectType
  canRerun: boolean
  busy: boolean
  defaultSamples: number
  onRerun: (request: ModelRerunRequest) => void
}

function rate(value: number): string {
  return `${Math.round(value * 1000) / 10}%`
}

function shortDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
}

/**
 * One row per model: our rate, how much it answered, and whether its data
 * looks off. A model that looks off can be re-run on its own.
 */
export default function ModelHealthPanel({
  result,
  subjectType,
  canRerun,
  busy,
  defaultSamples,
  onRerun,
}: Props) {
  const [rerunModel, setRerunModel] = useState<ModelKey | null>(null)
  const stats = useMemo(() => buildPenetrationModelStats(result), [result])
  const anomalies = useMemo(
    () => detectPenetrationModelAnomalies(stats, { subjectType }),
    [stats, subjectType],
  )
  const questions = useMemo(() => Array.from(new Set(
    Object.values(result.byModel).flatMap(items => (items || []).map(item => item.question.trim()).filter(Boolean)),
  )), [result.byModel])
  const lastRerun = useMemo(() => {
    const latest = new Map<ModelKey, string>()
    for (const record of result.modelReruns || []) latest.set(record.model, record.rerunAt)
    return latest
  }, [result.modelReruns])
  if (stats.length === 0) return null
  const flagged = new Set(anomalies.map(item => item.model))

  return (
    <div className="geo-data-panel min-w-0 rounded-lg p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="geo-section-kicker">模型数据体检</div>
        <div className={`text-[11px] ${flagged.size ? "text-amber-700" : "text-emerald-700"}`}>
          {flagged.size ? `${flagged.size} 个模型的数据需要留意` : "各模型数据未发现明显异常"}
        </div>
      </div>
      <p className="mb-3 text-[11px] leading-5 text-slate-500">
        数据看起来不正常的模型，可以单独重新检测；重测完先对比，确认后再替换原结果。
      </p>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[620px] text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2 pr-3 font-medium">模型</th>
              <th className="px-2 py-2 text-right font-medium">我方提及率</th>
              <th className="px-2 py-2 text-right font-medium">回答</th>
              <th className="px-2 py-2 text-right font-medium">平均来源</th>
              <th className="px-2 py-2 font-medium">数据状态</th>
              <th className="py-2 pl-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {stats.map(item => {
              const issues = anomalies.filter(anomaly => anomaly.model === item.model)
              const rerunAt = lastRerun.get(item.model)
              return (
                <tr key={item.model} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                      <ModelAvatar model={item.model} size="xs" />
                      {MODEL_LABELS[item.model]}
                    </span>
                    {rerunAt ? (
                      <div className="mt-0.5 text-[10px] text-slate-400">{shortDate(rerunAt)} 已单独重测</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                    {rate(item.ourRate)}
                    <div className="text-[10px] text-slate-400">{item.ourMentions}/{item.answers}</div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">{item.answers}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">{item.avgSources.toFixed(1)}</td>
                  <td className="px-2 py-2">
                    {issues.length ? (
                      <div className="flex flex-wrap gap-1">
                        {issues.map(issue => (
                          <span
                            key={issue.code}
                            title={issue.detail}
                            className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 ring-1 ring-amber-200"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {issue.title}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" />
                        正常
                      </span>
                    )}
                    {issues.length ? (
                      <div className="mt-1 text-[10px] leading-4 text-slate-500">{issues[0].detail}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    {canRerun ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRerunModel(item.model)}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ring-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          issues.length
                            ? "bg-[#1677FF] text-white ring-[#1677FF] hover:bg-[#0958d9]"
                            : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <RotateCcw className="h-3 w-3" />
                        重新检测
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rerunModel ? (
        <ModelRerunDialog
          model={rerunModel}
          questionCount={questions.length}
          defaultSamples={defaultSamples}
          onClose={() => setRerunModel(null)}
          onConfirm={({ samplesPerQuestion, mode }) => {
            setRerunModel(null)
            onRerun({ model: rerunModel, questions, samplesPerQuestion, mode })
          }}
        />
      ) : null}
    </div>
  )
}
