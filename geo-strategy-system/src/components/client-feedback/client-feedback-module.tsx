"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileBarChart2,
  FileDown,
  FileSearch2,
  FileUp,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  X,
} from "lucide-react"
import BatchEvidenceImportDialog from "@/components/client-feedback/batch-evidence-import-dialog"
import ClientFeedbackReportView from "@/components/client-feedback/client-feedback-report-view"
import FeedbackAutomationPanel from "@/components/client-feedback/feedback-automation-panel"
import PublishingPlanPanel from "@/components/client-feedback/publishing-plan-panel"
import type { Client } from "@/types"
import {
  groupClientExecutionActions,
  type ClientExecutionActionGroup,
} from "@/lib/client-feedback/action-groups"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type {
  ClientExecutionAction,
  ClientExecutionProfile,
  ClientExecutionActionPublication,
  ClientExecutionPublicationPolicy,
  ClientExecutionStage,
  ClientEvidenceImportResult,
  ClientFeedbackMetricOption,
  ClientFeedbackPeriod,
  ClientFeedbackReport,
  ClientFeedbackReportOptions,
  ClientFeedbackReportType,
} from "@/types/client-feedback"

type Payload = {
  accessMode: "standard" | "client"
  canManage: boolean
  canManageVisibility: boolean
  publicationPolicy?: ClientExecutionPublicationPolicy
  profile: ClientExecutionProfile
  counters: {
    executionDay: number
    serviceWeek: number
    serviceMonth: number
  }
  currentWeek: ClientFeedbackPeriod
  currentMonth: ClientFeedbackPeriod
  actions: ClientExecutionAction[]
  reports: ClientFeedbackReport[]
}

const PUBLICATION_META: Record<ClientExecutionActionPublication, {
  label: string
  className: string
}> = {
  internal: {
    label: "仅内部",
    className: "bg-slate-100 text-slate-600",
  },
  summary: {
    label: "只展示动作",
    className: "bg-amber-50 text-amber-700",
  },
  full: {
    label: "动作和报告",
    className: "bg-emerald-50 text-emerald-700",
  },
}

const STAGE_OPTIONS: Array<{ value: ClientExecutionStage; label: string }> = [
  { value: "baseline", label: "基线建档" },
  { value: "foundation", label: "基础建设" },
  { value: "initial_mention", label: "首次提及" },
  { value: "coverage_growth", label: "覆盖增长" },
  { value: "stable_mention", label: "稳定提及" },
  { value: "continuous_optimization", label: "持续优化" },
]

const CATEGORY_OPTIONS: Array<{ value: ClientExecutionAction["category"]; label: string }> = [
  { value: "content_production", label: "内容生产" },
  { value: "self_media_publish", label: "自媒体发布" },
  { value: "authority_media_publish", label: "权威媒体发布" },
  { value: "video_publish", label: "视频发布" },
  { value: "website_optimization", label: "网站优化" },
  { value: "strategy_adjustment", label: "策略调整" },
  { value: "client_communication", label: "客户沟通" },
  { value: "other", label: "其他动作" },
]

const CATEGORY_LABELS = Object.fromEntries(CATEGORY_OPTIONS.map(item => [item.value, item.label])) as Record<string, string>
CATEGORY_LABELS.penetration_check = "疑问句检测"

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function dateOnly(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function metricPercent(value: number | null | undefined): string {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "暂无"
}

function metricOptionLabel(item: ClientFeedbackMetricOption): string {
  const status = item.status === "partial" ? "部分完成" : "完整完成"
  return `${formatTime(item.completedAt)} · 渗透率 ${metricPercent(item.penetrationRate)} · ${item.questionCount} 问题 / ${item.modelCount} 模型 · ${status}`
}

function monthLabel(month: string): string {
  const [year, value] = month.split("-")
  return `${year} 年 ${Number(value)} 月`
}

function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split("-").map(Number)
  const date = new Date(Date.UTC(year, value - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

function calendarCells(month: string): Array<string | null> {
  const [year, value] = month.split("-").map(Number)
  const first = new Date(Date.UTC(year, value - 1, 1))
  const leading = (first.getUTCDay() + 6) % 7
  const count = new Date(Date.UTC(year, value, 0)).getUTCDate()
  const cells: Array<string | null> = Array.from({ length: leading }, () => null)
  for (let day = 1; day <= count; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`)
  }
  while (cells.length % 7) cells.push(null)
  return cells
}

export default function ClientFeedbackModule({ client }: { client: Client }) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [profileDraft, setProfileDraft] = useState<ClientExecutionProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [actionOpen, setActionOpen] = useState(false)
  const [batchImportOpen, setBatchImportOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(today().slice(0, 7))
  const [selectedDate, setSelectedDate] = useState(today())
  const [reportTargetDate, setReportTargetDate] = useState(today())
  const [reportDialogType, setReportDialogType] = useState<ClientFeedbackReportType | null>(null)
  const [reportDialogSource, setReportDialogSource] = useState<ClientFeedbackReport | null>(null)
  const [reportOptions, setReportOptions] = useState<ClientFeedbackReportOptions | null>(null)
  const [reportOptionsLoading, setReportOptionsLoading] = useState(false)
  const [reportOptionsError, setReportOptionsError] = useState("")
  const [reportOptionsReloadKey, setReportOptionsReloadKey] = useState(0)
  const [baselineHistoryRecordId, setBaselineHistoryRecordId] = useState("")
  const [currentHistoryRecordId, setCurrentHistoryRecordId] = useState("")
  const [previewReport, setPreviewReport] = useState<ClientFeedbackReport | null>(null)
  const [copiedReportId, setCopiedReportId] = useState("")
  const [shareUrl, setShareUrl] = useState("")
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([])
  const [customerActionPreview, setCustomerActionPreview] = useState(false)

  const endpoint = `/api/client-feedback/${encodeURIComponent(client.id)}`

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError("")
    try {
      const response = await fetch(endpoint, { cache: "no-store" })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "执行反馈读取失败，请稍后重试。", subject: "执行反馈" }))
      setPayload(body as Payload)
      setProfileDraft((body as Payload).profile)
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "执行反馈读取失败，请稍后重试。", subject: "执行反馈" }))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (!reportDialogType) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setReportOptionsLoading(true)
      setReportOptionsError("")
      const params = new URLSearchParams({
        type: reportDialogType,
        targetDate: reportTargetDate,
      })
      void (async () => {
        try {
          const response = await fetch(`${endpoint}/report-options?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          })
          const body = await response.json().catch(() => null)
          if (!response.ok) throw new Error(toUserFacingError(body?.error, {
            status: response.status,
            fallback: "报告配置读取失败，请稍后重试。",
            subject: "反馈报告",
          }))
          if (controller.signal.aborted) return
          const options = body as ClientFeedbackReportOptions
          setReportOptions(options)
          const sourceBaselineId = reportDialogSource?.snapshot.comparison.baseline?.historyRecordId || ""
          const sourceCurrentId = reportDialogSource?.snapshot.comparison.current?.historyRecordId || ""
          setBaselineHistoryRecordId(
            options.metrics.some(item => item.historyRecordId === sourceBaselineId)
              ? sourceBaselineId
              : options.suggestedBaselineHistoryRecordId || "",
          )
          setCurrentHistoryRecordId(
            options.metrics.some(item => item.historyRecordId === sourceCurrentId)
              ? sourceCurrentId
              : options.suggestedCurrentHistoryRecordId || "",
          )
        } catch (caught) {
          if (!controller.signal.aborted) {
            setReportOptions(null)
            setReportOptionsError(toUserFacingError(caught, {
              fallback: "报告配置读取失败，请稍后重试。",
              subject: "反馈报告",
            }))
          }
        } finally {
          if (!controller.signal.aborted) setReportOptionsLoading(false)
        }
      })()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [endpoint, reportDialogSource, reportDialogType, reportOptionsReloadKey, reportTargetDate])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search)
      const requestedDate = String(params.get("date") || "")
      if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return
      setSelectedDate(requestedDate)
      setCalendarMonth(requestedDate.slice(0, 7))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const cells = useMemo(() => calendarCells(calendarMonth), [calendarMonth])
  const calendarActions = useMemo(() => {
    const actions = payload?.actions || []
    if (!customerActionPreview || !payload?.canManageVisibility) return actions
    return actions.filter(action => action.publication !== "internal")
  }, [customerActionPreview, payload?.actions, payload?.canManageVisibility])
  const actionsByDate = useMemo(() => {
    const map = new Map<string, ClientExecutionAction[]>()
    for (const action of calendarActions) {
      const day = dateOnly(action.occurredAt)
      map.set(day, [...(map.get(day) || []), action])
    }
    return map
  }, [calendarActions])
  const selectedActionGroups = useMemo(
    () => groupClientExecutionActions(actionsByDate.get(selectedDate) || []),
    [actionsByDate, selectedDate],
  )
  const visibleReports = payload?.reports || []
  const canEditActionVisibility = payload?.canManageVisibility && !customerActionPreview
  const selectedBaselineMetric = reportOptions?.metrics.find(
    item => item.historyRecordId === baselineHistoryRecordId,
  )
  const selectedCurrentMetric = reportOptions?.metrics.find(
    item => item.historyRecordId === currentHistoryRecordId,
  )
  const baselineMetricOptions = (reportOptions?.metrics || []).filter(item => (
    !selectedCurrentMetric || Date.parse(item.completedAt) < Date.parse(selectedCurrentMetric.completedAt)
  ))
  const currentMetricOptions = (reportOptions?.metrics || []).filter(item => (
    !selectedBaselineMetric || Date.parse(item.completedAt) > Date.parse(selectedBaselineMetric.completedAt)
  ))

  async function saveProfile() {
    if (!profileDraft) return
    setPending("profile")
    setError("")
    setNotice("")
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: {
            startDate: profileDraft.startDate,
            endDate: profileDraft.endDate,
            periodMode: profileDraft.periodMode,
            currentStage: profileDraft.currentStage,
            stageProgress: profileDraft.stageProgress,
            projectOwner: profileDraft.projectOwner,
            expectedDurationDays: profileDraft.expectedDurationDays,
            nextPlan: profileDraft.nextPlan,
          },
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "执行设置保存失败，请稍后重试。", subject: "执行设置" }))
      setSettingsOpen(false)
      setNotice("执行设置已保存")
      await load(true)
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "执行设置保存失败，请稍后重试。", subject: "执行设置" }))
    } finally {
      setPending("")
    }
  }

  async function addAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending("action")
    setError("")
    setNotice("")
    const form = new FormData(event.currentTarget)
    const evidenceUrl = String(form.get("evidenceUrl") || "").trim()
    const actionTitle = String(form.get("title") || "").trim()
    try {
      const response = await fetch(`${endpoint}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: {
            category: String(form.get("category") || "other"),
            status: String(form.get("status") || "completed"),
            visibility: String(form.get("visibility") || "client"),
            title: actionTitle,
            description: String(form.get("description") || ""),
            occurredAt: `${String(form.get("occurredDate") || today())}T12:00:00+08:00`,
            quantity: form.get("quantity") ? Number(form.get("quantity")) : undefined,
            unit: String(form.get("unit") || ""),
            platform: String(form.get("platform") || ""),
            evidence: evidenceUrl ? [{ label: actionTitle || "查看执行证据", url: evidenceUrl }] : [],
          },
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "动作记录保存失败，请稍后重试。", subject: "动作记录" }))
      setActionOpen(false)
      setNotice("动作记录已保存")
      await load(true)
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "动作记录保存失败，请稍后重试。", subject: "动作记录" }))
    } finally {
      setPending("")
    }
  }

  async function deleteActionGroup(group: ClientExecutionActionGroup) {
    if (group.actions.some(action => action.source !== "manual")) return
    const label = group.isBatch
      ? `这批 ${group.totalQuantity}${group.unit}记录`
      : `“${group.action.title}”`
    if (!window.confirm(`确认删除${label}吗？`)) return
    setPending(`delete:${group.key}`)
    setError("")
    try {
      const deleteQuery = group.isBatch && group.action.importBatchId
        ? `importBatchId=${encodeURIComponent(group.action.importBatchId)}`
        : `actionId=${encodeURIComponent(group.action.id)}`
      const response = await fetch(`${endpoint}/actions?${deleteQuery}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(toUserFacingError(body?.error, {
          status: response.status,
          fallback: "动作记录删除失败，请稍后重试。",
          subject: "删除动作记录",
        }))
      }
      setNotice(group.isBatch ? "该批次动作记录已删除" : "动作记录已删除")
      await load(true)
    } catch (caught) {
      setError(toUserFacingError(caught, {
        fallback: "动作记录删除失败，请稍后重试。",
        subject: "删除动作记录",
      }))
    } finally {
      setPending("")
    }
  }

  async function saveActionPublication(
    actionIds: string[],
    publication: ClientExecutionActionPublication,
  ) {
    if (actionIds.length === 0) return
    setPending("publication")
    setError("")
    setNotice("")
    try {
      const response = await fetch(`${endpoint}/actions/publication`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionIds, publication }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, {
        status: response.status,
        fallback: "客户展示权限保存失败，请稍后重试。",
        subject: "动作权限",
      }))
      setSelectedActionIds([])
      setNotice(`已将 ${actionIds.length} 条动作设为“${PUBLICATION_META[publication].label}”`)
      await load(true)
    } catch (caught) {
      setError(toUserFacingError(caught, {
        fallback: "客户展示权限保存失败，请稍后重试。",
        subject: "动作权限",
      }))
    } finally {
      setPending("")
    }
  }

  async function saveDefaultPenetrationPublication(
    publication: ClientExecutionActionPublication,
  ) {
    setPending("publication-default")
    setError("")
    setNotice("")
    try {
      const response = await fetch(`${endpoint}/actions/publication`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-default",
          publication,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, {
        status: response.status,
        fallback: "默认展示规则保存失败，请稍后重试。",
        subject: "默认展示规则",
      }))
      setPayload(current => current ? {
        ...current,
        publicationPolicy: body.policy as ClientExecutionPublicationPolicy,
      } : current)
      setNotice(`以后新完成的检测默认设为“${PUBLICATION_META[publication].label}”`)
    } catch (caught) {
      setError(toUserFacingError(caught, {
        fallback: "默认展示规则保存失败，请稍后重试。",
        subject: "默认展示规则",
      }))
    } finally {
      setPending("")
    }
  }

  function handleBatchImported(result: ClientEvidenceImportResult) {
    setPayload(current => {
      if (!current || result.created.length === 0) return current
      const createdIds = new Set(result.created.map(action => action.id))
      return {
        ...current,
        actions: [
          ...result.created,
          ...current.actions.filter(action => !createdIds.has(action.id)),
        ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
      }
    })
    const importedDate = result.created[0]
      ? dateOnly(result.created[0].occurredAt)
      : selectedDate
    setSelectedDate(importedDate)
    setCalendarMonth(importedDate.slice(0, 7))
    setBatchImportOpen(false)
    setError("")
    setNotice(
      result.skippedCount > 0
        ? `已导入 ${result.createdCount} 条动作，跳过 ${result.skippedCount} 条重复网址`
        : `已导入 ${result.createdCount} 条动作`,
    )
    void load(true)
  }

  function openReportDialog(type: ClientFeedbackReportType, source: ClientFeedbackReport | null = null) {
    setReportOptions(null)
    setReportOptionsError("")
    setReportDialogSource(source)
    if (source) setReportTargetDate(source.periodEnd)
    setReportDialogType(type)
  }

  function closeReportDialog() {
    setReportDialogType(null)
    setReportDialogSource(null)
  }

  function absoluteShareUrl(path: string): string {
    return new URL(path, window.location.origin).toString()
  }

  async function copyReportShareUrl(report: ClientFeedbackReport): Promise<boolean> {
    if (!report.sharePath) return false
    const url = absoluteShareUrl(report.sharePath)
    setShareUrl(url)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedReportId(report.id)
      setNotice("私密报告链接已复制")
      window.setTimeout(() => setCopiedReportId(""), 2_000)
      return true
    } catch {
      setNotice("请从上方链接框手动复制")
      return false
    }
  }

  function openReportShareUrl(report: ClientFeedbackReport, print = false) {
    if (!report.sharePath) return
    const url = new URL(absoluteShareUrl(report.sharePath))
    if (print) url.searchParams.set("print", "1")
    window.open(url.toString(), "_blank", "noopener,noreferrer")
  }

  async function generateReport(type: ClientFeedbackReportType, publish: boolean) {
    const pendingKey = `generate:${type}:${publish ? "publish" : "draft"}`
    const isRegeneration = Boolean(reportDialogSource)
    setPending(pendingKey)
    setError("")
    setNotice("")
    try {
      const response = await fetch(`${endpoint}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          targetDate: reportTargetDate,
          baselineHistoryRecordId: baselineHistoryRecordId || undefined,
          currentHistoryRecordId: currentHistoryRecordId || undefined,
          publish,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "反馈报告生成失败，请稍后重试。", subject: "反馈报告" }))
      const report = {
        ...body.report as ClientFeedbackReport,
        sharePath: typeof body.sharePath === "string" ? body.sharePath : body.report?.sharePath,
      }
      setPreviewReport(report)
      closeReportDialog()
      if (publish && report.sharePath) {
        await copyReportShareUrl(report)
        setNotice("报告已生成并创建私密链接")
      } else {
        setNotice(isRegeneration ? "报告新版草稿已生成" : "报告草稿已生成，确认后可发布给客户")
      }
      await load(true)
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "反馈报告生成失败，请稍后重试。", subject: "反馈报告" }))
    } finally {
      setPending("")
    }
  }

  async function publishReport(report: ClientFeedbackReport) {
    setPending(`publish:${report.id}`)
    setError("")
    try {
      const response = await fetch(`${endpoint}/reports/${encodeURIComponent(report.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "报告发布失败，请稍后重试。", subject: "报告发布" }))
      const publishedReport = {
        ...body.report as ClientFeedbackReport,
        sharePath: body.sharePath as string,
      }
      setPreviewReport(publishedReport)
      await copyReportShareUrl(publishedReport)
      setNotice("报告已发布，私密链接可跨设备重复使用")
      await load(true)
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "报告发布失败，请稍后重试。", subject: "报告发布" }))
    } finally {
      setPending("")
    }
  }

  async function revokeReportShare(report: ClientFeedbackReport) {
    if (!report.shareEnabled || !window.confirm(`确认停止分享“${report.snapshot.reportTitle}”吗？原私密链接将立即失效。`)) return
    setPending(`revoke:${report.id}`)
    setError("")
    setNotice("")
    try {
      const response = await fetch(`${endpoint}/reports/${encodeURIComponent(report.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke-share" }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "停止分享失败，请稍后重试。", subject: "停止分享" }))
      const nextReport = body.report as ClientFeedbackReport
      setPreviewReport(current => current?.id === report.id ? nextReport : current)
      setShareUrl("")
      setNotice("报告分享已停止，原私密链接已失效")
      await load(true)
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "停止分享失败，请稍后重试。", subject: "停止分享" }))
    } finally {
      setPending("")
    }
  }

  async function deleteReport(report: ClientFeedbackReport) {
    if (report.status !== "draft" || !window.confirm(`确认删除草稿“${report.snapshot.reportTitle}”吗？删除后无法恢复。`)) return
    setPending(`delete-report:${report.id}`)
    setError("")
    setNotice("")
    try {
      const response = await fetch(`${endpoint}/reports/${encodeURIComponent(report.id)}`, {
        method: "DELETE",
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "报告草稿删除失败，请稍后重试。", subject: "删除报告草稿" }))
      setPayload(current => current ? {
        ...current,
        reports: current.reports.filter(item => item.id !== report.id),
      } : current)
      setPreviewReport(current => current?.id === report.id ? null : current)
      setNotice("报告草稿已删除")
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "报告草稿删除失败，请稍后重试。", subject: "删除报告草稿" }))
    } finally {
      setPending("")
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-[#DCE8F4] bg-white">
        <LoaderCircle className="h-6 w-6 animate-spin text-[#1677FF]" />
      </div>
    )
  }

  if (!payload || !profileDraft) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-5 py-10 text-center">
        <p className="text-sm text-rose-700">{error || "执行反馈暂时无法读取"}</p>
        <button type="button" onClick={() => void load()} className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-rose-700">
          <RefreshCw className="h-3.5 w-3.5" />重新加载
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-[#B9DDFC] bg-white shadow-[0_18px_44px_-34px_rgba(0,78,180,.62)]">
        <div className="grid gap-px bg-[#CFE4F7] sm:grid-cols-2 lg:grid-cols-[1.25fr_.75fr_.75fr_.75fr]">
          <div className="bg-[linear-gradient(135deg,#003EB3_0%,#1677FF_58%,#00AEEA_100%)] p-5 text-white">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100/80">
              <Activity className="h-4 w-4" />客户执行中心
            </div>
            <h2 className="mt-3 break-words text-2xl font-bold">{client.name}</h2>
            <p className="mt-2 text-xs text-cyan-50/75">
              正式执行日期 {payload.profile.startDate}
              {payload.profile.endDate ? ` 至 ${payload.profile.endDate}` : ""}
              {" · "}{payload.profile.periodMode === "service" ? "按服务周期" : "按自然周期"}
            </p>
          </div>
          {[
            { label: "执行进度", value: `第 ${payload.counters.executionDay} 天` },
            { label: "当前周", value: `第 ${payload.counters.serviceWeek} 周` },
            { label: "当前月", value: `第 ${payload.counters.serviceMonth} 月` },
          ].map(item => (
            <div key={item.label} className="bg-white p-5">
              <p className="text-[11px] text-[#7E91A7]">{item.label}</p>
              <p className="mt-2 text-xl font-bold text-[#0958D9]">{item.value}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E3EDF6] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-xs text-[#6B8299]">阶段</span>
            <span className="rounded-md bg-[#EAF4FF] px-2 py-1 text-xs font-semibold text-[#0958D9]">
              {STAGE_OPTIONS.find(item => item.value === payload.profile.currentStage)?.label}
            </span>
            <div className="hidden h-2 w-36 overflow-hidden rounded-full bg-[#E7EFF7] sm:block">
              <div className="h-full bg-gradient-to-r from-[#1677FF] to-[#13C2C2]" style={{ width: `${payload.profile.stageProgress}%` }} />
            </div>
            <span className="font-mono text-xs font-bold text-[#0958D9]">{payload.profile.stageProgress}%</span>
          </div>
          {payload.canManage ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={() => setActionOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#91CAFF] bg-[#F3F9FF] px-3 text-xs font-semibold text-[#0958D9] hover:bg-[#EAF4FF]">
                <Plus className="h-3.5 w-3.5" />记录动作
              </button>
              <button type="button" onClick={() => setBatchImportOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#79D6E8] bg-[#F0FCFF] px-3 text-xs font-semibold text-[#007A99] transition hover:bg-[#E4F9FD]">
                <FileUp className="h-3.5 w-3.5" />批量导入网址
              </button>
              {payload.canManageVisibility ? (
                <FeedbackAutomationPanel key={client.id} client={client} profile={payload.profile} onChanged={() => void load(true)} />
              ) : null}
              <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 text-xs font-semibold text-white">
                <Settings2 className="h-3.5 w-3.5" />执行设置
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-[#6B8299]"><LockKeyhole className="h-3.5 w-3.5" />客户浏览模式</span>
          )}
        </div>
      </section>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><Check className="h-4 w-4" />{notice}</div> : null}

      {shareUrl ? (
        <div className="flex flex-col gap-2 rounded-lg border border-[#91CAFF] bg-[#F0F8FF] px-4 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold text-[#0958D9]">客户私密验证链接</p>
            <input readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} className="mt-1 h-8 w-full rounded-md border border-[#C8D9E8] bg-white px-2 font-mono text-[10px] text-[#38536E]" />
          </div>
          <button type="button" onClick={() => void navigator.clipboard.writeText(shareUrl).then(() => setNotice("私密链接已复制")).catch(() => undefined)} className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-[#1677FF] px-3 text-xs font-semibold text-white"><Copy className="h-3.5 w-3.5" />复制链接</button>
        </div>
      ) : null}

      <PublishingPlanPanel
        key={`publishing-plan-${client.id}`}
        client={client}
        profile={payload.profile}
        mode="summary"
        onExecutionChanged={() => void load(true)}
      />

      <div className="grid gap-4 xl:grid-cols-[1.08fr_.92fr]">
        <section className="rounded-lg border border-[#D7E5F2] bg-white">
          <header className="flex items-center justify-between gap-3 border-b border-[#E7EFF6] px-4 py-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-[#1677FF]" />执行日历</h3>
              <p className="mt-0.5 text-[10px] text-[#7E91A7]">检测结果与执行记录按日期汇总</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setCalendarMonth(value => shiftMonth(value, -1))} className="rounded-md p-2 text-[#6B8299] hover:bg-[#EEF5FC]" aria-label="上个月"><ChevronLeft className="h-4 w-4" /></button>
              <span className="w-24 text-center text-xs font-semibold">{monthLabel(calendarMonth)}</span>
              <button type="button" onClick={() => setCalendarMonth(value => shiftMonth(value, 1))} className="rounded-md p-2 text-[#6B8299] hover:bg-[#EEF5FC]" aria-label="下个月"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </header>
          {payload.canManageVisibility ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E7EFF6] bg-[#F8FBFF] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-[#526A83]">未单独设置的检测默认展示</span>
                <select
                  value={payload.publicationPolicy?.defaultPenetration || "full"}
                  disabled={pending === "publication-default" || customerActionPreview}
                  onChange={event => void saveDefaultPenetrationPublication(
                    event.target.value as ClientExecutionActionPublication,
                  )}
                  className="h-8 rounded-md border border-[#C8D9E8] bg-white px-2 text-[10px] font-semibold text-[#38536E] outline-none focus:border-[#1677FF] disabled:opacity-50"
                >
                  <option value="full">动作和完整报告</option>
                  <option value="summary">只展示动作</option>
                  <option value="internal">仅内部可见</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCustomerActionPreview(current => !current)
                  setSelectedActionIds([])
                }}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-semibold transition ${
                  customerActionPreview
                    ? "bg-[#1677FF] text-white"
                    : "border border-[#C8D9E8] bg-white text-[#526A83]"
                }`}
              >
                <Eye className="h-3 w-3" />
                {customerActionPreview ? "退出动作预览" : "预览客户可见动作"}
              </button>
            </div>
          ) : null}
          <div className="p-3 sm:p-4">
            <div className="grid grid-cols-7 text-center text-[10px] font-semibold text-[#8AA0B5]">
              {"一二三四五六日".split("").map(value => <span key={value} className="py-2">周{value}</span>)}
            </div>
            <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-[#E3EDF6] bg-[#E3EDF6] gap-px">
              {cells.map((day, index) => {
                const count = day ? actionsByDate.get(day)?.length || 0 : 0
                const selected = day === selectedDate
                return day ? (
                  <button key={day} type="button" onClick={() => setSelectedDate(day)} className={`relative min-h-16 bg-white p-2 text-left transition hover:bg-[#F3F9FF] ${selected ? "ring-2 ring-inset ring-[#1677FF]" : ""}`}>
                    <span className={`text-xs font-semibold ${day === today() ? "text-[#1677FF]" : "text-[#526A83]"}`}>{Number(day.slice(-2))}</span>
                    {count ? <span className="absolute bottom-2 left-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1677FF] px-1.5 text-[9px] font-bold text-white">{count}</span> : null}
                  </button>
                ) : <span key={`empty-${index}`} className="min-h-16 bg-[#F7FAFC]" />
              })}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-[#D7E5F2] bg-white">
          <header className="border-b border-[#E7EFF6] px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><ClipboardList className="h-4 w-4 text-[#13C2C2]" />{selectedDate} 动作</h3>
            <p className="mt-0.5 text-[10px] text-[#7E91A7]">
              {customerActionPreview ? "当前仅显示客户登录后能看到的动作" : "可逐条控制客户是否能查看动作和对应报告"}
            </p>
          </header>
          {canEditActionVisibility && selectedActionIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-[#E7EFF6] bg-[#F8FBFF] px-4 py-2.5">
              <span className="mr-auto text-[10px] font-semibold text-[#526A83]">
                已选择 {selectedActionIds.length} 条
              </span>
              <button type="button" disabled={pending === "publication"} onClick={() => void saveActionPublication(selectedActionIds, "internal")} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-semibold text-slate-600"><EyeOff className="h-3 w-3" />隐藏</button>
              <button type="button" disabled={pending === "publication"} onClick={() => void saveActionPublication(selectedActionIds, "summary")} className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-200 bg-white px-2.5 text-[10px] font-semibold text-amber-700"><Eye className="h-3 w-3" />只展示动作</button>
              <button type="button" disabled={pending === "publication"} onClick={() => void saveActionPublication(selectedActionIds, "full")} className="inline-flex h-8 items-center gap-1 rounded-md bg-[#1677FF] px-2.5 text-[10px] font-semibold text-white"><FileSearch2 className="h-3 w-3" />开放报告</button>
            </div>
          ) : null}
          <div className="max-h-[420px] divide-y divide-[#EDF2F7] overflow-y-auto">
            {selectedActionGroups.length === 0 ? (
              <div className="px-5 py-16 text-center text-xs text-[#8AA0B5]">当天没有执行记录</div>
            ) : selectedActionGroups.map(group => {
              const action = group.action
              const detailAllowed = payload.accessMode !== "client"
                || group.publication === "full"
              const detailHref = action.resultRef?.module === "penetration"
                && action.resultRef.resourceType === "history"
                ? `/workspace/results/penetration/${encodeURIComponent(action.resultRef.resourceId)}`
                : `/workspace/actions/${encodeURIComponent(action.id)}?clientId=${encodeURIComponent(client.id)}`
              const detailLabel = action.category === "penetration_check"
                ? "查看当次检测报告"
                : group.isPublication
                  ? `查看发布明细 · ${group.totalQuantity}${group.unit}`
                  : "查看动作详情"
              const groupSelected = group.actionIds.every(id => (
                selectedActionIds.includes(id)
              ))
              return (
              <article key={group.key} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  {canEditActionVisibility ? (
                    <input
                      type="checkbox"
                      checked={groupSelected}
                      onChange={event => setSelectedActionIds(current => (
                        event.target.checked
                          ? Array.from(new Set([...current, ...group.actionIds]))
                          : current.filter(id => !group.actionIds.includes(id))
                      ))}
                      className="mt-1 h-4 w-4 shrink-0 accent-[#1677FF]"
                      aria-label={`选择动作：${action.title}`}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="break-words text-sm font-semibold">
                        {group.isBatch
                          ? `${CATEGORY_LABELS[action.category]} · ${group.totalQuantity}${group.unit}`
                          : action.title}
                      </h4>
                      <span className="rounded-md bg-[#EDF5FF] px-2 py-0.5 text-[10px] font-semibold text-[#0958D9]">{CATEGORY_LABELS[action.category] || "其他动作"}</span>
                      {canEditActionVisibility ? (
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${PUBLICATION_META[group.publication].className}`}>
                          {PUBLICATION_META[group.publication].label}
                        </span>
                      ) : null}
                    </div>
                    {group.isBatch ? (
                      <p className="mt-1 text-xs leading-5 text-[#6B8299]">
                        本批次包含 {group.itemCount} 条发布明细，可进入详情逐条查看标题与网址。
                      </p>
                    ) : null}
                    {action.description ? <p className="mt-1 break-words text-xs leading-5 text-[#6B8299]">{action.description}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-x-3 text-[10px] text-[#8AA0B5]">
                      <span>{formatTime(action.occurredAt)}</span>
                      {action.platform ? <span>{action.platform}</span> : null}
                      {group.evidenceCount > 0 ? <span>{group.evidenceCount} 条证据</span> : null}
                      {action.visibility === "internal" ? <span className="text-amber-600">仅内部</span> : null}
                    </div>
                    {detailAllowed ? (
                      <Link
                        href={detailHref}
                        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 text-[10px] font-semibold text-white shadow-sm transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1677FF]"
                      >
                        <FileSearch2 className="h-3.5 w-3.5" />
                        {detailLabel}
                      </Link>
                    ) : (
                      <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-[#8AA0B5]">
                        <LockKeyhole className="h-3 w-3" />该动作详情尚未开放
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {canEditActionVisibility ? (
                      <select
                        aria-label={`调整动作权限：${action.title}`}
                        value={group.publication}
                        disabled={pending === "publication"}
                        onChange={event => void saveActionPublication(
                          group.actionIds,
                          event.target.value as ClientExecutionActionPublication,
                        )}
                        className="h-8 max-w-24 rounded-md border border-[#D7E5F2] bg-white px-1.5 text-[9px] font-semibold text-[#526A83] outline-none focus:border-[#1677FF]"
                      >
                        <option value="internal">仅内部</option>
                        <option value="summary">只展示</option>
                        <option value="full">含报告</option>
                      </select>
                    ) : null}
                    {payload.canManage && group.actions.every(item => item.source === "manual") ? (
                      <button type="button" onClick={() => void deleteActionGroup(group)} disabled={pending === `delete:${group.key}`} className="rounded-md p-2 text-[#8AA0B5] hover:bg-rose-50 hover:text-rose-600" aria-label={group.isBatch ? "删除整批动作" : "删除动作"}><Trash2 className="h-3.5 w-3.5" /></button>
                    ) : null}
                  </div>
                </div>
              </article>
              )
            })}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-[#D7E5F2] bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E7EFF6] px-4 py-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold"><FileBarChart2 className="h-4 w-4 text-[#6C5CE7]" />周报与月报</h3>
            <p className="mt-0.5 text-[10px] text-[#7E91A7]">发布后客户可在账号中查看，也可通过私密链接验证</p>
          </div>
          {payload.canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={reportTargetDate} max={today()} onChange={event => setReportTargetDate(event.target.value)} className="h-9 rounded-lg border border-[#C8D9E8] px-3 text-xs outline-none focus:border-[#1677FF]" aria-label="反馈报告截止日期" />
              <button type="button" onClick={() => openReportDialog("weekly")} disabled={pending.startsWith("generate:")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#91CAFF] px-3 text-xs font-semibold text-[#0958D9] disabled:opacity-50">
                <FileBarChart2 className="h-3.5 w-3.5" />生成周报
              </button>
              <button type="button" onClick={() => openReportDialog("monthly")} disabled={pending.startsWith("generate:")} className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#6C5CE7] px-3 text-xs font-semibold text-white disabled:opacity-50">
                <FileBarChart2 className="h-3.5 w-3.5" />生成月报
              </button>
            </div>
          ) : null}
        </header>
        {visibleReports.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <FileBarChart2 className="mx-auto h-8 w-8 text-[#A6BCD0]" />
            <p className="mt-3 text-sm font-semibold">{payload.canManage ? "还没有反馈报告" : "暂无已发布反馈报告"}</p>
            <p className="mt-1 text-xs text-[#7E91A7]">{payload.canManage ? "选择一个周期日期生成第一份周报或月报。" : "主账号发布后会自动出现在这里。"}</p>
          </div>
        ) : (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleReports.map(report => (
              <article key={report.id} className="rounded-lg border border-[#DCE8F4] bg-[#F9FCFF] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${report.type === "weekly" ? "bg-cyan-50 text-cyan-700" : "bg-indigo-50 text-indigo-700"}`}>{report.type === "weekly" ? "周报" : "月报"}</span>
                    <span className="text-[10px] font-semibold text-[#7E91A7]">V{report.version}</span>
                  </div>
                  <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${report.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{report.status === "published" ? "已发布" : "草稿"}</span>
                </div>
                <h4 className="mt-3 break-words text-sm font-semibold">{report.snapshot.reportTitle}</h4>
                <p className="mt-1 text-[11px] text-[#7E91A7]">{report.periodStart} 至 {report.periodEnd}</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setPreviewReport(report)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#C8D9E8] bg-white text-xs font-semibold text-[#38536E] hover:border-[#91CAFF]">
                    <ExternalLink className="h-3.5 w-3.5" />查看
                  </button>
                  {payload.canManage ? (
                    <>
                      <button type="button" onClick={() => openReportDialog(report.type, report)} disabled={pending.startsWith("generate:")} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#C8D9E8] bg-white text-xs font-semibold text-[#38536E] hover:border-[#91CAFF] disabled:opacity-50">
                        <RefreshCw className="h-3.5 w-3.5" />生成新版
                      </button>
                      {report.status === "draft" ? (
                        <button type="button" onClick={() => void publishReport(report)} disabled={pending === `publish:${report.id}`} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#1677FF] text-xs font-semibold text-white disabled:opacity-50">
                          {pending === `publish:${report.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                          创建链接
                        </button>
                      ) : report.shareEnabled ? (
                        <button type="button" onClick={() => openReportShareUrl(report)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#1677FF] text-xs font-semibold text-white">
                          <Link2 className="h-3.5 w-3.5" />网页报告
                        </button>
                      ) : (
                        <button type="button" onClick={() => void publishReport(report)} disabled={pending === `publish:${report.id}`} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#1677FF] text-xs font-semibold text-white disabled:opacity-50">
                          {pending === `publish:${report.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                          恢复分享
                        </button>
                      )}
                      {report.status === "draft" ? (
                        <button type="button" onClick={() => void deleteReport(report)} disabled={pending === `delete-report:${report.id}`} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-white text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                          {pending === `delete-report:${report.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}删除草稿
                        </button>
                      ) : report.shareEnabled ? (
                        <>
                          <button type="button" onClick={() => void copyReportShareUrl(report)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#91CAFF] bg-white text-xs font-semibold text-[#0958D9]">
                            {copiedReportId === report.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copiedReportId === report.id ? "已复制" : "复制链接"}
                          </button>
                          <button type="button" onClick={() => openReportShareUrl(report, true)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#C8D9E8] bg-white text-xs font-semibold text-[#38536E]">
                            <FileDown className="h-3.5 w-3.5" />导出 PDF
                          </button>
                          <button type="button" onClick={() => void revokeReportShare(report)} disabled={pending === `revoke:${report.id}`} className="col-span-2 inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#C8D9E8] bg-white text-xs font-semibold text-[#5E738A] hover:border-rose-200 hover:text-rose-600 disabled:opacity-50">
                            {pending === `revoke:${report.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <LockKeyhole className="h-3.5 w-3.5" />}停止分享
                          </button>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {reportDialogType ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#00133F]/58 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="feedback-report-dialog-title">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-[#E3EDF6] px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="feedback-report-dialog-title" className="text-base font-semibold">
                    {reportDialogSource ? "重新生成" : "生成"}{reportDialogType === "weekly" ? "周反馈" : "月反馈"}
                  </h3>
                  <span className="rounded-md bg-[#EAF4FF] px-2 py-1 text-[10px] font-semibold text-[#0958D9]">
                    {reportDialogType === "weekly" ? "连续 7 天" : "连续 30 天"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#7E91A7]">{reportDialogSource ? `原 V${reportDialogSource.version} 会保留，本次生成一份新版本。` : "确认动作范围，并选择用于效果对比的两次真实检测记录。"}</p>
              </div>
              <button type="button" onClick={closeReportDialog} disabled={pending.startsWith("generate:")} className="rounded-md p-2 hover:bg-[#EEF5FC] disabled:opacity-50" aria-label="关闭"><X className="h-4 w-4" /></button>
            </header>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <label className="space-y-1.5 text-xs font-semibold">
                  报告截止日期
                  <input
                    type="date"
                    value={reportTargetDate}
                    max={today()}
                    onChange={event => setReportTargetDate(event.target.value)}
                    className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal outline-none focus:border-[#1677FF]"
                  />
                </label>
                <div className="rounded-lg border border-[#CFE1F5] bg-[linear-gradient(135deg,#F1F8FF_0%,#F3FDFF_100%)] px-4 py-3">
                  <p className="text-[10px] font-semibold text-[#6B8299]">动作统计范围</p>
                  <p className="mt-1 text-sm font-bold text-[#0958D9]">
                    {reportOptions
                      ? `${reportOptions.period.start} 至 ${reportOptions.period.end}`
                      : reportOptionsLoading ? "正在计算…" : "等待加载"}
                  </p>
                  <p className="mt-1 text-[10px] text-[#7E91A7]">按北京时间计算，首尾日期均计入报告</p>
                </div>
              </div>

              {reportOptionsLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-[#C8D9E8] py-12 text-sm text-[#6B8299]">
                  <LoaderCircle className="h-4 w-4 animate-spin text-[#1677FF]" />正在读取历史检测记录
                </div>
              ) : reportOptionsError ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <span>{reportOptionsError}</span>
                  <button type="button" onClick={() => setReportOptionsReloadKey(value => value + 1)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 text-xs font-semibold"><RefreshCw className="h-3.5 w-3.5" />重试</button>
                </div>
              ) : reportOptions ? (
                <>
                  <section aria-labelledby="feedback-action-preview-title">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h4 id="feedback-action-preview-title" className="text-xs font-semibold text-[#102A43]">报告动作预览</h4>
                        <p className="mt-1 text-[10px] text-[#7E91A7]">本次将收录 {reportOptions.actionCount} 项客户可见动作</p>
                      </div>
                      <span className="rounded-md bg-[#EAF4FF] px-2 py-1 text-[10px] font-semibold text-[#0958D9]">
                        {reportOptions.actionDays.filter(day => day.count > 0).length} 个日期有记录
                      </span>
                    </div>
                    <div className={`mt-3 grid gap-2 ${reportDialogType === "weekly" ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7" : "grid-cols-4 sm:grid-cols-6 lg:grid-cols-10"}`}>
                      {reportOptions.actionDays.map(day => (
                        <div key={day.date} className={`min-h-16 rounded-lg border px-2 py-2 ${day.count > 0 ? "border-[#91CAFF] bg-[#EFF8FF]" : "border-[#E3EDF6] bg-white"}`}>
                          <p className={`text-[9px] font-semibold ${day.count > 0 ? "text-[#0958D9]" : "text-[#8AA0B5]"}`}>{day.date.slice(5)}</p>
                          <p className={`mt-2 text-xs font-bold ${day.count > 0 ? "text-[#102A43]" : "text-[#A0B1C1]"}`}>{day.count > 0 ? `${day.count} 项` : "无动作"}</p>
                        </div>
                      ))}
                    </div>
                    {reportOptions.actionCount === 0 ? (
                      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">该周期没有可向客户展示的动作，仍可生成只包含阶段进度和效果对比的报告。</p>
                    ) : null}
                  </section>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1.5 text-xs font-semibold">
                      起始检测
                      <select
                        value={baselineHistoryRecordId}
                        onChange={event => setBaselineHistoryRecordId(event.target.value)}
                        className="h-11 w-full rounded-lg border border-[#C8D9E8] bg-white px-3 font-normal outline-none focus:border-[#1677FF]"
                      >
                        <option value="">不设置起始检测</option>
                        {baselineMetricOptions.map(item => <option key={item.historyRecordId} value={item.historyRecordId}>{metricOptionLabel(item)}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1.5 text-xs font-semibold">
                      当前检测
                      <select
                        value={currentHistoryRecordId}
                        onChange={event => {
                          const nextId = event.target.value
                          setCurrentHistoryRecordId(nextId)
                          const next = reportOptions.metrics.find(item => item.historyRecordId === nextId)
                          if (next && selectedBaselineMetric && Date.parse(selectedBaselineMetric.completedAt) >= Date.parse(next.completedAt)) {
                            setBaselineHistoryRecordId("")
                          }
                        }}
                        className="h-11 w-full rounded-lg border border-[#C8D9E8] bg-white px-3 font-normal outline-none focus:border-[#1677FF]"
                      >
                        <option value="">暂无当前检测</option>
                        {currentMetricOptions.map(item => <option key={item.historyRecordId} value={item.historyRecordId}>{metricOptionLabel(item)}</option>)}
                      </select>
                    </label>
                  </div>

                  {reportOptions.metrics.length === 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                      截止该日期还没有可用的渗透率检测记录。仍可生成动作反馈报告，效果对比会显示为暂无数据。
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        { label: "起始值", item: selectedBaselineMetric },
                        { label: "当前值", item: selectedCurrentMetric },
                      ].map(entry => (
                        <div key={entry.label} className="min-w-0 rounded-lg border border-[#DCE8F4] bg-[#F8FBFF] p-4">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold text-[#6B8299]">{entry.label}</span>
                            {entry.item ? <span className={`rounded-md px-2 py-0.5 text-[9px] font-semibold ${entry.item.status === "partial" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{entry.item.status === "partial" ? "部分完成" : "完整完成"}</span> : null}
                          </div>
                          <p className="mt-2 text-2xl font-bold text-[#102A43]">{metricPercent(entry.item?.penetrationRate)}</p>
                          <p className="mt-1 break-words text-[10px] text-[#7E91A7]">{entry.item ? formatTime(entry.item.completedAt) : "未选择"}</p>
                          {entry.item ? <p className="mt-2 text-[10px] text-[#526A83]">{entry.item.questionCount} 个问题 · {entry.item.modelCount} 个模型 · {entry.item.completedSlots}/{entry.item.totalSlots} 次采样</p> : null}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-lg border border-[#CFE7FA] bg-[#F2F9FF] px-4 py-3 text-[11px] leading-5 text-[#526A83]">
                    系统会在生成时校验两次检测的模型和疑问句样本。样本一致会标记为“可直接对比”；不一致仍可保留观察结果，但会明确标注差异原因。
                    {reportOptions.truncated ? " 当前历史记录超过 1000 次，列表已展示最近 1000 次。" : ""}
                  </div>
                </>
              ) : null}
            </div>

            <footer className="flex flex-wrap justify-end gap-2 border-t border-[#E3EDF6] px-5 py-4">
              <button type="button" onClick={closeReportDialog} disabled={pending.startsWith("generate:")} className="h-9 rounded-lg border border-[#C8D9E8] px-4 text-xs font-semibold disabled:opacity-50">取消</button>
              <button
                type="button"
                onClick={() => void generateReport(reportDialogType, false)}
                disabled={reportOptionsLoading || Boolean(reportOptionsError) || !reportOptions || pending.startsWith("generate:")}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#91CAFF] bg-white px-4 text-xs font-semibold text-[#0958D9] disabled:opacity-50"
              >
                {pending === `generate:${reportDialogType}:draft` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                保存草稿
              </button>
              <button
                type="button"
                onClick={() => void generateReport(reportDialogType, true)}
                disabled={reportOptionsLoading || Boolean(reportOptionsError) || !reportOptions || pending.startsWith("generate:")}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#6C5CE7] px-4 text-xs font-semibold text-white disabled:opacity-50"
              >
                {pending === `generate:${reportDialogType}:publish` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                生成并创建链接
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#00133F]/58 p-3 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-[#E3EDF6] px-5 py-4">
              <div><h3 className="text-base font-semibold">执行设置</h3><p className="mt-1 text-xs text-[#7E91A7]">开始与结束日期共同确定服务周期，自动报送会按该周期生成周报和月报</p></div>
              <button type="button" onClick={() => setSettingsOpen(false)} className="rounded-md p-2 hover:bg-[#EEF5FC]" aria-label="关闭"><X className="h-4 w-4" /></button>
            </header>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-semibold">正式执行日期<input type="date" value={profileDraft.startDate} onChange={event => setProfileDraft({ ...profileDraft, startDate: event.target.value })} className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal outline-none focus:border-[#1677FF]" /></label>
              <label className="space-y-1.5 text-xs font-semibold">正式结束日期<input type="date" min={profileDraft.startDate} value={profileDraft.endDate || ""} onChange={event => setProfileDraft({ ...profileDraft, endDate: event.target.value || undefined })} className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal outline-none focus:border-[#1677FF]" /></label>
              <label className="space-y-1.5 text-xs font-semibold">进度编号方式<select value={profileDraft.periodMode} onChange={event => setProfileDraft({ ...profileDraft, periodMode: event.target.value === "calendar" ? "calendar" : "service" })} className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal outline-none focus:border-[#1677FF]"><option value="service">从正式执行日计算</option><option value="calendar">按自然周 / 自然月计算</option></select></label>
              <label className="space-y-1.5 text-xs font-semibold">当前阶段<select value={profileDraft.currentStage} onChange={event => setProfileDraft({ ...profileDraft, currentStage: event.target.value as ClientExecutionStage })} className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal outline-none focus:border-[#1677FF]">{STAGE_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="space-y-1.5 text-xs font-semibold">项目负责人<input value={profileDraft.projectOwner} onChange={event => setProfileDraft({ ...profileDraft, projectOwner: event.target.value })} placeholder="负责人姓名" className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal outline-none focus:border-[#1677FF]" /></label>
              <label className="space-y-1.5 text-xs font-semibold sm:col-span-2">阶段进度 · {profileDraft.stageProgress}%<input type="range" min="0" max="100" value={profileDraft.stageProgress} onChange={event => setProfileDraft({ ...profileDraft, stageProgress: Number(event.target.value) })} className="w-full accent-[#1677FF]" /></label>
              <label className="space-y-1.5 text-xs font-semibold">预计执行天数<input type="number" min="1" max="3650" value={profileDraft.expectedDurationDays || ""} onChange={event => setProfileDraft({ ...profileDraft, expectedDurationDays: event.target.value ? Number(event.target.value) : undefined })} className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal outline-none focus:border-[#1677FF]" /></label>
              <label className="space-y-1.5 text-xs font-semibold sm:col-span-2">下一阶段计划<textarea value={profileDraft.nextPlan.join("\n")} onChange={event => setProfileDraft({ ...profileDraft, nextPlan: event.target.value.split("\n").map(item => item.trim()).filter(Boolean) })} rows={5} placeholder="每行一项，将直接进入周报或月报" className="w-full rounded-lg border border-[#C8D9E8] px-3 py-2 font-normal leading-5 outline-none focus:border-[#1677FF]" /></label>
            </div>
            <footer className="flex justify-end gap-2 border-t border-[#E3EDF6] px-5 py-4">
              <button type="button" onClick={() => setSettingsOpen(false)} className="h-9 rounded-lg border border-[#C8D9E8] px-4 text-xs font-semibold">取消</button>
              <button type="button" onClick={() => void saveProfile()} disabled={pending === "profile"} className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white disabled:opacity-50">{pending === "profile" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存</button>
            </footer>
          </div>
        </div>
      ) : null}

      {actionOpen ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#00133F]/58 p-3 backdrop-blur-sm" role="dialog" aria-modal="true">
          <form onSubmit={addAction} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-[#E3EDF6] px-5 py-4"><div><h3 className="text-base font-semibold">记录执行动作</h3><p className="mt-1 text-xs text-[#7E91A7]">证据链接将提高客户反馈的可信度</p></div><button type="button" onClick={() => setActionOpen(false)} className="rounded-md p-2 hover:bg-[#EEF5FC]" aria-label="关闭"><X className="h-4 w-4" /></button></header>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-semibold sm:col-span-2">动作名称<input name="title" required maxLength={160} placeholder="例如：发布 10 篇行业疑问型内容" className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal outline-none focus:border-[#1677FF]" /></label>
              <label className="space-y-1.5 text-xs font-semibold">动作类型<select name="category" className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal">{CATEGORY_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="space-y-1.5 text-xs font-semibold">发生日期<input name="occurredDate" type="date" defaultValue={selectedDate} required className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal" /></label>
              <label className="space-y-1.5 text-xs font-semibold">完成状态<select name="status" className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal"><option value="completed">已完成</option><option value="planned">计划中</option></select></label>
              <label className="space-y-1.5 text-xs font-semibold">客户可见性<select name="visibility" className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal"><option value="client">客户可见</option><option value="internal">仅内部可见</option></select></label>
              <label className="space-y-1.5 text-xs font-semibold">发布平台<input name="platform" placeholder="如：搜狐、公众号" className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal" /></label>
              <div className="grid grid-cols-[1fr_.7fr] gap-2"><label className="space-y-1.5 text-xs font-semibold">数量<input name="quantity" type="number" min="0" step="1" className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal" /></label><label className="space-y-1.5 text-xs font-semibold">单位<input name="unit" placeholder="篇/条" className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal" /></label></div>
              <label className="space-y-1.5 text-xs font-semibold sm:col-span-2">执行说明<textarea name="description" rows={4} maxLength={2000} className="w-full rounded-lg border border-[#C8D9E8] px-3 py-2 font-normal leading-5 outline-none focus:border-[#1677FF]" /></label>
              <label className="space-y-1.5 text-xs font-semibold sm:col-span-2">证据网址<input name="evidenceUrl" type="url" placeholder="https://..." className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal outline-none focus:border-[#1677FF]" /></label>
            </div>
            <footer className="flex justify-end gap-2 border-t border-[#E3EDF6] px-5 py-4"><button type="button" onClick={() => setActionOpen(false)} className="h-9 rounded-lg border border-[#C8D9E8] px-4 text-xs font-semibold">取消</button><button type="submit" disabled={pending === "action"} className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white disabled:opacity-50">{pending === "action" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存动作</button></footer>
          </form>
        </div>
      ) : null}

      {batchImportOpen ? (
        <BatchEvidenceImportDialog
          endpoint={endpoint}
          defaultDate={selectedDate}
          onClose={() => setBatchImportOpen(false)}
          onImported={handleBatchImported}
        />
      ) : null}

      {previewReport ? (
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-[#00133F]/72 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true">
          <div className="mx-auto mb-4 flex max-w-6xl flex-col items-stretch justify-between gap-2 rounded-lg bg-[#001D66] px-3 py-2 text-white sm:flex-row sm:items-center sm:gap-3">
            <button type="button" onClick={() => setPreviewReport(null)} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold hover:bg-white/10"><ArrowLeft className="h-4 w-4" />返回执行中心</button>
            {payload.canManage ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" onClick={() => openReportDialog(previewReport.type, previewReport)} disabled={pending.startsWith("generate:")} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/25 px-3 text-xs font-semibold hover:bg-white/10 disabled:opacity-50"><RefreshCw className="h-4 w-4" />生成新版</button>
                {previewReport.status === "draft" ? (
                  <button type="button" onClick={() => void deleteReport(previewReport)} disabled={pending === `delete-report:${previewReport.id}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/25 px-3 text-xs font-semibold hover:bg-white/10 disabled:opacity-50"><Trash2 className="h-4 w-4" />删除草稿</button>
                ) : previewReport.shareEnabled ? (
                  <button type="button" onClick={() => void revokeReportShare(previewReport)} disabled={pending === `revoke:${previewReport.id}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/25 px-3 text-xs font-semibold hover:bg-white/10 disabled:opacity-50"><LockKeyhole className="h-4 w-4" />停止分享</button>
                ) : null}
                {previewReport.status === "published" && previewReport.shareEnabled ? (
                  <>
                    <button type="button" onClick={() => openReportShareUrl(previewReport)} className="inline-flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 text-xs font-semibold"><ExternalLink className="h-4 w-4" />打开网页</button>
                    <button type="button" onClick={() => void copyReportShareUrl(previewReport)} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/25 px-3 text-xs font-semibold hover:bg-white/10">{copiedReportId === previewReport.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copiedReportId === previewReport.id ? "已复制" : "复制链接"}</button>
                    <button type="button" onClick={() => openReportShareUrl(previewReport, true)} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/25 px-3 text-xs font-semibold hover:bg-white/10"><FileDown className="h-4 w-4" />导出 PDF</button>
                  </>
                ) : (
                  <button type="button" onClick={() => void publishReport(previewReport)} disabled={pending === `publish:${previewReport.id}`} className="inline-flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 text-xs font-semibold disabled:opacity-50">
                    {pending === `publish:${previewReport.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                    {previewReport.status === "published" ? "恢复分享并复制链接" : "创建链接并复制"}
                  </button>
                )}
              </div>
            ) : null}
          </div>
          <ClientFeedbackReportView report={previewReport} />
        </div>
      ) : null}
    </div>
  )
}
