"use client"

import Image from "next/image"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Check,
  FileImage,
  Images,
  Loader2,
  RotateCcw,
  Square,
  Upload,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { createBackgroundRequestId } from "@/lib/background-job-client"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type {
  ArticleBatchRecord,
  ArticleMediaAssetRecord,
  ArticleMediaJobRecord,
  ArticleMediaMappingMode,
  ArticleMediaTemplateKey,
} from "@/types"

type Props = {
  open: boolean
  clientId: string
  batch: ArticleBatchRecord
  onClose: () => void
  onCompleted: () => void
}

type UploadResponse = { assets?: ArticleMediaAssetRecord[]; error?: string }
type JobResponse = { job?: ArticleMediaJobRecord; error?: string }
type JobListResponse = { jobs?: ArticleMediaJobRecord[]; error?: string }

const TERMINAL = new Set(["succeeded", "partial", "failed", "cancelled"])
const TEMPLATE_OPTIONS: Array<{ value: ArticleMediaTemplateKey; label: string; detail: string; count: number }> = [
  { value: "opening", label: "首图版", detail: "导语后插入 1 张", count: 1 },
  { value: "standard", label: "标准图文", detail: "开篇、正文、结尾共 3 张", count: 3 },
  { value: "rich", label: "丰富图文", detail: "按结构均匀插入 5 张", count: 5 },
]

const MAPPING_OPTIONS: Array<{ value: ArticleMediaMappingMode; label: string; detail: string }> = [
  { value: "round_robin", label: "轮换配图", detail: "图片池按文章顺序轮换，避免每篇完全相同" },
  { value: "same_set", label: "统一配图", detail: "所有文章使用相同的一组图片" },
  { value: "per_article", label: "逐篇指定", detail: "为每篇文章单独勾选图片" },
]

function terminal(job?: ArticleMediaJobRecord | null): boolean {
  return Boolean(job && TERMINAL.has(job.status))
}

export default function ArticleMediaDialog({
  open,
  clientId,
  batch,
  onClose,
  onCompleted,
}: Props) {
  const availableItems = useMemo(
    () => batch.items.filter(item => item.hasDraft),
    [batch.items],
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [assets, setAssets] = useState<ArticleMediaAssetRecord[]>([])
  const [template, setTemplate] = useState<ArticleMediaTemplateKey>("standard")
  const [mappingMode, setMappingMode] = useState<ArticleMediaMappingMode>("round_robin")
  const [activeItemId, setActiveItemId] = useState("")
  const [itemAssetMap, setItemAssetMap] = useState<Record<string, string[]>>({})
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [job, setJob] = useState<ArticleMediaJobRecord | null>(null)
  const [error, setError] = useState("")
  const completedJobId = useRef("")

  const loadLatestJob = useCallback(async () => {
    const response = await apiFetch(
      `/api/article-generation/batches/${encodeURIComponent(batch.id)}/media-jobs`,
      { cache: "no-store" },
    )
    const data = await readApiJson<JobListResponse>(response, "批量配图")
    if (!response.ok) throw new Error(data.error || "读取配图任务失败")
    const latest = data.jobs?.[0]
    if (latest) setJob(latest)
  }, [batch.id])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      const selected = new Set(availableItems.map(item => item.id))
      setSelectedIds(selected)
      setActiveItemId(current => current && selected.has(current) ? current : availableItems[0]?.id || "")
      setError("")
      void loadLatestJob().catch(loadError => {
        setError(toUserFacingError(loadError, { fallback: "读取配图任务失败，请稍后重试。" }))
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [availableItems, loadLatestJob, open])

  const refreshJob = useCallback(async (jobId: string) => {
    const response = await apiFetch(`/api/article-generation/media-jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    })
    const data = await readApiJson<JobResponse>(response, "批量配图")
    if (!response.ok || !data.job) throw new Error(data.error || "读取配图进度失败")
    setJob(data.job)
    if (terminal(data.job) && completedJobId.current !== data.job.id) {
      completedJobId.current = data.job.id
      onCompleted()
    }
  }, [onCompleted])

  useEffect(() => {
    if (!job || terminal(job)) return
    const timer = window.setInterval(() => {
      void refreshJob(job.id).catch(pollError => {
        setError(toUserFacingError(pollError, { fallback: "配图任务仍在后台运行，请稍后刷新。" }))
      })
    }, 1_500)
    return () => window.clearInterval(timer)
  }, [job, refreshJob])

  const targetItems = availableItems.filter(item => selectedIds.has(item.id))
  const selectedTemplate = TEMPLATE_OPTIONS.find(option => option.value === template) || TEMPLATE_OPTIONS[1]

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    setError("")
    try {
      const form = new FormData()
      form.set("clientId", clientId)
      form.set("batchId", batch.id)
      Array.from(files).slice(0, 30).forEach(file => form.append("files", file))
      const response = await apiFetch("/api/article-generation/assets", {
        method: "POST",
        body: form,
      })
      const data = await readApiJson<UploadResponse>(response, "图片上传")
      if (!response.ok) throw new Error(data.error || "图片上传失败")
      setAssets(current => {
        const byId = new Map(current.map(asset => [asset.id, asset]))
        for (const asset of data.assets || []) byId.set(asset.id, asset)
        return [...byId.values()]
      })
    } catch (uploadError) {
      setError(toUserFacingError(uploadError, { fallback: "图片上传失败，请稍后重试。" }))
    } finally {
      setUploading(false)
    }
  }

  const toggleItem = (id: string) => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleItemAsset = (itemId: string, assetId: string) => {
    setItemAssetMap(current => {
      const ids = new Set(current[itemId] || [])
      if (ids.has(assetId)) ids.delete(assetId)
      else if (ids.size < selectedTemplate.count) ids.add(assetId)
      return { ...current, [itemId]: [...ids] }
    })
  }

  const removeAsset = (assetId: string) => {
    setAssets(current => current.filter(candidate => candidate.id !== assetId))
    setItemAssetMap(current => Object.fromEntries(
      Object.entries(current).map(([itemId, ids]) => [
        itemId,
        ids.filter(id => id !== assetId),
      ]),
    ))
  }

  const startJob = async () => {
    if (targetItems.length === 0) {
      setError("请至少选择一篇文章")
      return
    }
    if (assets.length === 0) {
      setError("请先上传图片")
      return
    }
    if (mappingMode === "per_article") {
      const missing = targetItems.find(item => !(itemAssetMap[item.id]?.length > 0))
      if (missing) {
        setError(`请先为第 ${missing.position} 篇文章选择图片`)
        return
      }
    }
    setSubmitting(true)
    setError("")
    try {
      const response = await apiFetch(
        `/api/article-generation/batches/${encodeURIComponent(batch.id)}/media-jobs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: createBackgroundRequestId("article-media"),
            itemIds: targetItems.map(item => item.id),
            assetIds: assets.map(asset => asset.id),
            itemAssetMap,
            template,
            mappingMode,
          }),
        },
      )
      const data = await readApiJson<JobResponse>(response, "批量配图")
      if (!response.ok || !data.job) throw new Error(data.error || "创建批量配图任务失败")
      completedJobId.current = ""
      setJob(data.job)
    } catch (submitError) {
      setError(toUserFacingError(submitError, { fallback: "创建批量配图任务失败，请稍后重试。" }))
    } finally {
      setSubmitting(false)
    }
  }

  const cancelJob = async () => {
    if (!job || terminal(job)) return
    try {
      const response = await apiFetch(`/api/article-generation/media-jobs/${encodeURIComponent(job.id)}`, {
        method: "DELETE",
      })
      const data = await readApiJson<JobResponse>(response, "停止配图")
      if (!response.ok) throw new Error(data.error || "停止配图失败")
      if (data.job) setJob(data.job)
    } catch (cancelError) {
      setError(toUserFacingError(cancelError, { fallback: "停止配图失败，请稍后重试。" }))
    }
  }

  if (!open || typeof document === "undefined") return null
  const running = Boolean(job && !terminal(job))

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-end justify-center bg-[#00133F]/65 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="批量插入图片">
      <button type="button" className="absolute inset-0 cursor-default" onClick={running ? undefined : onClose} aria-label="关闭批量配图" />
      <section className="relative flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl sm:rounded-lg">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Images className="h-4 w-4 text-[#1677FF]" />
              <h2 className="text-base font-semibold text-slate-950">批量插入图片</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">原始文章保持不变，系统会另存可预览、可导出的图文版本。</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center text-slate-500 hover:bg-slate-100" title="关闭" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]">
            <div className="space-y-6">
              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">1. 选择文章</h3>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(current => current.size === availableItems.length ? new Set() : new Set(availableItems.map(item => item.id)))}
                    className="text-xs font-semibold text-[#0958D9] hover:text-[#003EB3]"
                  >
                    {selectedIds.size === availableItems.length ? "取消全选" : "全选"}
                  </button>
                </div>
                <div className="max-h-44 overflow-y-auto border-y border-slate-200">
                  {availableItems.map(item => {
                    const selected = selectedIds.has(item.id)
                    return (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => toggleItem(item.id)}
                        className={`grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 px-2 py-2.5 text-left last:border-b-0 ${selected ? "bg-blue-50/70" : "hover:bg-slate-50"}`}
                      >
                        <span className={`flex h-5 w-5 items-center justify-center border ${selected ? "border-[#1677FF] bg-[#1677FF] text-white" : "border-slate-300 text-transparent"}`}><Check className="h-3 w-3" /></span>
                        <span className="truncate text-xs font-medium text-slate-700">{item.title || item.topic}</span>
                        <span className="text-[11px] text-slate-400">#{item.position}</span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">2. 上传图片</h3>
                <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center border border-dashed border-blue-300 bg-blue-50/40 px-4 text-center transition hover:bg-blue-50">
                  {uploading ? <Loader2 className="h-6 w-6 animate-spin text-[#1677FF]" /> : <Upload className="h-6 w-6 text-[#1677FF]" />}
                  <span className="mt-2 text-xs font-semibold text-slate-700">{uploading ? "正在压缩并上传" : "选择 JPG、PNG 或 WebP 图片"}</span>
                  <span className="mt-1 text-[11px] text-slate-400">单张不超过 12MB，系统自动校正方向并压缩</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading || running} onChange={event => void uploadFiles(event.target.files)} className="sr-only" />
                </label>
                {assets.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {assets.map(asset => (
                      <div key={asset.id} className="relative aspect-square overflow-hidden border border-slate-200 bg-slate-50" title={asset.originalName}>
                        <Image src={`/api/article-generation/assets/${encodeURIComponent(asset.id)}/content`} alt={asset.originalName} fill sizes="120px" unoptimized className="object-cover" />
                        <button type="button" disabled={running} onClick={() => removeAsset(asset.id)} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center bg-white/90 text-slate-600 shadow hover:text-rose-600" title="移出本次配图" aria-label={`移除 ${asset.originalName}`}><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="space-y-6">
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">3. 插入脚本</h3>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                  {TEMPLATE_OPTIONS.map(option => (
                    <button type="button" key={option.value} disabled={running} onClick={() => setTemplate(option.value)} className={`min-h-20 border px-3 py-2 text-left transition ${template === option.value ? "border-[#1677FF] bg-blue-50 ring-1 ring-[#1677FF]" : "border-slate-200 hover:border-blue-300"}`}>
                      <span className="block text-xs font-semibold text-slate-900">{option.label}</span>
                      <span className="mt-1 block text-[11px] leading-4 text-slate-500">{option.detail}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">4. 图片分配</h3>
                <div className="divide-y divide-slate-100 border-y border-slate-200">
                  {MAPPING_OPTIONS.map(option => (
                    <button type="button" key={option.value} disabled={running} onClick={() => setMappingMode(option.value)} className="flex w-full items-start gap-3 px-1 py-3 text-left">
                      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${mappingMode === option.value ? "border-[#1677FF] bg-[#1677FF] text-white" : "border-slate-300 text-transparent"}`}><Check className="h-2.5 w-2.5" /></span>
                      <span><span className="block text-xs font-semibold text-slate-800">{option.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{option.detail}</span></span>
                    </button>
                  ))}
                </div>
              </section>

              {mappingMode === "per_article" && targetItems.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">逐篇指定图片</h3>
                  <select value={activeItemId} onChange={event => setActiveItemId(event.target.value)} className="h-9 w-full border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#1677FF]">
                    {targetItems.map(item => <option key={item.id} value={item.id}>#{item.position} {item.title || item.topic}</option>)}
                  </select>
                  <div className="mt-2 grid grid-cols-5 gap-2">
                    {assets.map(asset => {
                      const selected = (itemAssetMap[activeItemId] || []).includes(asset.id)
                      return (
                        <button type="button" key={asset.id} onClick={() => toggleItemAsset(activeItemId, asset.id)} className={`relative aspect-square overflow-hidden border ${selected ? "border-[#1677FF] ring-2 ring-blue-200" : "border-slate-200"}`} title={asset.originalName}>
                          <Image src={`/api/article-generation/assets/${encodeURIComponent(asset.id)}/content`} alt={asset.originalName} fill sizes="80px" unoptimized className="object-cover" />
                          {selected && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#1677FF] text-white"><Check className="h-2.5 w-2.5" /></span>}
                        </button>
                      )
                    })}
                  </div>
                </section>
              )}
            </div>
          </div>

          {error && <div className="mt-5 border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{error}</div>}
          {job && (
            <div className={`mt-5 border px-4 py-3 ${job.status === "failed" ? "border-rose-200 bg-rose-50" : terminal(job) ? "border-emerald-200 bg-emerald-50" : "border-blue-200 bg-blue-50"}`}>
              <div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-800">{job.stage}</span><span className="text-slate-500">{job.progressPercent}%</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className="h-full bg-gradient-to-r from-[#1677FF] to-[#00B8D9] transition-[width]" style={{ width: `${job.progressPercent}%` }} /></div>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
          <span className="text-xs text-slate-500">已选 {targetItems.length} 篇 · 已上传 {assets.length} 张 · 每篇最多 {selectedTemplate.count} 张</span>
          <div className="flex items-center gap-2">
            {running && <Button type="button" variant="outline" onClick={() => void cancelJob()} className="gap-1.5 border-rose-200 text-rose-600"><Square className="h-3 w-3" />停止配图</Button>}
            {terminal(job) && <Button type="button" variant="outline" onClick={() => setJob(null)} className="gap-1.5"><RotateCcw className="h-3.5 w-3.5" />新建一批</Button>}
            <Button type="button" onClick={() => void startJob()} disabled={submitting || uploading || running} className="gap-1.5 bg-gradient-to-r from-[#1677FF] to-[#00AEEA] text-white">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileImage className="h-4 w-4" />}
              {submitting ? "正在创建" : "开始批量配图"}
            </Button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
