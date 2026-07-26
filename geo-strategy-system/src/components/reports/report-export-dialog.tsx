"use client"

import NextImage from "next/image"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertCircle,
  BarChart3,
  Brain,
  Building2,
  CheckCircle2,
  Download,
  FileDown,
  Gauge,
  ImagePlus,
  Layers3,
  Link2,
  LockKeyhole,
  Loader2,
  Radar,
  RotateCcw,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from "lucide-react"
import { BillingLink } from "@/components/billing/billing-link"
import { CreditCostBadge } from "@/components/credits/credit-cost-badge"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { createBackgroundRequestId } from "@/lib/background-job-client"
import { DEFAULT_REPORT_BRANDING, resolveReportBranding } from "@/lib/report-branding"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type {
  Client,
  CommercialReportDetail,
  CommercialReportInput,
  CommercialReportJobRecord,
  CommercialReportKind,
  PenetrationItem,
  PenetrationResult,
  ReportBrandingSettings,
  ReportBrandingAccess,
  ReportExportPreset,
} from "@/types"

type Props = {
  client: Client
  teamId?: string
  preset?: ReportExportPreset
  onClose: () => void
}

const KIND_OPTIONS: Array<{
  kind: CommercialReportKind
  title: string
  description: string
  icon: typeof Layers3
}> = [
  { kind: "combined", title: "四模块综合报告", description: "整合当前已有的前四个模块结果", icon: Layers3 },
  { kind: "penetration", title: "渗透率情报", description: "品牌声量、模型表现与联网信源", icon: BarChart3 },
  { kind: "research", title: "独立调研", description: "认知调研、证据缺口与竞品对比", icon: Brain },
  { kind: "diagnosis", title: "AI 诊断", description: "网站 GEO 评分、爬虫规则与整改证据", icon: Radar },
  { kind: "difficulty", title: "难度测评", description: "七维评分、关键洞察与执行路径", icon: Gauge },
]

const MAX_SOURCE_LOGO_BYTES = 8 * 1024 * 1024
const MAX_REPORT_LOGO_BYTES = 600 * 1024

function dataUrlBytes(value: string): number {
  const encoded = value.split(",", 2)[1] || ""
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding)
}

function loadBrowserImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = document.createElement("img")
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error("Logo 图片无法读取，请换一张图片"))
    }
    image.src = objectUrl
  })
}

function renderLogoDataUrl(args: {
  image: HTMLImageElement
  maxSide: number
  mimeType: "image/png" | "image/jpeg"
  quality?: number
  whiteBackground?: boolean
}): string {
  const { image, maxSide, mimeType, quality, whiteBackground } = args
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("当前浏览器无法处理 Logo")
  if (whiteBackground) {
    context.fillStyle = "#FFFFFF"
    context.fillRect(0, 0, width, height)
  }
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = "high"
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL(mimeType, quality)
}

async function optimizeLogo(file: File): Promise<string> {
  if (file.type !== "image/png" && file.type !== "image/jpeg") {
    throw new Error("Logo 仅支持 PNG 或 JPG 图片")
  }
  if (file.size > MAX_SOURCE_LOGO_BYTES) throw new Error("Logo 原图不能超过 8MB")
  const image = await loadBrowserImage(file)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width < 16 || height < 16) throw new Error("Logo 尺寸过小，请上传更清晰的图片")

  const attempts = file.type === "image/png"
    ? [720, 560, 420, 320].map(maxSide => ({ maxSide, mimeType: "image/png" as const }))
    : [900, 720, 560, 420].map((maxSide, index) => ({
        maxSide,
        mimeType: "image/jpeg" as const,
        quality: [0.9, 0.87, 0.84, 0.8][index],
      }))
  for (const attempt of attempts) {
    const dataUrl = renderLogoDataUrl({ image, ...attempt })
    if (dataUrlBytes(dataUrl) <= MAX_REPORT_LOGO_BYTES) return dataUrl
  }

  const fallback = renderLogoDataUrl({
    image,
    maxSide: 420,
    mimeType: "image/jpeg",
    quality: 0.84,
    whiteBackground: true,
  })
  if (dataUrlBytes(fallback) <= MAX_REPORT_LOGO_BYTES) return fallback
  throw new Error("Logo 压缩后仍过大，请上传构图更简洁的图片")
}

function availableKinds(client: Client): CommercialReportKind[] {
  const modules: CommercialReportKind[] = []
  if (client.penetration) modules.push("penetration")
  if (client.research || client.competitorCompare) modules.push("research")
  if (client.diagnosis) modules.push("diagnosis")
  if (client.difficultyAssessments?.length) modules.push("difficulty")
  return modules.length > 1 ? ["combined", ...modules] : modules
}

function compactItem(item: PenetrationItem, detail: CommercialReportDetail): PenetrationItem {
  const full = detail === "full"
  const sources = full ? (item.searchSources || []) : (item.searchSources || []).slice(0, 200)
  const queries = full ? (item.searchQueries || []) : (item.searchQueries || []).slice(0, 100)
  return {
    ...item,
    question: full ? String(item.question || "") : String(item.question || "").slice(0, 2_000),
    answer: full ? String(item.answer || "") : "",
    mentionedBrands: full ? [...(item.mentionedBrands || [])] : (item.mentionedBrands || []).slice(0, 100),
    searchSources: sources.map(source => ({
      title: full ? String(source.title || "") : String(source.title || "").slice(0, 500),
      snippet: full ? String(source.snippet || "") : String(source.snippet || "").slice(0, 1_000),
      url: full ? String(source.url || "") : String(source.url || "").slice(0, 4_000),
      domain: full ? String(source.domain || "") : String(source.domain || "").slice(0, 500),
      query: full ? String(source.query || "") : String(source.query || "").slice(0, 1_000),
    })),
    searchQueries: queries.map(query => full ? query : query.slice(0, 1_000)),
    webVerificationNote: full ? item.webVerificationNote : item.webVerificationNote?.slice(0, 2_000),
    webFailureReason: full ? item.webFailureReason : item.webFailureReason?.slice(0, 2_000),
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

export default function ReportExportDialog({ client, teamId, preset, onClose }: Props) {
  const kinds = useMemo(() => availableKinds(client), [client])
  const initialKind = preset?.kind && kinds.includes(preset.kind) ? preset.kind : kinds[0] || "combined"
  const [kind, setKind] = useState<CommercialReportKind>(initialKind)
  const [detail, setDetail] = useState<CommercialReportDetail>("concise")
  const [difficultyEntryId, setDifficultyEntryId] = useState(
    preset?.difficultyEntryId || client.difficultyAssessments?.[0]?.id || "",
  )
  const [generating, setGenerating] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [job, setJob] = useState<CommercialReportJobRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [branding, setBranding] = useState<ReportBrandingSettings>({ ...DEFAULT_REPORT_BRANDING })
  const [brandingAccess, setBrandingAccess] = useState<ReportBrandingAccess>({
    membership: { tier: "free", active: false, paidCents: 0, qualifyingOrderCount: 0, clientAccountLimit: 0 },
    canUseCustomBranding: false,
    accessSource: "none",
    customReportCredits: 15,
  })
  const [brandingLoading, setBrandingLoading] = useState(true)
  const [brandingSaving, setBrandingSaving] = useState(false)
  const [logoProcessing, setLogoProcessing] = useState(false)
  const [rememberBranding, setRememberBranding] = useState(true)
  const [brandingError, setBrandingError] = useState<string | null>(null)
  const [brandingNotice, setBrandingNotice] = useState<string | null>(null)
  const customBrandingRef = useRef<ReportBrandingSettings>({
    mode: "custom",
    companyName: "",
    website: "",
  })
  const reportRequestIdRef = useRef<string | null>(null)

  const difficulty = client.difficultyAssessments?.find(entry => entry.id === difficultyEntryId)
    || client.difficultyAssessments?.[0]
  const canGenerate = kinds.length > 0
    && (kind !== "penetration" || Boolean(client.penetration))
    && (kind !== "research" || Boolean(client.research || client.competitorCompare))
    && (kind !== "diagnosis" || Boolean(client.diagnosis))
    && (kind !== "difficulty" || Boolean(difficulty))
    && !brandingLoading
    && !brandingSaving
    && !logoProcessing
    && (branding.mode !== "custom" || brandingAccess.canUseCustomBranding)
    && (branding.mode !== "custom" || Boolean(branding.companyName.trim()))
  const customBrandingLocked = branding.mode === "custom" && !brandingAccess.canUseCustomBranding

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (branding.mode === "custom") customBrandingRef.current = branding
  }, [branding])

  useEffect(() => {
    let active = true
    async function loadBranding() {
      try {
        const params = new URLSearchParams({ clientId: client.id })
        if (teamId) params.set("teamId", teamId)
        const response = await reportFetch(`/api/reports/branding?${params.toString()}`)
        const data = await readApiJson<{
          branding?: ReportBrandingSettings
          access?: ReportBrandingAccess
          error?: string
        }>(response, "报告出品方")
        if (!response.ok) throw new Error(data.error || "读取报告出品方失败")
        if (active) {
          const resolved = resolveReportBranding(data.branding)
          setBranding(resolved)
          if (resolved.mode === "custom") customBrandingRef.current = resolved
          if (data.access) setBrandingAccess(data.access)
        }
      } catch {
        if (active) {
          setBranding({ ...DEFAULT_REPORT_BRANDING })
          setBrandingNotice("未能读取已保存的出品方，本次已使用势途默认信息。")
        }
      } finally {
        if (active) setBrandingLoading(false)
      }
    }
    void loadBranding()
    return () => { active = false }
  }, [client.id, teamId])

  function buildInput(): CommercialReportInput {
    const includePenetration = kind === "combined" || kind === "penetration"
    const includeResearch = kind === "combined" || kind === "research"
    const includeDiagnosis = kind === "combined" || kind === "diagnosis"
    const includeDifficulty = kind === "combined" || kind === "difficulty"
    return {
      kind,
      detail,
      branding: resolveReportBranding(branding),
      client: {
        id: client.id,
        name: client.name,
        subjectType: client.subjectType,
        personProfile: client.personProfile,
        ourBrand: client.ourBrand,
        brandAliases: client.brandAliases || [],
        industry: client.industry,
        website: client.website,
      },
      penetration: includePenetration ? compactPenetration(client.penetration, detail) : undefined,
      research: includeResearch ? client.research : undefined,
      competitorCompare: includeResearch ? client.competitorCompare : undefined,
      diagnosis: includeDiagnosis ? client.diagnosis : undefined,
      difficulty: includeDifficulty ? difficulty : undefined,
    }
  }

  function changeBrandingMode(mode: ReportBrandingSettings["mode"]) {
    setBrandingError(null)
    setBrandingNotice(null)
    if (branding.mode === "custom") customBrandingRef.current = branding
    setBranding(mode === "shitu" ? { ...DEFAULT_REPORT_BRANDING } : { ...customBrandingRef.current })
  }

  async function handleLogoFile(file: File | undefined) {
    if (!file) return
    setLogoProcessing(true)
    setBrandingError(null)
    setBrandingNotice(null)
    try {
      const logoDataUrl = await optimizeLogo(file)
      setBranding(current => ({ ...current, logoDataUrl }))
    } catch (caught) {
      setBrandingError(toUserFacingError(caught, { fallback: "Logo 处理失败，请更换图片后重试。", subject: "Logo" }))
    } finally {
      setLogoProcessing(false)
    }
  }

  async function persistBranding(): Promise<ReportBrandingSettings> {
    setBrandingSaving(true)
    try {
      const response = await reportFetch("/api/reports/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, teamId, branding }),
      })
      const data = await readApiJson<{
        branding?: ReportBrandingSettings
        error?: string
        code?: string
      }>(response, "保存报告出品方")
      if (!response.ok || !data.branding) throw new Error(data.error || "保存报告出品方失败")
      const saved = resolveReportBranding(data.branding)
      setBranding(saved)
      return saved
    } finally {
      setBrandingSaving(false)
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
    if (branding.mode === "custom" && !branding.companyName.trim()) {
      setBrandingError("请填写报告出品方的公司名称。")
      return
    }
    setGenerating(true)
    setError(null)
    setBrandingError(null)
    setJob(null)
    try {
      if (rememberBranding && branding.mode === "custom") await persistBranding()
      const requestId = reportRequestIdRef.current
        || createBackgroundRequestId("report")
      reportRequestIdRef.current = requestId
      const response = await apiFetch("/api/reports/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: buildInput(), requestId, teamId }),
      })
      let current = await readApiJson<CommercialReportJobRecord & { error?: string }>(response, "专业报告任务")
      if (!response.ok) {
        if (response.status !== 409) reportRequestIdRef.current = null
        throw new Error(current.error || "创建专业报告任务失败")
      }
      reportRequestIdRef.current = null
      setJob(current)

      while (current.status === "queued" || current.status === "running") {
        await new Promise(resolve => setTimeout(resolve, 1_800))
        const pollResponse = await reportFetch(`/api/reports/jobs/${current.id}`)
        current = await readApiJson<CommercialReportJobRecord & { error?: string }>(pollResponse, "专业报告进度")
        if (!pollResponse.ok) throw new Error(current.error || "查询专业报告进度失败")
        setJob(current)
      }
      if (current.status === "failed") throw new Error(current.error || "专业报告生成失败")
      if (current.status === "cancelled") throw new Error("专业报告生成已停止")
      await downloadReport(current)
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "专业报告生成失败，请稍后重试。", subject: "专业报告" }))
    } finally {
      setGenerating(false)
    }
  }

  async function stopReport() {
    if (!job || (job.status !== "queued" && job.status !== "running") || stopping) return
    setStopping(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/reports/jobs/${encodeURIComponent(job.id)}`, {
        method: "PATCH",
      })
      const stopped = await readApiJson<CommercialReportJobRecord & { error?: string }>(
        response,
        "专业报告任务",
      )
      if (!response.ok) throw new Error(stopped.error || "停止报告生成失败")
      setJob(stopped)
    } catch (caught) {
      setError(toUserFacingError(caught, {
        fallback: "停止报告生成失败，请稍后重试。",
        subject: "专业报告",
      }))
    } finally {
      setStopping(false)
    }
  }

  const dialog = (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden bg-slate-950/65 px-3 py-3 backdrop-blur-sm sm:px-6 sm:py-6"
      onClick={onClose}
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
                  <p className="mt-1 truncate text-xs text-cyan-100/70">{client.name} · 专业版式 · 可点击信源</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                aria-label="关闭报告窗口"
                title="关闭"
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
                <p className="mt-1 text-xs text-slate-500">请先完成渗透率情报、独立调研、AI 诊断或难度测评中的任意一项。</p>
              </div>
            ) : (
              <>
                <section>
                  <div className="mb-2 text-xs font-semibold text-slate-700">报告范围</div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                      完整证据版
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">
                    {detail === "full" ? "完整保留全部已保存回答与可点击来源，适合交付、复盘和信源核验。" : "突出管理层摘要、核心图表和行动路线，文件更轻、生成更快。"}
                  </p>
                </section>

                <section className="mt-5 border-t border-slate-200/80 pt-5">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-700">报告出品方</div>
                      <div className="mt-1 text-[11px] text-slate-500">势途标准版免费；白标版可换成你的公司名称和 Logo。</div>
                    </div>
                    {brandingLoading ? <Loader2 className="h-4 w-4 animate-spin text-[#1677FF]" /> : null}
                  </div>

                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => changeBrandingMode("shitu")}
                      disabled={generating || brandingLoading}
                      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-xs font-semibold transition ${branding.mode === "shitu" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-500"}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      势途标准版 · 免费
                    </button>
                    <button
                      type="button"
                      onClick={() => changeBrandingMode("custom")}
                      disabled={generating || brandingLoading}
                      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-xs font-semibold transition ${branding.mode === "custom" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-500"}`}
                    >
                      {brandingAccess.canUseCustomBranding
                        ? <Building2 className="h-3.5 w-3.5" />
                        : <LockKeyhole className="h-3.5 w-3.5" />}
                      白标交付版
                    </button>
                  </div>

                  {branding.mode === "shitu" ? (
                    <div className="mt-3 flex items-center gap-3 border-l-2 border-[#1677FF] bg-[#F2F8FF] px-3 py-3">
                      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-sky-100">
                        <NextImage src="/logo.jpg" alt="势途 Logo" width={48} height={48} className="h-10 w-10 object-contain" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-slate-800">杭州势途数字科技有限公司</span>
                        <span className="mt-1 block truncate text-[11px] text-[#1677FF]">https://shitugeo.top</span>
                      </span>
                    </div>
                  ) : customBrandingLocked ? (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                          <LockKeyhole className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-amber-950">充值到账后解锁 VIP1</div>
                          <p className="mt-1 text-[11px] leading-5 text-amber-800">
                            任意真实充值套餐首次到账即永久解锁白标报告，之后每份仅消耗 {brandingAccess.customReportCredits} 积分。势途标准版始终免费。
                          </p>
                          {branding.companyName ? (
                            <p className="mt-1 text-[11px] text-amber-700">你之前保存的白标资料仍在，解锁后会自动恢复。</p>
                          ) : null}
                          <BillingLink onNavigate={onClose} className="mt-3 inline-flex h-8 items-center justify-center rounded-md bg-amber-600 px-3 text-xs font-semibold text-white transition hover:bg-amber-700">
                            查看充值套餐
                          </BillingLink>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 grid gap-4 md:grid-cols-[1fr_220px]">
                      <div className="space-y-3">
                        <label className="block">
                          <span className="text-[11px] font-semibold text-slate-600">公司名称</span>
                          <input
                            type="text"
                            value={branding.companyName}
                            onChange={event => setBranding(current => ({ ...current, companyName: event.target.value }))}
                            maxLength={120}
                            disabled={generating}
                            placeholder="如：某某数字科技有限公司"
                            className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[11px] font-semibold text-slate-600">公司官网（可选）</span>
                          <span className="relative mt-1.5 block">
                            <Link2 className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                            <input
                              type="text"
                              value={branding.website}
                              onChange={event => setBranding(current => ({ ...current, website: event.target.value }))}
                              maxLength={2_000}
                              disabled={generating}
                              placeholder="https://example.com"
                              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100"
                            />
                          </span>
                        </label>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold text-slate-600">Logo（可选）</div>
                        <div className="mt-1.5 flex h-[108px] items-center justify-center overflow-hidden rounded-lg border border-dashed border-sky-200 bg-[#F7FBFF] p-3">
                          {branding.logoDataUrl ? (
                            <NextImage
                              src={branding.logoDataUrl}
                              alt="自定义报告 Logo"
                              width={180}
                              height={80}
                              unoptimized
                              className="h-auto max-h-20 w-auto max-w-full object-contain"
                            />
                          ) : (
                            <Building2 className="h-8 w-8 text-sky-200" />
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <label className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[#1677FF] bg-white px-2 text-[11px] font-semibold text-[#0958D9] transition hover:bg-blue-50">
                            {logoProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                            {branding.logoDataUrl ? "替换" : "上传"}
                            <input
                              type="file"
                              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                              className="sr-only"
                              disabled={generating || logoProcessing}
                              onChange={event => {
                                void handleLogoFile(event.target.files?.[0])
                                event.currentTarget.value = ""
                              }}
                            />
                          </label>
                          {branding.logoDataUrl ? (
                            <button
                              type="button"
                              onClick={() => setBranding(current => ({ ...current, logoDataUrl: undefined }))}
                              disabled={generating || logoProcessing}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                              title="移除 Logo"
                              aria-label="移除 Logo"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                        <p className="mt-1.5 text-[10px] leading-4 text-slate-400">PNG/JPG，自动压缩至报告适用尺寸。</p>
                      </div>
                    </div>
                  )}

                  {branding.mode === "custom" && brandingAccess.canUseCustomBranding ? (
                    <label className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-slate-600">
                      <input
                        type="checkbox"
                        checked={rememberBranding}
                        onChange={event => setRememberBranding(event.target.checked)}
                        disabled={generating || brandingLoading}
                        className="mt-1 h-3.5 w-3.5 accent-[#1677FF]"
                      />
                      保存为我的默认白标出品方，下次和其他设备自动使用
                    </label>
                  ) : null}

                  {branding.mode === "custom" && brandingAccess.canUseCustomBranding ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        {brandingAccess.accessSource === "admin" ? "管理员已解锁" : "VIP1 已解锁"}
                      </span>
                      {brandingAccess.customReportCredits > 0 ? (
                        <CreditCostBadge featureKey="reportCustomBranding" label="本份消耗" />
                      ) : null}
                    </div>
                  ) : null}

                  {brandingNotice ? (
                    <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">{brandingNotice}</div>
                  ) : null}
                  {brandingError ? (
                    <div className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-700">{brandingError}</div>
                  ) : null}
                </section>

                <div className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-3 text-xs leading-5 text-emerald-900">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  报告将使用当前客户的检测与测评结果，不会混入其他客户资料。
                </div>

                {(job || generating) && (
                  <div className="mt-5 rounded-lg border border-sky-100 bg-sky-50/70 px-4 py-3">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex items-center gap-2 font-semibold text-[#003EB3]">
                        {job?.status === "succeeded" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : job?.status === "cancelled" || job?.status === "failed" ? <AlertCircle className="h-4 w-4 text-rose-500" /> : <Loader2 className="h-4 w-4 animate-spin" />}
                        {job?.stage || "正在生成专业报告"}
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
                className="h-10 rounded-lg border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                关闭
              </button>
              {generating && job && (job.status === "queued" || job.status === "running") ? (
                <button
                  type="button"
                  onClick={() => void stopReport()}
                  disabled={stopping}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-6 text-sm font-semibold text-rose-600 transition hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
                >
                  {stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />}
                  {stopping ? "正在停止" : "停止生成"}
                </button>
              ) : customBrandingLocked ? (
                <BillingLink onNavigate={onClose} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-amber-600 px-6 text-sm font-semibold text-white transition hover:bg-amber-700">
                  <LockKeyhole className="h-4 w-4" />
                  充值解锁 VIP1
                </BillingLink>
              ) : (
                <button
                  type="button"
                  onClick={generateReport}
                  disabled={!canGenerate || generating}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#1677FF] bg-[#1677FF] px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0958D9] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {brandingSaving
                    ? "正在保存出品方"
                    : generating
                      ? "正在生成"
                      : branding.mode === "custom" && brandingAccess.customReportCredits > 0
                        ? `消耗 ${brandingAccess.customReportCredits} 积分并生成 PDF`
                        : "生成并下载 PDF"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  if (typeof document === "undefined") return null
  return createPortal(dialog, document.body)
}
