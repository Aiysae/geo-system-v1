"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import {
  CalendarClock,
  Clock3,
  ExternalLink,
  Loader2,
  Mail,
  Pause,
  Play,
  RotateCw,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import type { Client } from "@/types"
import type {
  ClientExecutionProfile,
  ClientFeedbackAutomationExecution,
  ClientFeedbackAutomationSchedule,
  ClientFeedbackAutomationSnapshot,
} from "@/types/client-feedback"

type FormState = {
  weeklyEnabled: boolean
  monthlyEnabled: boolean
  timeLocal: string
  startDate: string
  endDate: string
  periodMode: "service" | "calendar"
  recipientText: string
  sendEmptyReports: boolean
  finalReportEnabled: boolean
}

function addDays(value: string, count: number): string {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + count)).toISOString().slice(0, 10)
}

function defaultForm(profile: ClientExecutionProfile): FormState {
  return {
    weeklyEnabled: true,
    monthlyEnabled: true,
    timeLocal: "10:00",
    startDate: profile.startDate,
    endDate: profile.endDate || addDays(profile.startDate, Math.max(1, profile.expectedDurationDays || 90) - 1),
    periodMode: profile.periodMode,
    recipientText: "",
    sendEmptyReports: true,
    finalReportEnabled: true,
  }
}

function formFromSchedule(schedule: ClientFeedbackAutomationSchedule): FormState {
  return {
    weeklyEnabled: schedule.weeklyEnabled,
    monthlyEnabled: schedule.monthlyEnabled,
    timeLocal: schedule.timeLocal,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    periodMode: schedule.periodMode,
    recipientText: schedule.recipientEmails.join("\n"),
    sendEmptyReports: schedule.sendEmptyReports,
    finalReportEnabled: schedule.finalReportEnabled,
  }
}

function recipientEmails(value: string): string[] {
  return [...new Set(value.split(/[\s,;，；]+/).map(item => item.trim().toLowerCase()).filter(Boolean))]
}

function formatDateTime(value?: string): string {
  if (!value) return "待安排"
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function executionStatus(status: ClientFeedbackAutomationExecution["status"]): { label: string; className: string } {
  if (status === "sent") return { label: "已发送", className: "bg-emerald-50 text-emerald-700" }
  if (status === "partial") return { label: "部分发送", className: "bg-amber-50 text-amber-700" }
  if (status === "failed") return { label: "失败", className: "bg-rose-50 text-rose-700" }
  if (status === "skipped") return { label: "已跳过", className: "bg-slate-100 text-slate-600" }
  if (status === "cancelled") return { label: "已取消", className: "bg-slate-100 text-slate-600" }
  if (status === "generated") return { label: "待发送", className: "bg-cyan-50 text-cyan-700" }
  return { label: "处理中", className: "bg-blue-50 text-blue-700" }
}

function hasActiveExecution(executions: ClientFeedbackAutomationExecution[]): boolean {
  return executions.some(item => ["pending", "running", "generated"].includes(item.status))
}

const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15"

export default function FeedbackAutomationPanel({
  client,
  profile,
  onChanged,
}: {
  client: Client
  profile: ClientExecutionProfile
  onChanged: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [testing, setTesting] = useState(false)
  const [retryingId, setRetryingId] = useState("")
  const [schedule, setSchedule] = useState<ClientFeedbackAutomationSchedule | null>(null)
  const [executions, setExecutions] = useState<ClientFeedbackAutomationExecution[]>([])
  const [form, setForm] = useState<FormState>(() => defaultForm(profile))
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const endpoint = `/api/client-feedback/${encodeURIComponent(client.id)}/automations`
  const emails = useMemo(() => recipientEmails(form.recipientText), [form.recipientText])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const response = await apiFetch(endpoint, { cache: "no-store" })
      const data = await readApiJson<ClientFeedbackAutomationSnapshot & { error?: string }>(response, "自动报送计划查询")
      if (!response.ok) throw new Error(data.error || "自动报送计划读取失败")
      setSchedule(data.schedule)
      setExecutions(data.executions || [])
      if (data.schedule) {
        setForm(formFromSchedule(data.schedule))
      } else {
        const meResponse = await apiFetch("/api/me", { cache: "no-store" })
        const me = await readApiJson<{ user?: { email?: string } }>(meResponse, "账号信息读取")
        setForm(current => ({ ...defaultForm(profile), recipientText: current.recipientText || me.user?.email || "" }))
      }
      setError("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "自动报送计划读取失败")
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [endpoint, profile])

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (!hasActiveExecution(executions)) return
    const timer = window.setInterval(() => void load(true), 12_000)
    return () => window.clearInterval(timer)
  }, [executions, load])

  async function saveSchedule(): Promise<ClientFeedbackAutomationSchedule | null> {
    setSaving(true)
    setError("")
    setNotice("")
    try {
      const target = schedule ? `${endpoint}/${encodeURIComponent(schedule.id)}` : endpoint
      const response = await apiFetch(target, {
        method: schedule ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weeklyEnabled: form.weeklyEnabled,
          monthlyEnabled: form.monthlyEnabled,
          timeLocal: form.timeLocal,
          startDate: form.startDate,
          endDate: form.endDate,
          periodMode: form.periodMode,
          recipientEmails: emails,
          sendEmptyReports: form.sendEmptyReports,
          finalReportEnabled: form.finalReportEnabled,
        }),
      })
      const data = await readApiJson<{ schedule?: ClientFeedbackAutomationSchedule; error?: string }>(response, "自动报送计划保存")
      if (!response.ok || !data.schedule) throw new Error(data.error || "自动报送计划保存失败")
      setSchedule(data.schedule)
      setForm(formFromSchedule(data.schedule))
      setNotice("自动报送计划已保存")
      onChanged()
      return data.schedule
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "自动报送计划保存失败")
      return null
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus() {
    if (!schedule) return
    setSaving(true)
    setError("")
    try {
      const action = schedule.status === "active" ? "pause" : "resume"
      const response = await apiFetch(`${endpoint}/${encodeURIComponent(schedule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await readApiJson<{ schedule?: ClientFeedbackAutomationSchedule; error?: string }>(response, "自动报送状态更新")
      if (!response.ok || !data.schedule) throw new Error(data.error || "状态更新失败")
      setSchedule(data.schedule)
      setNotice(action === "pause" ? "自动报送已暂停" : "自动报送已恢复")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "状态更新失败")
    } finally {
      setSaving(false)
    }
  }

  async function runNow() {
    const target = await saveSchedule()
    if (!target) return
    setRunning(true)
    setError("")
    try {
      const response = await apiFetch(`${endpoint}/${encodeURIComponent(target.id)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID() }),
      })
      const data = await readApiJson<{ execution?: ClientFeedbackAutomationExecution; error?: string }>(response, "立即报送")
      if (!response.ok || !data.execution) throw new Error(data.error || "任务创建失败")
      setExecutions(current => [data.execution!, ...current.filter(item => item.id !== data.execution!.id)].slice(0, 20))
      setNotice("报告任务已提交，完成后会自动发送邮件")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "立即报送失败")
    } finally {
      setRunning(false)
    }
  }

  async function sendTest() {
    const target = await saveSchedule()
    if (!target || !emails[0]) return
    setTesting(true)
    setError("")
    try {
      const response = await apiFetch(`${endpoint}/${encodeURIComponent(target.id)}/test-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emails[0] }),
      })
      const data = await readApiJson<{ ok?: boolean; error?: string }>(response, "测试邮件发送")
      if (!response.ok) throw new Error(data.error || "测试邮件发送失败")
      setNotice(`测试邮件已发送至 ${emails[0]}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "测试邮件发送失败")
    } finally {
      setTesting(false)
    }
  }

  async function retryExecution(execution: ClientFeedbackAutomationExecution) {
    if (!schedule) return
    setRetryingId(execution.id)
    setError("")
    setNotice("")
    try {
      const response = await apiFetch(
        `${endpoint}/${encodeURIComponent(schedule.id)}/executions/${encodeURIComponent(execution.id)}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      )
      const data = await readApiJson<{ execution?: ClientFeedbackAutomationExecution; error?: string }>(response, "自动报送重试")
      if (!response.ok || !data.execution) throw new Error(data.error || "重试任务创建失败")
      setExecutions(current => current.map(item => item.id === data.execution!.id ? data.execution! : item))
      setNotice("失败的报送任务已重新提交")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "自动报送重试失败")
    } finally {
      setRetryingId("")
    }
  }

  async function removeSchedule() {
    if (!schedule || !window.confirm("删除后不再自动生成和发送，历史报告仍会保留。确认删除？")) return
    setSaving(true)
    try {
      const response = await apiFetch(`${endpoint}/${encodeURIComponent(schedule.id)}`, { method: "DELETE" })
      const data = await readApiJson<{ ok?: boolean; error?: string }>(response, "自动报送计划删除")
      if (!response.ok) throw new Error(data.error || "删除失败")
      setSchedule(null)
      setExecutions([])
      setForm(defaultForm(profile))
      setNotice("自动报送计划已删除")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); void load() }} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#79D6E8] bg-[#F0FCFF] px-3 text-xs font-semibold text-[#007A99] transition hover:bg-[#E4F9FD]">
        <CalendarClock className="h-3.5 w-3.5" />自动报送
        {schedule ? <span className={`h-1.5 w-1.5 rounded-full ${schedule.status === "active" ? "bg-emerald-500" : "bg-slate-400"}`} /> : null}
      </button>

      {mounted && open ? createPortal(
        <>
          <button type="button" className="fixed inset-0 z-[118] cursor-default bg-[#00133F]/35 backdrop-blur-[2px]" aria-label="关闭自动报送设置" onClick={() => setOpen(false)} />
          <section role="dialog" aria-modal="true" aria-labelledby="feedback-automation-title" className="fixed left-1/2 top-1/2 z-[119] flex max-h-[min(860px,calc(100vh-2rem))] w-[min(820px,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-[#B7D9FF] bg-white shadow-[0_28px_90px_-24px_rgba(0,49,128,.55)]">
            <header className="flex shrink-0 items-start justify-between border-b border-[#DDEBFA] px-5 py-4">
              <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white shadow-lg shadow-blue-200/70"><CalendarClock className="h-5 w-5" /></span><div><h2 id="feedback-automation-title" className="text-base font-semibold text-slate-900">周报与月报自动报送</h2><p className="mt-1 text-xs text-slate-500">{client.name} · 周期结束后自动生成私密链接并发送邮件</p></div></div>
              <button type="button" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="关闭"><X className="h-4 w-4" /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {loading ? <div className="flex min-h-56 items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取报送计划</div> : (
                <div className="space-y-5">
                  {schedule ? <ScheduleSummary schedule={schedule} /> : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ReportToggle checked={form.weeklyEnabled} tone="cyan" title="自动周报" detail="每个完整 7 天周期结束后报送" onChange={checked => setForm(current => ({ ...current, weeklyEnabled: checked }))} />
                    <ReportToggle checked={form.monthlyEnabled} tone="indigo" title="自动月报" detail="按服务月或自然月结束后报送" onChange={checked => setForm(current => ({ ...current, monthlyEnabled: checked }))} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="正式开始日期"><input type="date" value={form.startDate} onChange={event => setForm(current => ({ ...current, startDate: event.target.value }))} className={inputClass} /></Field>
                    <Field label="正式结束日期"><input type="date" min={form.startDate} value={form.endDate} onChange={event => setForm(current => ({ ...current, endDate: event.target.value }))} className={inputClass} /></Field>
                    <Field label="周期方式"><select value={form.periodMode} onChange={event => setForm(current => ({ ...current, periodMode: event.target.value === "calendar" ? "calendar" : "service" }))} className={inputClass}><option value="service">从执行日计算</option><option value="calendar">自然周 / 自然月</option></select></Field>
                    <Field label="发送时间"><input type="time" value={form.timeLocal} onChange={event => setForm(current => ({ ...current, timeLocal: event.target.value }))} className={inputClass} /></Field>
                  </div>
                  <Field label={`报送邮箱 · ${emails.length}/10`}><textarea value={form.recipientText} onChange={event => setForm(current => ({ ...current, recipientText: event.target.value }))} rows={3} placeholder="每行一个邮箱，最多 10 个" className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15" /></Field>
                  <div className="flex flex-wrap gap-x-6 gap-y-3 border-y border-slate-100 py-3"><label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={form.finalReportEnabled} onChange={event => setForm(current => ({ ...current, finalReportEnabled: event.target.checked }))} className="h-4 w-4 accent-[#1677FF]" />结束日生成收官报告</label><label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={form.sendEmptyReports} onChange={event => setForm(current => ({ ...current, sendEmptyReports: event.target.checked }))} className="h-4 w-4 accent-[#1677FF]" />无动作时仍如实报送</label></div>
                  {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div> : null}
                  {notice ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div> : null}
                  {schedule ? (
                    <ExecutionHistory
                      executions={executions}
                      retryingId={retryingId}
                      onRefresh={() => void load()}
                      onRetry={execution => void retryExecution(execution)}
                    />
                  ) : null}
                </div>
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#DDEBFA] bg-[#F8FBFF] px-5 py-3.5">
              <div>{schedule ? <button type="button" onClick={() => void removeSchedule()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md px-2.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />删除计划</button> : null}</div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {schedule ? <button type="button" onClick={() => void toggleStatus()} disabled={saving || schedule.status === "completed"} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[#91CAFF] hover:text-[#0958D9] disabled:opacity-50">{schedule.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{schedule.status === "active" ? "暂停" : "恢复"}</button> : null}
                <button type="button" onClick={() => void sendTest()} disabled={testing || saving || emails.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[#91CAFF] hover:text-[#0958D9] disabled:opacity-50">{testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}测试邮件</button>
                <button type="button" onClick={() => void runNow()} disabled={running || saving || hasActiveExecution(executions)} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#91CAFF] bg-white px-3 text-xs font-semibold text-[#0958D9] transition hover:bg-[#EEF7FF] disabled:opacity-50">{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}立即报送</button>
                <button type="button" onClick={() => void saveSchedule()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white shadow-md shadow-blue-200/60 transition hover:brightness-105 disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存计划</button>
              </div>
            </footer>
          </section>
        </>,
        document.body,
      ) : null}
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</span>{children}</label>
}

function ReportToggle({ checked, tone, title, detail, onChange }: { checked: boolean; tone: "cyan" | "indigo"; title: string; detail: string; onChange: (checked: boolean) => void }) {
  const active = tone === "cyan" ? "border-cyan-300 bg-cyan-50/70" : "border-indigo-300 bg-indigo-50/70"
  return <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${checked ? active : "border-slate-200"}`}><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="h-4 w-4 accent-[#1677FF]" /><span><span className="block text-xs font-semibold text-slate-900">{title}</span><span className="mt-0.5 block text-[10px] text-slate-500">{detail}</span></span></label>
}

function ScheduleSummary({ schedule }: { schedule: ClientFeedbackAutomationSchedule }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#CDE4FF] bg-[#F3F9FF] px-4 py-3"><div className="flex items-center gap-3"><span className={`h-2 w-2 rounded-full ${schedule.status === "active" ? "bg-emerald-500" : "bg-slate-400"}`} /><div><div className="text-xs font-semibold text-slate-900">{schedule.status === "active" ? "计划运行中" : schedule.status === "completed" ? "项目周期已结束" : "计划已暂停"}</div><div className="mt-0.5 text-[11px] text-slate-500">下次报送：{schedule.status === "active" ? formatDateTime(schedule.nextRunAt) : "暂无安排"}</div></div></div>{schedule.consecutiveFailures > 0 ? <span className="text-[11px] font-medium text-amber-700">连续失败 {schedule.consecutiveFailures} 次</span> : null}</div>
}

function ExecutionHistory({
  executions,
  retryingId,
  onRefresh,
  onRetry,
}: {
  executions: ClientFeedbackAutomationExecution[]
  retryingId: string
  onRefresh: () => void
  onRetry: (execution: ClientFeedbackAutomationExecution) => void
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-800">最近报送</h3>
        <button type="button" onClick={onRefresh} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-[#1677FF]" aria-label="刷新报送记录">
          <RotateCw className="h-3.5 w-3.5" />
        </button>
      </div>
      {executions.length ? (
        <div className="divide-y divide-slate-100 border-y border-slate-100">
          {executions.slice(0, 8).map(execution => {
            const meta = executionStatus(execution.status)
            const retryable = ["failed", "partial"].includes(execution.status)
            return (
              <div key={execution.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                    <Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    {formatDateTime(execution.scheduledFor)}
                    <span className="text-[10px] text-slate-400">{execution.trigger === "manual" ? "立即报送" : "计划报送"}</span>
                  </div>
                  <div className="mt-1 break-words text-[11px] text-slate-500">
                    {execution.error || `${execution.reports.length || execution.periods.length} 份报告 · ${execution.deliveries.filter(item => item.status === "sent").length}/${execution.deliveries.length} 个邮箱已发送`}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <span className={`rounded px-2 py-1 text-[10px] font-semibold ${meta.className}`}>{meta.label}</span>
                  {execution.reports.map(report => report.sharePath ? (
                    <a key={`${report.type}:${report.reportId}`} href={report.sharePath} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-[#0958D9] transition hover:bg-[#EEF7FF]">
                      <ExternalLink className="h-3 w-3" />{report.type === "weekly" ? "周报" : "月报"}
                    </a>
                  ) : null)}
                  {retryable ? (
                    <button type="button" onClick={() => onRetry(execution)} disabled={retryingId === execution.id} className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-200 px-2 text-[10px] font-semibold text-amber-700 transition hover:bg-amber-50 disabled:opacity-50">
                      {retryingId === execution.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}重试
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="border-y border-slate-100 py-6 text-center text-xs text-slate-400">暂无报送记录</div>
      )}
    </div>
  )
}
