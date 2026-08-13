"use client"

import { useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Crown,
  Loader2,
  Sparkles,
  WandSparkles,
} from "lucide-react"
import { BillingLink } from "@/components/billing/billing-link"
import { Button } from "@/components/ui/button"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { createBackgroundRequestId } from "@/lib/background-job-client"
import {
  articleQuestionSelectionLabel,
  classifyArticleQuestionSelection,
  isDirectRecommendationQuestionType,
} from "@/lib/article-question-selection"
import { ARTICLE_PROMPT_PRICE_KEYS, estimateFeatureCredits } from "@/lib/pricing"
import { toUserFacingError } from "@/lib/user-facing-errors"
import { isBrandVideoScriptPrompt } from "@/lib/article-video-script"
import type {
  ArticleBatchQuestionTask,
  ArticleBatchRecord,
  ArticleComparisonBrand,
  ArticleQuestionSelectionType,
  ArticleQuestionMaterial,
} from "@/types"
import type { QuestionItem } from "@/types/geo-strategy"

interface Props {
  clientId: string
  questions: QuestionItem[]
  importedMaterials?: ArticleQuestionMaterial[]
  basePayload: Record<string, unknown>
  hasAccess: boolean
  membershipTier: string
  onStarted: () => void
}

type StrategyQuestionOption = {
  selectionKey: string
  source: "keyword_strategy" | "excel"
  sourceId: string
  question: string
  category?: string
  intent?: string
  keyword?: string
  matchedAdvantage?: string
  questionSelectionType: ArticleQuestionSelectionType
  questionSelectionReason: string
}

type StrategyQuestionFilter = "all" | "direct" | "conditional" | "long_tail_other"

const MAX_STRATEGY_SELECTION = 300

interface PlanResponse {
  tasks?: ArticleBatchQuestionTask[]
  error?: string
}

function itemCost(task: ArticleBatchQuestionTask): number {
  const promptKey = task.promptKey || "thirdPartyObservation"
  return estimateFeatureCredits(ARTICLE_PROMPT_PRICE_KEYS[promptKey])
}

export default function ArticleStrategyWorkspace({
  clientId,
  questions,
  importedMaterials = [],
  basePayload,
  hasAccess,
  membershipTier,
  onStarted,
}: Props) {
  const availableQuestions = useMemo<StrategyQuestionOption[]>(() => [
    ...questions.map(question => {
      const selection = classifyArticleQuestionSelection({
        question: question.question,
        category: question.category,
        intent: question.intent,
        queryStyle: question.queryStyle,
      })
      return {
        selectionKey: `keyword:${question.id}`,
        source: "keyword_strategy" as const,
        sourceId: question.id,
        question: question.question,
        category: question.category,
        intent: question.intent,
        keyword: question.keyword,
        matchedAdvantage: question.matched_advantage,
        questionSelectionType: selection.type,
        questionSelectionReason: selection.reason,
      }
    }),
    ...importedMaterials.map(material => {
      const selection = classifyArticleQuestionSelection({
        question: material.question,
        category: material.category,
        intent: material.intent,
      })
      return {
        selectionKey: `excel:${material.id}`,
        source: "excel" as const,
        sourceId: material.id,
        question: material.question,
        category: material.category,
        intent: material.intent,
        keyword: material.keyword,
        matchedAdvantage: material.matchedAdvantage,
        questionSelectionType: selection.type,
        questionSelectionReason: selection.reason,
      }
    }),
  ], [importedMaterials, questions])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(availableQuestions
      .slice(0, MAX_STRATEGY_SELECTION)
      .map(item => item.selectionKey)),
  )
  const [plan, setPlan] = useState<ArticleBatchQuestionTask[]>([])
  const [plannedSignature, setPlannedSignature] = useState("")
  const [launchRequestId, setLaunchRequestId] = useState("")
  const [planning, setPlanning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [questionFilter, setQuestionFilter] = useState<StrategyQuestionFilter>("all")

  const questionFilterCounts = useMemo(() => ({
    all: availableQuestions.length,
    direct: availableQuestions.filter(item => (
      isDirectRecommendationQuestionType(item.questionSelectionType)
    )).length,
    conditional: availableQuestions.filter(item => (
      item.questionSelectionType === "conditional_recommendation"
    )).length,
    long_tail_other: availableQuestions.filter(item => (
      item.questionSelectionType === "long_tail"
      || item.questionSelectionType === "non_recommendation"
    )).length,
  }), [availableQuestions])
  const filteredQuestions = useMemo(() => availableQuestions.filter(item => {
    if (questionFilter === "direct") {
      return isDirectRecommendationQuestionType(item.questionSelectionType)
    }
    if (questionFilter === "conditional") {
      return item.questionSelectionType === "conditional_recommendation"
    }
    if (questionFilter === "long_tail_other") {
      return item.questionSelectionType === "long_tail"
        || item.questionSelectionType === "non_recommendation"
    }
    return true
  }), [availableQuestions, questionFilter])

  const groups = useMemo(() => {
    const grouped = new Map<string, StrategyQuestionOption[]>()
    for (const question of filteredQuestions) {
      const sourceLabel = question.source === "excel" ? "Excel 导入" : "关键词策略"
      const key = `${sourceLabel} · ${question.category || question.intent || "其他问题"}`
      grouped.set(key, [...(grouped.get(key) || []), question])
    }
    return [...grouped.entries()]
  }, [filteredQuestions])
  const selectedCount = selectedIds.size
  const filteredSelectedCount = filteredQuestions.filter(item => (
    selectedIds.has(item.selectionKey)
  )).length
  const comparisonBrandCount = Array.isArray(basePayload.comparisonBrands)
    ? (basePayload.comparisonBrands as ArticleComparisonBrand[]).filter(item => item.name).length
    : 0
  const videoScriptTrack = isBrandVideoScriptPrompt(basePayload.promptKey)
  const routeSignature = JSON.stringify({
    modelProvider: basePayload.modelProvider,
    model: basePayload.model,
    comparisonBrands: Array.isArray(basePayload.comparisonBrands)
      ? (basePayload.comparisonBrands as ArticleComparisonBrand[]).map(item => item.name)
      : [],
    methodology: basePayload.methodology,
    outputTrack: videoScriptTrack ? "video_script" : "article",
    videoScriptConfig: basePayload.videoScriptConfig,
  })
  const totalCredits = plan.reduce((sum, task) => sum + itemCost(task), 0)
  function updateSelection(next: Set<string>) {
    setSelectedIds(next)
    setPlan([])
    setPlannedSignature("")
    setLaunchRequestId("")
    setNotice("")
    setError("")
  }

  function toggleAll() {
    const onlyCurrentFilterSelected = filteredQuestions.length > 0
      && selectedCount === filteredSelectedCount
      && filteredSelectedCount === filteredQuestions.length
    updateSelection(onlyCurrentFilterSelected
      ? new Set()
      : new Set(filteredQuestions
        .slice(0, MAX_STRATEGY_SELECTION)
        .map(item => item.selectionKey)))
  }

  function toggleGroup(items: StrategyQuestionOption[]) {
    const next = new Set(selectedIds)
    const allSelected = items.every(item => next.has(item.selectionKey))
    for (const item of items) {
      if (allSelected) {
        next.delete(item.selectionKey)
      } else if (next.size < MAX_STRATEGY_SELECTION) {
        next.add(item.selectionKey)
      }
    }
    updateSelection(next)
  }

  function toggleOne(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else if (next.size < MAX_STRATEGY_SELECTION) next.add(id)
    else {
      setError(`单次最多选择 ${MAX_STRATEGY_SELECTION} 条疑问句，请分批生成。`)
      return
    }
    updateSelection(next)
  }

  async function createPlan() {
    if (!hasAccess || selectedCount === 0 || planning) return
    setPlanning(true)
    setError("")
    setNotice("")
    try {
      const selected = availableQuestions.filter(item => selectedIds.has(item.selectionKey))
      const response = await apiFetch("/api/article-generation/strategy-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          questionIds: selected
            .filter(item => item.source === "keyword_strategy")
            .map(item => item.sourceId),
          materialIds: selected
            .filter(item => item.source === "excel")
            .map(item => item.sourceId),
          modelProvider: basePayload.modelProvider,
          model: basePayload.model,
          comparisonBrandCount,
          methodology: basePayload.methodology,
          outputTrack: videoScriptTrack ? "video_script" : "article",
        }),
      })
      const data = await readApiJson<PlanResponse>(response, "策略自动成文")
      if (!response.ok) throw new Error(data.error || (videoScriptTrack
        ? "视频文案任务整理未完成"
        : "AI 裁判未能完成任务分配"))
      const routedTasks = data.tasks || []
      if (routedTasks.length !== selectedCount) {
        throw new Error("部分疑问句未完成创作类型分配，请重新选择后再试。")
      }
      setPlan(routedTasks)
      setPlannedSignature(routeSignature)
      setLaunchRequestId(createBackgroundRequestId("article_strategy"))
      setNotice(videoScriptTrack
        ? `已整理 ${routedTasks.length} 条独立视频文案任务。`
        : `已为 ${routedTasks.length} 条疑问句完成创作类型分配。`)
    } catch (planError) {
      setError(toUserFacingError(planError, {
        fallback: videoScriptTrack
          ? "视频文案任务整理未完成，请稍后重试。"
          : "AI 裁判未能完成任务分配，请稍后重试。",
        subject: "策略自动成文",
      }))
    } finally {
      setPlanning(false)
    }
  }

  async function startGeneration() {
    if (plan.length === 0 || !launchRequestId || submitting) return
    if (plannedSignature !== routeSignature) {
      setError("模型或对比品牌资料已经变化，请重新执行 AI 裁判分配。")
      return
    }
    setSubmitting(true)
    setError("")
    setNotice("")
    let createdCount = 0
    try {
      for (let offset = 0; offset < plan.length; offset += 50) {
        const chunk = plan.slice(offset, offset + 50)
        const response = await apiFetch("/api/article-generation/batches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: `${launchRequestId}_${Math.floor(offset / 50) + 1}`,
            clientId,
            count: chunk.length,
            topicMode: "strategy",
            questionTasks: chunk,
            similarityRetry: true,
            basePayload: {
              ...basePayload,
              promptKey: chunk[0]?.promptKey || "thirdPartyObservation",
              coreQuestion: chunk[0]?.question || "",
            },
          }),
        })
        const batch = await readApiJson<ArticleBatchRecord & { error?: string }>(
          response,
          "策略自动成文",
        )
        if (!response.ok) throw new Error(batch.error || "后台文章任务创建失败")
        createdCount += chunk.length
      }
      setNotice(`${createdCount} ${videoScriptTrack ? "条视频文案" : "篇文章"}已进入独立后台队列。`)
      onStarted()
    } catch (startError) {
      setError(toUserFacingError(startError, {
        fallback: createdCount > 0
          ? `已提交 ${createdCount} 篇，其余任务未能创建，请稍后重试。`
          : "后台文章任务创建失败，请稍后重试。",
        subject: "策略自动成文",
      }))
    } finally {
      setSubmitting(false)
    }
  }

  if (!hasAccess) {
    return (
      <section className="flex min-h-[680px] items-center justify-center rounded-lg border border-blue-100 bg-gradient-to-br from-[#F2F8FF] via-white to-[#EDFBFF] p-6">
        <div className="max-w-md text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00B8D9] text-white shadow-lg shadow-blue-200">
            <Crown className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-base font-bold text-slate-900">
            {videoScriptTrack ? "关键词策略自动生成视频文案" : "关键词策略自动成文"}
          </h3>
          <p className="mt-2 text-xs leading-6 text-slate-500">
            {videoScriptTrack
              ? "VIP3 可将疑问句与匹配优势自动组成独立视频文案任务。"
              : "VIP3 可将疑问句与匹配优势自动组成文章任务，由 AI 裁判分配创作类型后在后台独立生成。"}
          </p>
          <div className="mt-3 text-[11px] text-slate-400">当前等级：{membershipTier.toUpperCase()}</div>
          <BillingLink className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-[#1677FF] px-5 text-sm font-semibold text-white hover:bg-[#0958D9]">
            查看 VIP3 升级方案
          </BillingLink>
        </div>
      </section>
    )
  }

  return (
    <section className="min-h-[680px] overflow-hidden rounded-lg border border-[#d6e7ff] bg-white shadow-sm">
      <header className="border-b border-blue-100 bg-gradient-to-r from-[#EAF4FF] via-white to-[#E8FBFF] px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#003EB3]">
          <WandSparkles className="h-4 w-4" />
          {videoScriptTrack ? "关键词策略自动生成视频文案" : "关键词策略自动成文"}
        </div>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          一条疑问句配一条优势，每条独立生成；超过 50 条会自动拆分为多个后台批次。
        </p>
      </header>

      <div className="p-4">
        {availableQuestions.length === 0 ? (
          <div className="flex min-h-[500px] items-center justify-center border border-dashed border-slate-200 bg-slate-50/60 text-center">
            <div className="px-6">
              <Sparkles className="mx-auto h-8 w-8 text-blue-300" />
              <div className="mt-3 text-sm font-semibold text-slate-600">还没有可用疑问句</div>
              <div className="mt-1 text-xs leading-5 text-slate-400">请先在关键词策略中生成疑问句，或上传疑问句与优势 Excel。</div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-700">选择要生成的问题</div>
                <div className="mt-1 text-[11px] text-slate-500">
                  已选 {selectedCount}/{availableQuestions.length}
                  {availableQuestions.length > MAX_STRATEGY_SELECTION ? ` · 单次最多 ${MAX_STRATEGY_SELECTION} 条` : ""}
                </div>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={toggleAll}>
                {filteredQuestions.length > 0
                  && selectedCount === filteredSelectedCount
                  && filteredSelectedCount === filteredQuestions.length
                  ? "取消全选"
                  : "只选当前筛选"}
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
              {([
                ["all", "全部"],
                ["direct", "直推榜单"],
                ["conditional", "条件推荐"],
                ["long_tail_other", "长尾与其他"],
              ] as Array<[StrategyQuestionFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setQuestionFilter(value)}
                  className={`h-8 rounded-md px-3 text-[11px] font-semibold transition ${
                    questionFilter === value
                      ? "bg-white text-[#0958D9] shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {label} {questionFilterCounts[value]}
                </button>
              ))}
            </div>

            <div className="mt-3 max-h-[360px] space-y-3 overflow-y-auto pr-1">
              {groups.length === 0 ? (
                <div className="border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-400">
                  当前分类下没有可选疑问句
                </div>
              ) : groups.map(([category, items]) => {
                const checkedCount = items.filter(item => selectedIds.has(item.selectionKey)).length
                return (
                  <div key={category} className="rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => toggleGroup(items)}
                      className="flex w-full items-center justify-between gap-3 bg-slate-50 px-3 py-2 text-left"
                    >
                      <span className="text-xs font-semibold text-slate-700">{category}</span>
                      <span className="text-[11px] text-[#0958D9]">{checkedCount}/{items.length}</span>
                    </button>
                    <div className="divide-y divide-slate-100">
                      {items.map(question => (
                        <label key={question.selectionKey} className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5 hover:bg-blue-50/40">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(question.selectionKey)}
                            onChange={() => toggleOne(question.selectionKey)}
                            className="mt-0.5 h-4 w-4 accent-[#1677FF]"
                          />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-start gap-1.5 text-xs leading-5 text-slate-700">
                              <span>{question.question}</span>
                              <span
                                className="shrink-0 rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-cyan-700"
                                title={question.questionSelectionReason}
                              >
                                {articleQuestionSelectionLabel(question.questionSelectionType)}
                              </span>
                            </span>
                            <span className={`mt-0.5 block text-[10px] leading-4 ${
                              question.matchedAdvantage ? "text-emerald-700" : "text-slate-400"
                            }`}>
                              {question.matchedAdvantage
                                ? `优势：${question.matchedAdvantage}`
                                : question.intent || question.keyword || "暂未匹配优势"}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div className="text-[11px] leading-5 text-slate-500">
                {plan.length > 0
                  ? <>已分配 {plan.length} {videoScriptTrack ? "条" : "篇"} · 预计 <strong className="text-[#0958D9]">{totalCredits} 积分</strong></>
                  : videoScriptTrack
                    ? "系统会为每个问题建立独立视频文案任务"
                    : "先由 AI 裁判为所选问题分配最合适的创作类型"}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void createPlan()}
                  disabled={selectedCount === 0 || planning || submitting}
                  className="gap-1.5"
                >
                  {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {videoScriptTrack
                    ? plan.length > 0 ? "重新整理" : "整理视频任务"
                    : plan.length > 0 ? "重新分配" : "AI 裁判分配类型"}
                </Button>
                <Button
                  type="button"
                  onClick={() => void startGeneration()}
                  disabled={plan.length === 0 || planning || submitting}
                  className="gap-1.5 bg-gradient-to-r from-[#1677FF] to-[#00B8D9] text-white"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                  {videoScriptTrack ? "后台生成文案" : "开始后台生成"}
                </Button>
              </div>
            </div>

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}
            {notice && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {notice}
              </div>
            )}

            {plan.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="mb-2 text-xs font-semibold text-slate-700">任务分配预览</div>
                <div className="max-h-[300px] divide-y divide-slate-100 overflow-y-auto border-y border-slate-100">
                  {plan.map((task, index) => (
                    <div key={task.questionId || task.materialId || index} className="grid gap-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_180px]">
                      <div className="min-w-0">
                        <div className="text-xs leading-5 text-slate-700">{task.question}</div>
                        <div className="mt-1 text-[10px] leading-4 text-emerald-700">
                          匹配优势：{task.matchedAdvantage || "暂无可核验优势资料"}
                        </div>
                        <div className="mt-1 text-[10px] leading-4 text-cyan-700">
                          疑问句类型：{articleQuestionSelectionLabel(task.questionSelectionType)}
                        </div>
                      </div>
                      <div className="sm:text-right">
                        <div className="text-[11px] font-semibold text-[#0958D9]">{task.promptTitle}</div>
                        <div className="mt-0.5 text-[10px] leading-4 text-slate-400">{task.routeReason}</div>
                        {(task.missingEvidence?.length || 0) > 0 && (
                          <div className="mt-1 text-[10px] leading-4 text-amber-600">
                            资料待补：{task.missingEvidence?.join("、")}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
