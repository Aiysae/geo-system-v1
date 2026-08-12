"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import {
  BellRing,
  CalendarClock,
  Clock3,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  RotateCw,
  Save,
  Trash2,
  X,
} from "lucide-react"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import type {
  PenetrationAutomationExecution,
  PenetrationAutomationSchedule,
  PenetrationAutomationSnapshot,
} from "@/lib/penetration/automation-types"
import type { Client } from "@/types"

type Props = { client: Client; canExecute: boolean }

type FormState = {
  intervalDays: number
  timeLocal: string
  startDate: string
  relativeDropThresholdPct: number
  minimumAbsoluteDropPoints: number
  inAppEnabled: boolean
  emailEnabled: boolean
  monthlyCreditLimit: string
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function defaultForm(): FormState {
  return {
    intervalDays: 1,
    timeLocal: "09:00",
    startDate: shanghaiToday(),
    relativeDropThresholdPct: 20,
    minimumAbsoluteDropPoints: 3,
    inAppEnabled: true,
    emailEnabled: true,
    monthlyCreditLimit: "",
  }
}

function formFromSchedule(schedule: PenetrationAutomationSchedule): FormState {
  return {
    intervalDays: schedule.intervalDays,
    timeLocal: schedule.timeLocal,
    startDate: schedule.startDate,
    relativeDropThresholdPct: schedule.relativeDropThresholdPct,
    minimumAbsoluteDropPoints: schedule.minimumAbsoluteDropPoints,
    inAppEnabled: schedule.inAppEnabled,
    emailEnabled: schedule.emailEnabled,
    monthlyCreditLimit: schedule.monthlyCreditLimit
      ? String(schedule.monthlyCreditLimit)
      : "",
  }
}

function activeExecution(execution: PenetrationAutomationExecution): boolean {
  return ["pending", "submitted", "running"].includes(execution.status)
}

function executionStatus(status: PenetrationAutomationExecution["status"]): {
  label: string
  className: string
} {
  if (status === "succeeded") return { label: "已完成", className: "bg-emerald-50 text-emerald-700" }
  if (status === "partial") return { label: "部分完成", className: "bg-amber-50 text-amber-700" }
  if (status === "failed") return { label: "失败", className: "bg-rose-50 text-rose-700" }
  if (status === "skipped") return { label: "本次跳过", className: "bg-slate-100 text-slate-600" }
  if (status === "cancelled") return { label: "已取消", className: "bg-slate-100 text-slate-600" }
  return { label: "执行中", className: "bg-blue-50 text-blue-700" }
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

const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15 disabled:bg-slate-50"

export default function PenetrationAutomationPanel({ client, canExecute }: Props) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [schedule, setSchedule] = useState<PenetrationAutomationSchedule | null>(null)
  const [executions, setExecutions] = useState<PenetrationAutomationExecution[]>([])
  const [form, setForm] = useState<FormState>(defaultForm)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const response = await apiFetch(
        `/api/penetration/automations?clientId=${encodeURIComponent(client.id)}`,
        { cache: "no-store" },
      )
      const data = await readApiJson<PenetrationAutomationSnapshot & { error?: string }>(
        response,
        "自动检测计划查询",
      )
      if (!response.ok) throw new Error(data.error || "自动检测计划读取失败")
      setSchedule(data.schedule)
      setExecutions(data.executions || [])
      if (data.schedule) setForm(formFromSchedule(data.schedule))
      setError("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "自动检测计划读取失败")
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [client.id])

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0)
    return () => window.clearTimeout(timer)
  }, [client.id, load])

  const hasActiveExecution = useMemo(
    () => executions.some(activeExecution),
    [executions],
  )

  useEffect(() => {
    if (!hasActiveExecution) return
    const timer = window.setInterval(() => void load(true), 15_000)
    return () => window.clearInterval(timer)
  }, [hasActiveExecution, load])

  async function saveSchedule(): Promise<PenetrationAutomationSchedule | null> {
    if (!canExecute) return null
    setSaving(true)
    setError("")
    setNotice("")
    try {
      const endpoint = schedule
        ? `/api/penetration/automations/${encodeURIComponent(schedule.id)}`
        : "/api/penetration/automations"
      const response = await apiFetch(endpoint, {
        method: schedule ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          intervalDays: form.intervalDays,
          timeLocal: form.timeLocal,
          startDate: form.startDate,
          relativeDropThresholdPct: form.relativeDropThresholdPct,
          minimumAbsoluteDropPoints: form.minimumAbsoluteDropPoints,
          inAppEnabled: form.inAppEnabled,
          emailEnabled: form.emailEnabled,
          monthlyCreditLimit: form.monthlyCreditLimit
            ? Number(form.monthlyCreditLimit)
            : null,
        }),
      })
      const data = await readApiJson<{ schedule?: PenetrationAutomationSchedule; error?: string }>(
        response,
        "自动检测计划保存",
      )
      if (!response.ok || !data.schedule) throw new Error(data.error || "保存失败")
      setSchedule(data.schedule)
      setForm(formFromSchedule(data.schedule))
      setNotice("自动检测计划已保存")
      return data.schedule
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "自动检测计划保存失败")
      return null
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus() {
    if (!schedule || !canExecute) return
    setSaving(true)
    setError("")
    try {
      const action = schedule.status === "active" ? "pause" : "resume"
      const response = await apiFetch(`/api/penetration/automations/${encodeURIComponent(schedule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, action }),
      })
      const data = await readApiJson<{ schedule?: PenetrationAutomationSchedule; error?: string }>(
        response,
        "自动检测计划状态更新",
      )
      if (!response.ok || !data.schedule) throw new Error(data.error || "状态更新失败")
      setSchedule(data.schedule)
      setNotice(action === "pause" ? "自动检测计划已暂停" : "自动检测计划已恢复")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "状态更新失败")
    } finally {
      setSaving(false)
    }
  }

  async function runNow() {
    if (!canExecute || running) return
    let target = schedule
    if (!target) target = await saveSchedule()
    if (!target) return
    setRunning(true)
    setError("")
    try {
      const response = await apiFetch(
        `/api/penetration/automations/${encodeURIComponent(target.id)}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: client.id }),
        },
      )
      const data = await readApiJson<{ execution?: PenetrationAutomationExecution; error?: string }>(
        response,
        "自动检测立即执行",
      )
      if (!response.ok || !data.execution) throw new Error(data.error || "任务创建失败")
      setExecutions(current => [data.execution!, ...current].slice(0, 12))
      setNotice("检测任务已提交，可继续使用其他功能")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "立即检测失败")
    } finally {
      setRunning(false)
    }
  }

  async function removeSchedule() {
    if (!schedule || !canExecute) return
    if (!window.confirm("删除后将不再自动检测，历史报告不会被删除。确认删除？")) return
    setSaving(true)
    try {
      const response = await apiFetch(
        `/api/penetration/automations/${encodeURIComponent(schedule.id)}?clientId=${encodeURIComponent(client.id)}`,
        { method: "DELETE" },
      )
      const data = await readApiJson<{ ok?: boolean; error?: string }>(response, "自动检测计划删除")
      if (!response.ok) throw new Error(data.error || "删除失败")
      setSchedule(null)
      setExecutions([])
      setForm(defaultForm())
      setNotice("自动检测计划已删除")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); void load() }}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[#91CAFF] bg-white px-3 text-xs font-semibold text-[#0958D9] transition hover:border-[#1677FF] hover:bg-[#EEF7FF]"
      >
        <CalendarClock className="h-4 w-4" />
        自动检测
        {schedule ? <span className={`h-1.5 w-1.5 rounded-full ${schedule.status === "active" ? "bg-emerald-500" : "bg-slate-400"}`} /> : null}
      </button>

      {mounted && open ? createPortal(
        <>
          <button type="button" className="fixed inset-0 z-[118] cursor-default bg-[#00133F]/35 backdrop-blur-[2px]" aria-label="关闭自动检测设置" onClick={() => setOpen(false)} />
          <section role="dialog" aria-modal="true" aria-labelledby="penetration-automation-title" className="fixed left-1/2 top-1/2 z-[119] flex max-h-[min(820px,calc(100vh-2rem))] w-[min(760px,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-[#B7D9FF] bg-white shadow-[0_28px_90px_-24px_rgba(0,49,128,.55)]">
            <header className="flex shrink-0 items-start justify-between border-b border-[#DDEBFA] px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white shadow-lg shadow-blue-200/70"><CalendarClock className="h-5 w-5" /></span>
                <div>
                  <h2 id="penetration-automation-title" className="text-base font-semibold text-slate-900">自动渗透率检测</h2>
                  <p className="mt-1 text-xs text-slate-500">{client.name} · 当前已保存的疑问句与模型</p>
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="关闭"><X className="h-4 w-4" /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {loading ? (
                <div className="flex min-h-48 items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取计划</div>
              ) : (
                <div className="space-y-5">
                  {schedule ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#CDE4FF] bg-[#F3F9FF] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className={`h-2 w-2 rounded-full ${schedule.status === "active" ? "bg-emerald-500" : "bg-slate-400"}`} />
                        <div>
                          <div className="text-xs font-semibold text-slate-900">{schedule.status === "active" ? "计划运行中" : "计划已暂停"}</div>
                          <div className="mt-0.5 text-[11px] text-slate-500">下次检测：{schedule.status === "active" ? formatDateTime(schedule.nextRunAt) : "恢复后重新安排"}</div>
                        </div>
                      </div>
                      {schedule.consecutiveFailures > 0 ? <div className="text-[11px] font-medium text-amber-700">连续失败 {schedule.consecutiveFailures} 次</div> : null}
                    </div>
                  ) : null}

                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="检测间隔">
                      <select value={form.intervalDays} onChange={event => setForm(current => ({ ...current, intervalDays: Number(event.target.value) }))} disabled={!canExecute} className={inputClass}>
                        {Array.from({ length: 7 }, (_, index) => index + 1).map(days => <option key={days} value={days}>每 {days} 天</option>)}
                      </select>
                    </Field>
                    <Field label="执行时间"><input type="time" value={form.timeLocal} onChange={event => setForm(current => ({ ...current, timeLocal: event.target.value }))} disabled={!canExecute} className={inputClass} /></Field>
                    <Field label="首次日期"><input type="date" value={form.startDate} onChange={event => setForm(current => ({ ...current, startDate: event.target.value }))} disabled={!canExecute} className={inputClass} /></Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="相对下降提醒（%）"><input type="number" min="1" max="100" value={form.relativeDropThresholdPct} onChange={event => setForm(current => ({ ...current, relativeDropThresholdPct: Number(event.target.value) }))} disabled={!canExecute} className={inputClass} /></Field>
                    <Field label="最低下降百分点"><input type="number" min="0" max="100" value={form.minimumAbsoluteDropPoints} onChange={event => setForm(current => ({ ...current, minimumAbsoluteDropPoints: Number(event.target.value) }))} disabled={!canExecute} className={inputClass} /></Field>
                    <Field label="每月积分上限"><input type="number" min="1" value={form.monthlyCreditLimit} onChange={event => setForm(current => ({ ...current, monthlyCreditLimit: event.target.value }))} placeholder="不限制" disabled={!canExecute} className={inputClass} /></Field>
                  </div>

                  <div className="flex flex-wrap gap-x-6 gap-y-3 border-y border-slate-100 py-3">
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={form.inAppEnabled} onChange={event => setForm(current => ({ ...current, inAppEnabled: event.target.checked }))} disabled={!canExecute} className="h-4 w-4 accent-[#1677FF]" /><BellRing className="h-3.5 w-3.5 text-[#1677FF]" />站内提醒</label>
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={form.emailEnabled} onChange={event => setForm(current => ({ ...current, emailEnabled: event.target.checked }))} disabled={!canExecute} className="h-4 w-4 accent-[#1677FF]" />邮件提醒</label>
                  </div>

                  {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div> : null}
                  {notice ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div> : null}

                  {schedule ? (
                    <div>
                      <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold text-slate-800">最近执行</h3><button type="button" onClick={() => void load()} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-[#1677FF]" aria-label="刷新执行记录" title="刷新"><RotateCw className="h-3.5 w-3.5" /></button></div>
                      {executions.length ? (
                        <div className="divide-y divide-slate-100 border-y border-slate-100">
                          {executions.slice(0, 6).map(execution => {
                            const meta = executionStatus(execution.status)
                            return <div key={execution.id} className="flex items-start justify-between gap-4 py-2.5"><div className="min-w-0"><div className="flex items-center gap-2 text-xs text-slate-700"><Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-400" />{formatDateTime(execution.scheduledFor)}<span className="text-[10px] text-slate-400">{execution.trigger === "manual" ? "立即检测" : "计划检测"}</span></div><div className="mt-1 truncate text-[11px] text-slate-500">{execution.comparisonReason || execution.error || (activeExecution(execution) ? "任务正在后台执行" : "执行记录已保存")}</div></div><div className="flex shrink-0 items-center gap-2"><span className={`rounded px-2 py-1 text-[10px] font-semibold ${meta.className}`}>{meta.label}</span>{execution.historyRecordId ? <a href={`/workspace/results/penetration/${encodeURIComponent(execution.historyRecordId)}`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-[#0958D9] transition hover:bg-[#EEF7FF]"><ExternalLink className="h-3 w-3" />查看报告</a> : null}</div></div>
                          })}
                        </div>
                      ) : <div className="border-y border-slate-100 py-6 text-center text-xs text-slate-400">暂无执行记录</div>}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#DDEBFA] bg-[#F8FBFF] px-5 py-3.5">
              <div>{schedule && canExecute ? <button type="button" onClick={() => void removeSchedule()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md px-2.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />删除计划</button> : null}</div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {schedule && canExecute ? <button type="button" onClick={() => void toggleStatus()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[#91CAFF] hover:text-[#0958D9] disabled:opacity-50">{schedule.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{schedule.status === "active" ? "暂停" : "恢复"}</button> : null}
                {canExecute ? <button type="button" onClick={() => void runNow()} disabled={running || saving || hasActiveExecution} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#91CAFF] bg-white px-3 text-xs font-semibold text-[#0958D9] transition hover:bg-[#EEF7FF] disabled:cursor-not-allowed disabled:opacity-50">{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}立即检测</button> : null}
                {canExecute ? <button type="button" onClick={() => void saveSchedule()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white shadow-md shadow-blue-200/60 transition hover:brightness-105 disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存计划</button> : <span className="text-xs text-slate-500">当前账号仅可查看</span>}
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
