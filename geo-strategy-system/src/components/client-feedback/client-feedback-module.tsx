"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
  FileBarChart2,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Trash2,
  X,
} from "lucide-react"
import ClientFeedbackReportView from "@/components/client-feedback/client-feedback-report-view"
import type { Client } from "@/types"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type {
  ClientExecutionAction,
  ClientExecutionProfile,
  ClientExecutionStage,
  ClientFeedbackPeriod,
  ClientFeedbackReport,
  ClientFeedbackReportType,
} from "@/types/client-feedback"

type Payload = {
  accessMode: "standard" | "client"
  canManage: boolean
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
  const [calendarMonth, setCalendarMonth] = useState(today().slice(0, 7))
  const [selectedDate, setSelectedDate] = useState(today())
  const [reportTargetDate, setReportTargetDate] = useState(today())
  const [previewReport, setPreviewReport] = useState<ClientFeedbackReport | null>(null)
  const [copiedReportId, setCopiedReportId] = useState("")
  const [shareUrl, setShareUrl] = useState("")

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

  const cells = useMemo(() => calendarCells(calendarMonth), [calendarMonth])
  const actionsByDate = useMemo(() => {
    const map = new Map<string, ClientExecutionAction[]>()
    for (const action of payload?.actions || []) {
      const day = dateOnly(action.occurredAt)
      map.set(day, [...(map.get(day) || []), action])
    }
    return map
  }, [payload?.actions])
  const selectedActions = actionsByDate.get(selectedDate) || []
  const visibleReports = payload?.reports || []

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
    try {
      const response = await fetch(`${endpoint}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: {
            category: String(form.get("category") || "other"),
            status: String(form.get("status") || "completed"),
            visibility: String(form.get("visibility") || "client"),
            title: String(form.get("title") || ""),
            description: String(form.get("description") || ""),
            occurredAt: `${String(form.get("occurredDate") || today())}T12:00:00+08:00`,
            quantity: form.get("quantity") ? Number(form.get("quantity")) : undefined,
            unit: String(form.get("unit") || ""),
            platform: String(form.get("platform") || ""),
            evidence: evidenceUrl ? [{ label: "查看执行证据", url: evidenceUrl }] : [],
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

  async function deleteAction(action: ClientExecutionAction) {
    if (action.source !== "manual" || !window.confirm(`确认删除“${action.title}”吗？`)) return
    setPending(`delete:${action.id}`)
    setError("")
    try {
      const response = await fetch(`${endpoint}/actions?actionId=${encodeURIComponent(action.id)}`, {
        method: "DELETE",
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "动作记录删除失败，请稍后重试。", subject: "删除动作记录" }))
      await load(true)
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "动作记录删除失败，请稍后重试。", subject: "删除动作记录" }))
    } finally {
      setPending("")
    }
  }

  async function generateReport(type: ClientFeedbackReportType) {
    setPending(`generate:${type}`)
    setError("")
    setNotice("")
    try {
      const response = await fetch(`${endpoint}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, targetDate: reportTargetDate }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(toUserFacingError(body?.error, { status: response.status, fallback: "反馈报告生成失败，请稍后重试。", subject: "反馈报告" }))
      setPreviewReport(body.report as ClientFeedbackReport)
      setNotice("报告草稿已生成，确认后可发布给客户")
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
      const url = new URL(body.sharePath, window.location.origin).toString()
      setShareUrl(url)
      let copied = false
      try {
        await navigator.clipboard.writeText(url)
        copied = true
      } catch {
        copied = false
      }
      setCopiedReportId(copied ? report.id : "")
      setPreviewReport(body.report as ClientFeedbackReport)
      setNotice(copied ? "报告已发布，私密链接已复制" : "报告已发布，请从下方复制私密链接")
      if (copied) window.setTimeout(() => setCopiedReportId(""), 2_000)
      await load(true)
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "报告发布失败，请稍后重试。", subject: "报告发布" }))
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
              正式执行日期 {payload.profile.startDate} · {payload.profile.periodMode === "service" ? "按服务周期" : "按自然周期"}
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
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setActionOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#91CAFF] bg-[#F3F9FF] px-3 text-xs font-semibold text-[#0958D9] hover:bg-[#EAF4FF]">
                <Plus className="h-3.5 w-3.5" />记录动作
              </button>
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
            <p className="mt-0.5 text-[10px] text-[#7E91A7]">客户只能看到标记为“客户可见”的内容</p>
          </header>
          <div className="max-h-[420px] divide-y divide-[#EDF2F7] overflow-y-auto">
            {selectedActions.length === 0 ? (
              <div className="px-5 py-16 text-center text-xs text-[#8AA0B5]">当天没有执行记录</div>
            ) : selectedActions.map(action => (
              <article key={action.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="break-words text-sm font-semibold">{action.title}</h4>
                      <span className="rounded-md bg-[#EDF5FF] px-2 py-0.5 text-[10px] font-semibold text-[#0958D9]">{CATEGORY_LABELS[action.category] || "其他动作"}</span>
                    </div>
                    {action.description ? <p className="mt-1 break-words text-xs leading-5 text-[#6B8299]">{action.description}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-x-3 text-[10px] text-[#8AA0B5]">
                      <span>{formatTime(action.occurredAt)}</span>
                      {action.platform ? <span>{action.platform}</span> : null}
                      {action.visibility === "internal" ? <span className="text-amber-600">仅内部</span> : null}
                    </div>
                    {action.evidence.map(item => <a key={item.url} href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-[#1677FF] hover:underline"><Link2 className="h-3 w-3" />{item.label}</a>)}
                  </div>
                  {payload.canManage && action.source === "manual" ? (
                    <button type="button" onClick={() => void deleteAction(action)} disabled={pending === `delete:${action.id}`} className="shrink-0 rounded-md p-2 text-[#8AA0B5] hover:bg-rose-50 hover:text-rose-600" aria-label="删除动作"><Trash2 className="h-3.5 w-3.5" /></button>
                  ) : null}
                </div>
              </article>
            ))}
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
              <input type="date" value={reportTargetDate} min={payload.profile.startDate} onChange={event => setReportTargetDate(event.target.value)} className="h-9 rounded-lg border border-[#C8D9E8] px-3 text-xs outline-none focus:border-[#1677FF]" />
              <button type="button" onClick={() => void generateReport("weekly")} disabled={pending.startsWith("generate:")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#91CAFF] px-3 text-xs font-semibold text-[#0958D9] disabled:opacity-50">
                {pending === "generate:weekly" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FileBarChart2 className="h-3.5 w-3.5" />}生成周报
              </button>
              <button type="button" onClick={() => void generateReport("monthly")} disabled={pending.startsWith("generate:")} className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#6C5CE7] px-3 text-xs font-semibold text-white disabled:opacity-50">
                {pending === "generate:monthly" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FileBarChart2 className="h-3.5 w-3.5" />}生成月报
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
                  <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${report.type === "weekly" ? "bg-cyan-50 text-cyan-700" : "bg-indigo-50 text-indigo-700"}`}>{report.type === "weekly" ? "周报" : "月报"}</span>
                  <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${report.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{report.status === "published" ? "已发布" : "草稿"}</span>
                </div>
                <h4 className="mt-3 break-words text-sm font-semibold">{report.snapshot.reportTitle}</h4>
                <p className="mt-1 text-[11px] text-[#7E91A7]">{report.periodStart} 至 {report.periodEnd}</p>
                <div className="mt-4 flex items-center gap-2">
                  <button type="button" onClick={() => setPreviewReport(report)} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-[#C8D9E8] bg-white text-xs font-semibold text-[#38536E] hover:border-[#91CAFF]">
                    <ExternalLink className="h-3.5 w-3.5" />查看
                  </button>
                  {payload.canManage ? (
                    <button type="button" onClick={() => void publishReport(report)} disabled={pending === `publish:${report.id}`} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-[#1677FF] text-xs font-semibold text-white disabled:opacity-50">
                      {pending === `publish:${report.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : copiedReportId === report.id ? <Check className="h-3.5 w-3.5" /> : report.status === "published" ? <Copy className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                      {copiedReportId === report.id ? "已复制" : report.status === "published" ? "更新链接" : "发布"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {settingsOpen ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#00133F]/58 p-3 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-[#E3EDF6] px-5 py-4">
              <div><h3 className="text-base font-semibold">执行设置</h3><p className="mt-1 text-xs text-[#7E91A7]">开始日期决定服务周、服务月和反馈周期</p></div>
              <button type="button" onClick={() => setSettingsOpen(false)} className="rounded-md p-2 hover:bg-[#EEF5FC]" aria-label="关闭"><X className="h-4 w-4" /></button>
            </header>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-semibold">正式执行日期<input type="date" value={profileDraft.startDate} onChange={event => setProfileDraft({ ...profileDraft, startDate: event.target.value })} className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal outline-none focus:border-[#1677FF]" /></label>
              <label className="space-y-1.5 text-xs font-semibold">报告周期<select value={profileDraft.periodMode} onChange={event => setProfileDraft({ ...profileDraft, periodMode: event.target.value === "calendar" ? "calendar" : "service" })} className="h-10 w-full rounded-lg border border-[#C8D9E8] px-3 font-normal outline-none focus:border-[#1677FF]"><option value="service">从正式执行日滚动计算</option><option value="calendar">按自然周 / 自然月</option></select></label>
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

      {previewReport ? (
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-[#00133F]/72 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true">
          <div className="mx-auto mb-4 flex max-w-6xl items-center justify-between gap-3 rounded-lg bg-[#001D66] px-3 py-2 text-white">
            <button type="button" onClick={() => setPreviewReport(null)} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold hover:bg-white/10"><ArrowLeft className="h-4 w-4" />返回执行中心</button>
            {payload.canManage ? <button type="button" onClick={() => void publishReport(previewReport)} disabled={pending === `publish:${previewReport.id}`} className="inline-flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 text-xs font-semibold disabled:opacity-50">{pending === `publish:${previewReport.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{previewReport.status === "published" ? "更新并复制链接" : "确认发布并复制链接"}</button> : null}
          </div>
          <ClientFeedbackReportView report={previewReport} />
        </div>
      ) : null}
    </div>
  )
}
