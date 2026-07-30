"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  ArrowLeft,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Gauge,
  History,
  Loader2,
  Radar,
  RefreshCw,
  Swords,
} from "lucide-react"
import DifficultyDimensionsRadial from "@/components/difficulty/difficulty-dimensions-radial"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type {
  Client,
  CompetitorCompareResult,
  Diagnosis,
  DifficultyAssessmentResult,
  ResearchResult,
  SystemOutputKind,
  SystemOutputListPage,
  SystemOutputModule,
  SystemOutputRecord,
} from "@/types"

type Props = {
  clients: Array<Pick<Client, "id" | "name">>
  activeClientId: string | null
  teamId?: string
  modules: SystemOutputModule[]
}

const MODULE_LABELS: Record<SystemOutputModule, string> = {
  penetration: "渗透率情报",
  research: "独立调研",
  diagnosis: "AI 诊断",
  difficulty: "难度测评",
}

const KIND_LABELS: Record<SystemOutputKind, string> = {
  penetration_analysis: "疑问句检测",
  independent_research: "独立调研",
  competitor_comparison: "竞品对比",
  website_diagnosis: "网站诊断",
  difficulty_assessment: "难度测评",
}

const PAGE_SIZE = 20

export default function SystemOutputHistoryPanel({
  clients,
  activeClientId,
  teamId,
  modules,
}: Props) {
  const availableModuleKey = modules
    .filter(module => module !== "penetration")
    .join("|")
  const availableModules = useMemo<SystemOutputModule[]>(
    () => availableModuleKey
      ? availableModuleKey.split("|") as SystemOutputModule[]
      : [],
    [availableModuleKey],
  )
  const [clientId, setClientId] = useState(
    activeClientId || clients[0]?.id || "",
  )
  const [selectedModule, setSelectedModule] = useState<SystemOutputModule>(
    availableModules[0] || "research",
  )
  const [page, setPage] = useState(1)
  const [pageData, setPageData] = useState<SystemOutputListPage>({
    items: [],
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    hasMore: false,
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SystemOutputRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState("")
  const requestVersionRef = useRef(0)

  const effectiveModule = availableModules.includes(selectedModule)
    ? selectedModule
    : availableModules[0] || "research"
  const effectiveClientId = clientId && clients.some(client => client.id === clientId)
    ? clientId
    : activeClientId || clients[0]?.id || ""

  const loadHistory = useCallback(async (silent = false) => {
    if (!effectiveClientId || !availableModules.includes(effectiveModule)) {
      setPageData({ items: [], page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false })
      setLoading(false)
      return
    }
    const version = ++requestVersionRef.current
    if (!silent) setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({
        clientId: effectiveClientId,
        module: effectiveModule,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (teamId) params.set("teamId", teamId)
      const response = await apiFetch(`/api/system-outputs?${params.toString()}`)
      const data = await readApiJson<SystemOutputListPage & { error?: string }>(
        response,
        "云端产出记录",
      )
      if (!response.ok) throw new Error(data.error || "读取云端产出记录失败")
      if (version === requestVersionRef.current) setPageData(data)
    } catch (caught) {
      if (version === requestVersionRef.current) {
        setError(toUserFacingError(caught, {
          fallback: "读取云端产出记录失败，请稍后重试。",
          subject: "云端产出",
        }))
      }
    } finally {
      if (!silent && version === requestVersionRef.current) setLoading(false)
    }
  }, [availableModules, effectiveClientId, effectiveModule, page, teamId])

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
          const params = new URLSearchParams()
          if (teamId) params.set("teamId", teamId)
          const response = await apiFetch(
            `/api/system-outputs/${encodeURIComponent(selectedId)}?${params.toString()}`,
            { cache: "no-store", signal: controller.signal },
          )
          const data = await readApiJson<SystemOutputRecord & { error?: string }>(
            response,
            "云端产出详情",
          )
          if (!response.ok) throw new Error(data.error || "读取云端产出详情失败")
          if (!controller.signal.aborted) setDetail(data)
        } catch (caught) {
          if (!controller.signal.aborted) {
            setError(toUserFacingError(caught, {
              fallback: "读取云端产出详情失败，请稍后重试。",
              subject: "云端产出",
            }))
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
  }, [selectedId, teamId])

  function changeClient(value: string) {
    setClientId(value)
    setPage(1)
    setSelectedId(null)
    setDetail(null)
  }

  function changeModule(value: SystemOutputModule) {
    setSelectedModule(value)
    setPage(1)
    setSelectedId(null)
    setDetail(null)
  }

  if (availableModules.length === 0) {
    return (
      <div className="flex min-h-72 flex-1 flex-col items-center justify-center px-6 text-center">
        <History className="h-10 w-10 text-slate-300" />
        <p className="mt-3 text-sm font-semibold text-slate-700">当前账号暂无其他模块的历史查看权限</p>
      </div>
    )
  }

  if (selectedId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-[#F4F8FD]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
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
            <span className="text-[11px] text-slate-400">
              {formatDate(detail.completedAt || detail.createdAt)}
            </span>
          ) : null}
        </div>
        {error ? <ErrorNotice message={error} /> : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {detailLoading ? (
            <div className="flex min-h-64 items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#1677FF]" />
              正在读取完整结果
            </div>
          ) : detail ? (
            <OutputDetail record={detail} />
          ) : null}
        </div>
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(pageData.total / PAGE_SIZE))

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
        <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_minmax(160px,0.75fr)_auto]">
          <select
            aria-label="筛选客户"
            value={effectiveClientId}
            onChange={event => changeClient(event.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#1677FF]"
          >
            {clients.map(client => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
          <select
            aria-label="筛选产出模块"
            value={effectiveModule}
            onChange={event => changeModule(event.target.value as SystemOutputModule)}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#1677FF]"
          >
            {availableModules.map(item => (
              <option key={item} value={item}>{MODULE_LABELS[item]}</option>
            ))}
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
      </div>

      {error ? <ErrorNotice message={error} /> : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex min-h-64 items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#1677FF]" />
            正在读取云端产出
          </div>
        ) : pageData.items.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
            <History className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">暂无云端产出记录</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
              新完成的{MODULE_LABELS[effectiveModule]}任务会自动保存，换设备登录也能查看。
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {pageData.items.map(item => {
              const Icon = kindIcon(item.kind)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className="flex w-full items-start gap-3 px-4 py-4 text-left transition hover:bg-sky-50/45 sm:px-6"
                >
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white shadow-sm">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900">
                          {item.summary.title}
                        </span>
                        <span className="mt-1 block text-[11px] text-slate-500">
                          {KIND_LABELS[item.kind]} · {item.summary.subjectName}
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                        <CheckCircle2 className="h-3 w-3" />
                        已保存
                      </span>
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                      <span>{formatDate(item.completedAt || item.createdAt)}</span>
                      {item.summary.primaryMetricLabel ? (
                        <span>
                          {item.summary.primaryMetricLabel}：{item.summary.primaryMetricValue}
                        </span>
                      ) : null}
                      {item.summary.secondaryMetricLabel ? (
                        <span>
                          {item.summary.secondaryMetricLabel}：{item.summary.secondaryMetricValue}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {pageData.total > PAGE_SIZE ? (
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 sm:px-6">
          <span>共 {pageData.total} 条 · 第 {page}/{totalPages} 页</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(current => Math.max(1, current - 1))}
              className="rounded-md border border-slate-200 p-1.5 disabled:opacity-35"
              aria-label="上一页"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={!pageData.hasMore}
              onClick={() => setPage(current => current + 1)}
              className="rounded-md border border-slate-200 p-1.5 disabled:opacity-35"
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

function OutputDetail({ record }: { record: SystemOutputRecord }) {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <section className="overflow-hidden rounded-lg border border-[#B7DAFF] bg-white shadow-sm">
        <div className="bg-gradient-to-r from-[#003EB3] via-[#1677FF] to-[#00AEEA] px-4 py-4 text-white sm:px-5">
          <div className="text-xs text-cyan-50/75">{KIND_LABELS[record.kind]}</div>
          <h3 className="mt-1 text-lg font-bold">{record.summary.title}</h3>
        </div>
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2">
          <SummaryMetric
            label={record.summary.primaryMetricLabel || "分析主体"}
            value={record.summary.primaryMetricValue || record.summary.subjectName}
          />
          <SummaryMetric
            label={record.summary.secondaryMetricLabel || "所属行业"}
            value={record.summary.secondaryMetricValue || record.summary.industry || "-"}
          />
        </div>
        {record.summary.description ? (
          <p className="border-t border-slate-100 px-4 py-3 text-xs leading-6 text-slate-600 sm:px-5">
            {record.summary.description}
          </p>
        ) : null}
      </section>
      <ResultContent record={record} />
    </div>
  )
}

function ResultContent({ record }: { record: SystemOutputRecord }) {
  if (record.kind === "independent_research") {
    const result = record.result as ResearchResult | undefined
    if (!result) return <MissingResult />
    return (
      <>
        <TextSection title="调研结论" text={result.executiveSummary} />
        <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
          <h4 className="text-sm font-semibold text-slate-800">核心维度</h4>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {result.dimensions.map(item => (
              <div key={item.name} className="rounded-md bg-[#F5FAFF] px-3 py-3">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-800">
                  <span>{item.name}</span>
                  <span className="text-[#1677FF]">{item.score}</span>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-600">{item.insight}</p>
              </div>
            ))}
          </div>
        </section>
        <ListSection title="建议动作" items={result.recommendations} />
      </>
    )
  }

  if (record.kind === "competitor_comparison") {
    const result = record.result as CompetitorCompareResult | undefined
    if (!result) return <MissingResult />
    const comparisons = result.comparisons?.length ? result.comparisons : [result]
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h4 className="text-sm font-semibold text-slate-800">竞品对比结论</h4>
        <div className="mt-3 space-y-3">
          {comparisons.map((item, index) => (
            <div key={`${item.competitor}-${index}`} className="border-l-2 border-[#1677FF] pl-3">
              <div className="text-xs font-semibold text-slate-800">{item.competitor}</div>
              <p className="mt-1 text-xs leading-5 text-slate-600">{item.positioningSummary}</p>
              <div className="mt-2 text-[11px] text-slate-500">
                我方优势：{item.ourAdvantages.join("；") || "-"}
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (record.kind === "website_diagnosis") {
    const result = record.result as Diagnosis | undefined
    if (!result) return <MissingResult />
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <div className="flex min-h-36 flex-col items-center justify-center rounded-lg bg-gradient-to-br from-[#EAF5FF] to-[#F0FBFF]">
            <div className="text-xs font-semibold text-slate-500">综合诊断分</div>
            <div className="mt-1 text-5xl font-bold text-[#003EB3]">{result.gemScore}</div>
            <div className="text-xs text-slate-400">/ 100</div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-800">五维表现</h4>
            <div className="mt-3 space-y-2">
              {Object.entries(result.dimensions).map(([key, value]) => (
                <div key={key} className="grid grid-cols-[90px_1fr_38px] items-center gap-2 text-xs">
                  <span className="truncate text-slate-600">{diagnosisDimensionLabel(key)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-[#1677FF] to-[#00C8FF]"
                      style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%` }}
                    />
                  </span>
                  <span className="text-right font-semibold text-slate-700">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    )
  }

  if (record.kind === "difficulty_assessment") {
    const result = record.result as DifficultyAssessmentResult | undefined
    if (!result) return <MissingResult />
    return (
      <>
        <DifficultyDimensionsRadial
          dimensions={Object.values(result.dimensions)}
          totalScore={result.totalScore}
          level={result.level}
        />
        <TextSection title="测评结论" text={result.summary} />
        <ListSection title="执行建议" items={result.suggestions} />
      </>
    )
  }

  return <MissingResult />
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-3 sm:px-5">
      <div className="text-[10px] font-medium text-slate-400">{label}</div>
      <div className="mt-1 text-base font-bold text-slate-900">{value}</div>
    </div>
  )
}

function TextSection({ title, text }: { title: string; text: string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      <p className="mt-2 text-xs leading-6 text-slate-600">{text}</p>
    </section>
  )
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      <ol className="mt-3 space-y-2">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2 text-xs leading-5 text-slate-600">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#EAF5FF] text-[10px] font-bold text-[#0958D9]">
              {index + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function MissingResult() {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white text-center">
      <AlertCircle className="h-7 w-7 text-slate-300" />
      <p className="mt-2 text-xs text-slate-500">该记录暂时没有可展示的完整结果</p>
    </div>
  )
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-700 sm:px-6">
      {message}
    </div>
  )
}

function kindIcon(kind: SystemOutputKind) {
  if (kind === "independent_research") return Brain
  if (kind === "competitor_comparison") return Swords
  if (kind === "website_diagnosis") return Radar
  return Gauge
}

function diagnosisDimensionLabel(key: string): string {
  return {
    authority: "信源权威性",
    structure: "内容结构化",
    traceability: "信息可追溯",
    coverage: "关键词覆盖",
    sentiment: "情感倾向",
  }[key] || key
}

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
