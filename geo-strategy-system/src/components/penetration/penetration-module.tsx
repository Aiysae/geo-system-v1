"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Target, ChevronDown, MessageSquare, Globe2, ExternalLink, CheckCircle2, RefreshCw, X } from "lucide-react"
import BatchInputPanel from "./batch-input-panel"
import PenetrationDonut from "./penetration-donut"
import IndustryShareChart from "./industry-share-chart"
import BrandRankingCard from "./brand-ranking-card"
import ModelRateTrend from "./model-rate-trend"
import PenetrationSampleQualityPanel from "./sample-quality-panel"
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
import { aggregatePenetration } from "@/lib/score-utils"
import { getClientSubjectType } from "@/lib/analysis-subject"
import { isSameSubject } from "@/lib/subject-canonicalization"
import type {
  BrandVoiceItem,
  KeywordCompetitionItem,
} from "@/lib/dashboard-aggregations"
import type {
  AnalysisSubjectType,
  Client,
  ModelKey,
  PenetrationItem,
  PenetrationJobRecord,
  PenetrationModelProgress,
  PenetrationPromptPurity,
  PenetrationQuestionIntentHint,
  PenetrationResult,
  PenetrationSource,
  PenetrationSearchMode,
  SourceDomainCount,
} from "@/types"

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
  identityReadOnly?: boolean
}

type PenetrationRunParams = {
  questions: string[]
  models: ModelKey[]
  brandAliases: string[]
  competitors: string[]
  questionIntents: PenetrationQuestionIntentHint[]
  operation?: "replace" | "append"
  retestSampleId?: string
}

export default function PenetrationModule({
  client,
  onChangeClient,
  identityReadOnly = false,
}: Props) {
  const subjectType = getClientSubjectType(client)
  const [loading, setLoading] = useState(Boolean(client.penetrationJobId))
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const [modelErrors, setModelErrors] = useState<Partial<Record<ModelKey, string>>>({})
  const [modelProgress, setModelProgress] = useState<Partial<Record<ModelKey, PenetrationModelProgress>>>({})
  const [progressLabel, setProgressLabel] = useState("")
  const [completionNotice, setCompletionNotice] = useState("")
  const [retestingSampleId, setRetestingSampleId] = useState<string | null>(null)
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
          setModelProgress(job.modelProgress || {})
          setProgressLabel(formatPenetrationJobProgress(job))

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
            setRetestingSampleId(null)
            setProgressLabel("")
            const historyNotice = job.historySavedAt
              ? "已保存到检测历史。"
              : "检测记录正在保存。"
            setCompletionNotice(
              job.operation === "append"
                ? `本题重新检测完成，新的联网回答已追加，原回答仍然保留。${historyNotice}`
                : completedQuestions && completedModels
                ? `疑问句检测完成：共 ${job.totalSlots} 项结果，覆盖 ${completedQuestions} 个问题和 ${completedModels} 个模型。${historyNotice}`
                : `疑问句检测完成：${job.completedSlots} 项结果已更新。${historyNotice}`,
            )
            return
          }
          if (job.status === "failed") {
            onChangeClient({ penetrationJobId: undefined })
            setError(job.error || "疑问句检测未完成，请稍后重试。")
            setCompletionNotice(
              job.historySavedAt
                ? "本次检测记录已保存到历史。"
                : "本次检测记录正在保存。",
            )
            setLoading(false)
            setRetestingSampleId(null)
            setProgressLabel("")
            return
          }
          if (job.status === "blocked") {
            onChangeClient({
              ...(job.result ? { penetration: job.result } : {}),
              penetrationJobId: undefined,
            })
            setError(job.error || "部分模型暂未返回完整结果，可以稍后重新检测。")
            setCompletionNotice(
              job.historySavedAt
                ? "已完成的结果已保存到检测历史。"
                : "已完成的结果正在保存。",
            )
            setLoading(false)
            setRetestingSampleId(null)
            setProgressLabel("")
            return
          }
          if (job.status === "cancelled") {
            onChangeClient({
              ...(job.result ? { penetration: job.result } : {}),
              penetrationJobId: undefined,
            })
            setError(job.result ? "检测已停止，已保留当前完成结果。" : "检测已停止。")
            setCompletionNotice(
              job.historySavedAt
                ? "停止前已完成的结果已保存到检测历史。"
                : "停止前已完成的结果正在保存。",
            )
            setLoading(false)
            setRetestingSampleId(null)
            setProgressLabel("")
            return
          }
        } catch {
          if (stopped || controller.signal.aborted) return
          failedPolls += 1
          if (failedPolls >= 3) {
            setError("检测仍在继续，进度暂时未更新，系统会自动重试。")
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

  async function handleRun(params: PenetrationRunParams) {
    setLoading(true)
    setRetestingSampleId(params.retestSampleId || null)
    setError(null)
    setSkipped([])
    setModelErrors({})
    setModelProgress({})
    setProgressLabel(params.operation === "append" ? "正在重新检测本题..." : "正在开始检测...")
    try {
      const requestId = createBackgroundRequestId("penetration")
      const job = await createIdempotentApiJob<PenetrationJobRecord & { error?: string }>({
        endpoint: "/api/penetration/jobs",
        requestId,
        label: "疑问句检测任务创建",
        payload: {
          clientId: client.id,
          subjectType,
          personProfile: client.personProfile,
          ourBrand: client.ourBrand,
          brandAliases: params.brandAliases,
          industry: client.industry,
          questions: params.questions,
          questionIntents: params.questionIntents,
          competitors: params.competitors,
          models: params.models,
          operation: params.operation || "replace",
        },
        onRetry: () => {
          setProgressLabel("网络暂时中断，正在确认检测是否已开始...")
          setError("正在确认刚才的提交，请不要重复点击。")
        },
      })
      if (!job.id) throw new Error("检测未能开始，请稍后重试。")

      setError(null)
      setSkipped(job.skipped || [])
      setProgressLabel(`检测进度 0/${job.totalSlots}`)
      onChangeClient(identityReadOnly
        ? { penetrationJobId: job.id }
        : {
            brandAliases: params.brandAliases,
            competitors: params.competitors,
            penetrationJobId: job.id,
          })
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误")
      setLoading(false)
      setRetestingSampleId(null)
      setProgressLabel("")
    }
  }

  function handleRetest(model: ModelKey, item: PenetrationItem, sampleKey: string) {
    if (loading) return
    void handleRun({
      questions: [item.question],
      models: [model],
      brandAliases: client.brandAliases ?? [],
      competitors: client.competitors,
      questionIntents: (client.penetration?.questionIntents || [])
        .filter(hint => hint.question === item.question),
      operation: "append",
      retestSampleId: sampleKey,
    })
  }

  async function handleStop() {
    const jobId = client.penetrationJobId
    if (!jobId) return
    setProgressLabel("正在停止检测...")
    try {
      await apiFetch(`/api/penetration/jobs/${jobId}`, {
        method: "PATCH",
        cache: "no-store",
      })
    } finally {
      onChangeClient({ penetrationJobId: undefined })
      setLoading(false)
      setRetestingSampleId(null)
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
        subjectType,
        {
          plannedSlots: client.penetration.aggregated.plannedSlots,
          modelCount: client.penetration.aggregated.perModelRate.length,
        },
      ),
    }
  }, [
    client.penetration,
    client.ourBrand,
    client.brandAliases,
    client.competitors,
    subjectType,
  ])
  const topIndustryShare = pen?.aggregated.industryShare.slice(0, 10) ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-sm text-slate-800 sm:text-base">
          <span className="geo-module-icon">
            <Target className="h-5 w-5 text-white" />
          </span>
          <span className="geo-module-title min-w-0 text-base sm:text-lg">
            {subjectType === "person" ? "个人 IP 可见度与同行情报" : "关键词渗透率与竞品情报"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="geo-section-panel no-print min-w-0 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 pb-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">检测配置</div>
              <div className="mt-0.5 text-[11px] text-slate-500">填写检测范围，完成后将在下方展示结果和来源</div>
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
              modelProgress={modelProgress}
              progressLabel={progressLabel}
              identityReadOnly={identityReadOnly}
            />
        </div>

        <div className="min-w-0 space-y-4">
            {!pen ? (
                <div className="geo-empty-state min-h-[180px]">
                <div>
                  <div className="text-sm text-slate-500 mb-1">情报大盘待生成</div>
                  <div className="text-xs text-slate-400">
                    填写上方信息后开始检测，完成后会自动保存结果
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <div className="geo-data-panel min-w-0 rounded-lg p-4">
                    <div className="geo-section-kicker mb-1">
                      {subjectType === "person" ? "个人 IP 被提及率" : "品牌被提及率"}
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
                      subjectType={subjectType}
                    />
                  </div>
                </div>

                <PenetrationSampleQualityPanel aggregated={pen.aggregated} />

                <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                  <div className="geo-data-panel flex min-h-[340px] min-w-0 flex-col overflow-hidden rounded-lg p-4">
                    <div className="geo-section-kicker mb-3 shrink-0">
                      {subjectType === "person" ? "同行人物可见度" : "全品牌渗透率"} Top {topIndustryShare.length}
                    </div>
                    <div className="min-h-0 flex-1">
                      <IndustryShareChart
                        compact
                        items={topIndustryShare}
                        ourBrand={client.ourBrand}
                        totalSlots={pen.aggregated.totalSlots}
                        subjectType={subjectType}
                      />
                    </div>
                  </div>

                  {pen.aggregated.perModelRate.length > 0 && (
                    <div className="geo-data-panel flex min-h-[340px] min-w-0 flex-col overflow-hidden rounded-lg p-4">
                      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                        <div className="geo-section-kicker">
                          各模型渗透率对比 · 趋势图
                        </div>
                        <div className="inline-flex shrink-0 items-center gap-1.5 text-[10px] text-amber-600">
                          <span className="inline-block w-3 border-t-2 border-dashed border-amber-400"></span>
                          整体均值
                        </div>
                      </div>
                      <div className="min-h-0 flex-1">
                        <ModelRateTrend
                          compact
                          perModelRate={pen.aggregated.perModelRate}
                          overallRate={pen.aggregated.penetrationRate}
                        />
                      </div>
                    </div>
                  )}

                  {subjectType === "person" && (pen.aggregated.institutionShare?.length || 0) > 0 ? (
                    <div className="geo-data-panel flex min-h-[340px] min-w-0 flex-col overflow-hidden rounded-lg p-4">
                      <div className="geo-section-kicker mb-3 shrink-0">
                        关联机构提及 Top {Math.min(10, pen.aggregated.institutionShare?.length || 0)}
                      </div>
                      <div className="min-h-0 flex-1">
                        <IndustryShareChart
                          compact
                          items={(pen.aggregated.institutionShare || []).slice(0, 10)}
                          ourBrand=""
                          totalSlots={pen.aggregated.totalSlots}
                          subjectType="person"
                          entityLabel="关联机构"
                          highlightTarget={false}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <BrandAndKeywordPanels
                  penetration={pen}
                  ourBrand={client.ourBrand}
                  brandAliases={client.brandAliases ?? []}
                  competitors={client.competitors}
                  subjectType={getClientSubjectType(client)}
                />

                {pen.aggregated.missedQuestions.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
                    <div className="mb-2 text-[11px] uppercase tracking-wider text-amber-700">
                      未被任一模型提及的疑问句（{pen.aggregated.missedQuestions.length}）
                    </div>
                    <ul className="list-disc space-y-1 pl-4 text-xs text-amber-900">
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

                <RawAnswersPanel
                  byModel={pen.byModel}
                  ourBrand={client.ourBrand}
                  brandAliases={client.brandAliases ?? []}
                  onRetest={handleRetest}
                  retestingSampleId={retestingSampleId}
                  retestDisabled={loading}
                  subjectType={subjectType}
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

function formatPenetrationJobProgress(job: PenetrationJobRecord): string {
  if (job.queuePosition) {
    const position = `排队第 ${job.queuePosition} 位`
    return job.completedSlots > 0
      ? `已完成 ${job.completedSlots}/${job.totalSlots} · ${position}`
      : `检测已提交 · ${position}`
  }
  if (job.status === "queued" || job.phase === "preflight") {
    return "检测已提交，正在排队..."
  }
  const base = `已完成 ${job.completedSlots}/${job.totalSlots}`
  if (job.phase !== "retrying") return `${base} · 正在联网检测`

  const retrying = job.retryingSlots || 0
  if (!job.nextRetryAt) return `${base} · 正在补全 ${retrying} 项结果`
  const waitSeconds = Math.max(0, Math.ceil((Date.parse(job.nextRetryAt) - Date.now()) / 1000))
  const waitLabel = waitSeconds >= 60
    ? `${Math.ceil(waitSeconds / 60)} 分钟内`
    : `${Math.max(1, waitSeconds)} 秒内`
  return `${base} · ${retrying} 项待补全，${waitLabel}继续`
}

function RawAnswersPanel({
  byModel,
  ourBrand,
  brandAliases,
  onRetest,
  retestingSampleId,
  retestDisabled,
  subjectType,
}: {
  byModel: PenetrationResult["byModel"]
  ourBrand: string
  brandAliases: string[]
  onRetest: (model: ModelKey, item: PenetrationItem, sampleKey: string) => void
  retestingSampleId: string | null
  retestDisabled: boolean
  subjectType: AnalysisSubjectType
}) {
  const models = (Object.keys(byModel) as ModelKey[]).filter(m => byModel[m]?.length)
  const [open, setOpen] = useState(false)
  const [activeModel, setActive] = useState<ModelKey | null>(models[0] ?? null)
  const currentModel = activeModel && models.includes(activeModel) ? activeModel : models[0] ?? null
  const targetSubjectNames = [ourBrand, ...brandAliases].map(name => name.trim()).filter(Boolean)

  if (models.length === 0 || !currentModel) return null

  function isTargetSubject(subject: string): boolean {
    return targetSubjectNames.some(name => isSameSubject(subject, name, subjectType))
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
  const questionTotals = new Map<string, number>()
  for (const item of items) {
    const key = item.question.trim()
    questionTotals.set(key, (questionTotals.get(key) ?? 0) + 1)
  }
  const questionOccurrences = new Map<string, number>()
  const sampleMeta = items.map((item, index) => {
    const questionKey = item.question.trim()
    const ordinal = (questionOccurrences.get(questionKey) ?? 0) + 1
    questionOccurrences.set(questionKey, ordinal)
    return {
      ordinal,
      total: questionTotals.get(questionKey) ?? 1,
      key: item.sampleId || `legacy_${currentModel}_${index}`,
    }
  })

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
            <div className="text-sm font-medium text-slate-800">原始联网回答与来源</div>
            <div className="text-[11px] text-slate-500">
              查看各模型的完整回答、联网状态和可点击来源
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
                  <div className="text-xs font-semibold text-slate-800">来源网站概览</div>
                  <div className="text-[11px] text-slate-500 leading-relaxed">
                    汇总 {MODEL_LABELS[currentModel]} 本次回答引用的公开网页；未返回网址的回答会单独标记。
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
              <AuditStatCard label="回答方式" value={auditStats.modeSummary} />
              <AuditStatCard label="原问题直接提问" value={`${auditStats.rawQuestionOnly}/${items.length}`} />
              <AuditStatCard label="可核验联网回答" value={`${auditStats.webVerified}/${items.length}`} />
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
                该模型本次未返回可核验的来源网站，可以重新检测本题。
              </div>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
            {items.map((it, i) => {
              const meta = sampleMeta[i]
              const hit =
                typeof it.hitOur === "boolean"
                  ? it.hitOur
                  : ourBrand
                    ? it.mentionedBrands.some(b => isTargetSubject(b))
                    : false
              return (
                <div key={i} className="px-4 py-3 hover:bg-slate-50/50 transition">
                  <div className="flex items-start gap-2 mb-1.5">
                    <span className="text-[10px] font-mono text-slate-400 mt-0.5">
                      Q{String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-xs font-medium leading-relaxed text-slate-700">
                        {it.question}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span
                          className="whitespace-nowrap rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
                          title={it.sampleId || "历史结果"}
                        >
                          第 {meta.ordinal} 次检测{meta.total > 1 ? ` / 共 ${meta.total} 次` : ""}
                        </span>
                        {hit ? (
                          <span className="whitespace-nowrap rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                            ✓ 命中
                          </span>
                        ) : (
                          <span className="whitespace-nowrap rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                            未命中
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onRetest(currentModel, it, meta.key)}
                          disabled={retestDisabled}
                          className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-blue-200 bg-white px-1.5 text-[10px] font-medium text-[#1677FF] transition hover:border-[#1677FF] hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                          title={`使用${MODEL_LABELS[currentModel]}重新联网检测本题，并保留当前回答`}
                        >
                          <RefreshCw className={`h-3 w-3 ${retestingSampleId === meta.key ? "animate-spin" : ""}`} />
                          重新检测
                        </button>
                      </div>
                    </div>
                  </div>
                  {it.sampledAt && (
                    <div className="mb-1.5 pl-7 text-[10px] text-slate-400">
                      检测时间 {new Date(it.sampledAt).toLocaleString("zh-CN")}
                    </div>
                  )}
                  <AnswerItem text={it.answer} ourBrand={ourBrand} highlightFn={highlight} />
                  <AnswerAuditBadges item={it} />
                  <SourceAuditSnippet item={it} />
                  {it.mentionedBrands.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 pl-7">
                      <span className="mr-1 text-[10px] text-slate-400">
                        {subjectType === "person" ? "同行人物" : "识别品牌"}
                      </span>
                      {it.mentionedBrands.map((b, j) => {
                        const isOur = isTargetSubject(b)
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
                  {subjectType === "person" && (it.mentionedEntities || []).some(entity => entity.kind === "organization") ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1 pl-7">
                      <span className="mr-1 text-[10px] text-slate-400">关联机构</span>
                      {(it.mentionedEntities || [])
                        .filter(entity => entity.kind === "organization")
                        .map(entity => (
                          <span
                            key={`${entity.kind}-${entity.name}`}
                            className="rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] text-cyan-800 ring-1 ring-cyan-100"
                          >
                            {entity.name}
                          </span>
                        ))}
                    </div>
                  ) : null}
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
  native_web: "模型联网",
  local_tool_search: "联网补充",
  presearch_context: "联网补充",
  none: "未联网",
}

const PROMPT_PURITY_LABELS: Record<PenetrationPromptPurity, string> = {
  raw_question_only: "原问题直接提问",
  tool_augmented: "联网辅助提问",
  search_context_augmented: "结合公开网页提问",
  unknown: "未记录",
}

function getSearchModeLabel(mode?: PenetrationSearchMode): string {
  return mode ? SEARCH_MODE_LABELS[mode] : "未记录"
}

function getPromptPurityLabel(purity?: PenetrationPromptPurity): string {
  return purity ? PROMPT_PURITY_LABELS[purity] : "未记录"
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
  const executionOnly = verified && item.webExecutionVerified === true && sourceCount === 0
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
        {verified
          ? executionOnly
            ? "官方联网已执行"
            : "官方联网已验证"
          : "官方联网不可验证"} · 来源 {sourceCount}
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
            <span className="text-[10px] font-medium text-slate-500">搜索关键词</span>
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
            本条回答未返回可核验来源，可以重新检测。
          </div>
        )}
        {domains.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium text-slate-500">来源网站</span>
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

function BrandAndKeywordPanels({
  penetration,
  ourBrand,
  brandAliases,
  competitors,
  subjectType,
}: {
  penetration: PenetrationResult
  ourBrand: string
  brandAliases: string[]
  competitors: string[]
  subjectType: "brand" | "person"
}) {
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
        subjectType,
        cacheKey,
      }),
      getKeywordCompetitionAction({
        byModel: penetration.byModel,
        ourBrand,
        brandAliases,
        competitors,
        subjectType,
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
  }, [penetration.byModel, ourBrand, brandAliases, competitors, subjectType, cacheKey])

  return (
    <div className="min-w-0">
      {loading && !voice && !competition ? (
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <DashboardPanelLoading title={subjectType === "person" ? "人物声量表" : "品牌声量表"} />
          <DashboardPanelLoading title="关键词竞争热度" />
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      ) : null}

      {voice || competition ? (
        <div className="grid min-w-0 gap-4 xl:grid-cols-2 xl:items-start">
          {voice ? (
            <section
              aria-label={subjectType === "person" ? "人物声量表" : "品牌声量表"}
              className="min-h-[360px] min-w-0 overflow-hidden xl:aspect-square xl:min-h-0"
            >
              <BrandShareOfVoice
                key={`voice-${cacheKey}`}
                compact
                items={voice}
                subjectType={subjectType}
              />
            </section>
          ) : null}
          {competition ? (
            <section
              aria-label="关键词竞争热度"
              className="min-h-[360px] min-w-0 overflow-hidden xl:aspect-square xl:min-h-0"
            >
              <KeywordCompetition
                key={`competition-${cacheKey}`}
                compact
                items={competition}
                subjectType={subjectType}
              />
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function DashboardPanelLoading({ title }: { title: string }) {
  return (
    <div
      className="geo-panel flex min-h-[360px] min-w-0 items-center justify-center overflow-hidden xl:aspect-square xl:min-h-0"
      role="status"
      aria-label={`${title}聚合中`}
    >
      <div className="text-center">
        <span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-[#D6E8FF] border-t-[#1677FF]" />
        <div className="mt-3 text-sm font-medium text-slate-600">{title}</div>
        <div className="mt-1 text-xs text-slate-400">正在聚合本次盲测结果</div>
      </div>
    </div>
  )
}
