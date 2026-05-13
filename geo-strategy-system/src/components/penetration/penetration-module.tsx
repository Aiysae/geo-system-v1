"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Target, ChevronDown, MessageSquare } from "lucide-react"
import BatchInputPanel from "./batch-input-panel"
import PenetrationDonut from "./penetration-donut"
import IndustryShareChart from "./industry-share-chart"
import BrandRankingCard from "./brand-ranking-card"
import ModelRateTrend from "./model-rate-trend"
import { MODEL_LABELS } from "@/lib/llm"
import type { Client, ModelKey, PenetrationResult } from "@/types"

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}

export default function PenetrationModule({ client, onChangeClient }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const [modelErrors, setModelErrors] = useState<Partial<Record<ModelKey, string>>>({})

  async function handleRun(params: { questions: string[]; models: ModelKey[] }) {
    setLoading(true)
    setError(null)
    setSkipped([])
    setModelErrors({})
    try {
      const res = await fetch("/api/penetration", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ourBrand: client.ourBrand,
          industry: client.industry,
          questions: params.questions,
          competitors: client.competitors,
          models: params.models,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (Array.isArray(data.skipped)) setSkipped(data.skipped)
        throw new Error(data.error || "请求失败")
      }
      const result: PenetrationResult = {
        byModel: data.byModel,
        aggregated: data.aggregated,
        generatedAt: data.generatedAt,
      }
      onChangeClient({ penetration: result })
      if (Array.isArray(data.skipped)) setSkipped(data.skipped)
      if (data.modelErrors && typeof data.modelErrors === "object") {
        setModelErrors(data.modelErrors)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }

  const pen = client.penetration

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3 text-base text-slate-800">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0077B6] via-[#00B4D8] to-[#48cae4] flex items-center justify-center shadow-lg shadow-cyan-200/50">
            <Target className="h-5 w-5 text-white" />
          </span>
          <span className="bg-gradient-to-r from-[#004B73] to-[#0077B6] bg-clip-text text-transparent font-semibold">
            模块一 · 关键词渗透率与竞品情报
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
          <div className="lg:border-r lg:border-slate-100 lg:pr-6">
            <BatchInputPanel
              key={client.id}
              client={client}
              onChangeClient={onChangeClient}
              onRun={handleRun}
              loading={loading}
              error={error}
              skipped={skipped}
              modelErrors={modelErrors}
            />
          </div>

          <div className="space-y-5">
            {!pen ? (
              <div className="flex h-full min-h-[300px] items-center justify-center text-center">
                <div>
                  <div className="text-sm text-slate-500 mb-1">情报大盘待生成</div>
                  <div className="text-xs text-slate-400">
                    填写左侧信息后点击检测，多模型并行调用，约 10-30 秒返回
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4 bg-gradient-to-br from-slate-50 to-white">
                    <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">
                      渗透率
                    </div>
                    <PenetrationDonut
                      rate={pen.aggregated.penetrationRate}
                      mentions={pen.aggregated.ourMentions}
                      totalSlots={pen.aggregated.totalSlots}
                    />
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 bg-white">
                    <BrandRankingCard
                      ranking={pen.aggregated.ourRanking}
                      totalBrands={pen.aggregated.industryShare.length}
                      perModelRate={pen.aggregated.perModelRate}
                      topCompetitors={pen.aggregated.topCompetitors}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4 bg-white">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-3">
                    行业占有率 Top {pen.aggregated.industryShare.length}
                  </div>
                  <IndustryShareChart
                    items={pen.aggregated.industryShare}
                    ourBrand={client.ourBrand}
                  />
                </div>

                {pen.aggregated.perModelRate.length > 0 && (
                  <div className="rounded-xl border border-slate-200 p-4 bg-gradient-to-br from-white via-slate-50/40 to-blue-50/30">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-[11px] uppercase tracking-wider text-slate-400">
                        各模型渗透率对比 · 趋势图
                      </div>
                      <div className="text-[10px] text-amber-600 inline-flex items-center gap-1.5">
                        <span className="inline-block w-3 border-t-2 border-dashed border-amber-400"></span>
                        整体均值
                      </div>
                    </div>
                    <ModelRateTrend
                      perModelRate={pen.aggregated.perModelRate}
                      overallRate={pen.aggregated.penetrationRate}
                    />
                  </div>
                )}

                {pen.aggregated.missedQuestions.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                    <div className="text-[11px] uppercase tracking-wider text-amber-700 mb-2">
                      未被任一模型提及的疑问句（{pen.aggregated.missedQuestions.length}）
                    </div>
                    <ul className="space-y-1 text-xs text-amber-900 list-disc pl-4">
                      {pen.aggregated.missedQuestions.slice(0, 6).map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                      {pen.aggregated.missedQuestions.length > 6 && (
                        <li className="list-none text-amber-600">
                          ...还有 {pen.aggregated.missedQuestions.length - 6} 条
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                <RawAnswersPanel byModel={pen.byModel} ourBrand={client.ourBrand} />

                <div className="text-[11px] text-slate-400 text-right">
                  生成于 {new Date(pen.generatedAt).toLocaleString("zh-CN")}
                </div>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function RawAnswersPanel({
  byModel,
  ourBrand,
}: {
  byModel: PenetrationResult["byModel"]
  ourBrand: string
}) {
  const models = (Object.keys(byModel) as ModelKey[]).filter(m => byModel[m]?.length)
  const [open, setOpen] = useState(false)
  const [activeModel, setActive] = useState<ModelKey | null>(models[0] ?? null)
  if (models.length === 0 || !activeModel) return null

  function highlight(text: string, brand: string): React.ReactNode {
    const b = brand.trim()
    if (!b) return text
    const parts = text.split(new RegExp(`(${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"))
    return parts.map((p, i) =>
      p.toLowerCase() === b.toLowerCase() ? (
        <mark
          key={i}
          className="bg-gradient-to-r from-amber-200 to-yellow-200 text-amber-900 px-1 rounded font-semibold"
        >
          {p}
        </mark>
      ) : (
        <span key={i}>{p}</span>
      )
    )
  }

  const items = byModel[activeModel] ?? []
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50/70 transition group"
      >
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
            <MessageSquare className="h-3.5 w-3.5 text-white" />
          </span>
          <div className="text-left">
            <div className="text-sm font-medium text-slate-800">AI 原始回复审计</div>
            <div className="text-[11px] text-slate-500">
              查看每个模型对每个问题的真实回答（黄色高亮 = 命中我方品牌）
            </div>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-slate-100">
          <div className="flex flex-wrap gap-1.5 px-4 py-3 bg-slate-50/40 border-b border-slate-100">
            {models.map(m => (
              <button
                key={m}
                onClick={() => setActive(m)}
                className={`text-xs px-3 py-1.5 rounded-lg transition font-medium ${
                  activeModel === m
                    ? "bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white shadow"
                    : "bg-white text-slate-600 border border-slate-200 hover:border-[#0077B6]"
                }`}
              >
                {MODEL_LABELS[m]} · {byModel[m]?.length ?? 0} 条
              </button>
            ))}
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
            {items.map((it, i) => {
              const hit =
                typeof it.hitOur === "boolean"
                  ? it.hitOur
                  : ourBrand
                    ? it.mentionedBrands.some(b => b.toLowerCase() === ourBrand.toLowerCase().trim())
                    : false
              return (
                <div key={i} className="px-4 py-3 hover:bg-slate-50/50 transition">
                  <div className="flex items-start gap-2 mb-1.5">
                    <span className="text-[10px] font-mono text-slate-400 mt-0.5">
                      Q{String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="text-xs font-medium text-slate-700 flex-1">{it.question}</div>
                    {hit ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold whitespace-nowrap">
                        ✓ 命中
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">
                        未命中
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-600 leading-relaxed pl-7 mb-2">
                    {highlight(it.answer, ourBrand)}
                  </div>
                  {it.mentionedBrands.length > 0 && (
                    <div className="flex flex-wrap gap-1 pl-7">
                      {it.mentionedBrands.map((b, j) => {
                        const isOur = ourBrand && b.toLowerCase() === ourBrand.toLowerCase().trim()
                        return (
                          <span
                            key={j}
                            className={`text-[10px] px-1.5 py-0.5 rounded ${
                              isOur
                                ? "bg-gradient-to-r from-amber-200 to-yellow-200 text-amber-900 font-semibold"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {b}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
