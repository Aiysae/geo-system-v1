"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardPaste,
  FileSpreadsheet,
  Link2,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import {
  inferEvidencePlatform,
  inferEvidencePlatformKey,
  MAX_EVIDENCE_IMPORT_ROWS,
  parseEvidenceImportText,
  validateEvidenceImportRows,
  type EvidenceImportRowDraft,
} from "@/lib/client-feedback/evidence-import"
import {
  resolveSourcePlatformByName,
  sourcePlatformOptions,
} from "@/lib/source-platform-registry"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type {
  ClientEvidenceImportDefaults,
  ClientEvidenceImportPreview,
  ClientEvidenceImportPreviewRow,
  ClientEvidenceImportResult,
  ClientExecutionActionCategory,
  ClientExecutionActionStatus,
  ClientExecutionActionVisibility,
} from "@/types/client-feedback"

type EditableImportRow = EvidenceImportRowDraft & { key: string }

type Props = {
  endpoint: string
  defaultDate: string
  onClose: () => void
  onImported: (result: ClientEvidenceImportResult) => void
}

const CATEGORY_OPTIONS: Array<{ value: ClientExecutionActionCategory; label: string }> = [
  { value: "self_media_publish", label: "自媒体发布" },
  { value: "authority_media_publish", label: "权威媒体发布" },
  { value: "video_publish", label: "视频发布" },
  { value: "content_production", label: "内容生产" },
  { value: "website_optimization", label: "网站优化" },
  { value: "strategy_adjustment", label: "策略调整" },
  { value: "other", label: "其他动作" },
]

const PLATFORM_OPTIONS = sourcePlatformOptions()
const PUBLICATION_CATEGORIES = new Set<ClientExecutionActionCategory>([
  "self_media_publish",
  "authority_media_publish",
  "video_publish",
])

function rowKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function importId(): string {
  return `cimp_${rowKey().replace(/-/g, "")}`
}

function toEditableRows(rows: EvidenceImportRowDraft[]): EditableImportRow[] {
  return rows.map(row => ({ ...row, key: rowKey() }))
}

function revalidate(rows: EditableImportRow[]): EditableImportRow[] {
  const validated = validateEvidenceImportRows(rows.map(row => ({
    title: row.title,
    url: row.url,
    platform: row.platform,
    platformKey: row.platformKey,
  })))
  return rows.map((row, index) => ({
    ...row,
    ...validated[index],
    key: row.key,
  }))
}

function isDuplicateWarning(error?: string): boolean {
  return Boolean(error && /^与第 \d+ 行网址重复$/.test(error))
}

export default function BatchEvidenceImportDialog({
  endpoint,
  defaultDate,
  onClose,
  onImported,
}: Props) {
  const [step, setStep] = useState<"paste" | "preview">("paste")
  const [rawText, setRawText] = useState("")
  const [rows, setRows] = useState<EditableImportRow[]>([])
  const [requestImportId] = useState(importId)
  const [category, setCategory] = useState<ClientExecutionActionCategory>("self_media_publish")
  const [status, setStatus] = useState<ClientExecutionActionStatus>("completed")
  const [visibility, setVisibility] = useState<ClientExecutionActionVisibility>("client")
  const [occurredDate, setOccurredDate] = useState(defaultDate)
  const [description, setDescription] = useState("")
  const [reconcilePublishingQuota, setReconcilePublishingQuota] = useState(true)
  const [quotaPreview, setQuotaPreview] = useState<ClientEvidenceImportPreview | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose, pending])

  const summary = useMemo(() => {
    const duplicateCount = rows.filter(row => isDuplicateWarning(row.error)).length
    const errorCount = rows.filter(row => row.error && !isDuplicateWarning(row.error)).length
    return {
      duplicateCount,
      errorCount,
      importableCount: rows.length - duplicateCount - errorCount,
    }
  }, [rows])

  async function parseRows() {
    setError("")
    const parsed = parseEvidenceImportText(rawText)
    if (parsed.length === 0) {
      setError("请先粘贴文章标题和证据网址")
      return
    }
    const editable = toEditableRows(parsed)
    setRows(editable)
    setStep("preview")
    await refreshQuotaPreview(editable)
  }

  function updateRow(
    key: string,
    field: "title" | "url" | "platform",
    value: string,
  ) {
    setQuotaPreview(null)
    setRows(current => {
      const next = current.map(row => {
        if (row.key !== key) return row
        if (field === "platform") {
          const definition = resolveSourcePlatformByName(value)
          return {
            ...row,
            platform: definition?.name || value,
            platformKey: definition?.key || "",
          }
        }
        if (field !== "url") return { ...row, [field]: value }
        const shouldRefreshPlatform = !row.platform || row.platform === row.inferredPlatform
        const inferredPlatform = inferEvidencePlatform(value)
        const inferredPlatformKey = inferEvidencePlatformKey(value)
        return {
          ...row,
          url: value,
          inferredPlatform,
          inferredPlatformKey,
          platform: shouldRefreshPlatform ? inferredPlatform : row.platform,
          platformKey: shouldRefreshPlatform ? inferredPlatformKey : row.platformKey,
        }
      })
      return revalidate(next)
    })
  }

  function removeRow(key: string) {
    setQuotaPreview(null)
    setRows(current => revalidate(current.filter(row => row.key !== key)))
  }

  function addRow() {
    setQuotaPreview(null)
    setRows(current => revalidate([
      ...current,
      {
        key: rowKey(),
        rowNumber: current.length + 1,
        title: "",
        url: "",
        normalizedUrl: "",
        inferredPlatform: "",
        inferredPlatformKey: "",
        platform: "",
        platformKey: "",
        error: "请填写标题",
      },
    ]))
  }

  function shouldReconcileQuota(): boolean {
    return reconcilePublishingQuota
      && status === "completed"
      && PUBLICATION_CATEGORIES.has(category)
  }

  async function refreshQuotaPreview(sourceRows = rows): Promise<ClientEvidenceImportPreview | null> {
    const checked = revalidate(sourceRows)
    setRows(checked)
    if (!shouldReconcileQuota()) {
      setQuotaPreview(null)
      return null
    }
    if (checked.some(row => row.error && !isDuplicateWarning(row.error))) return null
    setPending(true)
    setError("")
    try {
      const response = await fetch(`${endpoint}/actions/batch`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preview: true,
          reconcilePublishingQuota: true,
          defaults: { category, status, visibility, occurredDate, description },
          rows: checked.map(row => ({
            title: row.title,
            url: row.url,
            platform: row.platform,
            platformKey: row.platformKey,
          })),
        }),
      })
      const body = await response.json().catch(() => null) as {
        preview?: ClientEvidenceImportPreview | null
        error?: string
      } | null
      if (!response.ok || !body) throw new Error(body?.error || "发布配额预览失败")
      setQuotaPreview(body.preview || null)
      return body.preview || null
    } catch (caught) {
      setQuotaPreview(null)
      setError(toUserFacingError(caught, {
        fallback: "发布配额暂时无法预览，请检查后重试。",
        subject: "发布配额预览",
      }))
      return null
    } finally {
      setPending(false)
    }
  }

  async function submitImport() {
    const checked = revalidate(rows)
    setRows(checked)
    const blockingError = checked.find(row => row.error && !isDuplicateWarning(row.error))
    const importableCount = checked.filter(row => !row.error).length
    if (blockingError) {
      setError(`第 ${blockingError.rowNumber} 行：${blockingError.error}`)
      return
    }
    if (importableCount === 0) {
      setError("没有可以导入的新记录")
      return
    }
    setPending(true)
    setError("")
    try {
      const defaults: ClientEvidenceImportDefaults = {
        category,
        status,
        visibility,
        occurredDate,
        description,
      }
      const response = await fetch(`${endpoint}/actions/batch`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importId: requestImportId,
          defaults,
          rows: checked.map(row => ({
            title: row.title,
            url: row.url,
            platform: row.platform,
            platformKey: row.platformKey,
          })),
          reconcilePublishingQuota: shouldReconcileQuota(),
        }),
      })
      const body = await response.json().catch(() => null) as (
        ClientEvidenceImportResult & { error?: string }
      ) | null
      if (!response.ok || !body) {
        throw new Error(body?.error || "批量导入动作失败")
      }
      onImported(body)
    } catch (caught) {
      setError(toUserFacingError(caught, {
        fallback: "批量导入失败，请检查内容后重试。",
        subject: "批量导入动作",
      }))
    } finally {
      setPending(false)
    }
  }

  if (typeof document === "undefined") return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#00133F]/62 p-2 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-evidence-import-title"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[#B7D9FF] bg-white shadow-[0_30px_90px_-30px_rgba(0,35,110,.82)]">
        <header className="flex items-center justify-between gap-4 border-b border-[#DCEAF7] px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[linear-gradient(145deg,#EAF5FF,#E8FFFD)] text-[#0958D9] ring-1 ring-[#B7D9FF]">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="batch-evidence-import-title" className="truncate text-base font-semibold text-slate-950">
                批量导入证据网址
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                自动识别发布平台，并将有效网址核销到当日发布任务
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden overflow-hidden rounded-md border border-[#C9DFF3] bg-[#F5FAFF] text-[11px] font-semibold sm:flex">
              <span className={`px-3 py-1.5 ${step === "paste" ? "bg-[#1677FF] text-white" : "text-slate-500"}`}>
                录入
              </span>
              <span className={`px-3 py-1.5 ${step === "preview" ? "bg-[#1677FF] text-white" : "text-slate-500"}`}>
                预览
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 disabled:opacity-40"
              aria-label="关闭批量导入"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="overflow-y-auto">
          <section className="grid gap-3 border-b border-[#E4EDF6] bg-[#F8FBFE] px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
            <label className="space-y-1.5 text-[11px] font-semibold text-slate-700">
              发生日期
              <input
                type="date"
                value={occurredDate}
              onChange={event => { setOccurredDate(event.target.value); setQuotaPreview(null) }}
                className="h-10 w-full rounded-lg border border-[#C8D9E8] bg-white px-3 text-xs font-normal outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/10"
              />
            </label>
            <label className="space-y-1.5 text-[11px] font-semibold text-slate-700">
              动作类型
              <select
                value={category}
                onChange={event => { setCategory(event.target.value as ClientExecutionActionCategory); setQuotaPreview(null) }}
                className="h-10 w-full rounded-lg border border-[#C8D9E8] bg-white px-3 text-xs font-normal outline-none transition focus:border-[#1677FF]"
              >
                {CATEGORY_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-[11px] font-semibold text-slate-700">
              完成状态
              <select
                value={status}
                onChange={event => { setStatus(event.target.value as ClientExecutionActionStatus); setQuotaPreview(null) }}
                className="h-10 w-full rounded-lg border border-[#C8D9E8] bg-white px-3 text-xs font-normal outline-none transition focus:border-[#1677FF]"
              >
                <option value="completed">已完成</option>
                <option value="planned">计划中</option>
              </select>
            </label>
            <label className="space-y-1.5 text-[11px] font-semibold text-slate-700">
              客户可见性
              <select
                value={visibility}
                onChange={event => setVisibility(event.target.value as ClientExecutionActionVisibility)}
                className="h-10 w-full rounded-lg border border-[#C8D9E8] bg-white px-3 text-xs font-normal outline-none transition focus:border-[#1677FF]"
              >
                <option value="client">客户可见</option>
                <option value="internal">仅内部可见</option>
              </select>
            </label>
            <label className="space-y-1.5 text-[11px] font-semibold text-slate-700 sm:col-span-2 lg:col-span-4">
              执行说明（可选）
              <input
                value={description}
                maxLength={2_000}
                onChange={event => setDescription(event.target.value)}
                placeholder="这段说明将应用到本批次的每条记录"
                className="h-10 w-full rounded-lg border border-[#C8D9E8] bg-white px-3 text-xs font-normal outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/10"
              />
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-[#B7D9FF] bg-white px-3 py-3 sm:col-span-2 lg:col-span-4">
              <input
                type="checkbox"
                checked={reconcilePublishingQuota}
                onChange={event => { setReconcilePublishingQuota(event.target.checked); setQuotaPreview(null) }}
                className="mt-0.5 h-4 w-4 accent-[#1677FF]"
              />
              <span>
                <span className="block text-[11px] font-semibold text-[#102A43]">同步核销当日发布配额</span>
                <span className="mt-1 block text-[10px] leading-4 text-[#6B8299]">仅“已完成”的自媒体、权威媒体和视频发布会核销；重复网址不重复计数。</span>
              </span>
            </label>
          </section>

          {step === "paste" ? (
            <section className="px-4 py-5 sm:px-5">
              <div className="mb-3 flex items-end justify-between gap-3">
                <label htmlFor="batch-evidence-text" className="text-xs font-semibold text-slate-900">
                  标题与网址
                </label>
                <span className="text-[10px] text-slate-400">最多 {MAX_EVIDENCE_IMPORT_ROWS} 条</span>
              </div>
              <div className="relative">
                <ClipboardPaste className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[#61A8EF]" />
                <textarea
                  id="batch-evidence-text"
                  value={rawText}
                  onChange={event => setRawText(event.target.value)}
                  rows={13}
                  autoFocus
                  placeholder={"文章标题一\thttps://example.com/article-1\n文章标题二\thttps://example.com/article-2"}
                  className="min-h-64 w-full resize-y rounded-lg border border-[#BFD7EC] bg-[#FBFDFF] py-3 pl-10 pr-3 font-mono text-xs leading-7 text-slate-700 outline-none transition placeholder:text-slate-300 focus:border-[#1677FF] focus:bg-white focus:ring-2 focus:ring-[#1677FF]/10"
                />
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                <FileSpreadsheet className="h-3.5 w-3.5 text-[#13A8A8]" />
                可直接粘贴 Excel 或 WPS 中的“标题、网址”两列
              </div>
            </section>
          ) : (
            <section className="px-3 py-4 sm:px-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" />可导入 {summary.importableCount}
                  </span>
                  {summary.duplicateCount > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-700">
                      重复 {summary.duplicateCount}
                    </span>
                  ) : null}
                  {summary.errorCount > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 font-semibold text-rose-700">
                      <AlertCircle className="h-3 w-3" />需修改 {summary.errorCount}
                    </span>
                  ) : null}
                  {quotaPreview ? (
                    <>
                      <span className="rounded-md bg-sky-50 px-2 py-1 font-semibold text-sky-700">匹配任务 {quotaPreview.summary.matchedCount}</span>
                      {quotaPreview.summary.overQuotaCount > 0 ? <span className="rounded-md bg-violet-50 px-2 py-1 font-semibold text-violet-700">超额 {quotaPreview.summary.overQuotaCount}</span> : null}
                      {quotaPreview.summary.unplannedCount > 0 ? <span className="rounded-md bg-cyan-50 px-2 py-1 font-semibold text-cyan-700">计划外 {quotaPreview.summary.unplannedCount}</span> : null}
                      {quotaPreview.summary.needsReviewCount > 0 ? <span className="rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-700">待确认平台 {quotaPreview.summary.needsReviewCount}</span> : null}
                    </>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={addRow}
                  disabled={rows.length >= MAX_EVIDENCE_IMPORT_ROWS}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#B7D9FF] bg-[#F3F9FF] px-3 text-[11px] font-semibold text-[#0958D9] transition hover:bg-[#EAF4FF] disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />添加一行
                </button>
                {shouldReconcileQuota() ? (
                  <button
                    type="button"
                    onClick={() => void refreshQuotaPreview()}
                    disabled={pending || summary.errorCount > 0}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#B7D9FF] bg-white px-3 text-[11px] font-semibold text-[#0958D9] disabled:opacity-40"
                  >
                    {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}刷新核销预览
                  </button>
                ) : null}
              </div>

              <div className="overflow-hidden rounded-lg border border-[#D4E4F2]">
                <div className="hidden grid-cols-[2rem_minmax(150px,1.15fr)_minmax(190px,1.45fr)_minmax(100px,.65fr)_minmax(105px,.65fr)_2rem] gap-2 border-b border-[#D4E4F2] bg-[#EEF6FD] px-3 py-2 text-[10px] font-semibold text-slate-500 md:grid">
                  <span>#</span>
                  <span>标题</span>
                  <span>证据网址</span>
                  <span>平台</span>
                  <span>当日核销</span>
                  <span />
                </div>
                <div className="max-h-[44vh] divide-y divide-[#E5EEF6] overflow-y-auto">
                  {rows.map(row => {
                    const warning = isDuplicateWarning(row.error)
                    const quotaRow = quotaPreview?.rows.find(item => item.rowNumber === row.rowNumber)
                    return (
                      <div
                        key={row.key}
                        className={`grid gap-2 px-3 py-3 md:grid-cols-[2rem_minmax(150px,1.15fr)_minmax(190px,1.45fr)_minmax(100px,.65fr)_minmax(105px,.65fr)_2rem] md:items-start ${
                          row.error
                            ? warning ? "bg-amber-50/55" : "bg-rose-50/55"
                            : "bg-white"
                        }`}
                      >
                        <span className="pt-2.5 font-mono text-[10px] text-slate-400">{row.rowNumber}</span>
                        <label className="space-y-1 md:space-y-0">
                          <span className="text-[10px] font-semibold text-slate-500 md:hidden">标题</span>
                          <input
                            value={row.title}
                            maxLength={160}
                            onChange={event => updateRow(row.key, "title", event.target.value)}
                            className="h-9 w-full rounded-md border border-[#C8D9E8] bg-white px-2.5 text-xs outline-none transition focus:border-[#1677FF]"
                          />
                        </label>
                        <label className="space-y-1 md:space-y-0">
                          <span className="text-[10px] font-semibold text-slate-500 md:hidden">证据网址</span>
                          <div className="relative">
                            <Link2 className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                            <input
                              value={row.url}
                              onChange={event => updateRow(row.key, "url", event.target.value)}
                              className="h-9 w-full rounded-md border border-[#C8D9E8] bg-white pl-8 pr-2 font-mono text-[10px] outline-none transition focus:border-[#1677FF]"
                            />
                          </div>
                          {row.error ? (
                            <span className={`block text-[10px] ${warning ? "text-amber-700" : "text-rose-600"}`}>
                              {warning ? `${row.error}，导入时会跳过` : row.error}
                            </span>
                          ) : null}
                        </label>
                        <label className="space-y-1 md:space-y-0">
                          <span className="text-[10px] font-semibold text-slate-500 md:hidden">平台</span>
                          <input
                            value={row.platform}
                            list="execution-evidence-platforms"
                            maxLength={120}
                            onChange={event => updateRow(row.key, "platform", event.target.value)}
                            className="h-9 w-full rounded-md border border-[#C8D9E8] bg-white px-2.5 text-xs outline-none transition focus:border-[#1677FF]"
                          />
                        </label>
                        <div className="flex min-h-9 items-center">
                          {quotaRow ? (
                            <QuotaPreviewBadge row={quotaRow} />
                          ) : (
                            <span className="text-[10px] text-slate-400">
                              {row.error ? "不核销" : shouldReconcileQuota() ? "待预览" : "不核销"}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeRow(row.key)}
                          className="flex h-9 w-9 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 md:h-8 md:w-8"
                          aria-label={`删除第 ${row.rowNumber} 行`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
              <datalist id="execution-evidence-platforms">
                {PLATFORM_OPTIONS.map(option => <option key={option.key} value={option.name} />)}
              </datalist>
            </section>
          )}

          {error ? (
            <div className="mx-4 mb-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700 sm:mx-5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-[#DCEAF7] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            {step === "preview" ? (
              <button
                type="button"
                onClick={() => {
                  setStep("paste")
                  setError("")
                }}
                disabled={pending}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 sm:w-auto"
              >
                <ArrowLeft className="h-3.5 w-3.5" />返回修改原文
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="h-9 flex-1 rounded-md border border-[#C8D9E8] px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 sm:flex-none"
            >
              取消
            </button>
            {step === "paste" ? (
              <button
                type="button"
                onClick={() => void parseRows()}
                disabled={pending}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-[linear-gradient(100deg,#1677FF,#00AEEA)] px-5 text-xs font-semibold text-white shadow-sm shadow-[#1677FF]/20 transition hover:brightness-105 sm:flex-none"
              >
                {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                {pending ? "正在识别" : "解析并预览"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submitImport()}
                disabled={pending || summary.errorCount > 0 || summary.importableCount === 0}
                className="inline-flex h-9 min-w-32 flex-1 items-center justify-center gap-1.5 rounded-md bg-[linear-gradient(100deg,#0958D9,#1677FF,#00AEEA)] px-5 text-xs font-semibold text-white shadow-sm shadow-[#1677FF]/25 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none"
              >
                {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {pending ? "正在导入" : `确认导入 ${summary.importableCount} 条`}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function QuotaPreviewBadge({ row }: { row: ClientEvidenceImportPreviewRow }) {
  const meta = {
    matched: { label: "将核销 1 项", className: "bg-emerald-50 text-emerald-700" },
    over_quota: { label: "超额发布", className: "bg-violet-50 text-violet-700" },
    unplanned: { label: "计划外发布", className: "bg-sky-50 text-sky-700" },
    needs_review: { label: "待确认平台", className: "bg-amber-50 text-amber-700" },
  }[row.status]
  return (
    <div className="min-w-0">
      <span className={`inline-flex rounded-md px-2 py-1 text-[9px] font-semibold ${meta.className}`}>
        {meta.label}
      </span>
      {row.plannedCount > 0 ? (
        <p className="mt-1 text-[9px] text-slate-400">当日已完成 {row.completedCount}/{row.plannedCount}</p>
      ) : null}
    </div>
  )
}
