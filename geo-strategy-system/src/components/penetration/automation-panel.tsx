"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import {
  BellRing,
  CheckSquare2,
  CalendarClock,
  Clock3,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  RotateCw,
  Save,
  Trash2,
  Square,
  X,
} from "lucide-react"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { MODEL_LABELS } from "@/lib/model-labels"
import { estimateFeatureCredits } from "@/lib/pricing"
import type {
  PenetrationAutomationExecution,
  PenetrationAutomationSchedule,
  PenetrationAutomationSnapshot,
} from "@/lib/penetration/automation-types"
import type { Client, ModelKey, PenetrationQuestionIntentHint } from "@/types"

type Props = {
  client: Client
  canExecute: boolean
  canManage: boolean
  teamId?: string
}

type QuestionOption = {
  id: string
  question: string
  intent?: PenetrationQuestionIntentHint
}

type FormState = {
  intervalDays: number
  timeLocal: string
  startDate: string
  relativeDropThresholdPct: number
  minimumAbsoluteDropPoints: number
  inAppEnabled: boolean
  emailEnabled: boolean
  monthlyCreditLimit: string
  models: ModelKey[]
  selectedQuestionIds: string[]
}

const ALL_MODELS: ModelKey[] = ["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"]

function questionOptions(
  questions: string[],
  intents: PenetrationQuestionIntentHint[] = [],
): QuestionOption[] {
  const intentByQuestion = new Map(intents.map(item => [item.question.trim(), item]))
  return questions.map((question, index) => ({
    id: `${index}:${question}`,
    question,
    intent: intentByQuestion.get(question.trim()),
  }))
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function defaultForm(client: Client): FormState {
  const options = questionOptions(client.questions, client.questionIntentHints)
  return {
    intervalDays: 1,
    timeLocal: "09:00",
    startDate: shanghaiToday(),
    relativeDropThresholdPct: 20,
    minimumAbsoluteDropPoints: 3,
    inAppEnabled: true,
    emailEnabled: true,
    monthlyCreditLimit: "",
    models: [...client.selectedModels],
    selectedQuestionIds: options.map(option => option.id),
  }
}

function formFromSchedule(
  schedule: PenetrationAutomationSchedule,
  client: Client,
): { form: FormState; questions: QuestionOption[] } {
  const detection = schedule.detectionConfig
  const options = detection
    ? questionOptions(detection.questions, detection.questionIntents)
    : questionOptions(client.questions, client.questionIntentHints)
  return {
    questions: options,
    form: {
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
      models: detection?.requestedModels.length
        ? [...detection.requestedModels]
        : [...client.selectedModels],
      selectedQuestionIds: options.map(option => option.id),
    },
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

export default function PenetrationAutomationPanel({
  client,
  canExecute,
  canManage,
  teamId,
}: Props) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [cancellingExecutionId, setCancellingExecutionId] = useState("")
  const [schedule, setSchedule] = useState<PenetrationAutomationSchedule | null>(null)
  const [executions, setExecutions] = useState<PenetrationAutomationExecution[]>([])
  const [questionChoices, setQuestionChoices] = useState<QuestionOption[]>(() => (
    questionOptions(client.questions, client.questionIntentHints)
  ))
  const [form, setForm] = useState<FormState>(() => defaultForm(client))
  const [modelReadiness, setModelReadiness] = useState<Partial<Record<ModelKey, {
    ready: boolean
    reason?: string
  }>>>({})
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const response = await apiFetch(
        `/api/penetration/automations?${new URLSearchParams({
          clientId: client.id,
          ...(teamId ? { teamId } : {}),
        })}`,
        { cache: "no-store" },
      )
      const data = await readApiJson<PenetrationAutomationSnapshot & { error?: string }>(
        response,
        "自动检测计划查询",
      )
      if (!response.ok) throw new Error(data.error || "自动检测计划读取失败")
      setSchedule(data.schedule)
      setExecutions(data.executions || [])
      if (data.schedule) {
        const next = formFromSchedule(data.schedule, client)
        setForm(next.form)
        setQuestionChoices(next.questions)
      }
      setError("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "自动检测计划读取失败")
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [client, teamId])

  const loadReadiness = useCallback(async () => {
    try {
      const response = await apiFetch("/api/penetration/readiness", { cache: "no-store" })
      const data = await readApiJson<{
        readiness?: Array<{ model: ModelKey; ready: boolean; reason?: string }>
      }>(response, "检测模型状态查询")
      if (!response.ok) return
      const next: Partial<Record<ModelKey, { ready: boolean; reason?: string }>> = {}
      for (const item of data.readiness || []) next[item.model] = item
      setModelReadiness(next)
    } catch {
      setModelReadiness({})
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0)
    return () => window.clearTimeout(timer)
  }, [client.id, load])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void loadReadiness(), 0)
    return () => window.clearTimeout(timer)
  }, [open, loadReadiness])

  const hasActiveExecution = useMemo(
    () => executions.some(activeExecution),
    [executions],
  )

  const selectedQuestions = useMemo(() => {
    const selected = new Set(form.selectedQuestionIds)
    return questionChoices.filter(option => selected.has(option.id))
  }, [form.selectedQuestionIds, questionChoices])

  const estimatedSlots = selectedQuestions.length * form.models.length
  const estimatedCredits = estimateFeatureCredits("penetrationSlot", estimatedSlots)

  function useCurrentQuestions() {
    const options = questionOptions(client.questions, client.questionIntentHints)
    setQuestionChoices(options)
    setForm(current => ({
      ...current,
      selectedQuestionIds: options.map(option => option.id),
    }))
    setNotice("已载入客户当前保存的疑问句，保存计划后才会生效")
  }

  function toggleQuestion(id: string) {
    setForm(current => ({
      ...current,
      selectedQuestionIds: current.selectedQuestionIds.includes(id)
        ? current.selectedQuestionIds.filter(item => item !== id)
        : [...current.selectedQuestionIds, id],
    }))
  }

  function toggleModel(model: ModelKey) {
    setForm(current => ({
      ...current,
      models: current.models.includes(model)
        ? current.models.filter(item => item !== model)
        : [...current.models, model],
    }))
  }

  useEffect(() => {
    if (!hasActiveExecution) return
    const timer = window.setInterval(() => void load(true), 15_000)
    return () => window.clearInterval(timer)
  }, [hasActiveExecution, load])

  async function saveSchedule(): Promise<PenetrationAutomationSchedule | null> {
    if (!canManage) return null
    if (!selectedQuestions.length) {
      setError("请至少选择一个自动检测疑问句")
      return null
    }
    if (!form.models.length) {
      setError("请至少选择一个自动检测模型")
      return null
    }
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
          teamId,
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
          questions: selectedQuestions.map(option => option.question),
          questionIntents: selectedQuestions.flatMap(option => option.intent ? [option.intent] : []),
          models: form.models,
        }),
      })
      const data = await readApiJson<{ schedule?: PenetrationAutomationSchedule; error?: string }>(
        response,
        "自动检测计划保存",
      )
      if (!response.ok || !data.schedule) throw new Error(data.error || "保存失败")
      setSchedule(data.schedule)
      const next = formFromSchedule(data.schedule, client)
      setForm(next.form)
      setQuestionChoices(next.questions)
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
    if (!schedule || !canManage) return
    setSaving(true)
    setError("")
    try {
      const action = schedule.status === "active" ? "pause" : "resume"
      const response = await apiFetch(`/api/penetration/automations/${encodeURIComponent(schedule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, teamId, action }),
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
          body: JSON.stringify({ clientId: client.id, teamId }),
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
    if (!schedule || !canManage) return
    if (!window.confirm("删除后将停止当前未完成任务和所有后续检测，历史报告仍会保留。确认删除？")) return
    setSaving(true)
    try {
      const response = await apiFetch(
        `/api/penetration/automations/${encodeURIComponent(schedule.id)}?${new URLSearchParams({
          clientId: client.id,
          ...(teamId ? { teamId } : {}),
        })}`,
        { method: "DELETE" },
      )
      const data = await readApiJson<{ ok?: boolean; error?: string }>(response, "自动检测计划删除")
      if (!response.ok) throw new Error(data.error || "删除失败")
      setSchedule(null)
      setExecutions([])
      const options = questionOptions(client.questions, client.questionIntentHints)
      setQuestionChoices(options)
      setForm(defaultForm(client))
      setNotice("自动检测计划已删除")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败")
    } finally {
      setSaving(false)
    }
  }

  async function cancelExecution(execution: PenetrationAutomationExecution) {
    if (!schedule || !canExecute || !activeExecution(execution)) return
    if (!window.confirm("确认停止本次检测？已经完成的结果会保留，未执行部分不再继续调用。")) return
    setCancellingExecutionId(execution.id)
    setError("")
    try {
      const response = await apiFetch(
        `/api/penetration/automations/${encodeURIComponent(schedule.id)}/executions/${encodeURIComponent(execution.id)}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: client.id, teamId }),
        },
      )
      const data = await readApiJson<{
        execution?: PenetrationAutomationExecution
        message?: string
        error?: string
      }>(response, "停止自动检测")
      if (!response.ok || !data.execution) throw new Error(data.error || "停止失败")
      setExecutions(current => current.map(item => (
        item.id === data.execution!.id ? data.execution! : item
      )))
      setNotice(data.message || "本次自动检测已停止")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "停止自动检测失败")
    } finally {
      setCancellingExecutionId("")
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
                  <p className="mt-1 text-xs text-slate-500">{client.name} · 固定疑问句与模型口径</p>
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
                      <div className="flex items-center gap-2">
                        {schedule.consecutiveFailures > 0 ? <div className="text-[11px] font-medium text-amber-700">连续失败 {schedule.consecutiveFailures} 次</div> : null}
                        {canManage ? <button type="button" onClick={() => void toggleStatus()} disabled={saving} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#91CAFF] bg-white px-2.5 text-[11px] font-semibold text-[#0958D9] transition hover:bg-[#EAF5FF] disabled:opacity-50">{schedule.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{schedule.status === "active" ? "暂停计划" : "恢复计划"}</button> : null}
                      </div>
                    </div>
                  ) : null}

                  <section className="rounded-lg border border-slate-200 bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                      <div>
                        <h3 className="text-xs font-semibold text-slate-900">检测疑问句</h3>
                        <p className="mt-1 text-[11px] text-slate-500">已选择 {selectedQuestions.length}/{questionChoices.length} 条，保存后固定为本计划口径</p>
                      </div>
                      {canManage ? <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={useCurrentQuestions} className="h-8 rounded-md border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 transition hover:border-[#91CAFF] hover:text-[#0958D9]">同步当前疑问句</button>
                        <button type="button" onClick={() => setForm(current => ({ ...current, selectedQuestionIds: questionChoices.map(option => option.id) }))} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold text-[#0958D9] hover:bg-[#EEF7FF]"><CheckSquare2 className="h-3.5 w-3.5" />全选</button>
                        <button type="button" onClick={() => setForm(current => ({ ...current, selectedQuestionIds: [] }))} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-100"><Square className="h-3.5 w-3.5" />清空</button>
                      </div> : null}
                    </div>
                    <div className="max-h-48 overflow-y-auto p-2">
                      {questionChoices.length ? questionChoices.map((option, index) => (
                        <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-xs text-slate-700 transition hover:bg-[#F3F9FF]">
                          <input type="checkbox" checked={form.selectedQuestionIds.includes(option.id)} onChange={() => toggleQuestion(option.id)} disabled={!canManage} className="mt-0.5 h-4 w-4 shrink-0 accent-[#1677FF]" />
                          <span className="min-w-0 flex-1 leading-5"><span className="mr-1 text-[10px] text-slate-400">#{index + 1}</span>{option.question}</span>
                          {option.intent ? <span className="shrink-0 rounded bg-[#EAF5FF] px-1.5 py-0.5 text-[10px] text-[#0958D9]">{option.intent.category}</span> : null}
                        </label>
                      )) : <div className="py-6 text-center text-xs text-slate-400">当前客户还没有保存疑问句</div>}
                    </div>
                  </section>

                  <section className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-semibold text-slate-900">检测模型</h3>
                        <p className="mt-1 text-[11px] text-slate-500">固定模型口径；任一模型暂不可用时先重试，不静默换模型</p>
                      </div>
                      <span className="text-[11px] font-semibold text-[#0958D9]">{estimatedSlots} 次联网检测 · 预计 {estimatedCredits} 积分</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {ALL_MODELS.map(model => {
                        const readiness = modelReadiness[model]
                        const selected = form.models.includes(model)
                        return <button key={model} type="button" onClick={() => canManage && toggleModel(model)} disabled={!canManage} title={readiness?.reason} className={`flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition ${selected ? "border-[#69B1FF] bg-[#EAF5FF] text-[#0958D9]" : "border-slate-200 bg-white text-slate-600"} disabled:cursor-default`}><span className="text-xs font-semibold">{MODEL_LABELS[model]}</span><span className={`h-2 w-2 shrink-0 rounded-full ${readiness?.ready ? "bg-emerald-500" : readiness ? "bg-amber-400" : "bg-slate-300"}`} /></button>
                      })}
                    </div>
                  </section>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="检测间隔">
                      <select value={form.intervalDays} onChange={event => setForm(current => ({ ...current, intervalDays: Number(event.target.value) }))} disabled={!canManage} className={inputClass}>
                        {Array.from({ length: 7 }, (_, index) => index + 1).map(days => <option key={days} value={days}>每 {days} 天</option>)}
                      </select>
                    </Field>
                    <Field label="执行时间"><input type="time" value={form.timeLocal} onChange={event => setForm(current => ({ ...current, timeLocal: event.target.value }))} disabled={!canManage} className={inputClass} /></Field>
                    <Field label="首次日期"><input type="date" value={form.startDate} onChange={event => setForm(current => ({ ...current, startDate: event.target.value }))} disabled={!canManage} className={inputClass} /></Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="相对下降提醒（%）"><input type="number" min="1" max="100" value={form.relativeDropThresholdPct} onChange={event => setForm(current => ({ ...current, relativeDropThresholdPct: Number(event.target.value) }))} disabled={!canManage} className={inputClass} /></Field>
                    <Field label="最低下降百分点"><input type="number" min="0" max="100" value={form.minimumAbsoluteDropPoints} onChange={event => setForm(current => ({ ...current, minimumAbsoluteDropPoints: Number(event.target.value) }))} disabled={!canManage} className={inputClass} /></Field>
                    <Field label="每月积分上限"><input type="number" min="1" value={form.monthlyCreditLimit} onChange={event => setForm(current => ({ ...current, monthlyCreditLimit: event.target.value }))} placeholder="不限制" disabled={!canManage} className={inputClass} /></Field>
                  </div>

                  <div className="flex flex-wrap gap-x-6 gap-y-3 border-y border-slate-100 py-3">
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={form.inAppEnabled} onChange={event => setForm(current => ({ ...current, inAppEnabled: event.target.checked }))} disabled={!canManage} className="h-4 w-4 accent-[#1677FF]" /><BellRing className="h-3.5 w-3.5 text-[#1677FF]" />站内提醒</label>
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={form.emailEnabled} onChange={event => setForm(current => ({ ...current, emailEnabled: event.target.checked }))} disabled={!canManage} className="h-4 w-4 accent-[#1677FF]" />邮件提醒</label>
                    <span className="text-[11px] leading-5 text-slate-500">完成、下降和异常提醒会发送给拥有本客户查看权限的团队成员。</span>
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
                            return <div key={execution.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-xs text-slate-700"><Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-400" />{formatDateTime(execution.scheduledFor)}<span className="text-[10px] text-slate-400">{execution.trigger === "manual" ? "立即检测" : "计划检测"}</span></div><div className="mt-1 break-words text-[11px] leading-5 text-slate-500">{execution.comparisonReason || execution.error || (activeExecution(execution) ? "任务正在后台执行" : "执行记录已保存")}</div></div><div className="flex shrink-0 flex-wrap items-center gap-2"><span className={`rounded px-2 py-1 text-[10px] font-semibold ${meta.className}`}>{meta.label}</span>{activeExecution(execution) && canExecute ? <button type="button" onClick={() => void cancelExecution(execution)} disabled={cancellingExecutionId === execution.id} className="inline-flex h-7 items-center gap-1 rounded-md border border-rose-200 px-2 text-[10px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50">{cancellingExecutionId === execution.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}停止本次</button> : null}{execution.historyRecordId ? <a href={`/workspace/results/penetration/${encodeURIComponent(execution.historyRecordId)}`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-[#0958D9] transition hover:bg-[#EEF7FF]"><ExternalLink className="h-3 w-3" />查看报告</a> : null}</div></div>
                          })}
                        </div>
                      ) : <div className="border-y border-slate-100 py-6 text-center text-xs text-slate-400">暂无执行记录</div>}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#DDEBFA] bg-[#F8FBFF] px-5 py-3.5">
              <div>{schedule && canManage ? <button type="button" onClick={() => void removeSchedule()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md px-2.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />删除计划</button> : null}</div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {canExecute ? <button type="button" onClick={() => void runNow()} disabled={running || saving || hasActiveExecution || (!schedule && !canManage)} title={!schedule && !canManage ? "需要由计划管理员先创建自动检测计划" : undefined} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#91CAFF] bg-white px-3 text-xs font-semibold text-[#0958D9] transition hover:bg-[#EEF7FF] disabled:cursor-not-allowed disabled:opacity-50">{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}立即检测</button> : null}
                {canManage ? <button type="button" onClick={() => void saveSchedule()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white shadow-md shadow-blue-200/60 transition hover:brightness-105 disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存计划</button> : <span className="text-xs text-slate-500">当前账号可查看{canExecute ? "和执行" : ""}，无计划管理权限</span>}
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
