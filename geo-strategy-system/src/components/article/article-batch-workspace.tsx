"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  FileDown,
  Files,
  Globe2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { createBackgroundRequestId } from "@/lib/background-job-client"
import { resolveQuestionAdvantage } from "@/lib/geo-strategy/question-advantages"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type {
  ArticleBatchItemRecord,
  ArticleBatchQuestionTask,
  ArticleBatchRecord,
  ArticleBatchTopicMode,
} from "@/types"
import type { QuestionItem } from "@/types/geo-strategy"

interface Props {
  clientId: string
  promptTitle: string
  basePayload: Record<string, unknown>
  keywordQuestions: QuestionItem[]
  keywordAdvantages?: string[]
  perArticleCredits: number
}

interface BatchListResponse {
  batches?: ArticleBatchRecord[]
  error?: string
}

const TERMINAL_BATCH = new Set(["succeeded", "partial", "failed", "cancelled"])

function statusLabel(item: ArticleBatchItemRecord): string {
  if (item.status === "queued") return "排队中"
  if (item.status === "running") return "生成中"
  if (item.status === "word_processing") return "正在整理文档"
  if (item.status === "succeeded") return "已完成"
  if (item.status === "cancelled") return "已停止"
  return "失败"
}

function statusClass(item: ArticleBatchItemRecord): string {
  if (item.status === "succeeded") return "bg-emerald-50 text-emerald-700 ring-emerald-100"
  if (item.status === "failed") return "bg-rose-50 text-rose-700 ring-rose-100"
  if (item.status === "cancelled") return "bg-slate-100 text-slate-500 ring-slate-200"
  if (item.status === "running" || item.status === "word_processing") return "bg-cyan-50 text-cyan-700 ring-cyan-100"
  return "bg-blue-50 text-blue-700 ring-blue-100"
}

function topicLines(value: string): number {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).length
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
  perArticleCredits,
}: Props) {
  const [count, setCount] = useState(10)
  const [topicMode, setTopicMode] = useState<ArticleBatchTopicMode>("auto")
  const [customTopics, setCustomTopics] = useState("")
  const [similarityRetry, setSimilarityRetry] = useState(true)
  const [batches, setBatches] = useState<ArticleBatchRecord[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [acting, setActing] = useState(false)
  const [error, setError] = useState("")
  const [completionNotice, setCompletionNotice] = useState("")
  const previousStatuses = useRef<Map<string, ArticleBatchRecord["status"]>>(new Map())
  const initialized = useRef(false)

  const applyBatches = useCallback((next: ArticleBatchRecord[]) => {
    if (initialized.current) {
      for (const batch of next) {
        const previous = previousStatuses.current.get(batch.id)
        if (previous && !TERMINAL_BATCH.has(previous) && TERMINAL_BATCH.has(batch.status)) {
          setCompletionNotice(
            batch.status === "succeeded"
              ? `批量文章已完成：${batch.completedCount} 篇 Word 文档可以下载。`
              : `批量文章已结束：完成 ${batch.completedCount} 篇，未完成 ${batch.failedCount + batch.cancelledCount} 篇。`,
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

  function useKeywordQuestions() {
    const selected = keywordQuestions.slice(0, count)
    setCustomTopics(selected.map(item => item.question).join("\n"))
    setTopicMode("questions")
  }

  function questionTasksForRequest(): ArticleBatchQuestionTask[] | undefined {
    if (topicMode !== "questions") return undefined
    const byQuestion = new Map(
      keywordQuestions.map(question => [
        question.question.trim().replace(/\s+/g, "").toLocaleLowerCase("zh-CN"),
        question,
      ]),
    )
    return customTopics
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, count)
      .map(questionText => {
        const known = byQuestion.get(
          questionText.replace(/\s+/g, "").toLocaleLowerCase("zh-CN"),
        )
        return {
          questionId: known?.id,
          question: questionText,
          intent: known?.intent,
          category: known?.category,
          keyword: known?.keyword,
          contentAngle: known?.content_angle,
          subIntent: known?.subIntent,
          queryStyle: known?.queryStyle,
          methodologyCandidates: known?.methodologyCandidates,
          platformCandidates: known?.platformCandidates,
          articleFormat: known?.articleFormatCandidates?.[0],
          titleStrategy: known?.titleStrategyCandidates?.[0],
          matchedAdvantage: known
            ? resolveQuestionAdvantage(known, keywordAdvantages)
            : undefined,
        }
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
    if (!window.confirm(`确认删除这次批量任务吗？对应的 ${selectedBatch.completedCount} 篇 Word 文件也会一并清理。`)) return
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

  return (
    <section className="flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-lg border border-[#d6e7ff] bg-white/95 shadow-sm">
      <div className="border-b border-blue-100 bg-gradient-to-r from-[#EAF4FF] via-white to-[#E8FBFF] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#003EB3]">
              <Files className="h-4 w-4" />
              批量文章
            </div>
            <div className="mt-1 text-[11px] leading-5 text-slate-500">
              每篇文章独立生成，可以同时使用系统中的其他功能
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
                  onClick={() => setTopicMode(mode)}
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
              placeholder="每行填写一篇文章的主题或疑问句"
              className="min-h-28 bg-white text-xs leading-5"
            />
            {keywordQuestions.length > 0 && (
              <button
                type="button"
                onClick={useKeywordQuestions}
                className="mt-2 text-[11px] font-medium text-[#0958D9] hover:text-[#1677FF]"
              >
                填入当前客户前 {Math.min(count, keywordQuestions.length)} 条疑问句并保留匹配优势
              </button>
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
            <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">只重新生成重复度偏高的文章，不读取其他文章正文作为上下文。</span>
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
            当前模板：<span className="font-medium text-slate-700">{promptTitle}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            预计 <span className="font-semibold text-[#0958D9]">{totalCredits} 积分</span>
          </div>
          <Button
            type="button"
            onClick={() => void startBatch()}
            disabled={!canStart}
            title={blockedReason || "开始批量生成文章"}
            className="h-10 gap-2 bg-gradient-to-r from-[#1677FF] to-[#00B8D9] px-5 text-white shadow-sm hover:shadow-blue-200"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Files className="h-4 w-4" />}
            {submitting ? "正在准备..." : `批量生成 ${count} 篇`}
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
              <div className="flex shrink-0 gap-2">
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
              <div className="text-sm font-medium text-slate-500">还没有批量文章</div>
              <div className="mt-1 text-xs leading-5 text-slate-400">设置数量并开始后，每篇文章会独立排队并自动生成 Word 文档。</div>
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
                  <span>完成 {selectedBatch.completedCount} · 失败 {selectedBatch.failedCount} · 停止 {selectedBatch.cancelledCount}</span>
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
                {selectedBatch.completedCount > 0 && (
                  <a
                    href={`/api/article-generation/batches/${encodeURIComponent(selectedBatch.id)}/download`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#003EB3] px-3 font-semibold text-white transition hover:bg-[#0958D9]"
                    title="将当前已完成文章打包为 ZIP 下载"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    一键下载 {selectedBatch.completedCount} 篇
                  </a>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto border-y border-slate-100">
              {selectedBatch.items.map(item => (
                <div key={item.id} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 px-1 py-3 last:border-b-0">
                  <span className="text-center text-[11px] font-semibold text-slate-400">{String(item.position).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-700" title={item.title || item.topic}>
                      {item.title || item.topic}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-slate-400">
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ring-1 ${statusClass(item)}`}>
                        {item.status === "succeeded" ? <CheckCircle2 className="h-3 w-3" /> : item.status === "failed" ? <AlertCircle className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
                        {statusLabel(item)}
                      </span>
                      <span className="truncate" title={item.error || item.stage}>{item.error || item.stage}</span>
                      {item.promptTitle && (
                        <span className="hidden shrink-0 rounded bg-blue-50 px-1.5 py-0.5 font-medium text-[#0958D9] sm:inline">
                          {item.promptTitle}
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
                  {item.status === "succeeded" ? (
                    <a
                      href={`/api/article-generation/batches/${encodeURIComponent(selectedBatch.id)}/items/${encodeURIComponent(item.id)}/download`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-100 text-[#0958D9] transition hover:bg-blue-50"
                      title={`下载 ${item.fileName || "Word 文档"}`}
                      aria-label={`下载第 ${item.position} 篇 Word 文档`}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span className="w-8 text-right text-[10px] text-slate-400">{item.progressPercent}%</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

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
