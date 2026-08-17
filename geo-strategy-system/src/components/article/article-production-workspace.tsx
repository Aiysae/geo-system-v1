"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Download,
  FileStack,
  FolderArchive,
  Layers3,
  Loader2,
  RefreshCw,
  Square,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { createBackgroundRequestId } from "@/lib/background-job-client"
import { toUserFacingError } from "@/lib/user-facing-errors"
import { WORKSPACE_NAVIGATION_EVENT } from "@/lib/workspace-navigation"
import type { ArticleModelProviderKey } from "@/types"
import type { ContentProductionRun } from "@/types/content-production"
import type { PublishingPlan, PublishingTask } from "@/types/publishing-plan"

type Payload = {
  runs?: ContentProductionRun[]
  plan?: PublishingPlan | null
  run?: ContentProductionRun
  skippedAlreadyGenerated?: number
  error?: string
}

const TERMINAL = new Set(["succeeded", "partial", "failed", "cancelled"])

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function statusLabel(run: ContentProductionRun): string {
  if (run.status === "succeeded") return "全部完成"
  if (run.status === "partial") return "部分完成"
  if (run.status === "failed") return "未完成"
  if (run.status === "cancelled") return "已停止"
  if (run.status === "running") return "生成中"
  if (run.status === "queued") return "排队中"
  return "准备中"
}

function statusClass(run: ContentProductionRun): string {
  if (run.status === "succeeded") return "bg-emerald-50 text-emerald-700"
  if (run.status === "partial") return "bg-amber-50 text-amber-700"
  if (run.status === "failed") return "bg-rose-50 text-rose-700"
  if (run.status === "cancelled") return "bg-slate-100 text-slate-600"
  return "bg-blue-50 text-[#0958D9]"
}

function uniquePlatforms(tasks: PublishingTask[]): Array<{ key: string; name: string; count: number }> {
  const rows = new Map<string, { key: string; name: string; count: number }>()
  for (const task of tasks) {
    const current = rows.get(task.platformKey)
    rows.set(task.platformKey, {
      key: task.platformKey,
      name: task.platformName,
      count: (current?.count || 0) + 1,
    })
  }
  return [...rows.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"))
}

export default function ArticleProductionWorkspace({
  clientId,
  modelProvider,
  model,
}: {
  clientId: string
  modelProvider: ArticleModelProviderKey
  model: string
}) {
  const [payload, setPayload] = useState<Payload>({ runs: [], plan: null })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [acting, setActing] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [dateFrom, setDateFrom] = useState(today())
  const [dateTo, setDateTo] = useState(today())
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set())
  const [selectedRunId, setSelectedRunId] = useState("")
  const initialized = useRef(false)

  const apiUrl = useCallback((suffix = "", extra?: Record<string, string>) => {
    const query = new URLSearchParams({ clientId })
    const teamId = currentWorkspaceTeamId()
    if (teamId) query.set("teamId", teamId)
    for (const [key, value] of Object.entries(extra || {})) query.set(key, value)
    return `/api/article-generation/production-runs${suffix}?${query}`
  }, [clientId])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const response = await apiFetch(
        apiUrl(),
        { cache: "no-store" },
      )
      const data = await readApiJson<Payload>(response, "发布计划生产")
      if (!response.ok) throw new Error(data.error || "内容生产批次读取失败")
      setPayload(data)
      const runs = data.runs || []
      setSelectedRunId(current => {
        if (current && runs.some(run => run.id === current)) return current
        const requested = currentWorkspaceRunId()
        return runs.find(run => run.id === requested)?.id || runs[0]?.id || ""
      })
      if (!initialized.current && data.plan) {
        const dates = [...new Set(data.plan.calculation.tasks.map(task => task.plannedDate))].sort()
        const selected = dates.find(value => value >= today()) || dates[0]
        if (selected) {
          setDateFrom(selected)
          setDateTo(selected)
        }
        initialized.current = true
      }
      setError("")
    } catch (loadError) {
      setError(toUserFacingError(loadError, {
        fallback: "内容生产批次读取失败，请稍后重试。",
        subject: "发布计划生产",
      }))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [apiUrl])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const onWorkspaceNavigation = (event: Event) => {
      const urlValue = (event as CustomEvent<{ url?: string }>).detail?.url
      if (!urlValue) return
      const url = new URL(urlValue, window.location.origin)
      if (
        url.searchParams.get("module") !== "article"
        || url.searchParams.get("view") !== "production"
        || String(url.searchParams.get("clientId") || "") !== clientId
      ) return
      const runId = String(url.searchParams.get("jobId") || "").trim()
      if (runId) setSelectedRunId(runId)
      window.setTimeout(() => void load(true), 0)
    }
    window.addEventListener(WORKSPACE_NAVIGATION_EVENT, onWorkspaceNavigation)
    return () => window.removeEventListener(WORKSPACE_NAVIGATION_EVENT, onWorkspaceNavigation)
  }, [clientId, load])

  const runs = payload.runs || []
  const hasActiveRun = runs.some(run => !TERMINAL.has(run.status))
  useEffect(() => {
    if (!hasActiveRun) return
    const timer = window.setInterval(() => void load(true), 3_000)
    return () => window.clearInterval(timer)
  }, [hasActiveRun, load])

  const plan = payload.plan || null
  const candidateTasks = useMemo(() => (plan?.calculation.tasks || []).filter(task => (
    task.plannedDate >= dateFrom
    && task.plannedDate <= dateTo
    && task.status !== "completed"
    && task.status !== "skipped"
  )), [dateFrom, dateTo, plan])
  const platforms = useMemo(() => uniquePlatforms(candidateTasks), [candidateTasks])
  const effectiveSelectedPlatforms = useMemo(() => {
    const available = new Set(platforms.map(platform => platform.key))
    return new Set([...selectedPlatforms].filter(key => available.has(key)))
  }, [platforms, selectedPlatforms])
  const filteredTasks = useMemo(() => effectiveSelectedPlatforms.size === 0
    ? candidateTasks
    : candidateTasks.filter(task => effectiveSelectedPlatforms.has(task.platformKey)),
  [candidateTasks, effectiveSelectedPlatforms])
  const assetCount = new Set(filteredTasks.map(task => task.assetId)).size
  const reusedCount = Math.max(0, filteredTasks.length - assetCount)
  const selectedRun = runs.find(run => run.id === selectedRunId) || runs[0]
  const progress = selectedRun?.requestedAssetCount
    ? Math.round((selectedRun.completedCount + selectedRun.failedCount + selectedRun.cancelledCount) / selectedRun.requestedAssetCount * 100)
    : 0

  async function startProduction() {
    if (!plan || filteredTasks.length === 0 || submitting) return
    setSubmitting(true)
    setError("")
    setNotice("")
    try {
      const response = await apiFetch("/api/article-generation/production-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: createBackgroundRequestId("content_production"),
          clientId,
          teamId: currentWorkspaceTeamId() || undefined,
          dateFrom,
          dateTo,
          platformKeys: [...effectiveSelectedPlatforms],
          modelProvider,
          model,
        }),
      })
      const data = await readApiJson<Payload>(response, "发布计划生产")
      if (!response.ok || !data.run) throw new Error(data.error || "内容生产任务创建失败")
      setNotice(
        `${data.run.requestedAssetCount} 篇母稿已进入后台队列，对应 ${data.run.requestedPublicationCount} 项发布任务${data.skippedAlreadyGenerated ? `；已跳过 ${data.skippedAlreadyGenerated} 项重复任务` : ""}。`,
      )
      await load(true)
      setSelectedRunId(data.run.id)
    } catch (startError) {
      setError(toUserFacingError(startError, {
        fallback: "内容生产任务创建失败，请稍后重试。",
        subject: "发布计划生产",
      }))
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelRun() {
    if (!selectedRun || TERMINAL.has(selectedRun.status) || acting) return
    setActing(true)
    setError("")
    try {
      const response = await apiFetch(
        apiUrl(`/${encodeURIComponent(selectedRun.id)}`),
        { method: "DELETE" },
      )
      const data = await readApiJson<Payload>(response, "停止内容生产")
      if (!response.ok) throw new Error(data.error || "停止内容生产失败")
      setNotice("未开始的文章任务已停止，已完成内容仍然保留。")
      await load(true)
    } catch (cancelError) {
      setError(toUserFacingError(cancelError, {
        fallback: "停止内容生产失败，请稍后重试。",
        subject: "停止内容生产",
      }))
    } finally {
      setActing(false)
    }
  }

  function openKeywordPlan() {
    const params = new URLSearchParams({ clientId, module: "keyword", view: "strategy" })
    const teamId = currentWorkspaceTeamId()
    if (teamId) params.set("teamId", teamId)
    const url = `/workspace?${params}`
    window.history.pushState({}, "", url)
    window.dispatchEvent(new CustomEvent(WORKSPACE_NAVIGATION_EVENT, { detail: { url } }))
  }

  if (loading) {
    return <section className="flex min-h-[680px] items-center justify-center rounded-lg border border-[#D7E5F2] bg-white"><Loader2 className="h-6 w-6 animate-spin text-[#1677FF]" /></section>
  }

  if (!plan) {
    return (
      <section className="flex min-h-[680px] items-center justify-center rounded-lg border border-[#D7E5F2] bg-white p-6 text-center">
        <div className="max-w-md">
          <Layers3 className="mx-auto h-10 w-10 text-[#69B1FF]" />
          <h3 className="mt-4 text-base font-bold text-[#102A43]">还没有启用内容发布规划</h3>
          <p className="mt-2 text-xs leading-6 text-[#6B8299]">先在关键词策略中确定平台、预算和每日配额，再回来按计划批量生产内容。</p>
          <Button type="button" onClick={openKeywordPlan} className="mt-5 h-10 bg-[#1677FF] px-5 text-sm font-semibold text-white">前往关键词策略</Button>
        </div>
      </section>
    )
  }

  return (
    <section className="min-h-[680px] overflow-hidden rounded-lg border border-[#CFE3F7] bg-white shadow-sm">
      <header className="border-b border-[#DCEAF6] bg-gradient-to-r from-[#EAF4FF] via-white to-[#E8FBFF] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-[#003EB3]"><Layers3 className="h-4 w-4" />按发布计划生产</h3>
            <p className="mt-1 text-[11px] leading-5 text-[#6B8299]">一份母稿可对应多个平台交付任务，生成完成后按平台打包下载。</p>
          </div>
          <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">第 {plan.version} 版规划 · 已启用</span>
        </div>
      </header>

      <div className="space-y-4 p-4">
        {error ? <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
        {notice ? <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div> : null}

        <div className="grid gap-3 border-b border-[#E7EFF6] pb-4 lg:grid-cols-[auto_auto_1fr_auto] lg:items-end">
          <label className="text-[11px] font-semibold text-[#526A83]">开始日期<input type="date" value={dateFrom} min={plan.input.startDate} max={plan.input.endDate} onChange={event => setDateFrom(event.target.value)} className="mt-1.5 block h-10 rounded-lg border border-[#C8D9E8] bg-white px-3 text-xs outline-none focus:border-[#1677FF]" /></label>
          <label className="text-[11px] font-semibold text-[#526A83]">结束日期<input type="date" value={dateTo} min={dateFrom} max={plan.input.endDate} onChange={event => setDateTo(event.target.value)} className="mt-1.5 block h-10 rounded-lg border border-[#C8D9E8] bg-white px-3 text-xs outline-none focus:border-[#1677FF]" /></label>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-[#526A83]">发布平台（不勾选代表全部）</div>
            <div className="flex min-h-10 flex-wrap items-center gap-1.5">
              {platforms.map(platform => {
                const active = selectedPlatforms.has(platform.key)
                return <button key={platform.key} type="button" onClick={() => setSelectedPlatforms(current => { const next = new Set(current); if (next.has(platform.key)) next.delete(platform.key); else next.add(platform.key); return next })} className={`h-8 rounded-md border px-2.5 text-[10px] font-semibold transition ${active ? "border-[#1677FF] bg-[#EAF4FF] text-[#0958D9]" : "border-[#D7E5F2] bg-white text-[#526A83]"}`}>{platform.name} · {platform.count}</button>
              })}
              {platforms.length === 0 ? <span className="text-xs text-[#8AA0B5]">所选日期暂无任务</span> : null}
            </div>
          </div>
          <Button type="button" onClick={() => void startProduction()} disabled={submitting || filteredTasks.length === 0} className="h-10 gap-2 bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-bold text-white">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileStack className="h-4 w-4" />}
            生成所选内容
          </Button>
        </div>

        <div className="grid gap-px overflow-hidden rounded-lg border border-[#DCE8F4] bg-[#DCE8F4] sm:grid-cols-3">
          <Metric icon={<CalendarDays />} label="发布任务" value={`${filteredTasks.length} 项`} />
          <Metric icon={<FileStack />} label="原创母稿" value={`${assetCount} 篇/条`} />
          <Metric icon={<FolderArchive />} label="跨平台复用" value={`${reusedCount} 次`} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[230px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-lg border border-[#D7E5F2]">
            <div className="flex items-center justify-between border-b border-[#E7EFF6] bg-[#F8FBFF] px-3 py-2.5"><span className="text-xs font-bold text-[#102A43]">生产记录</span><button type="button" onClick={() => void load()} className="rounded-md p-1.5 text-[#6B8299] hover:bg-white" aria-label="刷新生产记录"><RefreshCw className="h-3.5 w-3.5" /></button></div>
            <div className="max-h-[430px] divide-y divide-[#EDF2F7] overflow-y-auto">
              {runs.length === 0 ? <div className="px-3 py-10 text-center text-xs text-[#8AA0B5]">还没有生产记录</div> : runs.map(run => <button key={run.id} type="button" onClick={() => setSelectedRunId(run.id)} className={`block w-full px-3 py-3 text-left transition ${selectedRun?.id === run.id ? "bg-[#EEF6FF]" : "bg-white hover:bg-[#F8FBFF]"}`}><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-[#102A43]">{run.dateFrom === run.dateTo ? run.dateFrom : `${run.dateFrom} 至 ${run.dateTo}`}</span><span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${statusClass(run)}`}>{statusLabel(run)}</span></div><p className="mt-1 text-[10px] text-[#6B8299]">{run.requestedAssetCount} 篇母稿 · {run.requestedPublicationCount} 项发布</p></button>)}
            </div>
          </div>

          <div className="min-w-0 overflow-hidden rounded-lg border border-[#D7E5F2]">
            {!selectedRun ? <div className="flex min-h-64 items-center justify-center text-xs text-[#8AA0B5]">选择一条生产记录查看进度</div> : <>
              <div className="border-b border-[#E7EFF6] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><span className="text-sm font-bold text-[#102A43]">{selectedRun.stage}</span><span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${statusClass(selectedRun)}`}>{statusLabel(selectedRun)}</span></div><p className="mt-1 text-[10px] text-[#6B8299]">质检通过 {selectedRun.passedCount} · 待复核 {selectedRun.reviewRequiredCount} · 未完成 {selectedRun.failedCount + selectedRun.cancelledCount}</p></div><div className="flex flex-wrap items-center gap-2">{!TERMINAL.has(selectedRun.status) ? <Button type="button" variant="outline" onClick={() => void cancelRun()} disabled={acting} className="h-8 gap-1.5 border-rose-200 px-2.5 text-[10px] text-rose-600">{acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3" />}停止</Button> : null}<a href={apiUrl(`/${encodeURIComponent(selectedRun.id)}/download`, { scope: "passed" })} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#91CAFF] bg-white px-2.5 text-[10px] font-semibold text-[#0958D9]"><Download className="h-3.5 w-3.5" />仅质检通过</a><a href={apiUrl(`/${encodeURIComponent(selectedRun.id)}/download`, { scope: "all" })} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#1677FF] px-2.5 text-[10px] font-semibold text-white"><Download className="h-3.5 w-3.5" />下载全部稿件</a></div></div>
                <div className="mt-3 flex items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-[#E7EFF7]"><div className="h-full rounded-full bg-gradient-to-r from-[#1677FF] to-[#13C2C2]" style={{ width: `${progress}%` }} /></div><span className="font-mono text-xs font-bold text-[#0958D9]">{progress}%</span></div>
              </div>
              <div className="max-h-[410px] divide-y divide-[#EDF2F7] overflow-y-auto">{selectedRun.items.map((item, index) => <article key={item.id} className="px-4 py-3"><div className="flex items-start gap-3"><span className="mt-0.5 font-mono text-[10px] text-[#8AA0B5]">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><p className="text-xs font-semibold leading-5 text-[#102A43]">{item.title || item.question}</p><div className="mt-1.5 flex flex-wrap gap-1.5">{item.deliveries.map(delivery => <span key={delivery.publishingTaskId} className="rounded bg-[#EEF5FC] px-1.5 py-0.5 text-[9px] font-semibold text-[#526A83]">{delivery.platformName}</span>)}<span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">{item.reuseMode === "master_reuse" ? "跨平台母稿" : "平台专稿"}</span></div>{item.error ? <p className="mt-1.5 text-[10px] text-rose-600">{item.error}</p> : null}</div><span className="shrink-0 text-[10px] font-semibold text-[#6B8299]">{item.status === "ready" ? "质检通过" : item.status === "review_required" ? "待复核" : item.status === "failed" ? "失败" : item.status === "cancelled" ? "已停止" : item.status === "running" ? "生成中" : "排队中"}</span></div></article>)}</div>
            </>}
          </div>
        </div>
      </div>
    </section>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="bg-white px-4 py-3"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#EAF4FF] text-[#1677FF] [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span><p className="mt-2 text-[10px] text-[#7E91A7]">{label}</p><p className="mt-0.5 text-lg font-bold text-[#102A43]">{value}</p></div>
}

function currentWorkspaceTeamId(): string {
  if (typeof window === "undefined") return ""
  return String(new URL(window.location.href).searchParams.get("teamId") || "").trim().slice(0, 200)
}

function currentWorkspaceRunId(): string {
  if (typeof window === "undefined") return ""
  return String(new URL(window.location.href).searchParams.get("jobId") || "").trim().slice(0, 240)
}
