"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Target, ChevronDown, MessageSquare, BarChart3, Globe2, ExternalLink } from "lucide-react"
import BatchInputPanel from "./batch-input-panel"
import PenetrationDonut from "./penetration-donut"
import IndustryShareChart from "./industry-share-chart"
import BrandRankingCard from "./brand-ranking-card"
import ModelRateTrend from "./model-rate-trend"
import BrandShareOfVoice from "@/components/dashboard/brand-share-of-voice"
import KeywordCompetition from "@/components/dashboard/keyword-competition"
import ModelAvatar from "@/components/model-avatar"
import { MODEL_LABELS } from "@/lib/model-labels"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import {
  getBrandVoiceAction,
  getKeywordCompetitionAction,
} from "@/app/actions/dashboards"
import { useCredits } from "@/components/credits/credits-provider"
import type {
  BrandVoiceItem,
  KeywordCompetitionItem,
} from "@/lib/dashboard-aggregations"
import type {
  Client,
  ModelKey,
  PenetrationItem,
  PenetrationResult,
  PenetrationSource,
  SourceDomainCount,
} from "@/types"

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}

export default function PenetrationModule({ client, onChangeClient }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const [modelErrors, setModelErrors] = useState<Partial<Record<ModelKey, string>>>({})
  const { balance } = useCredits()

  async function handleRun(params: { questions: string[]; models: ModelKey[] }) {
    const requiredCredits = params.questions.length * params.models.length
    if (typeof balance === "number" && balance < requiredCredits) {
      setError(
        `体验算力积分不足：本次检测需要 ${requiredCredits} 积分，当前余额 ${balance} 积分。请减少问题数量 / 检测模型，或申请充值后重试。`
      )
      return
    }

    setLoading(true)
    setError(null)
    setSkipped([])
    setModelErrors({})
    try {
      const res = await apiFetch("/api/penetration", {
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
      const data = await readApiJson<{
        error?: string
        skipped?: string[]
        byModel?: PenetrationResult["byModel"]
        aggregated?: PenetrationResult["aggregated"]
        generatedAt?: string
        modelErrors?: Partial<Record<ModelKey, string>>
      }>(res, "疑问句检测")
      if (!res.ok) {
        if (Array.isArray(data.skipped)) setSkipped(data.skipped)
        throw new Error(data.error || "请求失败")
      }
      if (!data.byModel || !data.aggregated || !data.generatedAt) {
        throw new Error("疑问句检测返回数据不完整，请重新检测。")
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
  const topIndustryShare = pen?.aggregated.industryShare.slice(0, 10) ?? []

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3 text-sm text-slate-800 sm:text-base">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0077B6] via-[#00B4D8] to-[#48cae4] flex items-center justify-center shadow-lg shadow-cyan-200/50">
            <Target className="h-5 w-5 text-white" />
          </span>
          <span className="min-w-0 bg-gradient-to-r from-[#004B73] to-[#0077B6] bg-clip-text text-transparent font-semibold leading-snug">
            模块一 · 关键词渗透率与竞品情报
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid min-w-0 gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
          <div className="min-w-0 lg:border-r lg:border-slate-100 lg:pr-6">
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

          <div className="min-w-0 space-y-5">
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
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <div className="min-w-0 rounded-xl border border-slate-200 p-4 bg-gradient-to-br from-slate-50 to-white">
                    <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">
                      渗透率
                    </div>
                    <PenetrationDonut
                      rate={pen.aggregated.penetrationRate}
                      mentions={pen.aggregated.ourMentions}
                      totalSlots={pen.aggregated.totalSlots}
                    />
                  </div>
                  <div className="min-w-0 rounded-xl border border-slate-200 p-4 bg-white">
                    <BrandRankingCard
                      ranking={pen.aggregated.ourRanking}
                      totalBrands={pen.aggregated.industryShare.length}
                      perModelRate={pen.aggregated.perModelRate}
                      topCompetitors={pen.aggregated.topCompetitors}
                    />
                  </div>
                </div>

                <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 p-4 bg-white">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-3">
                    全品牌渗透率 Top {topIndustryShare.length}
                  </div>
                  <IndustryShareChart
                    items={topIndustryShare}
                    ourBrand={client.ourBrand}
                    totalSlots={pen.aggregated.totalSlots}
                  />
                </div>

                {pen.aggregated.perModelRate.length > 0 && (
                  <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 p-4 bg-gradient-to-br from-white via-slate-50/40 to-blue-50/30">
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

                <MonitoringDashboards
                  penetration={pen}
                  ourBrand={client.ourBrand}
                />

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
  const currentModel = activeModel && models.includes(activeModel) ? activeModel : models[0] ?? null

  if (models.length === 0 || !currentModel) return null

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

  const items = byModel[currentModel] ?? []
  const modelDomainStats = getModelDomainStats(items)
  const topSource = modelDomainStats[0] ?? null
  const sourceTotal = modelDomainStats.reduce((sum, item) => sum + item.count, 0)

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
            <div className="text-sm font-medium text-slate-800">联网回答命中审计</div>
            <div className="text-[11px] text-slate-500">
              每条回答来自纯净模型独立联网提问；默认展示摘要，黄色高亮为真实提及我方品牌
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
                  currentModel === m
                    ? "bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white shadow"
                    : "bg-white text-slate-600 border border-slate-200 hover:border-[#0077B6]"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <ModelAvatar model={m} size="xs" />
                  {MODEL_LABELS[m]} · {byModel[m]?.length ?? 0} 条
                </span>
              </button>
            ))}
          </div>
          <div className="px-4 py-3 bg-cyan-50/40 border-b border-cyan-100">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-6 h-6 rounded-lg bg-white border border-cyan-100 flex items-center justify-center text-cyan-700">
                  <Globe2 className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="text-xs font-semibold text-slate-800">来源域名统计</div>
                  <div className="text-[11px] text-slate-500 leading-relaxed">
                    统计 {MODEL_LABELS[currentModel]} 本次可审计公开网页来源；优先读取模型返回引用，未暴露引用时使用同题联网采样补充。
                  </div>
                </div>
              </div>
              {topSource && (
                <div className="text-[11px] text-cyan-900 bg-white/80 border border-cyan-100 rounded-lg px-2.5 py-1.5">
                  最高频：<span className="font-semibold">{topSource.domain}</span> · {topSource.count} 次
                </div>
              )}
            </div>
            {modelDomainStats.length > 0 ? (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {modelDomainStats.slice(0, 9).map(source => (
                  <div
                    key={source.domain}
                    className="bg-white border border-cyan-100 rounded-lg px-2.5 py-2 min-w-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-slate-700 truncate">
                        {source.domain}
                      </span>
                      <span className="text-[10px] font-semibold text-cyan-700 whitespace-nowrap">
                        {source.count} 次
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                        style={{
                          width: `${Math.max(10, Math.round((source.count / sourceTotal) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-[11px] text-slate-500 bg-white/70 border border-dashed border-cyan-100 rounded-lg px-3 py-2">
                该模型本次未返回可审计来源域名；请重新检测，系统会尝试补充同题公开网页采样。
              </div>
            )}
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
                  <AnswerItem text={it.answer} ourBrand={ourBrand} highlightFn={highlight} />
                  <SourceAuditSnippet item={it} />
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

function summarizeSourcesByDomain(sources: PenetrationSource[]): SourceDomainCount[] {
  const counts = new Map<string, number>()
  for (const source of sources) {
    if (!source.domain) continue
    counts.set(source.domain, (counts.get(source.domain) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
}

function getModelDomainStats(items: PenetrationItem[]): SourceDomainCount[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const domains =
      item.sourceDomains && item.sourceDomains.length > 0
        ? item.sourceDomains
        : summarizeSourcesByDomain(item.searchSources ?? [])
    for (const source of domains) {
      counts.set(source.domain, (counts.get(source.domain) ?? 0) + source.count)
    }
  }
  return Array.from(counts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
}

function uniqueSources(sources: PenetrationSource[]): PenetrationSource[] {
  const seen = new Set<string>()
  const out: PenetrationSource[] = []
  for (const source of sources) {
    if (seen.has(source.url)) continue
    seen.add(source.url)
    out.push(source)
  }
  return out
}

function SourceAuditSnippet({ item }: { item: PenetrationItem }) {
  const domains =
    item.sourceDomains && item.sourceDomains.length > 0
      ? item.sourceDomains
      : summarizeSourcesByDomain(item.searchSources ?? [])
  const sources = uniqueSources(item.searchSources ?? []).slice(0, 3)

  if (domains.length === 0 && sources.length === 0) return null

  return (
    <div className="pl-7 mb-2">
      <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2">
        {domains.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium text-slate-500">参考域名</span>
            {domains.slice(0, 5).map(source => (
              <span
                key={source.domain}
                className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600"
              >
                {source.domain} · {source.count} 次
              </span>
            ))}
          </div>
        )}
        {sources.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1">
            {sources.map(source => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-[#0077B6] min-w-0"
                title={source.title}
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{source.title || source.domain}</span>
                <span className="shrink-0 text-slate-400">({source.domain})</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AnswerItem({
  text,
  ourBrand,
  highlightFn,
}: {
  text: string
  ourBrand: string
  highlightFn: (t: string, b: string) => React.ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 260
  const displayText = !isLong || expanded ? text : text.slice(0, 260) + "..."

  return (
    <div className="pl-7 mb-2">
      <div className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
        {highlightFn(displayText, ourBrand)}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 text-[11px] font-medium text-[#0077B6] hover:text-[#004B73] transition-colors"
        >
          {expanded ? "收起完整联网回答" : "展开完整联网回答"}
        </button>
      )}
    </div>
  )
}

function MonitoringDashboards({
  penetration,
  ourBrand,
}: {
  penetration: PenetrationResult
  ourBrand: string
}) {
  const [open, setOpen] = useState(true)
  const [voice, setVoice] = useState<BrandVoiceItem[] | null>(null)
  const [competition, setCompetition] = useState<KeywordCompetitionItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // generatedAt 是 PenetrationResult 的稳定指纹：byModel 一变它就变，
  // 用它做 cache key 既能命中 React.cache、又能避免重复请求。
  const cacheKey = penetration.generatedAt

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kick off server-action fetch on cacheKey change
    setLoading(true)
    setError(null)
    Promise.all([
      getBrandVoiceAction({ byModel: penetration.byModel, ourBrand, cacheKey }),
      getKeywordCompetitionAction({ byModel: penetration.byModel, ourBrand, cacheKey }),
    ])
      .then(([v, c]) => {
        if (cancelled) return
        setVoice(v)
        setCompetition(c)
      })
      .catch(e => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : "聚合失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [penetration.byModel, ourBrand, cacheKey])

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50/70 transition group"
      >
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
            <BarChart3 className="h-3.5 w-3.5 text-white" />
          </span>
          <div className="text-left">
            <div className="text-sm font-medium text-slate-800">监控大盘 · 品牌声量 & 关键词竞争</div>
            <div className="text-[11px] text-slate-500">
              基于本次盲测结果服务端聚合，自动过滤拒答 / 0 参与模型的无效问题
            </div>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4 bg-slate-950/95 space-y-4">
          {loading && !voice && !competition && (
            <div className="text-center text-sm text-slate-400 py-10">聚合中…</div>
          )}
          {error && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {voice && <BrandShareOfVoice items={voice} />}
          {competition && <KeywordCompetition items={competition} />}
        </div>
      )}
    </div>
  )
}
