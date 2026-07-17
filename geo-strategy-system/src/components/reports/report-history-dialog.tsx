"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileText,
  History,
  Loader2,
  Radar,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react"
import PenetrationHistoryPanel from "@/components/reports/penetration-history-panel"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import type {
  Client,
  CommercialReportJobRecord,
  CommercialReportJobStatus,
  CommercialReportKind,
} from "@/types"

type Props = {
  clients: Client[]
  activeClientId: string | null
  onExportPenetration: (client: Client) => void
  onClose: () => void
}

const KIND_LABELS: Record<CommercialReportKind, string> = {
  combined: "综合商业报告",
  penetration: "渗透率情报",
  difficulty: "难度测评",
}

const STATUS_META: Record<CommercialReportJobStatus, {
  label: string
  className: string
  icon: typeof Clock3
}> = {
  queued: { label: "排队中", className: "bg-sky-50 text-sky-700 ring-sky-200", icon: Clock3 },
  running: { label: "生成中", className: "bg-blue-50 text-blue-700 ring-blue-200", icon: Loader2 },
  succeeded: { label: "已完成", className: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: CheckCircle2 },
  failed: { label: "失败", className: "bg-rose-50 text-rose-700 ring-rose-200", icon: AlertCircle },
}

const subscribeToClientMount = () => () => undefined
const clientMountedSnapshot = () => true
const serverMountedSnapshot = () => false

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function formatSize(value?: number): string {
  if (!value || value <= 0) return ""
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
}

export default function ReportHistoryDialog({
  clients,
  activeClientId,
  onExportPenetration,
  onClose,
}: Props) {
  const canUseDom = useSyncExternalStore(
    subscribeToClientMount,
    clientMountedSnapshot,
    serverMountedSnapshot,
  )
  const [activeTab, setActiveTab] = useState<"penetration" | "pdf">("penetration")
  const [jobs, setJobs] = useState<CommercialReportJobRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [clientFilter, setClientFilter] = useState("all")
  const [kindFilter, setKindFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [daysFilter, setDaysFilter] = useState("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const requestVersionRef = useRef(0)

  const selectedJob = useMemo(
    () => jobs.find(job => job.id === selectedId) || null,
    [jobs, selectedId],
  )

  const loadJobs = useCallback(async (silent = false) => {
    const requestVersion = ++requestVersionRef.current
    if (!silent) setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      if (clientFilter !== "all") params.set("clientId", clientFilter)
      if (kindFilter !== "all") params.set("kind", kindFilter)
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (daysFilter !== "all") params.set("days", daysFilter)
      const response = await apiFetch(`/api/reports/jobs?${params.toString()}`)
      const data = await readApiJson<{ jobs?: CommercialReportJobRecord[]; error?: string }>(
        response,
        "历史报告",
      )
      if (!response.ok) throw new Error(data.error || "读取历史报告失败")
      if (requestVersion === requestVersionRef.current) setJobs(data.jobs || [])
    } catch (caught) {
      if (requestVersion === requestVersionRef.current) {
        setError(caught instanceof Error ? caught.message : "读取历史报告失败")
      }
    } finally {
      if (!silent && requestVersion === requestVersionRef.current) setLoading(false)
    }
  }, [clientFilter, daysFilter, kindFilter, statusFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadJobs(), 0)
    return () => window.clearTimeout(timer)
  }, [loadJobs])

  useEffect(() => {
    if (!jobs.some(job => job.status === "queued" || job.status === "running")) return
    const timer = window.setInterval(() => void loadJobs(true), 3_000)
    return () => window.clearInterval(timer)
  }, [jobs, loadJobs])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (selectedId) setSelectedId(null)
      else onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose, selectedId])

  useEffect(() => {
    if (!selectedJob?.fileAvailable) return
    const controller = new AbortController()
    let objectUrl = ""
    const timer = window.setTimeout(() => {
      setPreviewLoading(true)
      setError("")
      void (async () => {
        try {
          const response = await apiFetch(`/api/reports/jobs/${selectedJob.id}/view`, {
            signal: controller.signal,
          })
          if (!response.ok) {
            const data = await readApiJson<{ error?: string }>(response, "报告预览")
            throw new Error(data.error || "报告预览失败")
          }
          objectUrl = URL.createObjectURL(await response.blob())
          if (!controller.signal.aborted) setPreviewUrl(objectUrl)
        } catch (caught) {
          if (!controller.signal.aborted) {
            setError(caught instanceof Error ? caught.message : "报告预览失败")
          }
        } finally {
          if (!controller.signal.aborted) setPreviewLoading(false)
        }
      })()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [selectedJob?.fileAvailable, selectedJob?.id])

  async function downloadJob(job: CommercialReportJobRecord) {
    setBusyId(job.id)
    setError("")
    try {
      const response = await apiFetch(`/api/reports/jobs/${job.id}/download`)
      if (!response.ok) {
        const data = await readApiJson<{ error?: string }>(response, "报告下载")
        throw new Error(data.error || "报告下载失败")
      }
      saveBlob(await response.blob(), job.fileName || "GEO-专业报告.pdf")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "报告下载失败")
    } finally {
      setBusyId(null)
    }
  }

  async function deleteJob(job: CommercialReportJobRecord) {
    if (!window.confirm(`确认删除“${job.fileName || KIND_LABELS[job.kind]}”吗？删除后无法恢复。`)) return
    setBusyId(job.id)
    setError("")
    try {
      const response = await apiFetch(`/api/reports/jobs/${job.id}`, { method: "DELETE" })
      const data = await readApiJson<{ ok?: boolean; error?: string }>(response, "删除报告")
      if (!response.ok) throw new Error(data.error || "删除报告失败")
      setJobs(current => current.filter(item => item.id !== job.id))
      if (selectedId === job.id) setSelectedId(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除报告失败")
    } finally {
      setBusyId(null)
    }
  }

  const dialog = (
    <div
      className="no-print fixed inset-0 z-[9999] bg-[#00133F]/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-history-title"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="ml-auto flex h-full w-full max-w-6xl flex-col bg-white shadow-[-24px_0_70px_-34px_rgba(0,29,102,0.72)]">
        <header className="shrink-0 bg-gradient-to-r from-[#003EB3] via-[#1677FF] to-[#00AEEA] px-4 py-4 text-white sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {selectedJob ? (
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="rounded-lg p-2 text-white/80 transition hover:bg-white/15 hover:text-white"
                  aria-label="返回历史报告列表"
                  title="返回列表"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
                  <History className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0">
                <h2 id="report-history-title" className="geo-display-title truncate text-xl">
                  {selectedJob ? "报告在线预览" : "历史报告中心"}
                </h2>
                <p className="mt-1 truncate text-xs text-cyan-50/75">
                  {selectedJob
                    ? selectedJob.fileName || KIND_LABELS[selectedJob.kind]
                    : "自动检测快照与专业 PDF 分开保存，换设备登录仍可查看"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {selectedJob?.fileAvailable ? (
                <button
                  type="button"
                  onClick={() => void downloadJob(selectedJob)}
                  disabled={busyId === selectedJob.id}
                  className="rounded-lg p-2 text-white/80 transition hover:bg-white/15 hover:text-white disabled:opacity-50"
                  aria-label="下载当前报告"
                  title="下载报告"
                >
                  <Download className="h-5 w-5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-white/80 transition hover:bg-white/15 hover:text-white"
                aria-label="关闭历史报告"
                title="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        {!selectedJob ? (
          <div className="grid shrink-0 grid-cols-2 border-b border-slate-200 bg-white px-4 pt-2 sm:px-6">
            <button
              type="button"
              onClick={() => setActiveTab("penetration")}
              className={`inline-flex h-11 items-center justify-center gap-2 border-b-2 text-xs font-semibold transition ${
                activeTab === "penetration"
                  ? "border-[#1677FF] text-[#0958D9]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Radar className="h-4 w-4" />
              检测记录
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("pdf")}
              className={`inline-flex h-11 items-center justify-center gap-2 border-b-2 text-xs font-semibold transition ${
                activeTab === "pdf"
                  ? "border-[#1677FF] text-[#0958D9]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <FileText className="h-4 w-4" />
              专业 PDF
            </button>
          </div>
        ) : null}

        {(activeTab === "pdf" || selectedJob) && error ? (
          <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-700 sm:px-6">
            {error}
          </div>
        ) : null}

        {selectedJob ? (
          <div className="min-h-0 flex-1 bg-slate-100 p-2 sm:p-4">
            {previewLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#1677FF]" />
                正在载入 PDF 预览
              </div>
            ) : previewUrl ? (
              <iframe
                title={selectedJob.fileName || "专业报告预览"}
                src={previewUrl}
                className="h-full w-full border-0 bg-white shadow-sm"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <FileText className="h-10 w-10 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-700">当前报告暂不可预览</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">报告可能仍在生成、生成失败，或文件已超过保留期限。</p>
              </div>
            )}
          </div>
        ) : activeTab === "penetration" ? (
          <PenetrationHistoryPanel
            clients={clients}
            activeClientId={activeClientId}
            onExportPenetration={onExportPenetration}
          />
        ) : (
          <>
            <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <select
                  aria-label="筛选客户"
                  value={clientFilter}
                  onChange={event => setClientFilter(event.target.value)}
                  className="col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#1677FF] sm:col-span-1"
                >
                  <option value="all">全部客户</option>
                  {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
                <select
                  aria-label="筛选报告类型"
                  value={kindFilter}
                  onChange={event => setKindFilter(event.target.value)}
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#1677FF]"
                >
                  <option value="all">全部类型</option>
                  <option value="combined">综合报告</option>
                  <option value="penetration">渗透率</option>
                  <option value="difficulty">难度测评</option>
                </select>
                <select
                  aria-label="筛选报告状态"
                  value={statusFilter}
                  onChange={event => setStatusFilter(event.target.value)}
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#1677FF]"
                >
                  <option value="all">全部状态</option>
                  <option value="succeeded">已完成</option>
                  <option value="running">生成中</option>
                  <option value="queued">排队中</option>
                  <option value="failed">失败</option>
                </select>
                <select
                  aria-label="筛选报告时间"
                  value={daysFilter}
                  onChange={event => setDaysFilter(event.target.value)}
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#1677FF]"
                >
                  <option value="all">全部时间</option>
                  <option value="30">近 30 天</option>
                  <option value="90">近 90 天</option>
                  <option value="365">近一年</option>
                </select>
                <button
                  type="button"
                  onClick={() => void loadJobs()}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:border-sky-200 hover:bg-sky-50 hover:text-[#1677FF]"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                  刷新
                </button>
              </div>
              {activeClientId ? (
                <button
                  type="button"
                  onClick={() => setClientFilter(activeClientId)}
                  className="mt-2 text-[11px] font-medium text-[#1677FF] hover:text-[#0050B3]"
                >
                  只看当前客户
                </button>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {loading ? (
                <div className="flex min-h-64 items-center justify-center text-sm text-slate-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#1677FF]" />
                  正在读取历史报告
                </div>
              ) : jobs.length === 0 ? (
                <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
                  <History className="h-10 w-10 text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-700">暂无符合条件的报告</p>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">生成专业报告后会自动保存在这里，不需要再次整理页面数据。</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {jobs.map(job => {
                    const status = STATUS_META[job.status]
                    const StatusIcon = status.icon
                    const isActive = job.status === "queued" || job.status === "running"
                    const clientName = job.clientName
                      || clients.find(client => client.id === job.clientId)?.name
                      || "历史客户"
                    return (
                      <article key={job.id} className="px-4 py-4 transition hover:bg-sky-50/45 sm:px-6">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white shadow-sm">
                            <FileText className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h3 className="truncate text-sm font-semibold text-slate-900">
                                  {job.fileName || `${clientName}-${KIND_LABELS[job.kind]}`}
                                </h3>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                                  <span>{clientName}</span>
                                  <span>·</span>
                                  <span>{KIND_LABELS[job.kind]}</span>
                                  <span>·</span>
                                  <span>{job.detail === "full" ? "完整版" : "精简版"}</span>
                                  {formatSize(job.fileSize) ? <><span>·</span><span>{formatSize(job.fileSize)}</span></> : null}
                                </div>
                              </div>
                              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ring-inset ${status.className}`}>
                                <StatusIcon className={`h-3 w-3 ${isActive ? "animate-spin" : ""}`} />
                                {status.label}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                              <div className="text-[11px] text-slate-400">
                                {formatDate(job.createdAt)} · {job.publisherName || "势途 GEO"}
                                {isActive ? ` · ${job.stage} ${job.progress}%` : ""}
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPreviewUrl("")
                                    setSelectedId(job.id)
                                  }}
                                  disabled={!job.fileAvailable}
                                  className="rounded-md p-2 text-slate-500 transition hover:bg-white hover:text-[#1677FF] disabled:cursor-not-allowed disabled:opacity-30"
                                  aria-label={`预览 ${job.fileName || "报告"}`}
                                  title={job.fileAvailable ? "在线预览" : "报告暂不可预览"}
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void downloadJob(job)}
                                  disabled={!job.fileAvailable || busyId === job.id}
                                  className="rounded-md p-2 text-slate-500 transition hover:bg-white hover:text-[#1677FF] disabled:cursor-not-allowed disabled:opacity-30"
                                  aria-label={`下载 ${job.fileName || "报告"}`}
                                  title="下载报告"
                                >
                                  {busyId === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteJob(job)}
                                  disabled={isActive || busyId === job.id}
                                  className="rounded-md p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30"
                                  aria-label={`删除 ${job.fileName || "报告"}`}
                                  title={isActive ? "生成完成后才能删除" : "删除报告"}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )

  if (!canUseDom) return null
  return createPortal(dialog, document.body)
}
