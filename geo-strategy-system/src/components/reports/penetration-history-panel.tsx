"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  ExternalLink,
  FileDown,
  History,
  Loader2,
  MessageSquareText,
  RefreshCw,
  RotateCw,
  Search,
  Trash2,
} from "lucide-react"
import BrandShareOfVoice from "@/components/dashboard/brand-share-of-voice"
import KeywordCompetition from "@/components/dashboard/keyword-competition"
import ModelAvatar from "@/components/model-avatar"
import BrandRankingCard from "@/components/penetration/brand-ranking-card"
import IndustryShareChart from "@/components/penetration/industry-share-chart"
import ModelRateTrend from "@/components/penetration/model-rate-trend"
import PenetrationDonut from "@/components/penetration/penetration-donut"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { MODEL_LABELS } from "@/lib/model-labels"
import { normalizeAnalysisSubjectType } from "@/lib/analysis-subject"
import type {
  Client,
  ModelKey,
  PenetrationHistoryListItem,
  PenetrationHistoryListPage,
  PenetrationHistoryRecord,
  PenetrationHistoryStatus,
  PenetrationByModel,
  PenetrationItem,
} from "@/types"

type Props = {
  clients: Client[]
  activeClientId: string | null
  onExportPenetration: (client: Client) => void
}

const STATUS_META: Record<PenetrationHistoryStatus, {
  label: string
  className: string
  icon: typeof CheckCircle2
}> = {
  succeeded: {
    label: "完整完成",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    icon: CheckCircle2,
  },
  partial: {
    label: "部分完成",
    className: "bg-amber-50 text-amber-700 ring-amber-200",
    icon: AlertCircle,
  },
  cancelled: {
    label: "已停止",
    className: "bg-slate-100 text-slate-600 ring-slate-200",
    icon: CircleStop,
  },
  failed: {
    label: "执行失败",
    className: "bg-rose-50 text-rose-700 ring-rose-200",
    icon: AlertCircle,
  },
}

function formatDate(value?: string): string {
  if (!value) return "-"
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

function percent(value: number | null): string {
  return value == null ? "-" : `${(value * 100).toFixed(1)}%`
}

function historyClient(record: PenetrationHistoryRecord): Client {
  return {
    id: record.request.clientId,
    name: record.request.clientName || record.clientName,
    subjectType: record.request.subjectType || "brand",
    personProfile: record.request.personProfile,
    ourBrand: record.request.ourBrand,
    brandAliases: record.request.brandAliases,
    industry: record.request.industry,
    website: record.request.website,
    questions: record.request.questions,
    competitors: record.request.competitors,
    selectedModels: record.request.models,
    createdAt: record.createdAt,
    updatedAt: record.completedAt || record.updatedAt,
    penetration: record.result,
  }
}

export default function PenetrationHistoryPanel({
  clients,
  activeClientId,
  onExportPenetration,
}: Props) {
  const [pageData, setPageData] = useState<PenetrationHistoryListPage>({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    hasMore: false,
  })
  const [page, setPage] = useState(1)
  const [clientFilter, setClientFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [operationFilter, setOperationFilter] = useState("all")
  const [daysFilter, setDaysFilter] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PenetrationHistoryRecord | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const requestVersionRef = useRef(0)

  const loadHistory = useCallback(async (silent = false) => {
    const version = ++requestVersionRef.current
    if (!silent) setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      })
      if (clientFilter !== "all") params.set("clientId", clientFilter)
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (operationFilter !== "all") params.set("operation", operationFilter)
      if (daysFilter !== "all") params.set("days", daysFilter)
      const response = await apiFetch(`/api/penetration/history?${params.toString()}`)
      const data = await readApiJson<PenetrationHistoryListPage & { error?: string }>(
        response,
        "检测历史",
      )
      if (!response.ok) throw new Error(data.error || "读取检测历史失败")
      if (version === requestVersionRef.current) setPageData(data)
    } catch (caught) {
      if (version === requestVersionRef.current) {
        setError(caught instanceof Error ? caught.message : "读取检测历史失败")
      }
    } finally {
      if (!silent && version === requestVersionRef.current) setLoading(false)
    }
  }, [clientFilter, daysFilter, operationFilter, page, statusFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadHistory(), 0)
    return () => window.clearTimeout(timer)
  }, [loadHistory])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setDetailLoading(true)
      setError("")
      void (async () => {
        try {
          const response = await apiFetch(`/api/penetration/history/${selectedId}`, {
            cache: "no-store",
            signal: controller.signal,
          })
          const data = await readApiJson<PenetrationHistoryRecord & { error?: string }>(
            response,
            "检测历史详情",
          )
          if (!response.ok) throw new Error(data.error || "读取检测历史详情失败")
          if (!controller.signal.aborted) setDetail(data)
        } catch (caught) {
          if (!controller.signal.aborted) {
            setError(caught instanceof Error ? caught.message : "读取检测历史详情失败")
          }
        } finally {
          if (!controller.signal.aborted) setDetailLoading(false)
        }
      })()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [selectedId])

  function resetPage() {
    setPage(1)
  }

  async function deleteRecord(record: PenetrationHistoryListItem | PenetrationHistoryRecord) {
    if (!window.confirm(`确认删除 ${formatDate(record.completedAt || record.createdAt)} 的检测记录吗？删除后无法恢复。`)) return
    setBusyId(record.id)
    setError("")
    try {
      const response = await apiFetch(`/api/penetration/history/${record.id}`, {
        method: "DELETE",
      })
      const data = await readApiJson<{ ok?: boolean; error?: string }>(response, "删除检测历史")
      if (!response.ok) throw new Error(data.error || "删除检测历史失败")
      if (selectedId === record.id) {
        setSelectedId(null)
        setDetail(null)
      }
      await loadHistory(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除检测历史失败")
    } finally {
      setBusyId(null)
    }
  }

  if (selectedId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-[#F4F8FD]">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => {
              setSelectedId(null)
              setDetail(null)
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-sky-200 hover:bg-sky-50 hover:text-[#1677FF]"
          >
            <ArrowLeft className="h-4 w-4" />
            返回记录列表
          </button>
          {detail ? (
            <div className="flex items-center gap-2">
              {detail.result ? (
                <button
                  type="button"
                  onClick={() => onExportPenetration(historyClient(detail))}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 text-xs font-semibold text-white shadow-sm transition hover:brightness-105"
                >
                  <FileDown className="h-4 w-4" />
                  生成专业报告
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void deleteRecord(detail)}
                disabled={busyId === detail.id}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                aria-label="删除检测记录"
                title="删除检测记录"
              >
                {busyId === detail.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-700 sm:px-6">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {detailLoading || !detail ? (
            <div className="flex min-h-72 items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#1677FF]" />
              正在载入当次检测快照
            </div>
          ) : (
            <HistoryDetail record={detail} />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <select
            aria-label="筛选客户"
            value={clientFilter}
            onChange={event => {
              setClientFilter(event.target.value)
              resetPage()
            }}
            className="col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#1677FF] sm:col-span-1"
          >
            <option value="all">全部客户</option>
            {clients.map(client => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
          <select
            aria-label="筛选检测状态"
            value={statusFilter}
            onChange={event => {
              setStatusFilter(event.target.value)
              resetPage()
            }}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#1677FF]"
          >
            <option value="all">全部状态</option>
            <option value="succeeded">完整完成</option>
            <option value="partial">部分完成</option>
            <option value="cancelled">已停止</option>
            <option value="failed">执行失败</option>
          </select>
          <select
            aria-label="筛选检测类型"
            value={operationFilter}
            onChange={event => {
              setOperationFilter(event.target.value)
              resetPage()
            }}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#1677FF]"
          >
            <option value="all">全部检测类型</option>
            <option value="replace">完整检测</option>
            <option value="append">单题重测</option>
          </select>
          <select
            aria-label="筛选检测时间"
            value={daysFilter}
            onChange={event => {
              setDaysFilter(event.target.value)
              resetPage()
            }}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#1677FF]"
          >
            <option value="all">全部时间</option>
            <option value="30">近 30 天</option>
            <option value="90">近 90 天</option>
            <option value="365">近一年</option>
          </select>
          <button
            type="button"
            onClick={() => void loadHistory()}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:border-sky-200 hover:bg-sky-50 hover:text-[#1677FF]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          {activeClientId ? (
            <button
              type="button"
              onClick={() => {
                setClientFilter(activeClientId)
                resetPage()
              }}
              className="text-[11px] font-medium text-[#1677FF] hover:text-[#0050B3]"
            >
              只看当前客户
            </button>
          ) : <span />}
          <span className="text-[11px] text-slate-400">共 {pageData.total} 次检测记录</span>
        </div>
      </div>

      {error ? (
        <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-700 sm:px-6">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <div className="flex min-h-64 items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#1677FF]" />
            正在读取检测历史
          </div>
        ) : pageData.items.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
            <History className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">暂无符合条件的检测记录</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
              后续每次渗透率检测结束都会自动保存，换设备登录同一账号也能查看。
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {pageData.items.map(record => (
              <HistoryRow
                key={record.id}
                record={record}
                busy={busyId === record.id}
                onOpen={() => {
                  setDetail(null)
                  setSelectedId(record.id)
                }}
                onDelete={() => void deleteRecord(record)}
              />
            ))}
          </div>
        )}
      </div>

      {pageData.total > pageData.pageSize ? (
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 sm:px-6">
          <span>第 {pageData.page} / {Math.ceil(pageData.total / pageData.pageSize)} 页</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(current => Math.max(1, current - 1))}
              disabled={pageData.page <= 1}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 transition hover:bg-sky-50 hover:text-[#1677FF] disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="上一页"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setPage(current => current + 1)}
              disabled={!pageData.hasMore}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 transition hover:bg-sky-50 hover:text-[#1677FF] disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="下一页"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function HistoryRow({
  record,
  busy,
  onOpen,
  onDelete,
}: {
  record: PenetrationHistoryListItem
  busy: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const status = STATUS_META[record.status]
  const subjectType = normalizeAnalysisSubjectType(record.summary.subjectType)
  const StatusIcon = status.icon
  return (
    <article className="group px-4 py-4 transition hover:bg-sky-50/45 sm:px-6">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white shadow-sm transition group-hover:scale-[1.03]"
          aria-label="查看检测记录"
        >
          <Search className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <button type="button" onClick={onOpen} className="min-w-0 text-left">
              <h3 className="truncate text-sm font-semibold text-slate-900">
                {record.clientName} · {record.summary.ourBrand || (
                  subjectType === "person" ? "未填写人物姓名" : "未填写品牌"
                )}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                <span>{record.summary.industry || "未填写行业"}</span>
                <span>·</span>
                <span>{record.operation === "append" ? "单题重测" : "完整检测"}</span>
                {record.source === "workspace_backfill" ? <><span>·</span><span>历史数据补录</span></> : null}
              </div>
            </button>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ring-inset ${status.className}`}>
              <StatusIcon className="h-3 w-3" />
              {status.label}
            </span>
          </div>
          <button
            type="button"
            onClick={onOpen}
            className="mt-3 grid w-full grid-cols-2 gap-2 text-left sm:grid-cols-4"
          >
            <SummaryCell
              label={subjectType === "person" ? "个人 IP 可见率" : "渗透率"}
              value={percent(record.summary.penetrationRate)}
            />
            <SummaryCell label="有效采样" value={`${record.summary.completedSlots}/${record.summary.totalSlots}`} />
            <SummaryCell label="问题 / 模型" value={`${record.summary.questionCount} / ${record.summary.modelCount}`} />
            <SummaryCell label="信源链接" value={`${record.summary.sourceCount}`} />
          </button>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatDate(record.completedAt || record.createdAt)}
            </span>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="rounded-md p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
              aria-label="删除检测记录"
              title="删除检测记录"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-slate-100 bg-slate-50/80 px-2.5 py-2">
      <span className="block text-[10px] text-slate-400">{label}</span>
      <span className="mt-0.5 block text-xs font-semibold tabular-nums text-slate-700">{value}</span>
    </span>
  )
}

function HistoryDetail({ record }: { record: PenetrationHistoryRecord }) {
  const result = record.result
  const subjectType = normalizeAnalysisSubjectType(record.request.subjectType)
  const status = STATUS_META[record.status]
  const StatusIcon = status.icon

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-3 py-4 sm:px-6 sm:py-6">
      <section className="overflow-hidden rounded-lg border border-sky-100 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-[#001D66] via-[#003EB3] to-[#00AEEA] px-4 py-4 text-white sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold text-cyan-100/70">
                {subjectType === "person" ? "个人 IP 检测历史快照" : "渗透率检测历史快照"}
              </div>
              <h3 className="mt-1 text-lg font-semibold">{record.clientName}</h3>
              <p className="mt-1 text-xs text-cyan-50/75">
                {record.request.ourBrand || (subjectType === "person" ? "未填写人物姓名" : "未填写品牌")} · {record.request.industry || "未填写行业"}
              </p>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1.5 text-[11px] font-semibold ring-1 ring-inset ${status.className}`}>
              <StatusIcon className="h-3.5 w-3.5" />
              {status.label}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0">
          <SnapshotMeta label="完成时间" value={formatDate(record.completedAt || record.createdAt)} />
          <SnapshotMeta label="检测类型" value={record.operation === "append" ? "单题重测" : "完整检测"} />
          <SnapshotMeta label="有效采样" value={`${record.summary.completedSlots}/${record.summary.totalSlots}`} />
          <SnapshotMeta label="联网信源" value={`${record.summary.sourceCount} 个链接`} />
        </div>
        {record.error ? (
          <div className="border-t border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 sm:px-5">
            {record.error}
          </div>
        ) : null}
      </section>

      <RequestSnapshot record={record} />

      {!result ? (
        <section className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 text-center">
          <AlertCircle className="h-10 w-10 text-rose-300" />
          <h4 className="mt-3 text-sm font-semibold text-slate-700">本次任务没有形成可展示的检测结果</h4>
          <p className="mt-1 max-w-lg text-xs leading-5 text-slate-500">
            失败原因和当时的输入已经保存，可用于排查；未完成的模型槽位不会进入渗透率统计。
          </p>
        </section>
      ) : (
        <>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-1 text-[11px] font-semibold text-[#1677FF]">
                {subjectType === "person" ? "个人 IP 可见率" : "渗透率"}
              </div>
              <PenetrationDonut
                rate={result.aggregated.penetrationRate}
                mentions={result.aggregated.ourMentions}
                totalSlots={result.aggregated.totalSlots}
              />
            </section>
            <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <BrandRankingCard
                ranking={result.aggregated.ourRanking}
                totalBrands={result.aggregated.industryShare.length}
                perModelRate={result.aggregated.perModelRate}
                topCompetitors={result.aggregated.topCompetitors}
                subjectType={subjectType}
              />
            </section>
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <section className="flex min-h-[380px] min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 text-[11px] font-semibold text-[#1677FF]">
                {subjectType === "person" ? "同行人物可见度" : "全品牌渗透率"} Top {Math.min(10, result.aggregated.industryShare.length)}
              </div>
              <div className="min-h-0 flex-1">
                <IndustryShareChart
                  compact
                  items={result.aggregated.industryShare.slice(0, 10)}
                  ourBrand={record.request.ourBrand}
                  totalSlots={result.aggregated.totalSlots}
                  subjectType={subjectType}
                />
              </div>
            </section>
            <section className="flex min-h-[380px] min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 text-[11px] font-semibold text-[#1677FF]">各模型渗透率对比</div>
              <div className="min-h-0 flex-1">
                <ModelRateTrend
                  compact
                  perModelRate={result.aggregated.perModelRate}
                  overallRate={result.aggregated.penetrationRate}
                />
              </div>
            </section>
          </div>

          {subjectType === "person" && (result.aggregated.institutionShare?.length || 0) > 0 ? (
            <section className="flex min-h-[380px] min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 text-[11px] font-semibold text-[#1677FF]">
                关联机构提及 Top {Math.min(10, result.aggregated.institutionShare?.length || 0)}
              </div>
              <div className="min-h-0 flex-1">
                <IndustryShareChart
                  compact
                  items={(result.aggregated.institutionShare || []).slice(0, 10)}
                  ourBrand=""
                  totalSlots={result.aggregated.totalSlots}
                  subjectType="person"
                  entityLabel="关联机构"
                  highlightTarget={false}
                />
              </div>
            </section>
          ) : null}

          <section className="min-w-0">
            <BrandShareOfVoice
              items={record.dashboard.brandVoice}
              defaultVisible={8}
              subjectType={subjectType}
            />
          </section>

          <section className="min-w-0">
            <KeywordCompetition
              items={record.dashboard.keywordCompetition}
              subjectType={subjectType}
            />
          </section>

          {result.aggregated.missedQuestions.length > 0 ? (
            <section className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-4">
              <h4 className="text-xs font-semibold text-amber-900">
                未被任一模型提及的问题（{result.aggregated.missedQuestions.length}）
              </h4>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-5 text-amber-900/85">
                {result.aggregated.missedQuestions.map(question => <li key={question}>{question}</li>)}
              </ol>
            </section>
          ) : null}

          <HistoryRawAnswers byModel={result.byModel} />
        </>
      )}
    </div>
  )
}

function SnapshotMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="mt-1 break-words text-xs font-semibold text-slate-700">{value}</div>
    </div>
  )
}

function RequestSnapshot({ record }: { record: PenetrationHistoryRecord }) {
  const [open, setOpen] = useState(false)
  const subjectType = normalizeAnalysisSubjectType(record.request.subjectType)
  const profile = record.request.personProfile
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-sky-50/50 sm:px-5"
      >
        <span>
          <span className="block text-sm font-semibold text-slate-800">当次检测输入</span>
          <span className="mt-0.5 block text-[11px] text-slate-500">
            {record.request.questions.length} 个问题 · {record.request.models.length} 个模型 · 输入按当时状态冻结
          </span>
        </span>
        <RotateCw className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open ? (
        <div className="grid gap-4 border-t border-slate-100 bg-slate-50/50 px-4 py-4 text-xs sm:grid-cols-2 sm:px-5">
          <SnapshotField
            label={subjectType === "person" ? "人物姓名" : "品牌名称"}
            value={record.request.ourBrand || "-"}
          />
          <SnapshotField label="行业" value={record.request.industry || "-"} />
          <SnapshotField
            label={subjectType === "person" ? "姓名别名" : "品牌别名"}
            value={record.request.brandAliases.join("、") || "-"}
          />
          <SnapshotField
            label={subjectType === "person" ? "已知同行人物" : "竞品"}
            value={record.request.competitors.join("、") || "-"}
          />
          {subjectType === "person" ? (
            <>
              <SnapshotField label="职业 / 身份" value={profile?.profession || "-"} />
              <SnapshotField label="所属机构" value={profile?.organization || "-"} />
              <SnapshotField label="职称 / 公开身份" value={profile?.title || "-"} />
              <SnapshotField label="主要地区" value={profile?.region || "-"} />
              <SnapshotField label="专业方向" value={profile?.specialties.join("、") || "-"} />
              <SnapshotField label="资质" value={profile?.credentials.join("、") || "-"} />
            </>
          ) : null}
          <SnapshotField
            label="选择的模型"
            value={record.request.models.map(model => MODEL_LABELS[model]).join("、") || "-"}
          />
          <SnapshotField
            label="实际执行模型"
            value={(record.request.activeModels || record.request.models)
              .map(model => MODEL_LABELS[model])
              .join("、") || "-"}
          />
          <SnapshotField label="官网" value={record.request.website || "-"} />
          {(record.request.skippedModels || []).length > 0 ? (
            <SnapshotField label="未进入检测" value={record.request.skippedModels.join("、")} />
          ) : null}
          <div className="sm:col-span-2">
            <div className="text-[10px] font-semibold text-slate-400">疑问句</div>
            <ol className="mt-2 max-h-64 list-decimal space-y-1.5 overflow-y-auto pl-5 leading-5 text-slate-700">
              {record.request.questions.map((question, index) => (
                <li key={`${index}-${question}`}>{question}</li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function SnapshotField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-slate-400">{label}</div>
      <div className="mt-1 break-words leading-5 text-slate-700">{value}</div>
    </div>
  )
}

function HistoryRawAnswers({
  byModel,
}: {
  byModel: PenetrationByModel
}) {
  const models = useMemo(
    () => (Object.keys(byModel) as ModelKey[]).filter(model => Boolean(byModel[model]?.length)),
    [byModel],
  )
  const [activeModel, setActiveModel] = useState<ModelKey | null>(models[0] || null)
  const currentModel = activeModel && models.includes(activeModel) ? activeModel : models[0]
  const items = currentModel ? byModel[currentModel] || [] : []

  if (!currentModel || models.length === 0) return null

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white">
            <MessageSquareText className="h-4 w-4" />
          </span>
          <div>
            <h4 className="text-sm font-semibold text-slate-800">原始联网回答与全部信源</h4>
            <p className="mt-0.5 text-[11px] text-slate-500">保留本次独立请求返回的原文、来源网址和审计信息</p>
          </div>
        </div>
        <span className="text-[11px] text-slate-400">{items.length} 条回答</span>
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
        {models.map(model => (
          <button
            key={model}
            type="button"
            onClick={() => setActiveModel(model)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition ${
              currentModel === model
                ? "bg-[#1677FF] text-white shadow-sm"
                : "border border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:text-[#1677FF]"
            }`}
          >
            <ModelAvatar model={model} size="xs" />
            {MODEL_LABELS[model]} · {byModel[model]?.length || 0}
          </button>
        ))}
      </div>
      <div className="divide-y divide-slate-100">
        {items.map((item, index) => (
          <HistoryAnswerItem
            key={item.sampleId || `${currentModel}-${index}`}
            item={item}
            index={index}
          />
        ))}
      </div>
    </section>
  )
}

function HistoryAnswerItem({ item, index }: { item: PenetrationItem; index: number }) {
  const uniqueSources = useMemo(() => {
    const seen = new Set<string>()
    return (item.searchSources || []).filter(source => {
      if (!source.url || seen.has(source.url)) return false
      seen.add(source.url)
      return true
    })
  }, [item.searchSources])

  return (
    <details
      className="group px-4 py-3 open:bg-sky-50/25 sm:px-5"
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 160px" }}
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 text-xs text-slate-700">
        <span className="mt-0.5 shrink-0 font-mono text-[10px] text-slate-400">
          Q{String(index + 1).padStart(2, "0")}
        </span>
        <span className="min-w-0 flex-1 font-medium leading-5">{item.question}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          item.hitOur ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
        }`}>
          {item.hitOur ? "命中" : "未命中"}
        </span>
      </summary>
      <div className="mt-3 pl-5">
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-blue-700">
            {searchModeLabel(item.searchMode)}
          </span>
          <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-slate-600">
            {item.promptPurity === "raw_question_only" ? "纯问题盲测" : "带搜索工具信息"}
          </span>
          <span className="rounded border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
            信源 {uniqueSources.length}
          </span>
          {item.sampledAt ? (
            <span className="px-1.5 py-0.5 text-slate-400">{formatDate(item.sampledAt)}</span>
          ) : null}
        </div>
        <div className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-slate-600">
          {item.answer || "本次没有返回回答原文。"}
        </div>
        {item.mentionedBrands.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.mentionedBrands.map(brand => (
              <span key={brand} className="rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-600">
                {brand}
              </span>
            ))}
          </div>
        ) : null}
        {item.webFailureReason ? (
          <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-2.5 py-2 text-[10px] leading-5 text-amber-700">
            {item.webFailureReason}
          </div>
        ) : null}
        {uniqueSources.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            <div className="text-[10px] font-semibold text-slate-500">全部具体信源网址</div>
            {uniqueSources.map((source, sourceIndex) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-start gap-1.5 rounded-md border border-slate-100 bg-white px-2.5 py-2 text-[10px] text-slate-500 transition hover:border-sky-200 hover:text-[#1677FF]"
              >
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="shrink-0 font-mono text-slate-400">#{sourceIndex + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-700">{source.title || source.domain || "查看来源"}</span>
                  <span className="mt-0.5 block break-all font-mono text-slate-400">{source.url}</span>
                </span>
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  )
}

function searchModeLabel(mode: PenetrationItem["searchMode"]): string {
  if (mode === "native_web") return "官方联网"
  if (mode === "local_tool_search") return "搜索工具联网"
  if (mode === "presearch_context") return "预搜索增强"
  return "联网状态未记录"
}
