"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import {
  BarChart3,
  CheckCircle2,
  Download,
  FileDown,
  Gauge,
  Layers3,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react"
import { readApiJson } from "@/lib/api-fetch"
import type {
  Client,
  CommercialReportDetail,
  CommercialReportInput,
  CommercialReportJobRecord,
  CommercialReportKind,
  PenetrationItem,
  PenetrationResult,
  ReportExportPreset,
} from "@/types"

type Props = {
  client: Client
  preset?: ReportExportPreset
  onClose: () => void
}

const KIND_OPTIONS: Array<{
  kind: CommercialReportKind
  title: string
  description: string
  icon: typeof Layers3
}> = [
  { kind: "combined", title: "综合商业报告", description: "渗透率、信源、难度与行动建议", icon: Layers3 },
  { kind: "penetration", title: "渗透率情报", description: "品牌声量、模型表现与联网信源", icon: BarChart3 },
  { kind: "difficulty", title: "难度测评", description: "六维评分、关键洞察与执行路径", icon: Gauge },
]

function availableKinds(client: Client): CommercialReportKind[] {
  const hasPenetration = Boolean(client.penetration)
  const hasDifficulty = Boolean(client.difficultyAssessments?.length)
  if (hasPenetration && hasDifficulty) return ["combined", "penetration", "difficulty"]
  if (hasPenetration) return ["penetration"]
  if (hasDifficulty) return ["difficulty"]
  return []
}

function compactItem(item: PenetrationItem, detail: CommercialReportDetail): PenetrationItem {
  return {
    ...item,
    question: String(item.question || "").slice(0, 2_000),
    answer: detail === "full" ? String(item.answer || "").slice(0, 1_000) : "",
    mentionedBrands: (item.mentionedBrands || []).slice(0, 100),
    searchSources: item.searchSources?.slice(0, 200).map(source => ({
      title: String(source.title || "").slice(0, 500),
      snippet: String(source.snippet || "").slice(0, 1_000),
      url: String(source.url || "").slice(0, 4_000),
      domain: String(source.domain || "").slice(0, 500),
      query: String(source.query || "").slice(0, 1_000),
    })),
    searchQueries: item.searchQueries?.slice(0, 100).map(query => query.slice(0, 1_000)),
    webVerificationNote: item.webVerificationNote?.slice(0, 2_000),
    webFailureReason: item.webFailureReason?.slice(0, 2_000),
  }
}

function compactPenetration(
  penetration: PenetrationResult | undefined,
  detail: CommercialReportDetail,
): PenetrationResult | undefined {
  if (!penetration) return undefined
  return {
    ...penetration,
    byModel: Object.fromEntries(
      Object.entries(penetration.byModel).map(([model, items]) => [
        model,
        items?.map(item => compactItem(item, detail)),
      ]),
    ),
  }
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", { hour12: false })
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

async function reportFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { cache: "no-store", ...init })
  } catch {
    throw new Error("报告服务连接中断，请稍后重试。")
  }
}

export default function ReportExportDialog({ client, preset, onClose }: Props) {
  const kinds = useMemo(() => availableKinds(client), [client])
  const initialKind = preset?.kind && kinds.includes(preset.kind) ? preset.kind : kinds[0] || "combined"
  const [kind, setKind] = useState<CommercialReportKind>(initialKind)
  const [detail, setDetail] = useState<CommercialReportDetail>("concise")
  const [difficultyEntryId, setDifficultyEntryId] = useState(
    preset?.difficultyEntryId || client.difficultyAssessments?.[0]?.id || "",
  )
  const [generating, setGenerating] = useState(false)
  const [job, setJob] = useState<CommercialReportJobRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  const difficulty = client.difficultyAssessments?.find(entry => entry.id === difficultyEntryId)
    || client.difficultyAssessments?.[0]
  const canGenerate = kinds.length > 0
    && (kind !== "penetration" || Boolean(client.penetration))
    && (kind !== "difficulty" || Boolean(difficulty))

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !generating) onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [generating, onClose])

  function buildInput(): CommercialReportInput {
    const includePenetration = kind === "combined" || kind === "penetration"
    const includeDifficulty = kind === "combined" || kind === "difficulty"
    return {
      kind,
      detail,
      client: {
        id: client.id,
        name: client.name,
        ourBrand: client.ourBrand,
        brandAliases: client.brandAliases || [],
        industry: client.industry,
        website: client.website,
      },
      penetration: includePenetration ? compactPenetration(client.penetration, detail) : undefined,
      difficulty: includeDifficulty ? difficulty : undefined,
    }
  }

  async function downloadReport(completedJob: CommercialReportJobRecord): Promise<void> {
    const response = await reportFetch(`/api/reports/jobs/${completedJob.id}/download`)
    if (!response.ok) {
      const data = await readApiJson<{ error?: string }>(response, "报告下载")
      throw new Error(data.error || "报告下载失败")
    }
    saveBlob(await response.blob(), completedJob.fileName || `${client.name}-GEO-商业报告.pdf`)
  }

  async function generateReport() {
    if (!canGenerate || generating) return
    setGenerating(true)
    setError(null)
    setJob(null)
    try {
      const response = await reportFetch("/api/reports/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: buildInput() }),
      })
      let current = await readApiJson<CommercialReportJobRecord & { error?: string }>(response, "专业报告任务")
      if (!response.ok) throw new Error(current.error || "创建专业报告任务失败")
      setJob(current)

      while (current.status === "queued" || current.status === "running") {
        await new Promise(resolve => setTimeout(resolve, 1_800))
        const pollResponse = await reportFetch(`/api/reports/jobs/${current.id}`)
        current = await readApiJson<CommercialReportJobRecord & { error?: string }>(pollResponse, "专业报告进度")
        if (!pollResponse.ok) throw new Error(current.error || "查询专业报告进度失败")
        setJob(current)
      }
      if (current.status === "failed") throw new Error(current.error || "专业报告生成失败")
      await downloadReport(current)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "专业报告生成失败")
    } finally {
      setGenerating(false)
    }
  }

  const dialog = (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden bg-slate-950/65 px-3 py-3 backdrop-blur-sm sm:px-6 sm:py-6"
      onClick={() => { if (!generating) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-export-title"
    >
      <div className="flex min-h-full items-center justify-center">
        <div
          className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl ring-1 ring-white/20 sm:max-h-[92dvh]"
          onClick={event => event.stopPropagation()}
        >
          <div className="shrink-0 bg-[#001D66] px-5 py-4 text-white sm:px-7 sm:py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#1677FF] shadow-sm">
                  <FileDown className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 id="report-export-title" className="geo-display-title text-xl">生成专业可视化报告</h2>
                  <p className="mt-1 truncate text-xs text-cyan-100/70">{client.name} · A4 商业版式 · 可点击信源</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={generating}
                className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                aria-label="关闭报告窗口"
                title={generating ? "报告生成中，请稍候" : "关闭"}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7">
            {kinds.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
                <BarChart3 className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-700">暂无可导出的报告数据</p>
                <p className="mt-1 text-xs text-slate-500">请先完成一次渗透率检测或难度测评。</p>
              </div>
            ) : (
              <>
                <section>
                  <div className="mb-2 text-xs font-semibold text-slate-700">报告范围</div>
                  <div className={`grid gap-2 ${kinds.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                    {KIND_OPTIONS.filter(option => kinds.includes(option.kind)).map(option => {
                      const Icon = option.icon
                      const selected = kind === option.kind
                      return (
                        <button
                          key={option.kind}
                          type="button"
                          onClick={() => setKind(option.kind)}
                          disabled={generating}
                          className={`flex min-h-[86px] items-start gap-3 rounded-lg border p-3 text-left transition ${selected
                            ? "border-[#1677FF] bg-[#EEF6FF] ring-2 ring-[#1677FF]/10"
                            : "border-slate-200 bg-white hover:border-sky-200 hover:bg-slate-50"
                          }`}
                        >
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-[#1677FF] text-white" : "bg-slate-100 text-slate-500"}`}>
                            <Icon className="h-4 w-4" />
                          </span>
                          <span>
                            <span className="block text-sm font-semibold text-slate-900">{option.title}</span>
                            <span className="mt-1 block text-[11px] leading-4 text-slate-500">{option.description}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>

                {(kind === "combined" || kind === "difficulty") && (client.difficultyAssessments?.length || 0) > 1 && (
                  <section className="mt-5">
                    <label htmlFor="report-difficulty" className="text-xs font-semibold text-slate-700">采用哪一份难度测评</label>
                    <select
                      id="report-difficulty"
                      value={difficultyEntryId}
                      onChange={event => setDifficultyEntryId(event.target.value)}
                      disabled={generating}
                      className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-[#00C8FF] focus:ring-2 focus:ring-sky-100"
                    >
                      {client.difficultyAssessments?.map(entry => (
                        <option key={entry.id} value={entry.id}>
                          {entry.industry} · {entry.result.totalScore} 分 · {formatDate(entry.createdAt)}
                        </option>
                      ))}
                    </select>
                  </section>
                )}

                <section className="mt-5">
                  <div className="mb-2 text-xs font-semibold text-slate-700">报告版本</div>
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setDetail("concise")}
                      disabled={generating}
                      className={`rounded-md px-3 py-2.5 text-xs font-semibold transition ${detail === "concise" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-500"}`}
                    >
                      精简决策版
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetail("full")}
                      disabled={generating}
                      className={`rounded-md px-3 py-2.5 text-xs font-semibold transition ${detail === "full" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-500"}`}
                    >
                      审计附录版
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">
                    {detail === "full" ? "增加最多 120 条原始回答审计附录，适合交付、复盘和信源核验。" : "突出管理层摘要、核心图表和行动路线，文件更轻、生成更快。"}
                  </p>
                </section>

                <div className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-3 text-xs leading-5 text-emerald-900">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  报告仅使用当前客户已保存的数据生成，不额外调用 AI，也不会把其他客户的数据混入本报告。
                </div>

                {(job || generating) && (
                  <div className="mt-5 rounded-lg border border-sky-100 bg-sky-50/70 px-4 py-3">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex items-center gap-2 font-semibold text-[#003EB3]">
                        {job?.status === "succeeded" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Loader2 className="h-4 w-4 animate-spin" />}
                        {job?.stage || "正在提交报告任务"}
                      </span>
                      <span className="font-mono font-bold text-[#003EB3]">{job?.progress || 0}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white ring-1 ring-sky-100">
                      <div className="h-full rounded-full bg-[#16C79A] transition-all duration-500" style={{ width: `${job?.progress || 4}%` }} />
                    </div>
                  </div>
                )}

                {error && (
                  <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700">{error}</div>
                )}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-3 sm:px-7">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={generating}
                className="h-10 rounded-lg border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                onClick={generateReport}
                disabled={!canGenerate || generating}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#1677FF] bg-[#1677FF] px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0958D9] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {generating ? "正在生成" : "生成并下载 PDF"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  if (typeof document === "undefined") return null
  return createPortal(dialog, document.body)
}
