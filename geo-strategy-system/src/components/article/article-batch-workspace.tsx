"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileDown,
  FileWarning,
  Files,
  Globe2,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react"
import ArticleMediaDialog from "@/components/article/article-media-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { resolveArticleBatchQuestionTasks } from "@/lib/article-batch-question-tasks"
import {
  articleQuestionSelectionLabel,
  isDirectRecommendationQuestionType,
} from "@/lib/article-question-selection"
import { createBackgroundRequestId } from "@/lib/background-job-client"
import { resolveQuestionAdvantage } from "@/lib/geo-strategy/question-advantages"
import { classifyQuestionMethodology } from "@/lib/geo-strategy/question-methodology"
import { toUserFacingError } from "@/lib/user-facing-errors"
import {
  isBrandVideoScriptPrompt,
  parseBrandVideoScript,
} from "@/lib/article-video-script"
import type {
  ArticleBatchItemRecord,
  ArticleBatchQuestionTask,
  ArticleBatchRecord,
  ArticleBatchTopicMode,
  ArticleGenerationQualityAudit,
  ArticleQuestionMaterial,
} from "@/types"
import type { QuestionItem } from "@/types/geo-strategy"

interface Props {
  clientId: string
  promptTitle: string
  basePayload: Record<string, unknown>
  keywordQuestions: QuestionItem[]
  keywordAdvantages?: string[]
  importedMaterials?: ArticleQuestionMaterial[]
  perArticleCredits: number
}

interface BatchListResponse {
  batches?: ArticleBatchRecord[]
  error?: string
}

interface BatchArticleDetail {
  id: string
  title?: string
  topic: string
  markdown?: string
  mediaMarkdown?: string
  status: ArticleBatchItemRecord["status"]
  stage?: string
  qualityStatus?: ArticleBatchItemRecord["qualityStatus"]
  qualityAudit?: ArticleGenerationQualityAudit
  promptTitle?: string
  model?: string
  generatedAt?: string
  error?: string
}

const TERMINAL_BATCH = new Set(["succeeded", "partial", "failed", "cancelled"])
type ArticleBatchResultFilter = "all" | "passed" | "direct" | "review" | "failed"

function statusLabel(item: ArticleBatchItemRecord): string {
  if (item.status === "queued") return "排队中"
  if (item.status === "running") return "生成中"
  if (item.status === "word_processing") return "正在整理文档"
  if (item.qualityStatus === "review_required" && item.hasDraft) return "待人工复核"
  if (item.status === "succeeded") return "质检通过"
  if (item.status === "cancelled") return "已停止"
  return item.hasDraft ? "待人工复核" : "生成失败"
}

function statusClass(item: ArticleBatchItemRecord): string {
  if (item.qualityStatus === "review_required" && item.hasDraft) {
    return "bg-amber-50 text-amber-700 ring-amber-200"
  }
  if (item.status === "succeeded") return "bg-emerald-50 text-emerald-700 ring-emerald-100"
  if (item.status === "failed") return "bg-rose-50 text-rose-700 ring-rose-100"
  if (item.status === "cancelled") return "bg-slate-100 text-slate-500 ring-slate-200"
  if (item.status === "running" || item.status === "word_processing") return "bg-cyan-50 text-cyan-700 ring-cyan-100"
  return "bg-blue-50 text-blue-700 ring-blue-100"
}

function topicLines(value: string): number {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).length
}

function BatchVideoScriptPreview({ value }: { value: string }) {
  const parsed = parseBrandVideoScript(value)
  return (
    <div className="space-y-3">
      {[
        ["专业视角", parsed.perspective],
        ["标题", parsed.title],
        ["正文", parsed.body],
        ["标签", parsed.tagsText],
      ].map(([label, content]) => (
        <section key={label} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-[11px] font-semibold text-[#0958D9]">{label}</div>
          <div className={`mt-1.5 whitespace-pre-wrap break-words text-slate-700 ${
            label === "标题" ? "text-lg font-bold leading-7" : "text-sm leading-7"
          }`}>
            {content || "该部分尚未生成"}
          </div>
        </section>
      ))}
    </div>
  )
}

function startBlockReason(args: {
  count: number
  coreQuestion: string
  topicMode: ArticleBatchTopicMode
  providedTopicCount: number
}): string {
  if (args.count < 2 || args.count > 50) return "生成数量需要在 2 到 50 篇之间"
  if (!args.coreQuestion.trim()) return "请先填写“核心搜索问题 / 内容主题”"
  if (args.topicMode !== "auto" && args.providedTopicCount < args.count) {
    return `当前只填写了 ${args.providedTopicCount} 个主题，请补足到 ${args.count} 个`
  }
  return ""
}

export default function ArticleBatchWorkspace({
  clientId,
  promptTitle,
  basePayload,
  keywordQuestions,
  keywordAdvantages = [],
  importedMaterials = [],
  perArticleCredits,
}: Props) {
  const videoScriptBatch = isBrandVideoScriptPrompt(basePayload.promptKey)
  const [count, setCount] = useState(10)
  const [topicMode, setTopicMode] = useState<ArticleBatchTopicMode>("auto")
  const [customTopics, setCustomTopics] = useState("")
  const [preferredQuestionTasks, setPreferredQuestionTasks] = useState<ArticleBatchQuestionTask[]>([])
  const [similarityRetry, setSimilarityRetry] = useState(true)
  const [batches, setBatches] = useState<ArticleBatchRecord[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [acting, setActing] = useState(false)
  const [error, setError] = useState("")
  const [completionNotice, setCompletionNotice] = useState("")
  const [previewItem, setPreviewItem] = useState<ArticleBatchItemRecord | null>(null)
  const [previewBatchId, setPreviewBatchId] = useState("")
  const [previewDetail, setPreviewDetail] = useState<BatchArticleDetail | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState("")
  const [previewVariant, setPreviewVariant] = useState<"original" | "media">("original")
  const [mediaOpen, setMediaOpen] = useState(false)
  const [resultFilter, setResultFilter] = useState<ArticleBatchResultFilter>("all")
  const previousStatuses = useRef<Map<string, ArticleBatchRecord["status"]>>(new Map())
  const initialized = useRef(false)

  const applyBatches = useCallback((next: ArticleBatchRecord[]) => {
    if (initialized.current) {
      for (const batch of next) {
        const previous = previousStatuses.current.get(batch.id)
        if (previous && !TERMINAL_BATCH.has(previous) && TERMINAL_BATCH.has(batch.status)) {
          const completedVideoScriptBatch = isBrandVideoScriptPrompt(batch.promptKey)
          setCompletionNotice(
            batch.status === "succeeded"
              ? `批量${completedVideoScriptBatch ? "视频文案" : "文章"}已完成：${batch.completedCount} ${completedVideoScriptBatch ? "条" : "篇"} Word 文档可以下载。`
              : `批量任务已结束：质检通过 ${batch.passedCount || 0} ${completedVideoScriptBatch ? "条" : "篇"}，待人工复核 ${batch.reviewRequiredCount || 0} ${completedVideoScriptBatch ? "条" : "篇"}，未生成 ${batch.failedCount + batch.cancelledCount} ${completedVideoScriptBatch ? "条" : "篇"}。`,
          )
        }
      }
    }
    initialized.current = true
    previousStatuses.current = new Map(next.map(batch => [batch.id, batch.status]))
    setBatches(next)
    setSelectedBatchId(current => (
      current && next.some(batch => batch.id === current) ? current : next[0]?.id || ""
    ))
  }, [])

  const loadBatches = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const response = await apiFetch(`/api/article-generation/batches?clientId=${encodeURIComponent(clientId)}`, {
        cache: "no-store",
      })
      const data = await readApiJson<BatchListResponse>(response, "批量文章")
      if (!response.ok) throw new Error(data.error || "读取批量文章失败")
      applyBatches(data.batches || [])
      setError("")
    } catch (loadError) {
      setError(toUserFacingError(loadError, { fallback: "读取批量文章失败，请稍后重试。", subject: "批量文章" }))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [applyBatches, clientId])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadBatches(), 0)
    return () => window.clearTimeout(timer)
  }, [loadBatches])

  const hasActiveBatch = batches.some(batch => !TERMINAL_BATCH.has(batch.status))
  useEffect(() => {
    if (!hasActiveBatch) return
    const timer = window.setInterval(() => void loadBatches(true), 2_500)
    return () => window.clearInterval(timer)
  }, [hasActiveBatch, loadBatches])

  const selectedBatch = batches.find(batch => batch.id === selectedBatchId) || batches[0]
  const selectedBatchVideoScript = isBrandVideoScriptPrompt(selectedBatch?.promptKey)
  const activeResultFilter = selectedBatchVideoScript && resultFilter === "direct"
    ? "all"
    : resultFilter
  const generatedCount = selectedBatch?.items.filter(item => item.hasDraft).length || 0
  const mediaGeneratedCount = selectedBatch?.items.filter(item => item.hasMediaVersion).length || 0
  const passedCount = selectedBatch?.passedCount
    ?? selectedBatch?.items.filter(item => item.qualityStatus === "passed").length
    ?? 0
  const reviewRequiredCount = selectedBatch?.reviewRequiredCount
    ?? selectedBatch?.items.filter(item => item.qualityStatus === "review_required").length
    ?? 0
  const directRecommendationPassedCount = selectedBatch?.directRecommendationPassedCount
    ?? selectedBatch?.items.filter(item => (
      item.qualityStatus === "passed"
      && isDirectRecommendationQuestionType(item.questionSelectionType)
    )).length
    ?? 0
  const resultFilterCounts = useMemo(() => ({
    all: selectedBatch?.items.length || 0,
    passed: passedCount,
    direct: directRecommendationPassedCount,
    review: reviewRequiredCount,
    failed: selectedBatch?.items.filter(item => (
      item.status === "failed" || item.status === "cancelled"
    )).length || 0,
  }), [directRecommendationPassedCount, passedCount, reviewRequiredCount, selectedBatch])
  const visibleItems = useMemo(() => (selectedBatch?.items || []).filter(item => {
    if (activeResultFilter === "passed") return item.qualityStatus === "passed"
    if (activeResultFilter === "direct") {
      return item.qualityStatus === "passed"
        && isDirectRecommendationQuestionType(item.questionSelectionType)
    }
    if (activeResultFilter === "review") return item.qualityStatus === "review_required"
    if (activeResultFilter === "failed") {
      return item.status === "failed" || item.status === "cancelled"
    }
    return true
  }), [activeResultFilter, selectedBatch])
  const previewAudit = previewDetail?.qualityAudit || previewItem?.qualityAudit
  const previewNeedsReview = (
    previewDetail?.qualityStatus || previewItem?.qualityStatus
  ) === "review_required"
  const previewMarkdown = previewVariant === "media" && previewDetail?.mediaMarkdown
    ? previewDetail.mediaMarkdown
    : previewDetail?.markdown
  const providedTopicCount = topicLines(customTopics)
  const totalCredits = Math.max(0, perArticleCredits) * count
  const blockedReason = startBlockReason({
    count,
    coreQuestion: String(basePayload.coreQuestion || ""),
    topicMode,
    providedTopicCount,
  })
  const canStart = !blockedReason && !submitting
  const batchProgress = useMemo(() => {
    if (!selectedBatch || selectedBatch.requestedCount <= 0) return 0
    const total = selectedBatch.items.reduce((sum, item) => sum + item.progressPercent, 0)
    return Math.round(total / selectedBatch.requestedCount)
  }, [selectedBatch])

  const keywordQuestionTasks = useMemo<ArticleBatchQuestionTask[]>(() => (
    keywordQuestions.map(question => ({
      questionId: question.id,
      questionSource: "keyword_strategy" as const,
      question: question.question,
      intent: question.intent,
      category: question.category,
      keyword: question.keyword,
      decisionDimension: question.decisionDimension,
      contentAngle: question.content_angle,
      subIntent: question.subIntent,
      queryStyle: question.queryStyle,
      methodologyCandidates: question.methodologyCandidates,
      platformCandidates: question.platformCandidates,
      articleFormat: question.articleFormatCandidates?.[0],
      titleStrategy: question.titleStrategyCandidates?.[0],
      matchedAdvantage: resolveQuestionAdvantage(question, keywordAdvantages),
    }))
  ), [keywordAdvantages, keywordQuestions])
  const importedQuestionTasks = useMemo<ArticleBatchQuestionTask[]>(() => (
    importedMaterials.map(material => {
      const methodology = classifyQuestionMethodology({
        category: material.category || "痛点解决型",
        question: material.question,
        intent: material.intent,
      })
      return {
        materialId: material.id,
        questionSource: "excel" as const,
        question: material.question,
        intent: material.intent,
        category: material.category,
        keyword: material.keyword,
        decisionDimension: material.decisionDimension,
        contentAngle: material.contentAngle,
        geoOptimizationText: material.geoOptimizationText,
        matchedAdvantage: material.matchedAdvantage,
        subIntent: methodology.subIntent,
        queryStyle: methodology.queryStyle,
        methodologyCandidates: methodology.methodologyCandidates,
        platformCandidates: methodology.platformCandidates,
        articleFormat: methodology.articleFormatCandidates[0],
        titleStrategy: methodology.titleStrategyCandidates[0],
      }
    })
  ), [importedMaterials])
  const availableQuestionTasks = useMemo(
    () => [...keywordQuestionTasks, ...importedQuestionTasks],
    [importedQuestionTasks, keywordQuestionTasks],
  )

  function fillQuestionTasks(tasks: ArticleBatchQuestionTask[]) {
    const selected = tasks.slice(0, count)
    setCustomTopics(selected.map(item => item.question).join("\n"))
    setPreferredQuestionTasks(selected)
    setTopicMode("questions")
  }

  function questionTasksForRequest(): ArticleBatchQuestionTask[] | undefined {
    if (topicMode !== "questions") return undefined
    return resolveArticleBatchQuestionTasks({
      topicText: customTopics,
      count,
      availableTasks: availableQuestionTasks,
      preferredTasks: preferredQuestionTasks,
    })
  }

  async function startBatch() {
    if (!canStart) return
    setSubmitting(true)
    setError("")
    try {
      const response = await apiFetch("/api/article-generation/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: createBackgroundRequestId("article_batch"),
          clientId,
          count,
          topicMode,
          customTopics,
          questionTasks: questionTasksForRequest(),
          similarityRetry,
          basePayload,
        }),
      })
      const batch = await readApiJson<ArticleBatchRecord & { error?: string }>(response, "批量文章")
      if (!response.ok) throw new Error(batch.error || "批量生成未能开始")
      const next = [batch, ...batches.filter(item => item.id !== batch.id)]
      applyBatches(next)
      setSelectedBatchId(batch.id)
    } catch (startError) {
      setError(toUserFacingError(startError, { fallback: "批量生成未能开始，请稍后重试。", subject: "批量文章" }))
    } finally {
      setSubmitting(false)
    }
  }

  async function runAction(action: "cancel" | "retryFailed" | "restart") {
    if (!selectedBatch || acting) return
    setActing(true)
    setError("")
    try {
      const response = await apiFetch(`/api/article-generation/batches/${encodeURIComponent(selectedBatch.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "restart"
            ? { requestId: createBackgroundRequestId("article_batch_restart") }
            : {}),
        }),
      })
      const batch = await readApiJson<ArticleBatchRecord & { error?: string }>(response, "批量文章")
      if (!response.ok) throw new Error(batch.error || "操作未完成")
      applyBatches([batch, ...batches.filter(item => item.id !== batch.id)])
      if (action === "restart") setSelectedBatchId(batch.id)
    } catch (actionError) {
      setError(toUserFacingError(actionError, { fallback: "操作未完成，请稍后重试。", subject: "批量文章" }))
    } finally {
      setActing(false)
    }
  }

  async function deleteBatch() {
    if (!selectedBatch || acting || !TERMINAL_BATCH.has(selectedBatch.status)) return
    if (!window.confirm(`确认删除这次批量任务吗？对应的 ${selectedBatch.completedCount} ${selectedBatchVideoScript ? "条" : "篇"} Word 文件也会一并清理。`)) return
    setActing(true)
    setError("")
    try {
      const response = await apiFetch(`/api/article-generation/batches/${encodeURIComponent(selectedBatch.id)}`, {
        method: "DELETE",
      })
      const body = await readApiJson<{ ok?: boolean; error?: string }>(response, "批量文章")
      if (!response.ok) throw new Error(body.error || "批量任务删除失败")
      applyBatches(batches.filter(batch => batch.id !== selectedBatch.id))
      setCompletionNotice("批量任务记录及对应 Word 文件已删除。")
    } catch (deleteError) {
      setError(toUserFacingError(deleteError, { fallback: "批量任务删除失败，请稍后重试。", subject: "批量文章" }))
    } finally {
      setActing(false)
    }
  }

  async function openPreview(item: ArticleBatchItemRecord) {
    if (!selectedBatch || !item.hasDraft) return
    setPreviewItem(item)
    setPreviewBatchId(selectedBatch.id)
    setPreviewDetail(null)
    setPreviewError("")
    setPreviewVariant(item.hasMediaVersion ? "media" : "original")
    setPreviewLoading(true)
    try {
      const response = await apiFetch(
        `/api/article-generation/batches/${encodeURIComponent(selectedBatch.id)}/items/${encodeURIComponent(item.id)}`,
        { cache: "no-store" },
      )
      const detail = await readApiJson<BatchArticleDetail>(response, "文章正文")
      if (!response.ok) throw new Error(detail.error || "读取文章正文失败")
      if (!detail.markdown?.trim()) throw new Error("这篇任务没有保存可供复核的正文")
      setPreviewDetail(detail)
    } catch (previewFailure) {
      setPreviewError(toUserFacingError(previewFailure, {
        fallback: "读取文章正文失败，请稍后重试。",
        subject: "文章正文",
      }))
    } finally {
      setPreviewLoading(false)
    }
  }

  function closePreview() {
    setPreviewItem(null)
    setPreviewBatchId("")
    setPreviewDetail(null)
    setPreviewError("")
    setPreviewVariant("original")
  }

  return (
    <section className="flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-lg border border-[#d6e7ff] bg-white/95 shadow-sm">
      <div className="border-b border-blue-100 bg-gradient-to-r from-[#EAF4FF] via-white to-[#E8FBFF] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#003EB3]">
              <Files className="h-4 w-4" />
              {videoScriptBatch ? "批量视频文案" : "批量文章"}
            </div>
            <div className="mt-1 text-[11px] leading-5 text-slate-500">
              每{videoScriptBatch ? "条文案" : "篇文章"}独立生成，可以同时使用系统中的其他功能
            </div>
          </div>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => void loadBatches()}
            disabled={loading}
            title="刷新生成状态"
            aria-label="刷新生成状态"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="border-b border-slate-100 p-4">
        <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
          <label className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">生成数量</span>
            <Input
              type="number"
              min={2}
              max={50}
              value={count}
              onChange={event => setCount(Math.max(2, Math.min(50, Number(event.target.value) || 2)))}
              className="h-10 bg-white"
            />
          </label>
          <div className="text-xs">
            <span className="mb-1.5 block font-medium text-slate-500">选题方式</span>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
              {([
                ["auto", "自动拆分"],
                ["questions", "已有疑问句"],
                ["custom", "自定义主题"],
              ] as Array<[ArticleBatchTopicMode, string]>).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setTopicMode(mode)
                    if (mode !== "questions") setPreferredQuestionTasks([])
                  }}
                  className={`h-8 rounded-md text-[11px] font-semibold transition ${
                    topicMode === mode ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {topicMode !== "auto" && (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-slate-500">每行一个独立主题</span>
              <span className={providedTopicCount >= count ? "text-emerald-600" : "text-amber-600"}>
                已填写 {providedTopicCount}/{count}
              </span>
            </div>
            <Textarea
              value={customTopics}
              onChange={event => setCustomTopics(event.target.value)}
              placeholder={`每行填写一${videoScriptBatch ? "条文案" : "篇文章"}的主题或疑问句`}
              className="min-h-28 bg-white text-xs leading-5"
            />
            {availableQuestionTasks.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {keywordQuestionTasks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => fillQuestionTasks(keywordQuestionTasks)}
                    className="text-[11px] font-medium text-[#0958D9] hover:text-[#1677FF]"
                  >
                    填入关键词策略前 {Math.min(count, keywordQuestionTasks.length)} 条
                  </button>
                )}
                {importedQuestionTasks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => fillQuestionTasks(importedQuestionTasks)}
                    className="text-[11px] font-medium text-cyan-700 hover:text-cyan-600"
                  >
                    填入 Excel 前 {Math.min(count, importedQuestionTasks.length)} 组并按原行保留优势
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg bg-blue-50/70 px-3 py-2.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={similarityRetry}
            onChange={event => setSimilarityRetry(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#1677FF]"
          />
          <span>
            <span className="block font-semibold text-slate-700">相似度过高时免费重试</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">只重新生成重复度偏高的{videoScriptBatch ? "文案" : "文章"}，不读取其他完整正文作为上下文。</span>
          </span>
        </label>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[11px] text-slate-500">
            当前创作类型：<span className="font-medium text-slate-700">{promptTitle}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            预计 <span className="font-semibold text-[#0958D9]">{totalCredits} 积分</span>
          </div>
          <Button
            type="button"
            onClick={() => void startBatch()}
            disabled={!canStart}
            title={blockedReason || `开始批量生成${videoScriptBatch ? "视频文案" : "文章"}`}
            className="h-10 gap-2 bg-gradient-to-r from-[#1677FF] to-[#00B8D9] px-5 text-white shadow-sm hover:shadow-blue-200"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Files className="h-4 w-4" />}
            {submitting ? "正在准备..." : `批量生成 ${count} ${videoScriptBatch ? "条" : "篇"}`}
          </Button>
        </div>
        {blockedReason && !submitting && (
          <div className="mt-2 text-right text-[11px] leading-5 text-amber-600">
            {blockedReason}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        {batches.length > 0 && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <select
              value={selectedBatch?.id || ""}
              onChange={event => setSelectedBatchId(event.target.value)}
              className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-[#1677FF]"
            >
              {batches.map(batch => (
                <option key={batch.id} value={batch.id}>
                  {batch.mode === "strategy" ? "策略自动成文 · " : ""}
                  {new Date(batch.createdAt).toLocaleString("zh-CN", { hour12: false })} · {batch.completedCount}/{batch.requestedCount}
                </option>
              ))}
            </select>
            {selectedBatch && (
              <div className="flex flex-wrap justify-end gap-2">
                {!selectedBatchVideoScript && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setMediaOpen(true)}
                    disabled={generatedCount === 0 || acting}
                    className="gap-1.5 border-cyan-200 text-cyan-700 hover:bg-cyan-50 hover:text-cyan-800"
                    title={generatedCount > 0 ? "为本批文章批量插入图片" : "本批文章生成后即可批量插入图片"}
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    批量插入图片
                  </Button>
                )}
                {selectedBatch.failedCount > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void runAction("retryFailed")}
                    disabled={acting}
                    className="gap-1.5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    重试失败项
                  </Button>
                )}
                {selectedBatch.status === "cancelled" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void runAction("restart")}
                    disabled={acting}
                    className="gap-1.5 border-blue-200 text-[#0958D9] hover:bg-blue-50 hover:text-[#003EB3]"
                  >
                    {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    按原设置重新生成
                  </Button>
                )}
                {!TERMINAL_BATCH.has(selectedBatch.status) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void runAction("cancel")}
                    disabled={acting}
                    className="gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <Square className="h-3 w-3" />
                    停止剩余
                  </Button>
                )}
                {TERMINAL_BATCH.has(selectedBatch.status) && (
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => void deleteBatch()}
                    disabled={acting}
                    className="h-8 w-8 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    title="删除本次批量任务和 Word 文件"
                    aria-label="删除本次批量任务"
                  >
                    {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {loading && batches.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在读取批量任务
          </div>
        ) : !selectedBatch ? (
          <div className="flex flex-1 items-center justify-center border border-dashed border-slate-200 bg-slate-50/50 text-center">
            <div className="px-5">
              <Files className="mx-auto mb-3 h-8 w-8 text-blue-300" />
              <div className="text-sm font-medium text-slate-500">还没有批量{videoScriptBatch ? "视频文案" : "文章"}</div>
              <div className="mt-1 text-xs leading-5 text-slate-400">设置数量并开始后，每{videoScriptBatch ? "条文案" : "篇文章"}会独立排队并自动生成 Word 文档。</div>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-slate-700">{selectedBatch.stage}</span>
                <span className="shrink-0 text-slate-500">{batchProgress}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#1677FF] via-[#00A8FF] to-[#00C8B4] transition-[width] duration-500"
                  style={{ width: `${batchProgress}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    质检通过 {passedCount} · 待人工复核 {reviewRequiredCount}
                    · 生成失败 {selectedBatch.failedCount} · 停止 {selectedBatch.cancelledCount}
                  </span>
                  {(selectedBatch.webCompletedCount || 0) > 0 && (
                    <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                      <Globe2 className="h-3 w-3" />
                      联网完成 {selectedBatch.webCompletedCount}
                    </span>
                  )}
                  {(selectedBatch.fallbackCompletedCount || 0) > 0 && (
                    <span className="font-medium text-amber-700">
                      普通模式 {selectedBatch.fallbackCompletedCount}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {mediaGeneratedCount > 0 && !selectedBatchVideoScript && (
                    <a
                      href={`/api/article-generation/batches/${encodeURIComponent(selectedBatch.id)}/download?scope=all&variant=media`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 font-semibold text-white transition hover:brightness-105"
                      title="下载内嵌图片的 Word、离线 HTML、Markdown 和图片文件"
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      下载图文成品 {mediaGeneratedCount} 篇
                    </a>
                  )}
                  {generatedCount > 0 && (
                    <a
                      href={`/api/article-generation/batches/${encodeURIComponent(selectedBatch.id)}/download?scope=all`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#003EB3] px-3 font-semibold text-white transition hover:bg-[#0958D9]"
                      title="下载全部已生成正文，包含待人工复核文章"
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      下载全部（含待复核）{generatedCount} {selectedBatchVideoScript ? "条" : "篇"}
                    </a>
                  )}
                  {passedCount > 0 && (
                    <a
                      href={`/api/article-generation/batches/${encodeURIComponent(selectedBatch.id)}/download?scope=passed`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 font-semibold text-[#0958D9] transition hover:bg-blue-50"
                      title={`只下载系统质检通过的${selectedBatchVideoScript ? "视频文案" : "文章"}`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      仅下载质检通过 {passedCount} {selectedBatchVideoScript ? "条" : "篇"}
                    </a>
                  )}
                  {directRecommendationPassedCount > 0 && !selectedBatchVideoScript && (
                    <a
                      href={`/api/article-generation/batches/${encodeURIComponent(selectedBatch.id)}/download?scope=direct`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#0B5CFF] to-[#00A8C8] px-3 font-semibold text-white transition hover:brightness-105"
                      title="下载质检通过的直接推荐与直接榜单文章；标题会自动补充当前年份"
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      下载直推榜单 {directRecommendationPassedCount} 篇
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
              {([
                ["all", "全部结果"],
                ["passed", "质检通过"],
                ["direct", "直推榜单"],
                ["review", "待人工复核"],
                ["failed", "失败/停止"],
              ] as Array<[ArticleBatchResultFilter, string]>).filter(([value]) => (
                !selectedBatchVideoScript || value !== "direct"
              )).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setResultFilter(value)}
                  className={`h-8 rounded-md px-3 text-[11px] font-semibold transition ${
                    activeResultFilter === value
                      ? "bg-white text-[#0958D9] shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {label} {resultFilterCounts[value]}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto border-y border-slate-100">
              {visibleItems.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center px-5 text-center text-xs text-slate-400">
                  当前筛选下没有{selectedBatchVideoScript ? "视频文案" : "文章"}，切换其他分类即可继续查看。
                </div>
              ) : visibleItems.map(item => (
                <div key={item.id} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 px-1 py-3 last:border-b-0">
                  <span className="text-center text-[11px] font-semibold text-slate-400">{String(item.position).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-700" title={item.title || item.topic}>
                      {item.title || item.topic}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-slate-400">
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ring-1 ${statusClass(item)}`}>
                        {item.qualityStatus === "review_required" && item.hasDraft
                          ? <FileWarning className="h-3 w-3" />
                          : item.status === "succeeded"
                            ? <CheckCircle2 className="h-3 w-3" />
                            : item.status === "failed"
                              ? <AlertCircle className="h-3 w-3" />
                              : <Clock3 className="h-3 w-3" />}
                        {statusLabel(item)}
                      </span>
                      <span className="truncate" title={item.error || item.stage}>{item.error || item.stage}</span>
                      {item.promptTitle && (
                        <span className="hidden shrink-0 rounded bg-blue-50 px-1.5 py-0.5 font-medium text-[#0958D9] sm:inline">
                          {item.promptTitle}
                        </span>
                      )}
                      {(item.questionSource || selectedBatch.mode === "strategy") && (
                        <span
                          className={`hidden shrink-0 rounded px-1.5 py-0.5 font-medium sm:inline ${
                            isDirectRecommendationQuestionType(item.questionSelectionType)
                              ? "bg-cyan-50 text-cyan-700"
                              : item.questionSelectionType === "conditional_recommendation"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-slate-100 text-slate-500"
                          }`}
                          title={item.questionSelectionReason}
                        >
                          {articleQuestionSelectionLabel(item.questionSelectionType)}
                        </span>
                      )}
                      {item.hasMediaVersion && !selectedBatchVideoScript && (
                        <span className="hidden shrink-0 items-center gap-1 rounded bg-cyan-50 px-1.5 py-0.5 font-medium text-cyan-700 sm:inline-flex">
                          <ImagePlus className="h-3 w-3" />
                          图文 {item.mediaImageCount || 0} 图
                        </span>
                      )}
                      {item.status === "succeeded" && item.connectivity && (
                        <span
                          className={`hidden shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium sm:inline-flex ${
                            item.connectivity.mode === "web"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                          title={item.connectivity.mode === "web"
                            ? `已使用 ${item.connectivity.sourceCount} 条实时联网资料`
                            : item.connectivity.fallbackReason || "联网多次未成功，已使用普通模式完成"}
                        >
                          <Globe2 className="h-3 w-3" />
                          {item.connectivity.mode === "web" ? "联网" : "普通"}
                        </span>
                      )}
                    </div>
                  </div>
                  {item.hasDraft ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void openPreview(item)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0958D9]"
                        title={`查看${selectedBatchVideoScript ? "视频文案" : "文章正文"}和质检结果`}
                        aria-label={`查看第 ${item.position} ${selectedBatchVideoScript ? "条视频文案" : "篇文章"}`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <a
                        href={`/api/article-generation/batches/${encodeURIComponent(selectedBatch.id)}/items/${encodeURIComponent(item.id)}/download`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-100 text-[#0958D9] transition hover:bg-blue-50"
                        title={`下载 ${item.fileName || "Word 文档"}`}
                        aria-label={`下载第 ${item.position} ${selectedBatchVideoScript ? "条视频文案" : "篇文章"} Word 文档`}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                      {item.hasMediaVersion && !selectedBatchVideoScript && (
                        <a
                          href={`/api/article-generation/batches/${encodeURIComponent(selectedBatch.id)}/items/${encodeURIComponent(item.id)}/download?variant=media`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-100 text-cyan-700 transition hover:bg-cyan-50"
                          title="下载图文版 Word"
                          aria-label={`下载第 ${item.position} 篇图文版 Word`}
                        >
                          <ImagePlus className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  ) : (
                    <span className="w-8 text-right text-[10px] text-slate-400">{item.progressPercent}%</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {previewItem ? createPortal(
        <div
          className="fixed inset-0 z-[130] flex items-end justify-center bg-[#00133F]/60 p-0 backdrop-blur-sm sm:items-center sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label={`查看批量生成${selectedBatchVideoScript ? "视频文案" : "文章"}`}
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={closePreview}
            aria-label={`关闭${selectedBatchVideoScript ? "视频文案" : "文章"}预览`}
          />
          <section className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl sm:rounded-lg">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-slate-900">
                    {previewDetail?.title || previewItem.title || previewItem.topic}
                  </h2>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ${
                    previewNeedsReview
                      ? "bg-amber-50 text-amber-700 ring-amber-200"
                      : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  }`}>
                    {previewNeedsReview
                      ? <FileWarning className="h-3 w-3" />
                      : <CheckCircle2 className="h-3 w-3" />}
                    {previewNeedsReview ? "待人工复核" : "质检通过"}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {previewDetail?.promptTitle || previewItem.promptTitle || selectedBatch?.promptTitle}
                  {previewDetail?.model ? ` · ${previewDetail.model}` : ""}
                </div>
                {previewDetail?.mediaMarkdown && (
                  <div className="mt-2 inline-flex bg-slate-100 p-0.5">
                    <button type="button" onClick={() => setPreviewVariant("original")} className={`h-7 px-3 text-[11px] font-semibold ${previewVariant === "original" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-500"}`}>原文版</button>
                    <button type="button" onClick={() => setPreviewVariant("media")} className={`h-7 px-3 text-[11px] font-semibold ${previewVariant === "media" ? "bg-white text-cyan-700 shadow-sm" : "text-slate-500"}`}>图文版</button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={closePreview}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                title="关闭"
                aria-label={`关闭${selectedBatchVideoScript ? "视频文案" : "文章"}预览`}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-6">
              {previewLoading ? (
                <div className="flex min-h-72 items-center justify-center text-sm text-slate-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  正在读取{selectedBatchVideoScript ? "视频文案" : "文章正文"}
                </div>
              ) : previewError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {previewError}
                </div>
              ) : previewMarkdown ? (
                <div className="space-y-4">
                  {previewNeedsReview && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                      <div className="font-semibold">系统质检未通过，请人工确认后使用</div>
                      <div className="mt-1 text-xs text-amber-700">
                        正文已完整保留，可以继续查看或下载。系统判断仅作为辅助，不替代人工决策。
                      </div>
                    </div>
                  )}

                  {previewAudit && (
                    <div className="grid gap-3 border-y border-slate-200 bg-white px-4 py-3 text-xs sm:grid-cols-[120px_minmax(0,1fr)]">
                      <div>
                        <div className="text-slate-400">质量评分</div>
                        <div className="mt-1 text-xl font-semibold text-slate-900">
                          {previewAudit.semanticScore ?? previewAudit.deterministicScore ?? "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">复核重点</div>
                        <div className="mt-1 leading-5 text-slate-700">
                          {previewAudit.issues.length > 0
                            ? previewAudit.issues.slice(0, 8).join("；")
                            : "系统未记录额外问题"}
                        </div>
                      </div>
                    </div>
                  )}

                  <article className="mx-auto max-w-3xl overflow-hidden bg-white px-5 py-6 text-[15px] leading-8 text-slate-700 shadow-sm ring-1 ring-slate-200 sm:px-9 [&_a]:break-all [&_a]:text-blue-600 [&_blockquote]:border-l-4 [&_blockquote]:border-blue-200 [&_blockquote]:bg-blue-50 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_code]:break-words [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-slate-950 [&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-bold [&_img]:mx-auto [&_img]:my-6 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md [&_li]:my-1 [&_ol]:my-4 [&_ol]:pl-6 [&_p]:my-4 [&_pre]:overflow-x-auto [&_pre]:bg-slate-900 [&_pre]:p-4 [&_pre]:text-slate-100 [&_strong]:text-slate-950 [&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-blue-50 [&_th]:p-2 [&_ul]:my-4 [&_ul]:pl-6">
                    {selectedBatchVideoScript ? (
                      <BatchVideoScriptPreview value={previewMarkdown} />
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {previewMarkdown}
                      </ReactMarkdown>
                    )}
                  </article>
                </div>
              ) : null}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
              <span className="text-[11px] text-slate-500">
                {previewNeedsReview
                  ? "请重点核对事实、品牌信息和发布适配性"
                  : `${selectedBatchVideoScript ? "视频文案" : "文章"}已通过当前质量规则`}
              </span>
              {previewBatchId && previewItem.hasDraft && (
                <a
                  href={`/api/article-generation/batches/${encodeURIComponent(previewBatchId)}/items/${encodeURIComponent(previewItem.id)}/download${previewVariant === "media" ? "?variant=media" : ""}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#003EB3] px-4 text-xs font-semibold text-white transition hover:bg-[#0958D9]"
                >
                  <Download className="h-3.5 w-3.5" />
                  下载这{selectedBatchVideoScript ? "条" : "篇"}{previewVariant === "media" ? "图文版" : ""} Word
                </a>
              )}
            </footer>
          </section>
        </div>,
        document.body,
      ) : null}

      {selectedBatch && !selectedBatchVideoScript && (
        <ArticleMediaDialog
          open={mediaOpen}
          clientId={clientId}
          batch={selectedBatch}
          onClose={() => setMediaOpen(false)}
          onCompleted={() => {
            void loadBatches(true)
            setCompletionNotice("批量图文版本已生成，可以预览或下载图文成品包。")
          }}
        />
      )}

      {completionNotice ? createPortal(
        <div className="fixed bottom-6 right-6 z-[120] max-w-sm rounded-lg border border-emerald-300/70 bg-emerald-600 px-4 py-3 text-sm leading-relaxed text-white shadow-2xl shadow-emerald-300/40" role="status" aria-live="polite">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">{completionNotice}</div>
            <button type="button" onClick={() => setCompletionNotice("")} className="-mr-1 rounded p-0.5 text-white/80 hover:bg-white/10 hover:text-white" title="关闭" aria-label="关闭完成提示">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>,
        document.body,
      ) : null}
    </section>
  )
}
