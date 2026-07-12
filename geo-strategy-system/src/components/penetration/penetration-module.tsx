"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Target, ChevronDown, MessageSquare, BarChart3, Globe2, ExternalLink, CheckCircle2, X } from "lucide-react"
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
import { createBackgroundRequestId, createIdempotentApiJob } from "@/lib/background-job-client"
import {
  getBrandVoiceAction,
  getKeywordCompetitionAction,
} from "@/app/actions/dashboards"
import { aggregatePenetration, isSameBrand } from "@/lib/score-utils"
import type {
  BrandVoiceItem,
  KeywordCompetitionItem,
} from "@/lib/dashboard-aggregations"
import type {
  Client,
  ModelKey,
  PenetrationItem,
  PenetrationJobRecord,
  PenetrationPromptPurity,
  PenetrationResult,
  PenetrationSource,
  PenetrationSearchMode,
  SourceDomainCount,
} from "@/types"

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}

export default function PenetrationModule({ client, onChangeClient }: Props) {
  const [loading, setLoading] = useState(Boolean(client.penetrationJobId))
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const [modelErrors, setModelErrors] = useState<Partial<Record<ModelKey, string>>>({})
  const [progressLabel, setProgressLabel] = useState("")
  const [completionNotice, setCompletionNotice] = useState("")
  const publishedResultAtRef = useRef(client.penetration?.generatedAt || "")

  useEffect(() => {
    if (!completionNotice) return
    const timer = window.setTimeout(() => setCompletionNotice(""), 8_000)
    return () => window.clearTimeout(timer)
  }, [completionNotice])

  useEffect(() => {
    const jobId = client.penetrationJobId
    if (!jobId) return

    const controller = new AbortController()
    let stopped = false
    let failedPolls = 0

    async function poll() {
      while (!stopped) {
        try {
          const res = await apiFetch(`/api/penetration/jobs/${jobId}`, {
            cache: "no-store",
            signal: controller.signal,
          })
          const job = await readApiJson<PenetrationJobRecord & { error?: string }>(
            res,
            "疑问句检测任务查询",
          )
          if (!res.ok) throw new Error(job.error || `任务查询失败 (${res.status})`)
          if (stopped) return

          failedPolls = 0
          setError(null)
          setLoading(job.status === "queued" || job.status === "running")
          setSkipped(job.skipped || [])
          setModelErrors(job.modelErrors || {})
          setProgressLabel(
            job.status === "queued"
              ? "后台任务排队中..."
              : `后台检测 ${job.completedSlots}/${job.totalSlots}（第 ${Math.min(job.completedBatches + 1, job.totalBatches)}/${job.totalBatches} 批）`,
          )

          if (job.result && job.result.generatedAt !== publishedResultAtRef.current) {
            publishedResultAtRef.current = job.result.generatedAt
            onChangeClient({ penetration: job.result })
          }

          if (job.status === "succeeded") {
            const completedQuestions = new Set(
              Object.values(job.result?.byModel || {}).flatMap(items =>
                (items || []).map(item => item.question.trim()).filter(Boolean),
              ),
            ).size
            const completedModels = Object.values(job.result?.byModel || {})
              .filter(items => Boolean(items?.length)).length
            onChangeClient({
              ...(job.result ? { penetration: job.result } : {}),
              penetrationJobId: undefined,
            })
            setLoading(false)
            setProgressLabel("")
            setCompletionNotice(
              completedQuestions && completedModels
                ? `疑问句检测已完成：${completedQuestions} 条疑问句、${completedModels} 个模型的结果已更新。`
                : `疑问句检测已完成：${job.completedSlots} 项结果已更新。`,
            )
            return
          }
          if (job.status === "failed") {
            onChangeClient({ penetrationJobId: undefined })
            setError(job.error || "疑问句检测后台任务失败")
            setLoading(false)
            setProgressLabel("")
            return
          }
          if (job.status === "cancelled") {
            onChangeClient({
              ...(job.result ? { penetration: job.result } : {}),
              penetrationJobId: undefined,
            })
            setError(job.result ? "检测已停止，已保留当前完成结果。" : "检测已停止。")
            setLoading(false)
            setProgressLabel("")
            return
          }
        } catch {
          if (stopped || controller.signal.aborted) return
          failedPolls += 1
          if (failedPolls >= 3) {
            setError("后台检测仍在继续，刚才进度刷新失败；系统会自动重试，不需要重新发起任务。")
          }
        }

        await new Promise(resolve => window.setTimeout(resolve, failedPolls >= 3 ? 6000 : 2000))
      }
    }

    void poll()
    return () => {
      stopped = true
      controller.abort()
    }
  }, [client.penetrationJobId, onChangeClient])

  async function handleRun(params: {
    questions: string[]
    models: ModelKey[]
    brandAliases: string[]
    competitors: string[]
  }) {
    setLoading(true)
    setError(null)
    setSkipped([])
    setModelErrors({})
    setProgressLabel("正在创建后台检测任务...")
    try {
      const job = await createIdempotentApiJob<PenetrationJobRecord & { error?: string }>({
        endpoint: "/api/penetration/jobs",
        requestId: createBackgroundRequestId("penetration"),
        label: "疑问句检测任务创建",
        payload: {
          clientId: client.id,
          ourBrand: client.ourBrand,
          brandAliases: params.brandAliases,
          industry: client.industry,
          questions: params.questions,
          competitors: params.competitors,
          models: params.models,
        },
        onRetry: () => {
          setProgressLabel("网络暂时中断，正在确认检测任务是否已经创建...")
          setError("请勿重复点击，系统正在用同一请求编号自动确认任务。")
        },
      })
      if (!job.id) throw new Error("后台检测任务创建失败：未返回任务 ID")

      setError(null)
      setSkipped(job.skipped || [])
      setProgressLabel(`后台检测 0/${job.totalSlots}`)
      onChangeClient({
        brandAliases: params.brandAliases,
        competitors: params.competitors,
        penetrationJobId: job.id,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
      setLoading(false)
      setProgressLabel("")
    }
  }

  async function handleStop() {
    const jobId = client.penetrationJobId
    if (!jobId) return
    setProgressLabel("正在停止后台检测...")
    try {
      await apiFetch(`/api/penetration/jobs/${jobId}`, {
        method: "PATCH",
        cache: "no-store",
      })
    } finally {
      onChangeClient({ penetrationJobId: undefined })
      setLoading(false)
      setProgressLabel("")
      setError(client.penetration ? "检测已停止，已保留当前完成结果。" : "检测已停止。")
    }
  }

  // 旧报告也在展示时按最新规则重算，避免历史 hitOur=false 把简称命中显示成 0%。
  const pen = useMemo(() => {
    if (!client.penetration) return undefined
    return {
      ...client.penetration,
      aggregated: aggregatePenetration(
        client.penetration.byModel,
        client.ourBrand,
        client.brandAliases ?? [],
        client.competitors,
      ),
    }
  }, [client.penetration, client.ourBrand, client.brandAliases, client.competitors])
  const topIndustryShare = pen?.aggregated.industryShare.slice(0, 10) ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-sm text-slate-800 sm:text-base">
          <span className="geo-module-icon bg-gradient-to-br from-[#1677FF] to-[#00C8FF]">
            <Target className="h-5 w-5 text-white" />
          </span>
          <span className="geo-display-title min-w-0 text-lg leading-snug text-[#102A43]">
            关键词渗透率与竞品情报
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="geo-section-panel no-print min-w-0 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 pb-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">检测配置</div>
              <div className="mt-0.5 text-[11px] text-slate-500">填写检测范围后，结果将在下方按完整页面宽度生成</div>
            </div>
            <div className="rounded-md bg-[#001D66] px-2.5 py-1 text-[10px] font-semibold text-cyan-100">
              官方联网 · 纯净盲测
            </div>
          </div>
            <BatchInputPanel
              key={client.id}
              client={client}
              onChangeClient={onChangeClient}
              onRun={handleRun}
              onStop={handleStop}
              loading={loading}
              error={error}
              skipped={skipped}
              modelErrors={modelErrors}
              progressLabel={progressLabel}
            />
        </div>

        <div className="min-w-0 space-y-4">
            {!pen ? (
              <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 text-center">
                <div>
                  <div className="text-sm text-slate-500 mb-1">情报大盘待生成</div>
                  <div className="text-xs text-slate-400">
                    填写上方信息后点击检测，任务会在后台分批执行，可随时切换客户面板
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <div className="geo-data-panel min-w-0 rounded-lg p-4">
                    <div className="geo-section-kicker mb-1">
                      渗透率
                    </div>
                    <PenetrationDonut
                      rate={pen.aggregated.penetrationRate}
                      mentions={pen.aggregated.ourMentions}
                      totalSlots={pen.aggregated.totalSlots}
                    />
                  </div>
                  <div className="geo-data-panel min-w-0 rounded-lg p-4">
                    <BrandRankingCard
                      ranking={pen.aggregated.ourRanking}
                      totalBrands={pen.aggregated.industryShare.length}
                      perModelRate={pen.aggregated.perModelRate}
                      topCompetitors={pen.aggregated.topCompetitors}
                    />
                  </div>
                </div>

                <div className="geo-data-panel min-w-0 overflow-hidden rounded-lg p-4">
                  <div className="geo-section-kicker mb-3">
                    全品牌渗透率 Top {topIndustryShare.length}
                  </div>
                  <IndustryShareChart
                    items={topIndustryShare}
                    ourBrand={client.ourBrand}
                    totalSlots={pen.aggregated.totalSlots}
                  />
                </div>

                {pen.aggregated.perModelRate.length > 0 && (
                  <div className="geo-data-panel min-w-0 overflow-hidden rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="geo-section-kicker">
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
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
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
                  brandAliases={client.brandAliases ?? []}
                  competitors={client.competitors}
                />

                <RawAnswersPanel
                  byModel={pen.byModel}
                  ourBrand={client.ourBrand}
                  brandAliases={client.brandAliases ?? []}
                />

                <div className="text-[11px] text-slate-400 text-right">
                  生成于 {new Date(pen.generatedAt).toLocaleString("zh-CN")}
                </div>
              </>
            )}
        </div>
      </CardContent>

      {completionNotice ? createPortal(
        <div
          className="no-print fixed bottom-6 right-6 z-[110] max-w-sm rounded-lg border border-emerald-300/70 bg-emerald-600 px-4 py-3 text-sm leading-relaxed text-white shadow-2xl shadow-emerald-300/40 animate-fade-in-up"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">{completionNotice}</div>
            <button
              type="button"
              onClick={() => setCompletionNotice("")}
              className="-mr-1 shrink-0 rounded p-0.5 text-white/80 transition hover:bg-white/10 hover:text-white"
              aria-label="关闭完成提示"
              title="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>,
        document.body,
      ) : null}
    </Card>
  )
}

function RawAnswersPanel({
  byModel,
  ourBrand,
  brandAliases,
}: {
  byModel: PenetrationResult["byModel"]
  ourBrand: string
  brandAliases: string[]
}) {
  const models = (Object.keys(byModel) as ModelKey[]).filter(m => byModel[m]?.length)
  const [open, setOpen] = useState(false)
  const [activeModel, setActive] = useState<ModelKey | null>(models[0] ?? null)
  const currentModel = activeModel && models.includes(activeModel) ? activeModel : models[0] ?? null
  const targetBrandNames = [ourBrand, ...brandAliases].map(name => name.trim()).filter(Boolean)

  if (models.length === 0 || !currentModel) return null

  function isTargetBrand(brand: string): boolean {
    return targetBrandNames.some(name => isSameBrand(brand, name))
  }

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
  const auditStats = getModelAuditStats(items)

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
              每条回答均为独立请求；默认展示联网模式、提示纯净度和可审计来源
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
                    ? "bg-[#1677FF] text-white shadow"
                    : "bg-white text-slate-600 border border-slate-200 hover:border-[#1677FF]"
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
                    统计 {MODEL_LABELS[currentModel]} 本次可审计公开网页来源；未返回来源的结果会在单条回答里标为联网不可验证。
                  </div>
                </div>
              </div>
              {topSource && (
                <div className="text-[11px] text-cyan-900 bg-white/80 border border-cyan-100 rounded-lg px-2.5 py-1.5">
                  最高频：<span className="font-semibold">{topSource.domain}</span> · {topSource.count} 次
                </div>
              )}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <AuditStatCard label="联网模式" value={auditStats.modeSummary} />
              <AuditStatCard label="纯问题请求" value={`${auditStats.rawQuestionOnly}/${items.length}`} />
              <AuditStatCard label="联网可验证" value={`${auditStats.webVerified}/${items.length}`} />
            </div>
            {modelDomainStats.length > 0 ? (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {modelDomainStats.map(source => (
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
                    ? it.mentionedBrands.some(b => isTargetBrand(b))
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
                  <AnswerAuditBadges item={it} />
                  <SourceAuditSnippet item={it} />
                  {it.mentionedBrands.length > 0 && (
                    <div className="flex flex-wrap gap-1 pl-7">
                      {it.mentionedBrands.map((b, j) => {
                        const isOur = isTargetBrand(b)
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

const SEARCH_MODE_LABELS: Record<PenetrationSearchMode, string> = {
  native_web: "官方联网",
  local_tool_search: "本地搜索增强",
  presearch_context: "预搜索上下文",
  none: "未联网",
}

const PROMPT_PURITY_LABELS: Record<PenetrationPromptPurity, string> = {
  raw_question_only: "仅原始问题",
  tool_augmented: "带工具元数据",
  search_context_augmented: "带搜索上下文",
  unknown: "未知",
}

function getSearchModeLabel(mode?: PenetrationSearchMode): string {
  return mode ? SEARCH_MODE_LABELS[mode] : "旧数据未记录"
}

function getPromptPurityLabel(purity?: PenetrationPromptPurity): string {
  return purity ? PROMPT_PURITY_LABELS[purity] : "旧数据未记录"
}

function getModelAuditStats(items: PenetrationItem[]): {
  modeSummary: string
  rawQuestionOnly: number
  webVerified: number
} {
  const modeCounts = new Map<string, number>()
  let rawQuestionOnly = 0
  let webVerified = 0
  for (const item of items) {
    const mode = getSearchModeLabel(item.searchMode)
    modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1)
    if (item.promptPurity === "raw_question_only") rawQuestionOnly++
    if (item.webVerified === true) webVerified++
  }
  const modeSummary =
    Array.from(modeCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([mode, count]) => `${mode} ${count}`)
      .join(" / ") || "无"

  return { modeSummary, rawQuestionOnly, webVerified }
}

function AuditStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-cyan-100 bg-white/80 px-2.5 py-2">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="mt-0.5 text-[11px] font-semibold text-slate-700">{value}</div>
    </div>
  )
}

function AnswerAuditBadges({ item }: { item: PenetrationItem }) {
  const sourceCount = item.sourceCount ?? item.searchSources?.length ?? 0
  const verified = item.webVerified === true
  return (
    <div className="pl-7 mb-2 flex flex-wrap gap-1.5">
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
        {getSearchModeLabel(item.searchMode)}
      </span>
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200">
        {getPromptPurityLabel(item.promptPurity)}
      </span>
      <span
        className={`text-[10px] px-1.5 py-0.5 rounded border ${
          verified
            ? "bg-emerald-50 text-emerald-700 border-emerald-100"
            : "bg-amber-50 text-amber-700 border-amber-100"
        }`}
        title={item.webFailureReason || item.webVerificationNote}
      >
        {verified ? "官方联网已验证" : "官方联网不可验证"} · 来源 {sourceCount}
      </span>
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
  const allSources = uniqueSources(item.searchSources ?? [])
  const searchQueries = Array.from(new Set((item.searchQueries ?? []).filter(Boolean)))

  if (domains.length === 0 && allSources.length === 0 && searchQueries.length === 0 && !item.webFailureReason) {
    return null
  }

  return (
    <div className="pl-7 mb-2">
      <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2">
        {searchQueries.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium text-slate-500">实际搜索词</span>
            {searchQueries.map(query => (
              <span
                key={query}
                className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600"
              >
                {query}
              </span>
            ))}
          </div>
        )}
        {item.webFailureReason && (
          <div className="mb-1.5 rounded border border-amber-100 bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
            {item.webFailureReason}
          </div>
        )}
        {domains.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium text-slate-500">参考域名</span>
            {domains.map(source => (
              <span
                key={source.domain}
                className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600"
              >
                {source.domain} · {source.count} 次
              </span>
            ))}
          </div>
        )}
        {allSources.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            <div className="text-[10px] font-medium text-slate-500">
              全部信源网址（{allSources.length}）
            </div>
            {allSources.map((source, index) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start gap-1.5 rounded border border-white/70 bg-white/75 px-2 py-1.5 text-[10px] text-slate-500 hover:border-cyan-100 hover:text-[#1677FF] min-w-0"
                title={source.title}
              >
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="shrink-0 font-mono text-slate-400">#{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-600 group-hover:text-[#1677FF]">
                    {source.title || source.domain}
                  </span>
                  <span className="block break-all font-mono text-slate-400 group-hover:text-[#1677FF]">
                    {source.url}
                  </span>
                </span>
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
          className="mt-1.5 text-[11px] font-medium text-[#1677FF] hover:text-[#003EB3] transition-colors"
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
  brandAliases,
  competitors,
}: {
  penetration: PenetrationResult
  ourBrand: string
  brandAliases: string[]
  competitors: string[]
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
      getBrandVoiceAction({
        byModel: penetration.byModel,
        ourBrand,
        brandAliases,
        competitors,
        cacheKey,
      }),
      getKeywordCompetitionAction({
        byModel: penetration.byModel,
        ourBrand,
        brandAliases,
        competitors,
        cacheKey,
      }),
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
  }, [penetration.byModel, ourBrand, brandAliases, competitors, cacheKey])

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
