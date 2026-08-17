"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  CopyCheck,
  FileText,
  Loader2,
  Network,
  Plus,
  Rocket,
  Save,
  Settings2,
  Trash2,
  UsersRound,
  X,
} from "lucide-react"
import type { Client } from "@/types"
import type { ClientExecutionProfile } from "@/types/client-feedback"
import type {
  PublishingContentType,
  PublishingContentAsset,
  PublishingPlan,
  PublishingPlanInput,
  PublishingPlanRecommendation,
  PublishingPlatformConfig,
  PublishingTask,
  PublishingTaskStatus,
} from "@/types/publishing-plan"

type Payload = {
  plans: PublishingPlan[]
  current: PublishingPlan | null
  canEdit: boolean
  canManage: boolean
  costsVisible: boolean
  profile?: ClientExecutionProfile
}

const STATUS_LABELS: Record<PublishingTaskStatus, string> = {
  planned: "待执行",
  claimed: "执行中",
  completed: "已完成",
  failed: "未完成",
  skipped: "已跳过",
}

const CONTENT_LABELS: Record<PublishingContentType, string> = {
  article: "自媒体文章",
  authority_article: "权威稿件",
  video: "短视频",
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

export default function PublishingPlanPanel({
  client,
  profile,
  onExecutionChanged,
  mode = "full",
}: {
  client: Client
  profile?: ClientExecutionProfile
  onExecutionChanged?: () => void
  mode?: "full" | "summary"
}) {
  const endpointPath = `/api/client-feedback/${encodeURIComponent(client.id)}/publishing-plans`
  const endpointFor = useCallback((suffix = "") => {
    const teamId = currentWorkspaceTeamId()
    return `${endpointPath}${suffix}${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`
  }, [endpointPath])
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [editorOpen, setEditorOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [draft, setDraft] = useState<PublishingPlanInput>(() => defaultInput(profile))
  const [recommendation, setRecommendation] = useState<PublishingPlanRecommendation | null>(null)
  const [view, setView] = useState<"quota" | "daily" | "reuse">("quota")
  const [selectedDate, setSelectedDate] = useState(today())
  const [completionTask, setCompletionTask] = useState<PublishingTask | null>(null)
  const [completionTitle, setCompletionTitle] = useState("")
  const [completionUrl, setCompletionUrl] = useState("")

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError("")
    try {
      const response = await fetch(endpointFor(), { cache: "no-store" })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "发布规划读取失败")
      const next = body as Payload
      setPayload(next)
      setDraft(next.current?.input || defaultInput(next.profile || profile))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发布规划读取失败")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [endpointFor, profile])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const plan = payload?.current || null
  const tasks = useMemo(() => plan?.calculation.tasks || [], [plan])
  const dates = useMemo(() => Array.from(new Set(tasks.map(task => task.plannedDate))).sort(), [tasks])
  const effectiveSelectedDate = dates.includes(selectedDate)
    ? selectedDate
    : dates.find(date => date >= today()) || dates[0] || selectedDate
  const selectedTasks = useMemo(
    () => tasks.filter(task => task.plannedDate === effectiveSelectedDate),
    [effectiveSelectedDate, tasks],
  )
  const completedCount = tasks.filter(task => task.status === "completed").length
  const completionRate = tasks.length > 0 ? completedCount / tasks.length : 0
  const todayTasks = tasks.filter(task => task.plannedDate === today())
  const todayCompleted = todayTasks.filter(task => task.status === "completed").length

  function updateDraft(patch: Partial<PublishingPlanInput>) {
    setDraft(current => ({ ...current, ...patch }))
  }

  function updatePlatform(index: number, patch: Partial<PublishingPlatformConfig>) {
    setDraft(current => ({
      ...current,
      platformConfigs: current.platformConfigs.map((platform, currentIndex) => (
        currentIndex === index ? { ...platform, ...patch } : platform
      )),
    }))
  }

  async function generateRecommendation() {
    setPending("recommend")
    setError("")
    setNotice("")
    try {
      const response = await fetch(endpointFor("/recommend"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: currentWorkspaceTeamId() || undefined,
          customerStage: draft.customerStage,
          useAi: true,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "平台建议生成失败")
      const next = body.recommendation as PublishingPlanRecommendation
      setRecommendation(next)
      updateDraft({ platformConfigs: next.platformConfigs })
      setNotice(next.usedFallback ? "已根据现有报告生成平台建议" : "AI 已结合报告完成平台权重建议")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "平台建议生成失败")
    } finally {
      setPending("")
    }
  }

  async function createDraft() {
    setPending("save")
    setError("")
    setNotice("")
    try {
      const response = await fetch(endpointFor(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: currentWorkspaceTeamId() || undefined,
          input: draft,
          sourceSnapshot: recommendation?.sourceSnapshot || plan?.sourceSnapshot || [],
          recommendationModel: recommendation?.model,
          recommendationGeneratedAt: recommendation?.generatedAt,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "规划草案创建失败")
      const created = body.plan as PublishingPlan
      setPayload(current => current ? {
        ...current,
        current: created,
        plans: [created, ...current.plans.filter(item => item.id !== created.id)],
      } : current)
      setDraft(created.input)
      setEditorOpen(false)
      setDetailsOpen(true)
      setNotice(`第 ${created.version} 版规划草案已生成，请确认后启用`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "规划草案创建失败")
    } finally {
      setPending("")
    }
  }

  async function activatePlan() {
    if (!plan || plan.status !== "draft") return
    setPending("activate")
    setError("")
    try {
      const response = await fetch(endpointFor(`/${encodeURIComponent(plan.id)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", teamId: currentWorkspaceTeamId() || undefined }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "规划启用失败")
      setNotice("发布规划已启用，Agent 和团队成员现在可以读取每日任务")
      await load(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "规划启用失败")
    } finally {
      setPending("")
    }
  }

  async function viewPlan(planId: string) {
    if (!planId || planId === plan?.id) return
    setPending("view")
    setError("")
    try {
      const response = await fetch(endpointFor(`/${encodeURIComponent(planId)}`), { cache: "no-store" })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "规划版本读取失败")
      const selected = body.plan as PublishingPlan
      setPayload(current => current ? { ...current, current: selected } : current)
      setDraft(selected.input)
      setDetailsOpen(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "规划版本读取失败")
    } finally {
      setPending("")
    }
  }

  async function deleteDraft() {
    if (!plan || plan.status !== "draft" || !window.confirm(`确认删除第 ${plan.version} 版规划草案吗？`)) return
    setPending("delete")
    setError("")
    try {
      const response = await fetch(endpointFor(`/${encodeURIComponent(plan.id)}`), { method: "DELETE" })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "规划草案删除失败")
      setNotice("规划草案已删除")
      await load(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "规划草案删除失败")
    } finally {
      setPending("")
    }
  }

  async function completeTask() {
    if (!plan || !completionTask) return
    setPending(`complete:${completionTask.id}`)
    setError("")
    try {
      const response = await fetch(endpointFor(`/${encodeURIComponent(plan.id)}/tasks/${encodeURIComponent(completionTask.id)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          teamId: currentWorkspaceTeamId() || undefined,
          title: completionTitle,
          publishedUrl: completionUrl,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "发布任务完成失败")
      setCompletionTask(null)
      setCompletionTitle("")
      setCompletionUrl("")
      setNotice("发布任务已完成，并同步写入执行反馈")
      await load(true)
      onExecutionChanged?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发布任务完成失败")
    } finally {
      setPending("")
    }
  }

  if (loading) {
    return <section className="flex min-h-36 items-center justify-center rounded-lg border border-[#D7E5F2] bg-white"><Loader2 className="h-5 w-5 animate-spin text-[#1677FF]" /></section>
  }

  if (mode === "summary") {
    return (
      <section className="rounded-lg border border-[#D7E5F2] bg-white px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EAF4FF] text-[#1677FF]"><ClipboardCheck className="h-4 w-4" /></span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[#102A43]">发布执行进度</h3>
              <p className="mt-0.5 text-[10px] text-[#6B8299]">
                {plan
                  ? `今日 ${todayCompleted}/${todayTasks.length} 项，全部 ${completedCount}/${tasks.length} 项已完成`
                  : "尚未在关键词策略中制定发布规划"}
              </p>
            </div>
          </div>
          {plan ? (
            <div className="flex min-w-44 items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#E7EFF7]">
                <div className="h-full rounded-full bg-gradient-to-r from-[#1677FF] to-[#13C2C2]" style={{ width: `${Math.round(completionRate * 100)}%` }} />
              </div>
              <span className="font-mono text-xs font-bold text-[#0958D9]">{Math.round(completionRate * 100)}%</span>
            </div>
          ) : null}
        </div>
        {error ? <p className="mt-2 text-[10px] text-rose-600">{error}</p> : null}
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-lg border border-[#B9DDFC] bg-white shadow-[0_18px_44px_-36px_rgba(0,78,180,.55)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCEAF6] bg-[linear-gradient(120deg,#F2F8FF_0%,#F0FCFF_55%,#F7F5FF_100%)] px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] via-[#00AEEA] to-[#13C2C2] text-white shadow-sm"><Network className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-[#102A43]">内容发布规划</h3>
            <p className="mt-1 text-[10px] text-[#6B8299]">把关键词策略转成平台配额、内容资产和每日发布任务</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {plan ? <span className={`rounded-md px-2.5 py-1 text-[10px] font-bold ${plan.status === "active" ? "bg-emerald-100 text-emerald-700" : plan.status === "draft" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>第 {plan.version} 版 · {plan.status === "active" ? "执行中" : plan.status === "draft" ? "待确认" : "历史版本"}</span> : null}
          {payload?.canManage && payload.plans.length > 1 && plan ? <select aria-label="查看发布规划版本" value={plan.id} onChange={event => void viewPlan(event.target.value)} disabled={pending === "view"} className="h-9 rounded-lg border border-[#C8D9E8] bg-white px-2 text-[10px] font-semibold text-[#526A83] outline-none focus:border-[#1677FF]">{payload.plans.map(item => <option key={item.id} value={item.id}>第 {item.version} 版 · {item.status === "active" ? "执行中" : item.status === "draft" ? "草案" : "历史"}</option>)}</select> : null}
          {payload?.canManage ? (
            <button type="button" onClick={() => { setDraft(plan?.input || defaultInput(payload?.profile || profile)); setEditorOpen(true) }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#91CAFF] bg-white px-3 text-xs font-semibold text-[#0958D9] transition hover:bg-[#EAF4FF]"><Settings2 className="h-3.5 w-3.5" />{plan ? "重新规划" : "制定规划"}</button>
          ) : null}
          {plan ? <button type="button" onClick={() => setDetailsOpen(value => !value)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#D7E5F2] bg-white px-3 text-xs font-semibold text-[#526A83]"><ChevronDown className={`h-3.5 w-3.5 transition ${detailsOpen ? "rotate-180" : ""}`} />{detailsOpen ? "收起" : "展开"}</button> : null}
        </div>
      </header>

      {error ? <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div> : null}
      {notice ? <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700"><Check className="h-3.5 w-3.5" />{notice}</div> : null}

      {!plan ? (
        <div className="flex min-h-44 flex-col items-center justify-center px-5 py-8 text-center">
          <Rocket className="h-8 w-8 text-[#1677FF]" />
          <p className="mt-3 text-sm font-semibold text-[#102A43]">还没有制定发布规划</p>
          <p className="mt-1 max-w-lg text-xs leading-5 text-[#6B8299]">管理员可从已有检测和关键词策略中生成平台建议，再按客户预算形成每日任务。</p>
        </div>
      ) : detailsOpen ? (
        <div>
          <div className={`grid gap-px bg-[#DCE8F4] ${payload?.costsVisible ? "sm:grid-cols-2 xl:grid-cols-5" : "sm:grid-cols-2 xl:grid-cols-4"}`}>
            {payload?.costsVisible ? <Metric label="执行预算" value={money(plan.calculation.summary.executionBudgetCents)} icon={<CircleDollarSign />} /> : null}
            <Metric label="计划发布" value={`${plan.calculation.summary.totalPublicationCount} 次`} icon={<ClipboardCheck />} />
            <Metric label="需制作内容" value={`${plan.calculation.summary.uniqueContentCount} 篇/条`} icon={<FileText />} />
            <Metric label="跨平台复用" value={`${Math.round(plan.calculation.summary.reuseRate * 100)}%`} icon={<CopyCheck />} />
            <Metric label="账号缺口" value={`${plan.calculation.summary.accountGap} 个`} icon={<UsersRound />} alert={plan.calculation.summary.accountGap > 0} />
          </div>

          <div className="border-b border-[#E7EFF6] px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-[10px] text-[#6B8299]"><span>整体执行完成度</span><span className="font-mono font-bold text-[#0958D9]">{completedCount}/{tasks.length}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[#E7EFF7]"><div className="h-full rounded-full bg-gradient-to-r from-[#1677FF] via-[#00AEEA] to-[#13C2C2]" style={{ width: `${Math.round(completionRate * 100)}%` }} /></div>
          </div>

          {plan.calculation.warnings.length > 0 && payload?.costsVisible ? (
            <div className="flex flex-wrap gap-2 border-b border-amber-100 bg-amber-50/70 px-4 py-2.5">
              {plan.calculation.warnings.map(message => <span key={message} className="inline-flex items-center gap-1 text-[10px] text-amber-700"><AlertTriangle className="h-3 w-3" />{message}</span>)}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E7EFF6] px-4 py-3">
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#EEF5FC] p-1 text-[10px] font-semibold">
              {(["quota", "daily", "reuse"] as const).map(item => <button key={item} type="button" onClick={() => setView(item)} className={`h-8 rounded-md px-3 transition ${view === item ? "bg-white text-[#0958D9] shadow-sm" : "text-[#6B8299]"}`}>{item === "quota" ? "平台配额" : item === "daily" ? "每日任务" : "复用矩阵"}</button>)}
            </div>
            {plan.status === "draft" && payload?.canManage ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => void deleteDraft()} disabled={Boolean(pending)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-200 px-2.5 text-[10px] font-semibold text-rose-600 disabled:opacity-50"><Trash2 className="h-3 w-3" />删除草案</button>
                <button type="button" onClick={() => void activatePlan()} disabled={Boolean(pending)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#1677FF] px-3 text-[10px] font-semibold text-white disabled:opacity-50">{pending === "activate" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}确认启用</button>
              </div>
            ) : null}
          </div>

          {view === "quota" ? <QuotaTable plan={plan} costsVisible={payload?.costsVisible === true} /> : null}
          {view === "daily" ? <DailyTasks dates={dates} selectedDate={effectiveSelectedDate} onDateChange={setSelectedDate} tasks={selectedTasks} assets={plan.calculation.assets} canEdit={payload?.canEdit === true && plan.status === "active"} onComplete={task => { setCompletionTask(task); setCompletionTitle(task.title || ""); setCompletionUrl("") }} /> : null}
          {view === "reuse" ? <ReuseMatrix plan={plan} /> : null}
        </div>
      ) : null}

      {editorOpen && typeof document !== "undefined" ? createPortal(
        <PlanEditor
          input={draft}
          recommendation={recommendation}
          pending={pending}
          onChange={updateDraft}
          onPlatformChange={updatePlatform}
          onRecommend={() => void generateRecommendation()}
          onSave={() => void createDraft()}
          onClose={() => setEditorOpen(false)}
        />,
        document.body,
      ) : null}

      {completionTask && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#001B44]/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-lg border border-[#B9DDFC] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E7EFF6] px-4 py-3"><div><h4 className="text-sm font-bold">完成发布任务</h4><p className="mt-1 text-[10px] text-[#6B8299]">{completionTask.platformName} · 账号槽位 {completionTask.accountSlot}</p></div><button type="button" onClick={() => setCompletionTask(null)} className="rounded-md p-2 text-[#6B8299] hover:bg-[#EEF5FC]"><X className="h-4 w-4" /></button></div>
            <div className="space-y-4 p-4">
              <Field label="文章标题"><input value={completionTitle} onChange={event => setCompletionTitle(event.target.value)} className={inputClass()} placeholder="填写实际发布标题" /></Field>
              <Field label="发布后的文章网址"><input value={completionUrl} onChange={event => setCompletionUrl(event.target.value)} className={inputClass()} placeholder="https://..." /></Field>
              <button type="button" onClick={() => void completeTask()} disabled={!completionUrl.trim() || pending.startsWith("complete:")} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] text-xs font-bold text-white disabled:opacity-50">{pending.startsWith("complete:") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}完成并写入执行反馈</button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </section>
  )
}

function PlanEditor({
  input,
  recommendation,
  pending,
  onChange,
  onPlatformChange,
  onRecommend,
  onSave,
  onClose,
}: {
  input: PublishingPlanInput
  recommendation: PublishingPlanRecommendation | null
  pending: string
  onChange: (patch: Partial<PublishingPlanInput>) => void
  onPlatformChange: (index: number, patch: Partial<PublishingPlatformConfig>) => void
  onRecommend: () => void
  onSave: () => void
  onClose: () => void
}) {
  function addPlatform() {
    const index = input.platformConfigs.length + 1
    onChange({
      platformConfigs: [...input.platformConfigs, {
        id: `custom_${Date.now()}`,
        platformKey: `custom:${Date.now()}`,
        platformName: `自定义平台 ${index}`,
        category: "self_media",
        contentType: "article",
        enabled: true,
        weightBps: 1_000,
        dailyLimitPerAccount: 3,
        safeUtilizationBps: 8_000,
        existingAccountCount: 0,
        publishUnitCostCents: 300,
        maxReusePlatforms: 5,
      }],
    })
  }

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#001B44]/48 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true">
      <div className="mx-auto w-full max-w-6xl overflow-hidden rounded-lg border border-[#B9DDFC] bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#DCEAF6] bg-white px-4 py-3 sm:px-5"><div><h3 className="text-base font-bold text-[#102A43]">制定发布规划</h3><p className="mt-1 text-[10px] text-[#6B8299]">AI推荐平台，系统负责精确计算预算、配额和账号数量</p></div><button type="button" onClick={onClose} className="rounded-md p-2 text-[#6B8299] hover:bg-[#EEF5FC]"><X className="h-4 w-4" /></button></header>
        <div className="space-y-5 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="客户总服务费（元）"><input type="number" min="1" value={input.totalServiceFeeCents / 100} onChange={event => onChange({ totalServiceFeeCents: Math.round(Number(event.target.value || 0) * 100) })} className={inputClass()} /></Field>
            <Field label="执行成本比例"><div className="relative"><input type="number" min="30" max="35" step="0.1" value={input.executionCostRateBps / 100} onChange={event => onChange({ executionCostRateBps: Math.round(Number(event.target.value || 32.5) * 100) })} className={inputClass("pr-8")} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8AA0B5]">%</span></div></Field>
            <Field label="服务开始日期"><input type="date" value={input.startDate} onChange={event => onChange({ startDate: event.target.value })} className={inputClass()} /></Field>
            <Field label="服务结束日期"><input type="date" value={input.endDate} onChange={event => onChange({ endDate: event.target.value })} className={inputClass()} /></Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="客户阶段"><select value={input.customerStage} onChange={event => onChange({ customerStage: event.target.value === "maintenance" ? "maintenance" : "new_launch" })} className={inputClass()}><option value="new_launch">新客户冲刺</option><option value="maintenance">老客户维护</option></select></Field>
            <Field label="首月占总预算"><PercentInput value={input.firstMonthBudgetBps} disabled={input.customerStage === "maintenance"} onChange={value => onChange({ firstMonthBudgetBps: value })} /></Field>
            <Field label="前 7 天占首月预算"><PercentInput value={input.firstSevenDaysBudgetBps} disabled={input.customerStage === "maintenance"} onChange={value => onChange({ firstSevenDaysBudgetBps: value })} /></Field>
            <Field label="周期口径"><select value={input.periodMode} onChange={event => onChange({ periodMode: event.target.value === "calendar" ? "calendar" : "service" })} className={inputClass()}><option value="service">按服务周期</option><option value="calendar">按自然月</option></select></Field>
          </div>

          <div className="rounded-lg border border-[#D7E5F2] bg-[#F8FBFF] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-sm font-bold text-[#102A43]">平台与执行参数</h4><p className="mt-1 text-[10px] text-[#6B8299]">重复引用会计入平台权重，所有数值仍可人工调整</p></div><div className="flex gap-2"><button type="button" onClick={addPlatform} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#C8D9E8] bg-white px-3 text-xs font-semibold text-[#526A83]"><Plus className="h-3.5 w-3.5" />添加平台</button><button type="button" onClick={onRecommend} disabled={pending === "recommend"} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 text-xs font-semibold text-white disabled:opacity-50">{pending === "recommend" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}AI读取报告推荐</button></div></div>
            {recommendation?.notes.map(note => <p key={note} className="mt-2 text-[10px] text-amber-700">{note}</p>)}
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1040px] w-full text-left text-[10px]">
                <thead><tr className="border-b border-[#DCE8F4] text-[#6B8299]"><th className="pb-2 pr-2">启用</th><th className="pb-2 pr-2">平台</th><th className="pb-2 pr-2">内容类型</th><th className="pb-2 pr-2">权重</th><th className="pb-2 pr-2">单账号日上限</th><th className="pb-2 pr-2">已有账号</th><th className="pb-2 pr-2">单次发布成本</th><th className="pb-2 pr-2">最多复用平台</th><th className="pb-2">推荐依据</th></tr></thead>
                <tbody>{input.platformConfigs.map((platform, index) => <tr key={platform.id} className="border-b border-[#E7EFF6] align-top">
                  <td className="py-2 pr-2"><input type="checkbox" checked={platform.enabled} onChange={event => onPlatformChange(index, { enabled: event.target.checked })} className="h-4 w-4 accent-[#1677FF]" /></td>
                  <td className="py-2 pr-2"><input value={platform.platformName} onChange={event => onPlatformChange(index, { platformName: event.target.value })} className={tableInputClass("w-28")} /></td>
                  <td className="py-2 pr-2"><select value={platform.contentType} onChange={event => onPlatformChange(index, { contentType: event.target.value as PublishingContentType })} className={tableInputClass("w-28")}><option value="article">自媒体文章</option><option value="authority_article">权威稿件</option><option value="video">短视频</option></select></td>
                  <td className="py-2 pr-2"><PercentInput compact value={platform.weightBps} onChange={value => onPlatformChange(index, { weightBps: value })} /></td>
                  <td className="py-2 pr-2"><input type="number" min="1" value={platform.dailyLimitPerAccount} onChange={event => onPlatformChange(index, { dailyLimitPerAccount: Number(event.target.value || 1) })} className={tableInputClass("w-20")} /></td>
                  <td className="py-2 pr-2"><input type="number" min="0" value={platform.existingAccountCount} onChange={event => onPlatformChange(index, { existingAccountCount: Number(event.target.value || 0) })} className={tableInputClass("w-20")} /></td>
                  <td className="py-2 pr-2"><div className="relative w-24"><input type="number" min="0" step="0.01" value={platform.publishUnitCostCents / 100} onChange={event => onPlatformChange(index, { publishUnitCostCents: Math.round(Number(event.target.value || 0) * 100) })} className={tableInputClass("w-24 pr-5")} /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8AA0B5]">元</span></div></td>
                  <td className="py-2 pr-2"><input type="number" min="1" value={platform.maxReusePlatforms} onChange={event => onPlatformChange(index, { maxReusePlatforms: Number(event.target.value || 1) })} className={tableInputClass("w-20")} /></td>
                  <td className="max-w-56 py-2 text-[#6B8299]"><span className="line-clamp-3 leading-4">{platform.recommendationReason || "人工添加平台"}</span></td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="每篇普通文章制作成本（元）"><MoneyInput value={input.contentCreationCostsCents.article} onChange={value => onChange({ contentCreationCostsCents: { ...input.contentCreationCostsCents, article: value } })} /></Field>
            <Field label="每篇权威稿件制作成本（元）"><MoneyInput value={input.contentCreationCostsCents.authority_article} onChange={value => onChange({ contentCreationCostsCents: { ...input.contentCreationCostsCents, authority_article: value } })} /></Field>
            <Field label="每条视频制作成本（元）"><MoneyInput value={input.contentCreationCostsCents.video} onChange={value => onChange({ contentCreationCostsCents: { ...input.contentCreationCostsCents, video: value } })} /></Field>
          </div>
        </div>
        <footer className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-[#DCEAF6] bg-white px-4 py-3"><button type="button" onClick={onClose} className="h-9 rounded-lg border border-[#C8D9E8] px-4 text-xs font-semibold text-[#526A83]">取消</button><button type="button" onClick={onSave} disabled={pending === "save" || input.platformConfigs.length === 0} className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-bold text-white disabled:opacity-50">{pending === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}生成规划草案</button></footer>
      </div>
    </div>
  )
}

function QuotaTable({ plan, costsVisible }: { plan: PublishingPlan; costsVisible: boolean }) {
  return <div className="overflow-x-auto"><table className="min-w-[860px] w-full text-left text-xs"><thead><tr className="border-b border-[#E7EFF6] bg-[#F8FBFF] text-[10px] text-[#6B8299]"><th className="px-4 py-3">平台</th><th className="px-3 py-3">权重</th><th className="px-3 py-3">发布额度</th><th className="px-3 py-3">峰值/日</th><th className="px-3 py-3">账号需求</th>{costsVisible ? <th className="px-3 py-3">计划成本</th> : null}<th className="px-4 py-3">依据</th></tr></thead><tbody>{plan.calculation.platformQuotas.map(quota => {
    const config = plan.input.platformConfigs.find(item => item.platformKey === quota.platformKey)
    return <tr key={quota.platformKey} className="border-b border-[#EDF2F7] align-top"><td className="px-4 py-3"><div className="font-semibold text-[#102A43]">{quota.platformName}</div><div className="mt-1 text-[10px] text-[#8AA0B5]">{CONTENT_LABELS[quota.contentType]}</div></td><td className="px-3 py-3"><div className="w-24"><div className="flex justify-between text-[10px]"><span>{(quota.weightBps / 100).toFixed(1)}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#E7EFF7]"><div className="h-full rounded-full bg-gradient-to-r from-[#1677FF] to-[#13C2C2]" style={{ width: `${Math.min(100, quota.weightBps / 100)}%` }} /></div></div></td><td className="px-3 py-3 font-mono font-bold text-[#0958D9]">{quota.publicationCount}</td><td className="px-3 py-3">{quota.peakDailyCount}</td><td className="px-3 py-3"><span className={quota.accountGap > 0 ? "font-semibold text-amber-700" : "text-emerald-700"}>{quota.requiredAccountCount} 需 / {quota.existingAccountCount} 有</span>{quota.accountGap > 0 ? <div className="mt-1 text-[10px] text-amber-600">缺 {quota.accountGap} 个</div> : null}</td>{costsVisible ? <td className="px-3 py-3 font-mono">{money(quota.plannedCostCents)}</td> : null}<td className="max-w-72 px-4 py-3 text-[10px] leading-5 text-[#6B8299]">{config?.recommendationReason || "人工配置"}</td></tr>
  })}</tbody></table></div>
}

function DailyTasks({ dates, selectedDate, onDateChange, tasks, assets, canEdit, onComplete }: { dates: string[]; selectedDate: string; onDateChange: (value: string) => void; tasks: PublishingTask[]; assets: PublishingContentAsset[]; canEdit: boolean; onComplete: (task: PublishingTask) => void }) {
  const assetMap = new Map(assets.map(asset => [asset.id, asset]))
  return <div><div className="flex flex-wrap items-center gap-2 border-b border-[#E7EFF6] bg-[#F8FBFF] px-4 py-3"><CalendarDays className="h-4 w-4 text-[#1677FF]" /><select value={selectedDate} onChange={event => onDateChange(event.target.value)} className="h-8 rounded-md border border-[#C8D9E8] bg-white px-2 text-xs outline-none focus:border-[#1677FF]">{dates.map(date => <option key={date} value={date}>{date}</option>)}</select><span className="text-[10px] text-[#6B8299]">当日 {tasks.length} 项发布任务</span></div><div className="divide-y divide-[#EDF2F7]">{tasks.length === 0 ? <div className="px-4 py-10 text-center text-xs text-[#8AA0B5]">当天没有发布任务</div> : tasks.map(task => {
    const asset = assetMap.get(task.assetId)
    return <article key={task.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-[#102A43]">{task.platformName}</span><span className="rounded bg-[#EDF5FF] px-1.5 py-0.5 text-[9px] font-semibold text-[#0958D9]">账号槽位 {task.accountSlot}</span><span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${task.status === "completed" ? "bg-emerald-50 text-emerald-700" : task.status === "failed" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{STATUS_LABELS[task.status]}</span></div><p className="mt-1 truncate text-xs text-[#314A62]">{asset?.question || `内容编号 ${task.assetId}`}</p>{asset?.matchedAdvantage ? <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-emerald-700">匹配优势：{asset.matchedAdvantage}</p> : null}{task.publishedUrl ? <a href={task.publishedUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[10px] text-[#1677FF] underline">{task.publishedUrl}</a> : null}</div>{canEdit && task.status !== "completed" ? <button type="button" onClick={() => onComplete(task)} className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-[#1677FF] px-3 text-[10px] font-semibold text-white"><Check className="h-3 w-3" />登记完成</button> : null}</article>
  })}</div></div>
}

function ReuseMatrix({ plan }: { plan: PublishingPlan }) {
  const platforms = plan.calculation.platformQuotas.slice(0, 8)
  const assets = plan.calculation.assets.slice(0, 30)
  const pairs = new Set(plan.calculation.tasks.map(task => `${task.assetId}\u0000${task.platformKey}`))
  return <div className="overflow-x-auto"><table className="min-w-[720px] w-full text-center text-[10px]"><thead><tr className="border-b border-[#E7EFF6] bg-[#F8FBFF] text-[#6B8299]"><th className="px-4 py-3 text-left">内容资产</th>{platforms.map(platform => <th key={platform.platformKey} className="px-3 py-3">{platform.platformName}</th>)}</tr></thead><tbody>{assets.map(asset => <tr key={asset.id} className="border-b border-[#EDF2F7]"><td className="max-w-64 px-4 py-3 text-left"><div className="truncate font-semibold text-[#102A43]">{asset.question || asset.id}</div><div className="mt-1 text-[#8AA0B5]">{CONTENT_LABELS[asset.contentType]}</div></td>{platforms.map(platform => <td key={platform.platformKey} className="px-3 py-3">{pairs.has(`${asset.id}\u0000${platform.platformKey}`) ? <span className="mx-auto flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-3 w-3" /></span> : <span className="text-[#C8D9E8]">-</span>}</td>)}</tr>)}</tbody></table>{plan.calculation.assets.length > assets.length ? <p className="px-4 py-3 text-[10px] text-[#8AA0B5]">当前展示前 {assets.length} 条内容，完整任务可由 Agent 或每日任务表读取。</p> : null}</div>
}

function Metric({ label, value, icon, alert = false }: { label: string; value: string; icon: React.ReactNode; alert?: boolean }) {
  return <div className="bg-white px-4 py-4"><div className={`flex h-7 w-7 items-center justify-center rounded-md ${alert ? "bg-amber-50 text-amber-600" : "bg-[#EAF4FF] text-[#1677FF]"}`}>{icon}</div><p className="mt-3 text-[10px] text-[#7E91A7]">{label}</p><p className={`mt-1 text-lg font-bold ${alert ? "text-amber-700" : "text-[#102A43]"}`}>{value}</p></div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-[10px] font-semibold text-[#526A83]"><span className="mb-1.5 block">{label}</span>{children}</label>
}

function PercentInput({ value, onChange, disabled = false, compact = false }: { value: number; onChange: (value: number) => void; disabled?: boolean; compact?: boolean }) {
  return <div className={`relative ${compact ? "w-20" : ""}`}><input type="number" min="0" max="100" step="0.1" disabled={disabled} value={value / 100} onChange={event => onChange(Math.round(Number(event.target.value || 0) * 100))} className={compact ? tableInputClass("w-20 pr-5") : inputClass("pr-8")} /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#8AA0B5]">%</span></div>
}

function MoneyInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <div className="relative"><input type="number" min="0" step="0.01" value={value / 100} onChange={event => onChange(Math.round(Number(event.target.value || 0) * 100))} className={inputClass("pr-8")} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8AA0B5]">元</span></div>
}

function defaultInput(profile?: ClientExecutionProfile): PublishingPlanInput {
  const startDate = profile?.startDate || today()
  return {
    totalServiceFeeCents: 1_000_000,
    executionCostRateBps: 3_250,
    startDate,
    endDate: profile?.endDate || addMonthsMinusOne(startDate, 3),
    periodMode: profile?.periodMode || "service",
    customerStage: "new_launch",
    firstMonthBudgetBps: 5_000,
    firstSevenDaysBudgetBps: 5_000,
    contentCreationCostsCents: { article: 0, authority_article: 0, video: 0 },
    platformConfigs: [],
  }
}

function currentWorkspaceTeamId(): string {
  if (typeof window === "undefined") return ""
  return String(new URL(window.location.href).searchParams.get("teamId") || "").trim().slice(0, 200)
}

function addMonthsMinusOne(value: string, months: number): string {
  const [year, month, day] = value.split("-").map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  const date = new Date(Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    Math.min(day, lastDay),
  ))
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function money(cents: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(cents / 100)
}

function inputClass(extra = ""): string {
  return `h-10 w-full rounded-lg border border-[#C8D9E8] bg-white px-3 text-xs font-normal text-[#102A43] outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/10 disabled:bg-[#F1F5F9] ${extra}`
}

function tableInputClass(extra = ""): string {
  return `h-8 rounded-md border border-[#C8D9E8] bg-white px-2 text-[10px] font-normal text-[#102A43] outline-none focus:border-[#1677FF] ${extra}`
}
