"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock3,
  FileText,
  Gauge,
  Globe2,
  History,
  Loader2,
  Play,
  Square,
  Table2,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CreditCostBadge } from "@/components/credits/credit-cost-badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { createBackgroundRequestId, createIdempotentApiJob } from "@/lib/background-job-client"
import type {
  Client,
  DifficultyAssessmentEntry,
  DifficultyAssessmentMode,
  DifficultyAssessmentResult,
  DifficultyJobRecord,
  DifficultyLevel,
  DifficultyModelSelection,
  ModelKey,
  ReportExportPreset,
  DifficultyStageKey,
} from "@/types"
import { MODEL_LABELS } from "@/lib/model-labels"

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
  onExportReport?: (preset: ReportExportPreset) => void
}

const INDUSTRY_STAGES: Array<{ key: DifficultyStageKey; title: string; desc: string }> = [
  { key: "research", title: "调研取样", desc: "问题样本与信源分布" },
  { key: "comparison", title: "品牌/渠道对比", desc: "推荐池和渠道集中度" },
  { key: "scoring", title: "规则评分", desc: "六维标准折算" },
  { key: "review", title: "一致性复核", desc: "证据与分数校验" },
  { key: "report", title: "生成报告", desc: "结论和策略建议" },
]

const BRAND_STAGES: Array<{ key: DifficultyStageKey; title: string; desc: string }> = [
  { key: "research", title: "行业调研", desc: "行业问题与头部占位" },
  { key: "comparison", title: "品牌现状", desc: "可见度和信任资产" },
  { key: "scoring", title: "竞品评分", desc: "差距和进入门槛" },
  { key: "review", title: "复核", desc: "置信度和资料缺口" },
  { key: "report", title: "路径报告", desc: "突破入口和动作" },
]

const DIFFICULTY_MODELS: ModelKey[] = ["qwen", "deepseek", "doubao", "kimi", "ernie", "hunyuan"]

type DifficultyModelOption = {
  key: ModelKey
  label: string
  configured: boolean
}

const INDUSTRY_SCORE_STANDARDS = [
  {
    name: "头部品牌曝光集中度",
    max: 25,
    easy: "0-6 没有明显头部",
    medium: "7-12 有头部但仍有缝隙",
    hard: "13-19 头部占据主要曝光位",
    super: "20-25 头部霸屏",
  },
  {
    name: "推荐品牌多样性",
    max: 20,
    easy: "0-5 推荐池很宽",
    medium: "6-10 推荐池约20-30个",
    hard: "11-15 推荐池约10-15个",
    super: "16-20 推荐池不足10个",
  },
  {
    name: "本地化信息垄断程度",
    max: 20,
    easy: "0-5 本地商家容易出现",
    medium: "6-10 全国品牌和本地混合",
    hard: "11-15 全国品牌压过本地",
    super: "16-20 本地真实商家几乎不可见",
  },
  {
    name: "内容真实性与投毒程度",
    max: 15,
    easy: "0-4 真实信息较多",
    medium: "5-8 软文和真实内容混杂",
    hard: "9-12 批量内容影响判断",
    super: "13-15 虚假榜单主导",
  },
  {
    name: "GEO准入门槛与马太效应",
    max: 10,
    easy: "0-3 小品牌可快速进入",
    medium: "4-6 需要基础信任源",
    hard: "7-8 头部信任资产占优",
    super: "9-10 强马太效应",
  },
  {
    name: "信息来源单一性",
    max: 10,
    easy: "0-3 来源分散",
    medium: "4-6 部分渠道权重高",
    hard: "7-8 少数渠道控制主要答案",
    super: "9-10 高度依赖单一来源",
  },
]

const BRAND_SCORE_STANDARDS = [
  {
    name: "行业头部封锁强度",
    max: 20,
    easy: "0-5 头部未固定答案",
    medium: "6-10 有头部但长尾有机会",
    hard: "11-15 头部占主要推荐位",
    super: "16-20 头部长期霸屏",
  },
  {
    name: "品牌当前可见度差距",
    max: 20,
    easy: "0-5 品牌已有稳定公开提及",
    medium: "6-10 有基础信息但不稳定",
    hard: "11-15 AI 缺少可引用材料",
    super: "16-20 几乎没有公开信号",
  },
  {
    name: "信任资产差距",
    max: 15,
    easy: "0-4 资质案例背书完整",
    medium: "5-8 有基础但缺交叉验证",
    hard: "9-12 明显弱于头部竞品",
    super: "13-15 缺少可信凭证",
  },
  {
    name: "内容矩阵缺口",
    max: 15,
    easy: "0-4 内容结构完整",
    medium: "5-8 有内容但覆盖不系统",
    hard: "9-12 难支撑多类问题",
    super: "13-15 几乎无结构化内容",
  },
  {
    name: "本地/场景切入难度",
    max: 15,
    easy: "0-4 本地或场景有空位",
    medium: "5-8 部分场景可切入",
    hard: "9-12 长尾也被压制",
    super: "13-15 缺少突破口",
  },
  {
    name: "AI答案进入门槛",
    max: 15,
    easy: "0-4 少量证据即可进入",
    medium: "5-8 需要稳定内容和提及",
    hard: "9-12 需要多渠道长期建设",
    super: "13-15 需要系统性战役",
  },
]

const TOTAL_STANDARDS = [
  { range: "0-24", level: "容易", desc: "AI 推荐池开放，适合快速切入" },
  { range: "25-49", level: "中等", desc: "需要内容矩阵和基础信任源" },
  { range: "50-74", level: "困难", desc: "头部和渠道已有明显占位" },
  { range: "75-100", level: "超难", desc: "信息垄断强，需要系统性 GEO 战役" },
]

const BRAND_TOTAL_STANDARDS = [
  { range: "0-24", level: "容易", desc: "品牌已有进入 AI 推荐池的基础" },
  { range: "25-49", level: "中等", desc: "需要补强内容矩阵和信任源" },
  { range: "50-74", level: "困难", desc: "品牌与头部答案存在明显差距" },
  { range: "75-100", level: "超难", desc: "需要系统性 GEO 战役和持续信源建设" },
]

const SAMPLE_RESULT: DifficultyAssessmentResult = {
  mode: "industry",
  totalScore: 72,
  level: "困难",
  stableMentionPeriod: "约25-30天",
  summary:
    "除甲醛行业真实竞争分散，但 AI 搜索呈现层已经被少数连锁品牌、榜单软文和问答平台内容压缩。新品牌并非没有机会，但需要避开全国大词，优先用本地真实案例、检测流程和细分人群场景建立可引用信源。",
  dimensions: {
    dimension1: {
      name: "头部品牌曝光集中度",
      score: 20,
      max: 25,
      level: "超难",
      analysis: "AI 回答更容易复用已有榜单和连锁品牌，头部品牌重复率较高，新品牌直接抢占全国大词难度较大。",
    },
    dimension2: {
      name: "推荐品牌多样性",
      score: 14,
      max: 20,
      level: "困难",
      analysis: "推荐池约 12-15 个品牌，仍有进入空间，但需要持续积累第三方内容和口碑信号。",
    },
    dimension3: {
      name: "本地化信息垄断程度",
      score: 16,
      max: 20,
      level: "超难",
      analysis: "本地真实服务商容易被全国连锁和外地内容稀释，城市服务词需要补足地图、案例和本地媒体信源。",
    },
    dimension4: {
      name: "内容真实性与投毒程度",
      score: 12,
      max: 15,
      level: "超难",
      analysis: "软文榜单、AI 批量内容和低质量评测较多，用户真实经验和权威检测资料不足。",
    },
    dimension5: {
      name: "GEO准入门槛与马太效应",
      score: 6,
      max: 10,
      level: "困难",
      analysis: "准入门槛主要来自信任资产和第三方渠道，不是完全封闭，但需要持续运营。",
    },
    dimension6: {
      name: "信息来源单一性",
      score: 4,
      max: 10,
      level: "中等",
      analysis: "来源包括新闻、知乎、小红书、行业站和本地生活平台，仍有多渠道突围机会。",
    },
  },
  insights: [
    "行业真实供给分散，但 AI 推荐池呈现出头部感知垄断。",
    "本地词和细分场景比全国排名大词更适合切入。",
    "高质量案例、检测流程和第三方背书会直接影响被引用概率。",
  ],
  suggestions: [
    "先建设城市级服务页和真实案例库，覆盖新房、母婴、办公室等场景。",
    "用第三方评测、媒体稿和问答内容建立交叉验证，而不是只堆官网文章。",
    "每 2 周复测一次重点问题，跟踪 AI 回答中的品牌提及变化。",
  ],
  process: {
    research: {
      title: "调研取样",
      summary: "围绕全国除甲醛、城市除甲醛、新房入住、母婴安全、甲醛检测等场景生成问题样本。",
      evidence: ["样本覆盖全国大词、本地服务、细分人群和检测流程", "AI 回答常出现固定品牌和服务榜单", "本地真实商家信息弱于全国连锁内容"],
      tags: ["12个问题样本", "榜单内容", "本地服务"],
    },
    comparison: {
      title: "品牌/渠道对比",
      summary: "头部品牌在多类问题中重复出现，本地服务商被外地品牌和内容平台稀释。",
      evidence: ["TOP 品牌重复率高", "推荐池约 12-15 个品牌", "新闻、博客、问答平台贡献主要引用"],
      tags: ["TOP3集中", "推荐池偏窄", "渠道集中"],
    },
    scoring: {
      title: "规则评分",
      summary: "头部集中、本地垄断、内容投毒三个维度显著拉高总分，最终落在困难区间。",
      evidence: ["头部集中 20/25", "本地垄断 16/20", "内容投毒 12/15"],
      tags: ["72分", "困难", "六维加权"],
    },
    review: {
      title: "一致性复核",
      summary: "总分与证据匹配：行业竞争分散，但 AI 搜索呈现层已被少数品牌和渠道压缩。",
      evidence: ["总分与困难级区间一致", "维度高分均有对应证据", "来源单一性较低，保留突围空间"],
      tags: ["置信度中高", "证据匹配", "可突围"],
    },
    report: {
      title: "生成报告",
      summary: "报告建议避开全国排名大词，优先布局本地真实案例、细分场景内容和多渠道矩阵。",
      evidence: ["本地案例优先", "细分场景切入", "定期复测"],
      tags: ["策略生成", "历史可追溯", "可打印"],
    },
  },
  generatedAt: new Date().toISOString(),
  providerLabel: "示例",
}

const BRAND_SAMPLE_RESULT: DifficultyAssessmentResult = {
  mode: "brand",
  targetBrand: "净居家",
  website: "https://example.com",
  totalScore: 66,
  level: "困难",
  stableMentionPeriod: "约25-30天",
  summary:
    "净居家在除甲醛赛道具备本地服务切入机会，但公开信任资产、第三方提及和结构化案例不足。做 GEO 的核心难点不是行业完全封闭，而是要先让 AI 能验证品牌真实存在、服务可靠、案例可引用，再逐步进入城市词和母婴/新房等细分答案。",
  dimensions: {
    dimension1: {
      name: "行业头部封锁强度",
      score: 14,
      max: 20,
      level: "困难",
      analysis: "除甲醛大词已有连锁品牌、榜单和问答平台长期占位，目标品牌直接抢全国推荐位难度较高。",
    },
    dimension2: {
      name: "品牌当前可见度差距",
      score: 15,
      max: 20,
      level: "困难",
      analysis: "品牌公开提及和可搜索材料偏少，AI 缺少足够稳定的引用信号，容易被更高频出现的竞品覆盖。",
    },
    dimension3: {
      name: "信任资产差距",
      score: 10,
      max: 15,
      level: "困难",
      analysis: "需要补强检测资质、真实治理案例、客户评价和第三方渠道背书，否则很难进入可信推荐池。",
    },
    dimension4: {
      name: "内容矩阵缺口",
      score: 11,
      max: 15,
      level: "困难",
      analysis: "官网内容、问答内容、案例内容和竞品对比内容还不够系统，无法覆盖 AI 会复用的多类问题。",
    },
    dimension5: {
      name: "本地/场景切入难度",
      score: 7,
      max: 15,
      level: "中等",
      analysis: "城市词、新房入住、母婴房、办公室治理等场景仍有切入空间，是优先突破点。",
    },
    dimension6: {
      name: "AI答案进入门槛",
      score: 9,
      max: 15,
      level: "困难",
      analysis: "需要连续建设官网、案例、问答、第三方提及和本地生活信号，才能让 AI 有理由稳定引用。",
    },
  },
  insights: [
    "品牌 GEO 的首要任务是补足可验证信号，而不是直接争夺全国排名大词。",
    "本地词和细分场景能避开头部品牌的强占位，是更现实的第一阶段入口。",
    "AI 更容易引用结构化案例、资质说明和第三方背书，单纯官网介绍不够。",
  ],
  suggestions: [
    "先建设城市服务页、真实案例库、检测流程页和母婴/新房专题页。",
    "把资质、检测报告、客户评价和服务前后对比做成可被引用的结构化内容。",
    "每两周复测一次目标问题，记录品牌是否进入 AI 回答、位置和引用理由。",
  ],
  process: {
    research: {
      title: "行业调研",
      summary: "除甲醛行业大词已有固定答案和榜单渠道，本地与细分场景仍有可切入空间。",
      evidence: ["头部品牌在全国大词中更容易出现", "用户问题覆盖新房、母婴、检测、价格和口碑", "本地服务词存在真实需求"],
      tags: ["行业调研", "头部占位", "本地机会"],
    },
    comparison: {
      title: "品牌现状识别",
      summary: "目标品牌公开信号偏弱，需要补足官网、案例、资质、第三方提及和客户评价。",
      evidence: ["公开可见度不足", "信任资产需要交叉验证", "内容矩阵还不系统"],
      tags: ["品牌现状", "资料缺口", "可信信号"],
    },
    scoring: {
      title: "竞品信源对比与评分",
      summary: "头部封锁、品牌可见度差距和内容矩阵缺口拉高了品牌 GEO 难度。",
      evidence: ["行业头部封锁 14/20", "品牌可见度差距 15/20", "内容矩阵缺口 11/15"],
      tags: ["66分", "困难", "品牌评分"],
    },
    review: {
      title: "品牌难度复核",
      summary: "总分与证据匹配，但品牌资料不足会影响置信度，建议补充官网和案例后复测。",
      evidence: ["分数落在困难区间", "本地/场景维度仍有机会", "部分品牌信号需人工补充"],
      tags: ["置信度中", "需补资料", "可突围"],
    },
    report: {
      title: "突破路径报告",
      summary: "优先从城市服务词和细分场景词切入，以结构化案例和第三方背书建立 AI 可引用资产。",
      evidence: ["城市服务页优先", "案例和资质补强", "定期复测品牌提及"],
      tags: ["品牌路径", "GEO动作", "复测"],
    },
  },
  generatedAt: new Date().toISOString(),
  providerLabel: "示例",
}

function levelClasses(level: DifficultyLevel): string {
  if (level === "超难") return "border-red-200 bg-red-50 text-red-700"
  if (level === "困难") return "border-orange-200 bg-orange-50 text-orange-700"
  if (level === "中等") return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-emerald-200 bg-emerald-50 text-emerald-700"
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function stagesForMode(mode: DifficultyAssessmentMode) {
  return mode === "brand" ? BRAND_STAGES : INDUSTRY_STAGES
}

function scoreStandardsForMode(mode: DifficultyAssessmentMode) {
  return mode === "brand" ? BRAND_SCORE_STANDARDS : INDUSTRY_SCORE_STANDARDS
}

function totalStandardsForMode(mode: DifficultyAssessmentMode) {
  return mode === "brand" ? BRAND_TOTAL_STANDARDS : TOTAL_STANDARDS
}

function sampleForMode(mode: DifficultyAssessmentMode): DifficultyAssessmentResult {
  return mode === "brand" ? BRAND_SAMPLE_RESULT : SAMPLE_RESULT
}

function modeForEntry(entry: DifficultyAssessmentEntry | null | undefined): DifficultyAssessmentMode {
  return entry?.mode ?? entry?.result.mode ?? "industry"
}

function formatEntryTitle(entry: DifficultyAssessmentEntry): string {
  if (modeForEntry(entry) === "brand") {
    return `${entry.city} · ${entry.industry} · ${entry.targetBrand || entry.result.targetBrand || "未命名品牌"}`
  }
  return `${entry.city} · ${entry.industry}`
}

function createEntry(args: {
  mode: DifficultyAssessmentMode
  industry: string
  city: string
  targetBrand?: string
  website?: string
  source: string
  result: DifficultyAssessmentResult
}): DifficultyAssessmentEntry {
  const now = new Date().toISOString()
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `difficulty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    mode: args.mode,
    industry: args.industry,
    city: args.city,
    targetBrand: args.targetBrand,
    website: args.website,
    source: args.source,
    createdAt: now,
    result: {
      ...args.result,
      mode: args.result.mode ?? args.mode,
      targetBrand: args.result.targetBrand ?? args.targetBrand,
      website: args.result.website ?? args.website,
      generatedAt: args.result.generatedAt || now,
    },
  }
}

export default function DifficultyAssessmentModule({ client, onChangeClient, onExportReport }: Props) {
  const [mode, setMode] = useState<DifficultyAssessmentMode>("industry")
  const [industry, setIndustry] = useState(() => client.industry || "")
  const [city, setCity] = useState("全国")
  const [targetBrand, setTargetBrand] = useState(() => client.ourBrand || "")
  const [website, setWebsite] = useState(() => client.website || "")
  const [selectedModel, setSelectedModel] = useState<DifficultyModelSelection>("auto")
  const [modelOptions, setModelOptions] = useState<DifficultyModelOption[]>(
    () => DIFFICULTY_MODELS.map(key => ({ key, label: MODEL_LABELS[key], configured: true })),
  )
  const [loading, setLoading] = useState(Boolean(client.difficultyJobId))
  const [error, setError] = useState<string | null>(null)
  const [progressLabel, setProgressLabel] = useState("")
  const [progressPercent, setProgressPercent] = useState(0)
  const [activeEntry, setActiveEntry] = useState<DifficultyAssessmentEntry | null>(
    () => client.difficultyAssessments?.[0] ?? null
  )

  const history = useMemo(() => client.difficultyAssessments ?? [], [client.difficultyAssessments])
  const result = activeEntry?.result ?? sampleForMode(mode)
  const reportMode = activeEntry ? modeForEntry(activeEntry) : result.mode ?? mode
  const stages = stagesForMode(reportMode)
  const scoreStandards = scoreStandardsForMode(reportMode)
  const totalStandards = totalStandardsForMode(reportMode)
  const dimensions = useMemo(() => Object.values(result.dimensions), [result.dimensions])

  useEffect(() => {
    const controller = new AbortController()
    async function loadModels() {
      try {
        const response = await apiFetch("/api/difficulty-assessment/jobs", {
          cache: "no-store",
          signal: controller.signal,
        })
        const data = await readApiJson<{ models?: DifficultyModelOption[]; error?: string }>(
          response,
          "测评模型配置",
        )
        if (response.ok && data.models?.length) setModelOptions(data.models)
      } catch {
        // 创建任务时服务端还会再次校验，配置列表刷新失败不阻断页面。
      }
    }
    void loadModels()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const jobId = client.difficultyJobId
    if (!jobId) return

    const controller = new AbortController()
    let stopped = false
    let failedPolls = 0

    async function poll() {
      while (!stopped) {
        try {
          const response = await apiFetch(`/api/difficulty-assessment/jobs/${jobId}`, {
            cache: "no-store",
            signal: controller.signal,
          })
          const job = await readApiJson<DifficultyJobRecord & { error?: string }>(
            response,
            "难度测评任务查询",
          )
          if (!response.ok) throw new Error(job.error || `任务查询失败 (${response.status})`)
          if (stopped) return

          failedPolls = 0
          setLoading(job.status === "queued" || job.status === "running")
          setProgressPercent(job.progressPercent || 0)
          const stageTitle = job.currentStage
            ? stagesForMode(job.mode).find(stage => stage.key === job.currentStage)?.title
            : undefined
          const modelLabel = job.currentModel ? MODEL_LABELS[job.currentModel] : ""
          setProgressLabel(
            job.status === "queued"
              ? "后台任务排队中，切换客户或关闭页面都不会中断。"
              : `${stageTitle ? `正在${stageTitle}` : "后台测评中"} · ${job.completedStages}/${job.totalStages}${modelLabel ? ` · ${modelLabel}` : ""}`,
          )

          if (job.status === "succeeded" && job.result) {
            const entry: DifficultyAssessmentEntry = {
              ...createEntry({
                mode: job.mode,
                industry: job.industry,
                city: job.city,
                targetBrand: job.targetBrand,
                website: job.website,
                source: job.result.providerLabel || "服务端模型",
                result: job.result,
              }),
              id: `difficulty_${job.id}`,
              createdAt: job.result.generatedAt || job.finishedAt || new Date().toISOString(),
            }
            const next = [entry, ...history.filter(item => item.id !== entry.id)].slice(0, 30)
            onChangeClient({ difficultyAssessments: next, difficultyJobId: undefined })
            setActiveEntry(entry)
            setError(null)
            setLoading(false)
            setProgressLabel("")
            setProgressPercent(100)
            window.dispatchEvent(new Event("credits:refresh"))
            return
          }

          if (job.status === "failed") {
            if (!job.creditsRefunded) {
              setError(`${job.error || "难度测评后台任务失败"}，积分正在自动退回，请勿重新发起。`)
              setLoading(true)
              setProgressLabel("任务已结束，正在确认积分退款...")
              await new Promise(resolve => window.setTimeout(resolve, 3000))
              continue
            }
            onChangeClient({ difficultyJobId: undefined })
            setError(`${job.error || "难度测评后台任务失败"}，本次预扣积分已自动退回。`)
            setLoading(false)
            setProgressLabel("")
            window.dispatchEvent(new Event("credits:refresh"))
            return
          }

          if (job.status === "cancelled") {
            if (!job.creditsRefunded) {
              setError("测评已停止，积分正在自动退回，请稍候。")
              setLoading(true)
              setProgressLabel("正在确认积分退款...")
              await new Promise(resolve => window.setTimeout(resolve, 3000))
              continue
            }
            onChangeClient({ difficultyJobId: undefined })
            setError("测评已停止，本次预扣积分已自动退回。")
            setLoading(false)
            setProgressLabel("")
            window.dispatchEvent(new Event("credits:refresh"))
            return
          }
        } catch {
          if (stopped || controller.signal.aborted) return
          failedPolls += 1
          if (failedPolls >= 3) {
            setError("后台测评仍在继续，刚才进度刷新失败；系统会自动重试，不需要重新发起任务。")
          }
        }

        await new Promise(resolve => window.setTimeout(resolve, failedPolls >= 3 ? 6000 : 2000))
      }
    }

    void poll()
    return () => {
      stopped = true
      controller.abort()
    }
  }, [client.difficultyJobId, history, onChangeClient])

  function saveEntry(entry: DifficultyAssessmentEntry) {
    const next = [entry, ...history.filter(item => item.id !== entry.id)].slice(0, 30)
    onChangeClient({ difficultyAssessments: next })
    setActiveEntry(entry)
  }

  function loadSample() {
    const targetIndustry = industry.trim() || client.industry || "除甲醛"
    const sample = sampleForMode(mode)
    const brandName = targetBrand.trim() || client.ourBrand || sample.targetBrand || "净居家"
    const entry = createEntry({
      mode,
      industry: targetIndustry,
      city: city.trim() || "全国",
      targetBrand: mode === "brand" ? brandName : undefined,
      website: mode === "brand" ? website.trim() || sample.website : undefined,
      source: "示例",
      result: sample,
    })
    saveEntry(entry)
    setError(null)
  }

  async function runAssessment() {
    const targetIndustry = industry.trim() || client.industry.trim()
    const targetCity = city.trim() || "全国"
    const brandName = targetBrand.trim()
    const brandWebsite = website.trim()
    if (!targetIndustry) {
      setError("请先填写行业/赛道名称。")
      return
    }
    if (mode === "brand" && !brandName) {
      setError("请先填写要评估的品牌名称。")
      return
    }

    setLoading(true)
    setError(null)
    setProgressPercent(0)
    setProgressLabel("正在创建后台测评任务...")
    try {
      const job = await createIdempotentApiJob<DifficultyJobRecord & { error?: string }>({
        endpoint: "/api/difficulty-assessment/jobs",
        requestId: createBackgroundRequestId("difficulty"),
        label: "GEO 难度测评任务创建",
        payload: {
          clientId: client.id,
          mode,
          industry: targetIndustry,
          city: targetCity,
          targetBrand: mode === "brand" ? brandName : undefined,
          website: mode === "brand" ? brandWebsite : undefined,
          model: selectedModel,
        },
        onRetry: () => {
          setProgressLabel("网络暂时中断，正在确认测评任务是否已经创建...")
          setError("请勿重复点击，系统正在用同一请求编号自动确认任务。")
        },
      })
      if (!job.id) throw new Error("评估任务创建失败：未返回任务 ID")
      setError(null)
      onChangeClient({ difficultyJobId: job.id })
      setProgressLabel("后台任务已创建，正在排队...")
      window.dispatchEvent(new Event("credits:refresh"))
      if (!client.industry && targetIndustry) onChangeClient({ industry: targetIndustry })
      if (!client.ourBrand && mode === "brand" && brandName) onChangeClient({ ourBrand: brandName })
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误")
      setLoading(false)
      setProgressLabel("")
    }
  }

  async function stopAssessment() {
    const jobId = client.difficultyJobId
    if (!jobId) return
    setProgressLabel("正在停止后台测评...")
    try {
      const response = await apiFetch(`/api/difficulty-assessment/jobs/${jobId}`, {
        method: "PATCH",
        cache: "no-store",
      })
      const job = await readApiJson<DifficultyJobRecord & { error?: string }>(
        response,
        "停止难度测评",
      )
      if (!response.ok) throw new Error(job.error || "停止测评失败")
      if (job.status === "succeeded" && job.result) {
        setError(null)
        setProgressLabel("报告已生成，正在保存到当前客户...")
        return
      }
      if (!job.creditsRefunded) throw new Error("测评已停止，积分退款仍在确认中")
      onChangeClient({ difficultyJobId: undefined })
      setLoading(false)
      setProgressLabel("")
      setError("测评已停止，本次预扣积分已自动退回。")
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "停止测评失败"}；任务号已保留，系统会继续查询状态。`)
      setProgressLabel("后台任务状态仍在查询中...")
    } finally {
      window.dispatchEvent(new Event("credits:refresh"))
    }
  }

  function deleteEntry(id: string) {
    const next = history.filter(item => item.id !== id)
    onChangeClient({ difficultyAssessments: next })
    if (activeEntry?.id === id) setActiveEntry(next[0] ?? null)
  }

  function switchMode(nextMode: DifficultyAssessmentMode) {
    setMode(nextMode)
    setActiveEntry(null)
    setError(null)
  }

  return (
    <div className="min-w-0 space-y-5">
      <section className="geo-section-panel no-print p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 pb-3">
          <div className="flex items-center gap-3">
            <span className="geo-module-icon bg-gradient-to-br from-[#0958D9] to-[#003EB3]">
              <Gauge className="h-5 w-5 text-white" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">GEO 难度测评配置</div>
              <div className="mt-0.5 text-[11px] text-slate-500">调研、对比、评分、复核和报告将连续呈现在下方</div>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 sm:w-auto sm:min-w-[260px]">
              <button
                type="button"
                onClick={() => switchMode("industry")}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  mode === "industry"
                    ? "bg-white text-[#003EB3] shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <Globe2 className="h-4 w-4" />
                行业评估
              </button>
              <button
                type="button"
                onClick={() => switchMode("brand")}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  mode === "brand"
                    ? "bg-white text-[#003EB3] shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <Building2 className="h-4 w-4" />
                品牌评估
              </button>
          </div>
        </div>

        <div className={`grid gap-3 md:grid-cols-2 ${mode === "brand" ? "xl:grid-cols-5" : "xl:grid-cols-3"}`}>
            <div>
              <Label htmlFor="difficulty-industry">行业/赛道</Label>
              <Input
                id="difficulty-industry"
                value={industry}
                onChange={event => setIndustry(event.target.value)}
                placeholder="除甲醛、医美、律师服务"
              />
            </div>
            {mode === "brand" && (
              <>
                <div>
                  <Label htmlFor="difficulty-brand">查询品牌</Label>
                  <Input
                    id="difficulty-brand"
                    value={targetBrand}
                    onChange={event => setTargetBrand(event.target.value)}
                    placeholder="输入要评估的品牌名"
                  />
                </div>
                <div>
                  <Label htmlFor="difficulty-website">官网/资料</Label>
                  <Input
                    id="difficulty-website"
                    value={website}
                    onChange={event => setWebsite(event.target.value)}
                    placeholder="官网、案例页或资料链接，可选"
                  />
                </div>
              </>
            )}
            <div>
              <Label htmlFor="difficulty-city">城市/地区</Label>
              <Input
                id="difficulty-city"
                value={city}
                onChange={event => setCity(event.target.value)}
                placeholder="全国、上海、深圳"
              />
            </div>
            <div>
              <Label htmlFor="difficulty-model">首选模型</Label>
              <select
                id="difficulty-model"
                value={selectedModel}
                onChange={event => setSelectedModel(event.target.value as DifficultyModelSelection)}
                disabled={loading}
                className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="auto">自动推荐（失败自动切换）</option>
                {modelOptions.map(option => (
                  <option key={option.key} value={option.key} disabled={!option.configured}>
                    {option.label}{option.configured ? "" : "（未配置）"}
                  </option>
                ))}
              </select>
            </div>
        </div>

        {error && (
          <div className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3 border-t border-slate-200/70 pt-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CreditCostBadge featureKey="difficultyAssessment" className="w-fit" />
            <p className="mt-1 text-[11px] text-slate-500">任务在后台逐步保存，首选模型失败时会自动重试并切换可用模型。</p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 lg:w-auto lg:min-w-[300px]">
            <Button type="button" variant="outline" onClick={loadSample} disabled={loading}>
              示例
            </Button>
            {loading && client.difficultyJobId ? (
              <Button type="button" variant="outline" onClick={stopAssessment} className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700">
                <Square className="h-4 w-4 fill-current" />
                停止评估
              </Button>
            ) : (
              <Button type="button" onClick={runAssessment} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {loading ? "创建中" : "开始评估"}
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="no-print rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <History className="h-4 w-4 text-[#1677FF]" />
            历史测评
          </div>
          <div className="text-[11px] text-slate-400">{history.length} 份报告</div>
        </div>
        {history.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
            暂无历史报告，先运行一次测评。
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {history.map(entry => (
              <div
                key={entry.id}
                className={`flex min-w-[240px] items-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${
                  activeEntry?.id === entry.id ? "border-[#1677FF] bg-blue-50/70" : "border-slate-200 bg-white"
                }`}
              >
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setActiveEntry(entry)}>
                  <span className="block truncate font-semibold text-slate-800">{formatEntryTitle(entry)}</span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-slate-500">
                    <span>{entry.result.totalScore}分 · {entry.result.level}</span>
                    <span>{formatDate(entry.createdAt)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteEntry(entry.id)}
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                  aria-label={`删除 ${formatEntryTitle(entry)}`}
                  title="删除报告"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="min-w-0 space-y-5">
        {loading && (
          <Card className="no-print border-blue-200 bg-blue-50/80">
            <CardContent className="space-y-3 py-4 text-sm text-[#003EB3]">
              <div className="flex items-center gap-3">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                <span>{progressLabel || "后台测评正在启动..."}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-blue-100" aria-label={`测评进度 ${progressPercent}%`}>
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#1677FF] to-[#00C8FF] transition-[width] duration-500"
                  style={{ width: `${Math.max(2, Math.min(100, progressPercent))}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500">可以切换到其他客户继续工作，当前客户的任务不会被覆盖或中断。</p>
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-100 pb-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-[#1677FF]">
                    {activeEntry?.source ?? "示例"} · {reportMode === "brand" ? "Brand GEO difficulty" : "GEO/AEO monopoly score"}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                    {reportMode === "brand" ? "品牌报告" : "行业报告"}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${levelClasses(result.level)}`}>
                    {result.level}
                  </span>
                </div>
                <CardTitle className="geo-display-title text-2xl leading-tight text-slate-900 md:text-3xl">
                  {activeEntry
                    ? formatEntryTitle(activeEntry)
                    : reportMode === "brand" ? "品牌 GEO 难度测评示例" : "GEO 难度测评示例"}
                </CardTitle>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  {result.summary}
                </p>
              </div>
              <div className="flex shrink-0 items-end gap-4">
                <div className="text-right">
                  <div className="text-[11px] text-slate-400">
                    {reportMode === "brand" ? "品牌难度分" : "垄断总分"}
                  </div>
                  <div className="geo-data-number text-5xl font-bold text-[#1677FF]">
                    {result.totalScore}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="no-print"
                  onClick={() => onExportReport?.({ kind: "difficulty", difficultyEntryId: activeEntry?.id })}
                  disabled={!activeEntry || !onExportReport}
                >
                  <FileText className="h-4 w-4" />
                  导出该报告
                </Button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label={reportMode === "brand" ? "品牌稳定提及周期" : "被 AI 稳定提及周期"} value={result.stableMentionPeriod} />
              <Metric label="六维合计" value={`${dimensions.reduce((sum, item) => sum + item.score, 0)}/100`} />
              <Metric label="报告时间" value={formatDate(result.generatedAt)} />
            </div>
          </CardHeader>
          <CardContent className="space-y-6 pt-5">
            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <BarChart3 className="h-4 w-4 text-[#1677FF]" />
                六维评分
              </div>
              <div className="space-y-3">
                {dimensions.map(item => {
                  const percent = Math.round((item.score / item.max) * 100)
                  return (
                    <div key={item.name} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 font-medium text-slate-800">{item.name}</div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${levelClasses(item.level)}`}>
                            {item.level}
                          </span>
                          <span className="font-mono text-sm font-bold text-slate-900">
                            {item.score}/{item.max}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-[#1677FF]"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">{item.analysis}</p>
                    </div>
                  )
                })}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <CheckCircle2 className="h-4 w-4 text-[#1677FF]" />
                评估过程证据
              </div>
              <div className="grid gap-3 lg:grid-cols-5">
                {stages.map((stage, index) => {
                  const item = result.process[stage.key]
                  return (
                    <div key={stage.key} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#003EB3] text-[11px] font-bold text-white">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-slate-800">{item.title}</div>
                          <div className="truncate text-[10px] text-slate-400">{stage.desc}</div>
                        </div>
                      </div>
                      <p className="text-xs leading-5 text-slate-600">{item.summary}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.tags.map((tag, tagIndex) => (
                          <span key={`${stage.key}-${tag}-${tagIndex}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <InsightList title="关键洞察" items={result.insights} />
              <InsightList title="GEO 策略建议" items={result.suggestions} />
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-slate-700">
              <Table2 className="h-4 w-4 text-[#1677FF]" />
              分数标准说明
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-[640px] w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">总分</th>
                    <th className="px-3 py-2 font-medium">等级</th>
                    <th className="px-3 py-2 font-medium">含义</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {totalStandards.map(item => (
                    <tr key={item.range}>
                      <td className="px-3 py-2 font-mono text-slate-700">{item.range}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${levelClasses(item.level as DifficultyLevel)}`}>
                          {item.level}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{item.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-[960px] w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">维度</th>
                    <th className="px-3 py-2 font-medium">满分</th>
                    <th className="px-3 py-2 font-medium">容易</th>
                    <th className="px-3 py-2 font-medium">中等</th>
                    <th className="px-3 py-2 font-medium">困难</th>
                    <th className="px-3 py-2 font-medium">超难</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {scoreStandards.map(item => (
                    <tr key={item.name}>
                      <td className="px-3 py-2 font-medium text-slate-700">{item.name}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">{item.max}</td>
                      <td className="px-3 py-2 text-slate-500">{item.easy}</td>
                      <td className="px-3 py-2 text-slate-500">{item.medium}</td>
                      <td className="px-3 py-2 text-slate-500">{item.hard}</td>
                      <td className="px-3 py-2 text-slate-500">{item.super}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <Clock3 className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-800">{value}</div>
    </div>
  )
}

function InsightList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-slate-800">{title}</div>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={`${title}-${index}-${item}`} className="flex gap-2 text-xs leading-5 text-slate-600">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1677FF]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
