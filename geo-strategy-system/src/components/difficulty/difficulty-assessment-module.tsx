"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import {
  AlertTriangle,
  Building2,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileText,
  Gauge,
  Globe2,
  History,
  Loader2,
  Play,
  ShieldCheck,
  Square,
  Table2,
  TrendingUp,
  Trash2,
  UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CreditCostBadge } from "@/components/credits/credit-cost-badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { createBackgroundRequestId, createIdempotentApiJob } from "@/lib/background-job-client"
import { toUserFacingError } from "@/lib/user-facing-errors"
import {
  estimateGeoContentCost,
  isContentVolumeCostEstimate,
  isContentVolumeV3CostEstimate,
} from "@/lib/difficulty/content-cost-estimate"
import type {
  Client,
  DifficultyAssessmentEntry,
  DifficultyAssessmentDraft,
  DifficultyAssessmentMode,
  DifficultyAssessmentResult,
  DifficultyContentCostEstimate,
  DifficultyGeographicScope,
  DifficultyIndustryRiskLevel,
  DifficultyJobRecord,
  DifficultyLegacyCostEstimate,
  DifficultyLevel,
  DifficultyModelSelection,
  ModelKey,
  ReportExportPreset,
  DifficultyStageKey,
} from "@/types"
import { MODEL_LABELS } from "@/lib/model-labels"
import { getClientSubjectType } from "@/lib/analysis-subject"

const DifficultyDimensionsRadial = dynamic(
  () => import("@/components/difficulty/difficulty-dimensions-radial"),
  {
    ssr: false,
    loading: () => <div className="h-[350px] animate-pulse rounded-lg bg-slate-100" />,
  },
)

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
  onExportReport?: (preset: ReportExportPreset) => void
}

const INDUSTRY_STAGES: Array<{ key: DifficultyStageKey; title: string; desc: string }> = [
  { key: "research", title: "信息采集", desc: "问题与来源分布" },
  { key: "comparison", title: "品牌与渠道对比", desc: "推荐品牌和渠道集中度" },
  { key: "scoring", title: "结果整理", desc: "品牌合并与指标计算" },
  { key: "review", title: "结果复核", desc: "证据与分数检查" },
  { key: "report", title: "生成报告", desc: "结论和策略建议" },
]

const BRAND_STAGES: Array<{ key: DifficultyStageKey; title: string; desc: string }> = [
  { key: "research", title: "行业调研", desc: "行业问题与头部品牌表现" },
  { key: "comparison", title: "品牌现状", desc: "可见度和可信资料" },
  { key: "scoring", title: "竞品对比", desc: "差距和商业因素" },
  { key: "review", title: "结果复核", desc: "可信程度和资料缺口" },
  { key: "report", title: "路径报告", desc: "突破入口和动作" },
]

const PERSON_STAGES: Array<{ key: DifficultyStageKey; title: string; desc: string }> = [
  { key: "research", title: "行业与同行调研", desc: "问题与同行人物表现" },
  { key: "comparison", title: "个人 IP 现状", desc: "可见度和专业可信资料" },
  { key: "scoring", title: "同行对比", desc: "人物、机构和差距分析" },
  { key: "review", title: "结果复核", desc: "同名情况和资料缺口" },
  { key: "report", title: "突破路径报告", desc: "个人 IP 内容和信源动作" },
]

const DIFFICULTY_MODELS: ModelKey[] = ["qwen", "deepseek", "doubao", "kimi", "ernie", "hunyuan"]

type DifficultyModelOption = {
  key: ModelKey
  label: string
  configured: boolean
}

const INDUSTRY_SCORE_STANDARDS = [
  {
    name: "头部品牌锁定强度",
    max: 15,
    easy: "0-3 无固定头部答案",
    medium: "4-7 头部仍可替换",
    hard: "8-11 主要答案被占据",
    super: "12-15 大厂长期锁定",
  },
  {
    name: "有效竞品密度",
    max: 15,
    easy: "0-3 不超过3个有效竞品",
    medium: "4-6 约4-7个有效竞品",
    hard: "7-10 约8-15个有效竞品",
    super: "11-15 16个以上有效竞品",
  },
  {
    name: "地域覆盖复杂度",
    max: 15,
    easy: "2-5 单城市/区县",
    medium: "6-9 单省",
    hard: "10-12 跨省区域",
    super: "13-15 全国",
  },
  {
    name: "商业价值与预算竞争",
    max: 20,
    easy: "0-5 低客单低毛利",
    medium: "6-10 商业竞争正常",
    hard: "11-15 高价值或强投放",
    super: "16-20 高价值且大厂密集",
  },
  {
    name: "内容供给饱和度",
    max: 15,
    easy: "0-3 选题空间大",
    medium: "4-7 内容供给正常",
    hard: "8-11 重复竞争明显",
    super: "12-15 内容高度饱和",
  },
  {
    name: "权威信任门槛",
    max: 10,
    easy: "0-2 基础案例即可",
    medium: "3-5 需要资质验证",
    hard: "6-7 依赖强背书",
    super: "8-10 专业资质是硬门槛",
  },
  {
    name: "信源与 AI 入口壁垒",
    max: 10,
    easy: "0-2 入口开放",
    medium: "3-5 部分渠道权重高",
    hard: "6-7 少数信源控制答案",
    super: "8-10 信源与答案固化",
  },
]

const BRAND_SCORE_STANDARDS = [
  {
    name: "行业竞争与头部封锁",
    max: 15,
    easy: "0-3 头部未固定答案",
    medium: "4-7 长尾仍有机会",
    hard: "8-11 头部占主要推荐位",
    super: "12-15 大厂长期锁定",
  },
  {
    name: "目标品牌可见度差距",
    max: 15,
    easy: "0-3 已有稳定公开提及",
    medium: "4-7 有信息但不稳定",
    hard: "8-11 缺少可引用材料",
    super: "12-15 几乎无公开信号",
  },
  {
    name: "可信资料差距",
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
    name: "地域覆盖与本地资源差距",
    max: 15,
    easy: "0-4 小范围且本地资源完整",
    medium: "5-8 需补区域案例",
    hard: "9-12 跨区域资源差距明显",
    super: "13-15 全国覆盖资源不足",
  },
  {
    name: "商业预算竞争压力",
    max: 15,
    easy: "0-4 预算竞争较弱",
    medium: "5-8 需要稳定预算",
    hard: "9-12 高价值赛道竞争明显",
    super: "13-15 大厂预算密集",
  },
  {
    name: "AI 答案进入门槛",
    max: 10,
    easy: "0-2 少量证据即可进入",
    medium: "3-5 需要稳定内容和提及",
    hard: "6-7 需要多渠道建设",
    super: "8-10 需要系统性战役",
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

const SAMPLE_COST_ESTIMATE = estimateGeoContentCost({
  totalScore: 72,
  confidence: "中",
  scopeLabel: "全国",
  region: "全国",
  industry: "除甲醛",
})
const SAMPLE_STABLE_MILESTONE = SAMPLE_COST_ESTIMATE.milestones.find(item => item.key === "stableMention")!
const BRAND_SAMPLE_COST_ESTIMATE = estimateGeoContentCost({
  totalScore: 66,
  confidence: "中",
  scopeLabel: "全国",
  region: "全国",
  industry: "除甲醛",
})
const BRAND_SAMPLE_STABLE_MILESTONE = BRAND_SAMPLE_COST_ESTIMATE.milestones.find(item => item.key === "stableMention")!

const SAMPLE_RESULT: DifficultyAssessmentResult = {
  scoreVersion: "v2",
  mode: "industry",
  scope: "national",
  region: "全国",
  totalScore: 72,
  level: "困难",
  stableMentionPeriod: `约${SAMPLE_STABLE_MILESTONE.days.min}-${SAMPLE_STABLE_MILESTONE.days.max}天`,
  summary:
    "除甲醛行业真实竞争分散，但 AI 搜索呈现层已经被少数连锁品牌、榜单软文和问答平台内容压缩。新品牌并非没有机会，但需要避开全国大词，优先用本地真实案例、检测流程和细分人群场景建立可引用信源。",
  dimensions: {
    dimension1: {
      name: "头部品牌锁定强度",
      score: 12,
      max: 15,
      level: "超难",
      analysis: "AI 回答更容易复用已有榜单和连锁品牌，头部品牌重复率较高，新品牌直接抢占全国大词难度较大。",
    },
    dimension2: {
      name: "有效竞品密度",
      score: 9,
      max: 15,
      level: "困难",
      analysis: "合并同一品牌的中英文名和简称后，仍存在约 12-15 个有效竞争主体，竞争主体越多，进入难度越高。",
    },
    dimension3: {
      name: "地域覆盖复杂度",
      score: 14,
      max: 15,
      level: "超难",
      analysis: "全国覆盖需要同时建设城市页面、区域案例和本地信源，固定地域区间高于单省和单城市。",
    },
    dimension4: {
      name: "商业价值与预算竞争",
      score: 13,
      max: 20,
      level: "困难",
      analysis: "客单价、毛利、市场规模与竞品投放预算共同抬高竞争成本，不能只按内容数量判断难度。",
    },
    dimension5: {
      name: "内容供给饱和度",
      score: 10,
      max: 15,
      level: "困难",
      analysis: "软文榜单、AI 批量内容和低质量评测较多，新增内容需要真实案例和差异化证据。",
    },
    dimension6: {
      name: "权威信任门槛",
      score: 7,
      max: 10,
      level: "困难",
      analysis: "检测资质、真实案例和第三方验证直接影响 AI 是否采用相关内容。",
    },
    dimension7: {
      name: "信源与 AI 入口壁垒",
      score: 7,
      max: 10,
      level: "困难",
      analysis: "主要答案依赖新闻、问答、行业站和本地平台，需要多渠道建立可交叉验证的信源。",
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
      title: "信息采集",
      summary: "围绕全国除甲醛、城市除甲醛、新房入住、母婴安全、甲醛检测等场景生成问题样本。",
      evidence: ["样本覆盖全国大词、本地服务、细分人群和检测流程", "AI 回答常出现固定品牌和服务榜单", "本地真实商家信息弱于全国连锁内容"],
      tags: ["12个问题样本", "榜单内容", "本地服务"],
    },
    comparison: {
      title: "品牌与渠道对比",
      summary: "头部品牌在多类问题中重复出现，本地服务商被外地品牌和内容平台稀释。",
      evidence: ["TOP 品牌重复率高", "推荐池约 12-15 个品牌", "新闻、博客、问答平台贡献主要引用"],
      tags: ["TOP3集中", "有效竞品", "渠道集中"],
    },
    scoring: {
      title: "结果整理",
      summary: "合并同一品牌的不同名称，并结合地域范围和行业价值计算总分。",
      evidence: ["别名合并后统计竞品", "全国采用固定高分区间", "商业压力进入总分"],
      tags: ["72分", "困难", "七维评分"],
    },
    review: {
      title: "结果复核",
      summary: "总分与证据匹配：行业竞争分散，但 AI 搜索呈现层已被少数品牌和渠道压缩。",
      evidence: ["总分与困难级区间一致", "维度高分均有对应证据", "来源单一性较低，保留突围空间"],
      tags: ["参考可靠度较高", "证据匹配", "可突围"],
    },
    report: {
      title: "生成报告",
      summary: "报告建议避开全国排名大词，优先布局本地真实案例、细分场景内容和多渠道矩阵。",
      evidence: ["本地案例优先", "细分场景切入", "定期复测"],
      tags: ["策略生成", "历史可追溯", "可打印"],
    },
  },
  costEstimate: SAMPLE_COST_ESTIMATE,
  generatedAt: new Date().toISOString(),
  providerLabel: "示例",
}

const BRAND_SAMPLE_RESULT: DifficultyAssessmentResult = {
  scoreVersion: "v2",
  mode: "brand",
  scope: "national",
  region: "全国",
  targetBrand: "净居家",
  website: "https://example.com",
  totalScore: 66,
  level: "困难",
  stableMentionPeriod: `约${BRAND_SAMPLE_STABLE_MILESTONE.days.min}-${BRAND_SAMPLE_STABLE_MILESTONE.days.max}天`,
  summary:
    "净居家在除甲醛赛道具备本地服务切入机会，但公开可信资料、第三方提及和结构化案例不足。做 GEO 的核心难点不是行业完全封闭，而是要先让 AI 能验证品牌真实存在、服务可靠、案例可引用，再逐步进入城市词和母婴/新房等细分答案。",
  dimensions: {
    dimension1: {
      name: "行业竞争与头部封锁",
      score: 11,
      max: 15,
      level: "困难",
      analysis: "除甲醛大词已有连锁品牌、榜单和问答平台长期占位，目标品牌直接抢全国推荐位难度较高。",
    },
    dimension2: {
      name: "目标品牌可见度差距",
      score: 11,
      max: 15,
      level: "困难",
      analysis: "品牌公开提及和可搜索材料偏少，AI 缺少足够稳定的引用信号，容易被更高频出现的竞品覆盖。",
    },
    dimension3: {
      name: "可信资料差距",
      score: 10,
      max: 15,
      level: "困难",
      analysis: "需要补强检测资质、真实治理案例、客户评价和第三方渠道背书，否则很难进入可信推荐池。",
    },
    dimension4: {
      name: "内容矩阵缺口",
      score: 10,
      max: 15,
      level: "困难",
      analysis: "官网内容、问答内容、案例内容和竞品对比内容还不够系统，无法覆盖 AI 会复用的多类问题。",
    },
    dimension5: {
      name: "地域覆盖与本地资源差距",
      score: 8,
      max: 15,
      level: "中等",
      analysis: "全国覆盖需要补齐城市服务页、本地案例、地图和区域媒体信号，地域范围越大建设成本越高。",
    },
    dimension6: {
      name: "商业预算竞争压力",
      score: 9,
      max: 15,
      level: "困难",
      analysis: "行业商业价值和竞品投放预算要求目标品牌保持持续内容与信源投入。",
    },
    dimension7: {
      name: "AI 答案进入门槛",
      score: 7,
      max: 10,
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
      tags: ["行业调研", "头部品牌表现", "本地机会"],
    },
    comparison: {
      title: "品牌现状识别",
      summary: "目标品牌公开信号偏弱，需要补足官网、案例、资质、第三方提及和客户评价。",
      evidence: ["公开可见度不足", "可信资料需要多方验证", "内容矩阵还不系统"],
      tags: ["品牌现状", "资料缺口", "可信信号"],
    },
    scoring: {
      title: "竞品结果整理",
      summary: "头部封锁、品牌可见度差距和内容矩阵缺口拉高了品牌 GEO 难度。",
      evidence: ["行业头部封锁 11/15", "品牌可见度差距 11/15", "内容矩阵缺口 10/15"],
      tags: ["66分", "困难", "品牌评分"],
    },
    review: {
      title: "品牌难度复核",
      summary: "总分与证据匹配，但品牌资料较少会影响参考可靠度，建议补充官网和案例后复测。",
      evidence: ["分数落在困难区间", "本地/场景维度仍有机会", "部分品牌信号需人工补充"],
      tags: ["参考可靠度中等", "需补资料", "可突围"],
    },
    report: {
      title: "突破路径报告",
      summary: "优先从城市服务词和细分场景词切入，以结构化案例和第三方背书建立 AI 可引用内容。",
      evidence: ["城市服务页优先", "案例和资质补强", "定期复测品牌提及"],
      tags: ["品牌路径", "GEO动作", "复测"],
    },
  },
  costEstimate: BRAND_SAMPLE_COST_ESTIMATE,
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

const SCOPE_OPTIONS: Array<{ value: DifficultyGeographicScope; label: string }> = [
  { value: "city", label: "单城市/区县" },
  { value: "province", label: "单省" },
  { value: "region", label: "跨省区域" },
  { value: "national", label: "全国" },
]

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function formatMoney(value: number): string {
  if (value >= 10_000) {
    const amount = value / 10_000
    return `${Number.isInteger(amount) ? amount : amount.toFixed(1)}万`
  }
  return new Intl.NumberFormat("zh-CN").format(value)
}

function formatMoneyRange(range: { min: number; max: number }): string {
  if (range.max >= 10_000) {
    const inWan = (value: number) => {
      const amount = value / 10_000
      return `${Number.isInteger(amount) ? amount : amount.toFixed(1)}万`
    }
    return `\u00a5${inWan(range.min)}-${inWan(range.max)}`
  }
  return `\u00a5${formatMoney(range.min)}-${formatMoney(range.max)}`
}

function stagesForMode(
  mode: DifficultyAssessmentMode,
  subjectType: Client["subjectType"] = "brand",
) {
  if (mode === "brand" && subjectType === "person") return PERSON_STAGES
  return mode === "brand" ? BRAND_STAGES : INDUSTRY_STAGES
}

function scoreStandardsForMode(
  mode: DifficultyAssessmentMode,
  subjectType: Client["subjectType"] = "brand",
) {
  if (mode !== "brand") return INDUSTRY_SCORE_STANDARDS
  if (subjectType !== "person") return BRAND_SCORE_STANDARDS
  return BRAND_SCORE_STANDARDS.map(item => ({
    ...item,
    name: item.name
      .replace("目标品牌", "目标人物")
      .replace("品牌", "个人 IP"),
    easy: item.easy.replace("竞品", "同行人物"),
    medium: item.medium.replace("竞品", "同行人物"),
    hard: item.hard.replace("竞品", "同行人物"),
    super: item.super.replace("竞品", "同行人物"),
  }))
}

function totalStandardsForMode(
  mode: DifficultyAssessmentMode,
  subjectType: Client["subjectType"] = "brand",
) {
  if (mode !== "brand") return TOTAL_STANDARDS
  if (subjectType !== "person") return BRAND_TOTAL_STANDARDS
  return BRAND_TOTAL_STANDARDS.map(item => ({
    ...item,
    desc: item.desc
      .replaceAll("品牌", "个人 IP")
      .replaceAll("头部答案", "头部同行答案"),
  }))
}

function sampleForMode(mode: DifficultyAssessmentMode): DifficultyAssessmentResult {
  return mode === "brand" ? BRAND_SAMPLE_RESULT : SAMPLE_RESULT
}

function modeForEntry(entry: DifficultyAssessmentEntry | null | undefined): DifficultyAssessmentMode {
  return entry?.mode ?? entry?.result.mode ?? "industry"
}

function formatEntryTitle(entry: DifficultyAssessmentEntry): string {
  if (modeForEntry(entry) === "brand") {
    const fallback = entry.subjectType === "person" || entry.result.subjectType === "person"
      ? "未命名人物"
      : "未命名品牌"
    return `${entry.city} · ${entry.industry} · ${entry.targetBrand || entry.result.targetBrand || fallback}`
  }
  return `${entry.city} · ${entry.industry}`
}

function createEntry(args: {
  mode: DifficultyAssessmentMode
  subjectType?: Client["subjectType"]
  personProfile?: Client["personProfile"]
  industry: string
  city: string
  scope?: DifficultyGeographicScope
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
    subjectType: args.subjectType,
    personProfile: args.personProfile,
    industry: args.industry,
    city: args.city,
    scope: args.scope ?? args.result.scope,
    targetBrand: args.targetBrand,
    website: args.website,
    source: args.source,
    createdAt: now,
    result: {
      ...args.result,
      mode: args.result.mode ?? args.mode,
      subjectType: args.result.subjectType ?? args.subjectType,
      personProfile: args.result.personProfile ?? args.personProfile,
      scope: args.result.scope ?? args.scope,
      region: args.result.region ?? args.city,
      targetBrand: args.result.targetBrand ?? args.targetBrand,
      website: args.result.website ?? args.website,
      generatedAt: args.result.generatedAt || now,
    },
  }
}

export default function DifficultyAssessmentModule({ client, onChangeClient, onExportReport }: Props) {
  const subjectType = getClientSubjectType(client)
  const isPerson = subjectType === "person"
  const initialDraft: DifficultyAssessmentDraft = client.difficultyDraft || {
    mode: isPerson ? "brand" : "industry",
    industry: client.industry || "",
    scope: "national",
    city: "全国",
    averageOrderValue: "",
    grossMarginRate: "",
    annualRepeatPurchases: "",
    industryRiskLevel: "auto",
    targetBrand: client.ourBrand || "",
    website: client.website || "",
    selectedModel: "auto",
  }
  const draftRef = useRef(initialDraft)
  const [mode, setMode] = useState<DifficultyAssessmentMode>(() => initialDraft.mode)
  const [industry, setIndustry] = useState(() => initialDraft.industry)
  const [scope, setScope] = useState<DifficultyGeographicScope>(() => initialDraft.scope)
  const [city, setCity] = useState(() => initialDraft.city)
  const [averageOrderValue, setAverageOrderValue] = useState(() => initialDraft.averageOrderValue)
  const [grossMarginRate, setGrossMarginRate] = useState(() => initialDraft.grossMarginRate)
  const [annualRepeatPurchases, setAnnualRepeatPurchases] = useState(() => initialDraft.annualRepeatPurchases)
  const [industryRiskLevel, setIndustryRiskLevel] = useState<DifficultyIndustryRiskLevel>(() => initialDraft.industryRiskLevel)
  const [targetBrand, setTargetBrand] = useState(() => initialDraft.targetBrand)
  const [website, setWebsite] = useState(() => initialDraft.website)
  const [selectedModel, setSelectedModel] = useState<DifficultyModelSelection>(() => initialDraft.selectedModel)
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
  const [showSample, setShowSample] = useState(false)

  const history = useMemo(() => client.difficultyAssessments ?? [], [client.difficultyAssessments])
  const hasReportToShow = Boolean(activeEntry) || showSample
  const result = activeEntry?.result ?? sampleForMode(mode)
  const reportMode = activeEntry ? modeForEntry(activeEntry) : result.mode ?? mode
  const reportSubjectType = activeEntry?.subjectType ?? result.subjectType ?? subjectType
  const reportIsPerson = reportMode === "brand" && reportSubjectType === "person"
  const stages = stagesForMode(reportMode, reportSubjectType)
  const scoreStandards = scoreStandardsForMode(reportMode, reportSubjectType)
  const totalStandards = totalStandardsForMode(reportMode, reportSubjectType)
  const dimensions = useMemo(() => Object.values(result.dimensions), [result.dimensions])
  const costEstimate = result.costEstimate

  function persistDifficultyDraft(patch: Partial<DifficultyAssessmentDraft>) {
    const next = { ...draftRef.current, ...patch }
    draftRef.current = next
    onChangeClient({ difficultyDraft: next })
  }

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
            ? stagesForMode(job.mode, job.subjectType).find(stage => stage.key === job.currentStage)?.title
            : undefined
          const modelLabel = job.currentModel ? MODEL_LABELS[job.currentModel] : ""
          setProgressLabel(
            job.status === "queued"
              ? "正在等待开始，切换客户或关闭页面都不会中断。"
              : `${stageTitle ? `正在${stageTitle}` : "正在测评"} · ${job.completedStages}/${job.totalStages}${modelLabel ? ` · ${modelLabel}` : ""}`,
          )

          if (job.status === "succeeded" && job.result) {
            const entry: DifficultyAssessmentEntry = {
              ...createEntry({
                mode: job.mode,
                subjectType: job.subjectType,
                personProfile: job.personProfile,
                industry: job.industry,
                city: job.city,
                scope: job.scope ?? job.result.scope,
                targetBrand: job.targetBrand,
                website: job.website,
                source: job.result.providerLabel || "在线智能测评",
                result: job.result,
              }),
              id: `difficulty_${job.id}`,
              createdAt: job.result.generatedAt || job.finishedAt || new Date().toISOString(),
            }
            const next = [entry, ...history.filter(item => item.id !== entry.id)].slice(0, 30)
            onChangeClient({ difficultyAssessments: next, difficultyJobId: undefined })
            setActiveEntry(entry)
            setShowSample(false)
            setError(null)
            setLoading(false)
            setProgressLabel("")
            setProgressPercent(100)
            window.dispatchEvent(new Event("credits:refresh"))
            return
          }

          if (job.status === "failed") {
            if (!job.creditsRefunded) {
              setError(`${toUserFacingError(job.error, { fallback: "难度测评未完成，请稍后重试。", subject: "难度测评" })} 积分正在自动退回，请勿重新发起。`)
              setLoading(true)
              setProgressLabel("测评未完成，正在退回积分...")
              await new Promise(resolve => window.setTimeout(resolve, 3000))
              continue
            }
            onChangeClient({ difficultyJobId: undefined })
            setError(`${toUserFacingError(job.error, { fallback: "难度测评未完成，请稍后重试。", subject: "难度测评" })} 本次预扣积分已自动退回。`)
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
            setError("测评仍在继续，刚才没有取到最新进度；系统会自动重试，不需要重新发起。")
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

  function loadSample() {
    setActiveEntry(null)
    setShowSample(true)
    setError(null)
  }

  async function runAssessment() {
    const targetIndustry = industry.trim() || client.industry.trim()
    const targetCity = scope === "national" ? "全国" : city.trim()
    const brandName = targetBrand.trim()
    const brandWebsite = website.trim()
    if (!targetIndustry) {
      setError("请先填写行业/赛道名称。")
      return
    }
    if (!targetCity) {
      setError("请选择地域层级后，填写对应的城市、省份或跨省区域。")
      return
    }
    if (mode === "brand" && !brandName) {
      setError(isPerson ? "请先填写要评估的人物姓名。" : "请先填写要评估的品牌名称。")
      return
    }

    setShowSample(false)
    setLoading(true)
    setError(null)
    setProgressPercent(0)
    setProgressLabel("正在准备测评...")
    try {
      const job = await createIdempotentApiJob<DifficultyJobRecord & { error?: string }>({
        endpoint: "/api/difficulty-assessment/jobs",
        requestId: createBackgroundRequestId("difficulty"),
        label: "GEO 难度测评任务创建",
        payload: {
          clientId: client.id,
          mode,
          subjectType,
          personProfile: client.personProfile,
          industry: targetIndustry,
          city: targetCity,
          scope,
          commercial: {
            averageOrderValue: optionalNumber(averageOrderValue),
            grossMarginRate: optionalNumber(grossMarginRate),
            annualRepeatPurchases: optionalNumber(annualRepeatPurchases),
            riskLevel: industryRiskLevel,
          },
          targetBrand: mode === "brand" ? brandName : undefined,
          website: mode === "brand" ? brandWebsite : undefined,
          model: selectedModel,
        },
        onRetry: () => {
          setProgressLabel("网络暂时中断，正在确认测评任务是否已经创建...")
          setError("请勿重复点击，系统正在确认本次测评。")
        },
      })
      if (!job.id) throw new Error("测评未能开始，请稍后重试。")
      setError(null)
      onChangeClient({ difficultyJobId: job.id })
      setProgressLabel("测评已创建，正在等待开始...")
      window.dispatchEvent(new Event("credits:refresh"))
      if (!client.industry && targetIndustry) onChangeClient({ industry: targetIndustry })
      if (!client.ourBrand && mode === "brand" && brandName) onChangeClient({ ourBrand: brandName })
    } catch (err) {
      setError(toUserFacingError(err, { fallback: "难度测评未能开始，请稍后重试。", subject: "难度测评" }))
      setLoading(false)
      setProgressLabel("")
    }
  }

  async function stopAssessment() {
    const jobId = client.difficultyJobId
    if (!jobId) return
    setProgressLabel("正在停止测评...")
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
      setError(`${toUserFacingError(err, { fallback: "暂时无法停止测评。", subject: "停止测评" })} 系统仍会继续确认测评状态。`)
      setProgressLabel("正在确认测评状态...")
    } finally {
      window.dispatchEvent(new Event("credits:refresh"))
    }
  }

  function deleteEntry(id: string) {
    const next = history.filter(item => item.id !== id)
    onChangeClient({ difficultyAssessments: next })
    if (activeEntry?.id === id) {
      setActiveEntry(next[0] ?? null)
      setShowSample(false)
    }
  }

  function switchMode(nextMode: DifficultyAssessmentMode) {
    setMode(nextMode)
    persistDifficultyDraft({ mode: nextMode })
    setActiveEntry(null)
    setShowSample(false)
    setError(null)
  }

  function changeScope(nextScope: DifficultyGeographicScope) {
    setScope(nextScope)
    const nextCity = nextScope === "national" ? "全国" : city === "全国" ? "" : city
    setCity(nextCity)
    persistDifficultyDraft({ scope: nextScope, city: nextCity })
  }

  return (
    <div className="min-w-0 space-y-5">
      <section className="geo-section-panel no-print p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 pb-3">
          <div className="flex items-center gap-3">
            <span className="geo-module-icon">
              <Gauge className="h-5 w-5 text-white" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">GEO 难度测评配置</div>
              <div className="mt-0.5 text-[11px] text-slate-500">调研、对比、评分、复核和报告将连续呈现在下方</div>
            </div>
          </div>
          <div className="geo-segmented w-full grid-cols-2 sm:w-auto sm:min-w-[260px]">
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
                {isPerson ? <UserRound className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                {isPerson ? "个人 IP 评估" : "品牌评估"}
              </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label htmlFor="difficulty-industry">行业/赛道</Label>
              <Input
                id="difficulty-industry"
                value={industry}
                onChange={event => {
                  setIndustry(event.target.value)
                  persistDifficultyDraft({ industry: event.target.value })
                }}
                placeholder="除甲醛、医美、律师服务"
              />
            </div>
            {mode === "brand" && (
              <>
                <div>
                  <Label htmlFor="difficulty-brand">
                    {isPerson ? "查询人物" : "查询品牌"}
                  </Label>
                  <Input
                    id="difficulty-brand"
                    value={targetBrand}
                    onChange={event => {
                      setTargetBrand(event.target.value)
                      persistDifficultyDraft({ targetBrand: event.target.value })
                    }}
                    placeholder={isPerson ? "输入要评估的人物姓名" : "输入要评估的品牌名"}
                  />
                </div>
                <div>
                  <Label htmlFor="difficulty-website">
                    {isPerson ? "个人主页/资料" : "官网/资料"}
                  </Label>
                  <Input
                    id="difficulty-website"
                    value={website}
                    onChange={event => {
                      setWebsite(event.target.value)
                      persistDifficultyDraft({ website: event.target.value })
                    }}
                    placeholder={isPerson ? "个人主页、机构资料页或案例链接，可选" : "官网、案例页或资料链接，可选"}
                  />
                </div>
              </>
            )}
            <div>
              <Label htmlFor="difficulty-scope">覆盖范围</Label>
              <Select
                id="difficulty-scope"
                value={scope}
                onChange={event => changeScope(event.target.value as DifficultyGeographicScope)}
                disabled={loading}
              >
                {SCOPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="difficulty-city">
                {scope === "city" ? "城市/区县" : scope === "province" ? "省份" : scope === "region" ? "跨省区域" : "地区"}
              </Label>
              <Input
                id="difficulty-city"
                value={city}
                onChange={event => {
                  setCity(event.target.value)
                  persistDifficultyDraft({ city: event.target.value })
                }}
                disabled={scope === "national" || loading}
                placeholder={scope === "city" ? "如：杭州" : scope === "province" ? "如：浙江省" : scope === "region" ? "如：长三角" : "全国"}
              />
            </div>
            <div>
              <Label htmlFor="difficulty-model">首选模型</Label>
              <Select
                id="difficulty-model"
                value={selectedModel}
                onChange={event => {
                  const value = event.target.value as DifficultyModelSelection
                  setSelectedModel(value)
                  persistDifficultyDraft({ selectedModel: value })
                }}
                disabled={loading}
              >
                <option value="auto">自动推荐（失败自动切换）</option>
                {modelOptions.map(option => (
                  <option key={option.key} value={option.key} disabled={!option.configured}>
                    {option.label}{option.configured ? "" : "（暂不可用）"}
                  </option>
                ))}
              </Select>
            </div>
        </div>

        <details className="mt-4 rounded-lg border border-[#DCE6F2] bg-[#F8FAFD]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Calculator className="h-4 w-4 text-[#1677FF]" />
            商业参数（可选，留空由系统联网估算）
          </div>
          <span className="text-[10px] text-[#7E91A7]">行业属性、客单价、毛利率、复购次数</span>
          </summary>
          <div className="grid gap-3 border-t border-[#E8EEF5] p-3 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label htmlFor="difficulty-risk-level">行业属性</Label>
              <Select
                id="difficulty-risk-level"
                value={industryRiskLevel}
                onChange={event => {
                  const value = event.target.value as DifficultyIndustryRiskLevel
                  setIndustryRiskLevel(value)
                  persistDifficultyDraft({ industryRiskLevel: value })
                }}
                disabled={loading}
              >
                <option value="auto">系统自动判断（推荐）</option>
                <option value="standard">普通行业</option>
                <option value="high_trust">高信任决策行业</option>
                <option value="regulated">强监管行业</option>
                <option value="strict">严格监管行业</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="difficulty-aov">平均客单价（元）</Label>
              <Input
                id="difficulty-aov"
                type="number"
                min="0"
                value={averageOrderValue}
                onChange={event => {
                  setAverageOrderValue(event.target.value)
                  persistDifficultyDraft({ averageOrderValue: event.target.value })
                }}
                placeholder="如：5000"
                disabled={loading}
              />
            </div>
            <div>
              <Label htmlFor="difficulty-margin">毛利率（%）</Label>
              <Input
                id="difficulty-margin"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={grossMarginRate}
                onChange={event => {
                  setGrossMarginRate(event.target.value)
                  persistDifficultyDraft({ grossMarginRate: event.target.value })
                }}
                placeholder="如：45"
                disabled={loading}
              />
            </div>
            <div>
              <Label htmlFor="difficulty-repeat">年均复购次数</Label>
              <Input
                id="difficulty-repeat"
                type="number"
                min="0"
                step="0.1"
                value={annualRepeatPurchases}
                onChange={event => {
                  setAnnualRepeatPurchases(event.target.value)
                  persistDifficultyDraft({ annualRepeatPurchases: event.target.value })
                }}
                placeholder="如：2"
                disabled={loading}
              />
            </div>
          </div>
        </details>

        {error && (
          <div className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3 border-t border-slate-200/70 pt-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CreditCostBadge featureKey="difficultyAssessment" className="w-fit" />
            <p className="mt-1 text-[11px] text-slate-500">评估完成后会自动保存，可以在历史测评中随时查看。</p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 lg:w-auto lg:min-w-[300px]">
            <Button type="button" variant="outline" onClick={loadSample} disabled={loading}>
              查看示例报告
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
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setActiveEntry(entry)
                    setShowSample(false)
                  }}
                >
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
                <span>{progressLabel || "评估正在启动..."}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-blue-100" aria-label={`测评进度 ${progressPercent}%`}>
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#1677FF] to-[#00C8FF] transition-[width] duration-500"
                  style={{ width: `${Math.max(2, Math.min(100, progressPercent))}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500">可以离开本页继续使用其他功能，评估完成后会自动保存。</p>
            </CardContent>
          </Card>
        )}

        {hasReportToShow ? (
          <>
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-100 pb-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-[#1677FF]">
                    {activeEntry?.source ?? "示例报告"}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                    {reportIsPerson ? "个人 IP 报告" : reportMode === "brand" ? "品牌报告" : "行业报告"}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${levelClasses(result.level)}`}>
                    {result.level}
                  </span>
                </div>
                <CardTitle className="geo-display-title text-2xl leading-tight text-slate-900 md:text-3xl">
                  {activeEntry
                    ? formatEntryTitle(activeEntry)
                    : reportIsPerson
                      ? "个人 IP GEO 难度测评示例"
                      : reportMode === "brand" ? "品牌 GEO 难度测评示例" : "GEO 难度测评示例"}
                </CardTitle>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  {result.summary}
                </p>
              </div>
              <div className="flex shrink-0 items-end gap-4">
                <div className="text-right">
                  <div className="text-[11px] text-slate-400">
                    {reportIsPerson ? "个人 IP 难度分" : reportMode === "brand" ? "品牌难度分" : "垄断总分"}
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
              <Metric
                label={reportIsPerson
                  ? "个人 IP 稳定提及周期"
                  : reportMode === "brand" ? "品牌稳定提及周期" : "被 AI 稳定提及周期"}
                value={result.stableMentionPeriod}
              />
              <Metric label={`${dimensions.length}维合计`} value={`${dimensions.reduce((sum, item) => sum + item.score, 0)}/100`} />
              <Metric label="报告时间" value={formatDate(result.generatedAt)} />
            </div>
          </CardHeader>
          <CardContent className="space-y-6 pt-5">
            <section className="border-b border-slate-200 pb-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <CircleDollarSign className="h-4 w-4 text-[#1677FF]" />
                  GEO 执行成本测算
                </div>
                {costEstimate ? (
                  <span className="text-[11px] text-slate-500">预计内容量、周期与累计成本</span>
                ) : null}
              </div>
              {costEstimate ? (
                isContentVolumeCostEstimate(costEstimate)
                  ? <ContentVolumeCostPanel estimate={costEstimate} />
                  : <LegacyCostPanel estimate={costEstimate} />
              ) : (
                <p className="text-xs leading-5 text-slate-500">这是早期历史报告，未包含成本测算。重新评估后会生成三个提及阶段的内容量、周期和累计成本。</p>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Gauge className="h-4 w-4 text-[#1677FF]" />
                {dimensions.length}维评分
              </div>
              <DifficultyDimensionsRadial
                dimensions={dimensions}
                totalScore={result.totalScore}
                level={result.level}
              />
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <CheckCircle2 className="h-4 w-4 text-[#1677FF]" />
                评估依据
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
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

        <details className="group overflow-hidden rounded-lg border border-slate-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
            <Table2 className="h-4 w-4 text-[#1677FF]" />
            查看评分标准
            <span className="ml-auto text-[11px] font-normal text-slate-400 group-open:hidden">展开</span>
            <span className="ml-auto hidden text-[11px] font-normal text-slate-400 group-open:inline">收起</span>
          </summary>
          <div className="space-y-4 border-t border-slate-100 px-5 pb-5 pt-4">
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
          </div>
        </details>
          </>
        ) : (
          <Card className="no-print border-dashed border-slate-200 bg-white/80">
            <CardContent className="flex min-h-[240px] flex-col items-center justify-center px-6 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-[#1677FF]">
                <Gauge className="h-6 w-6" />
              </span>
              <h2 className="mt-4 text-base font-semibold text-slate-800">尚未生成难度测评报告</h2>
              <p className="mt-2 max-w-md text-xs leading-6 text-slate-500">
                填写上方信息并开始评估，完成后将在这里展示难度、周期、预计成本和行动建议。
              </p>
              <Button type="button" variant="outline" className="mt-5" onClick={loadSample}>
                <FileText className="h-4 w-4" />
                查看示例报告
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function ContentVolumeCostPanel({ estimate }: { estimate: DifficultyContentCostEstimate }) {
  const v3 = isContentVolumeV3CostEstimate(estimate) ? estimate : null
  const stageTones = [
    "border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50/70",
    "border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-blue-50/70",
    "border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50/70",
  ]

  return (
    <div className="space-y-4">
      {v3 ? (
        <details className="group overflow-hidden rounded-lg border border-blue-100 bg-[linear-gradient(110deg,#F0F7FF_0%,#FFFFFF_55%,#F0FDFF_100%)]">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-semibold text-[#003EB3]">
            <TrendingUp className="h-4 w-4" />
            查看分数与行业系数的测算依据
            <span className="ml-auto text-[10px] font-normal text-slate-400 group-open:hidden">展开</span>
            <span className="ml-auto hidden text-[10px] font-normal text-slate-400 group-open:inline">收起</span>
          </summary>
          <div className="border-t border-blue-100/80">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100/80 px-4 py-3">
            <div className="text-xs font-semibold text-slate-700">当前难度与成本变化</div>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${levelClasses(v3.difficultyBand.level)}`}>
              {v3.difficultyBand.score} 分 · {v3.difficultyBand.level}
            </span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-blue-100">
            <CostBasis
              label="当前分数档"
              value={`${v3.difficultyBand.minScore}-${v3.difficultyBand.maxScore} 分`}
              detail={`档内每分复合增长 ${(v3.difficultyBand.perPointGrowthRate * 100).toFixed(1)}%`}
            />
            <CostBasis
              label="稳定内容量公式"
              value={`${v3.difficultyBand.stableContent} 条`}
              detail={v3.difficultyBand.formula}
            />
            <CostBasis
              label="行业执行标准"
              value={v3.industryProfile.label}
              detail={`${v3.industryProfile.source === "manual" ? "用户选择" : "系统判断"} · 行业 ${v3.industryProfile.riskMultiplier} 倍`}
            />
            <CostBasis
              label="综合执行系数"
              value={`${v3.industryProfile.effectiveMultiplier} 倍`}
              detail={`客单价 ${v3.industryProfile.valueMultiplier} 倍 · 封顶 3.5 倍`}
            />
          </div>
          <div className="grid border-t border-blue-100/80 md:grid-cols-2 md:divide-x md:divide-blue-100">
            <div className="flex items-start gap-2 px-4 py-3">
              <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-[#1677FF]" />
              <div className="min-w-0 text-[11px] leading-5 text-slate-600">
                <div className="font-semibold text-slate-800">
                  {v3.difficultyBand.nextScoreImpact
                    ? `${v3.difficultyBand.score}→${v3.difficultyBand.nextScoreImpact.toScore} 分`
                    : "当前已到 100 分"}
                </div>
                <div>
                  {v3.difficultyBand.nextScoreImpact
                    ? `增加 ${v3.difficultyBand.nextScoreImpact.contentDelta} 条内容，稳定成本增加 ¥${formatMoney(v3.difficultyBand.nextScoreImpact.costDelta)}`
                    : "没有更高分值，当前采用最高工作量标准"}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2 px-4 py-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#13A8A8]" />
              <div className="min-w-0 text-[11px] leading-5 text-slate-600">
                <div className="font-semibold text-slate-800">
                  {v3.difficultyBand.nextLevelTransition
                    ? `${v3.difficultyBand.nextLevelTransition.fromScore}→${v3.difficultyBand.nextLevelTransition.toScore} 分跨档`
                    : "当前为最高难度档"}
                </div>
                <div>
                  {v3.difficultyBand.nextLevelTransition
                    ? `${v3.difficultyBand.nextLevelTransition.fromContent}→${v3.difficultyBand.nextLevelTransition.toContent} 条，成本跃升 ¥${formatMoney(v3.difficultyBand.nextLevelTransition.costDelta)}`
                    : v3.industryProfile.reason}
                </div>
              </div>
            </div>
          </div>
          <p className="border-t border-blue-100/80 px-4 py-2.5 text-[10px] leading-5 text-slate-500">
            {v3.industryProfile.reason}；{v3.industryProfile.valueReason}。
          </p>
          </div>
        </details>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        {estimate.milestones.map((milestone, index) => (
          <article key={milestone.key} className={`min-w-0 overflow-hidden rounded-lg border p-4 ${stageTones[index]}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-[#1677FF]">阶段 {index + 1}</div>
                <h4 className="mt-1 text-sm font-semibold text-slate-900">{milestone.label}</h4>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] text-slate-400">累计成本</div>
                <div className="geo-data-number mt-0.5 text-lg font-bold text-[#0958D9]">
                  {formatMoneyRange(milestone.cumulativeCost)}
                </div>
              </div>
            </div>
            <p className="mt-2 min-h-10 text-[11px] leading-5 text-slate-500">{milestone.successDefinition}</p>

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-y border-blue-100/80 py-3 text-xs">
              <div>
                <div className="text-[10px] text-slate-400">预计周期</div>
                <div className="mt-0.5 font-semibold text-slate-800">{milestone.days.min}-{milestone.days.max} 天</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">内容总量</div>
                <div className="mt-0.5 font-semibold text-slate-800">{milestone.contentCount.min}-{milestone.contentCount.max} 条</div>
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between text-[10px] text-slate-400">
                <span>
                  建议 {milestone.contentCount.recommended} 条
                  {milestone.recommendedCost ? ` · ¥${formatMoney(milestone.recommendedCost)}` : ""}
                </span>
                <span>新增 {formatMoneyRange(milestone.incrementalCost)}</span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-slate-200 rounded-md bg-white/80 py-2 text-center ring-1 ring-slate-200/80">
                <CostCount label="自媒体" value={milestone.allocation.selfMediaArticles} />
                <CostCount label="权威媒体" value={milestone.allocation.authorityMediaArticles} />
                <CostCount label="抖音视频" value={milestone.allocation.douyinVideos} />
              </div>
            </div>
          </article>
        ))}
      </div>

      <details className="group overflow-hidden rounded-lg border border-slate-200 bg-white">
        <summary className="flex cursor-pointer list-none items-center px-4 py-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
          查看单价与计算说明
          <span className="ml-auto text-[10px] font-normal text-slate-400 group-open:hidden">展开</span>
          <span className="ml-auto hidden text-[10px] font-normal text-slate-400 group-open:inline">收起</span>
        </summary>
        <div className="border-t border-slate-100">
      {v3 ? (
        <>
          <div className="grid overflow-hidden bg-slate-50/70 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-slate-200">
            <CostBasis label="基础建设" value={`¥${formatMoney(v3.foundationCost)}`} detail="官网和第三方站，只计一次" />
            <CostBasis label="信任与合规准备" value={`¥${formatMoney(v3.riskPreparationCost)}`} detail={`调整后基础投入 ¥${formatMoney(v3.effectiveFoundationCost)}`} />
            <CostBasis label="基准综合单价" value={`¥${v3.baselineWeightedUnitCost.toFixed(1)}/条`} detail="按 70/20/10 基准结构折算" />
            <CostBasis label="当前综合单价" value={`¥${v3.effectiveWeightedUnitCost.toFixed(2)}/条`} detail={`约 ${v3.industryProfile.dailyThroughput} 条/日有效产能`} />
          </div>
          <div className="grid overflow-hidden border-b border-slate-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-slate-200">
            <CostBasis label="自媒体文章" value={`${Math.round(v3.contentRatios.selfMediaArticles * 100)}% · ¥${v3.unitCosts.selfMediaArticle}/篇`} detail="行业内容矩阵" />
            <CostBasis label="权威媒体文章" value={`${Math.round(v3.contentRatios.authorityMediaArticles * 100)}% · ¥${v3.unitCosts.authorityMediaArticle}/篇`} detail="专业信源与背书" />
            <CostBasis label="抖音视频" value={`${Math.round(v3.contentRatios.douyinVideos * 100)}% · ¥${v3.unitCosts.douyinVideo}/个`} detail="场景和视频信号" />
          </div>
        </>
      ) : (
        <div className="grid overflow-hidden border-y border-slate-200 bg-slate-50/70 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-slate-200">
          <CostBasis label="基础建设" value={`¥${formatMoney(estimate.foundationCost)}`} detail="官网和第三方站，只计一次" />
          <CostBasis label="自媒体文章" value={`${Math.round(estimate.contentRatios.selfMediaArticles * 100)}% · ¥${estimate.unitCosts.selfMediaArticle}/篇`} detail="内容矩阵主体" />
          <CostBasis label="权威媒体文章" value={`${Math.round(estimate.contentRatios.authorityMediaArticles * 100)}% · ¥${estimate.unitCosts.authorityMediaArticle}/篇`} detail="权威信源支撑" />
          <CostBasis label="抖音视频" value={`${Math.round(estimate.contentRatios.douyinVideos * 100)}% · ¥${estimate.unitCosts.douyinVideo}/个`} detail="视频内容补充" />
        </div>
      )}

      <div className="grid gap-1 border-t border-slate-100 px-4 py-3 text-[11px] leading-5 text-slate-500 md:grid-cols-2">
        {estimate.assumptions.slice(0, v3 ? 6 : 4).map((item, index) => (
          <p key={`${index}-${item}`} className="pr-3">{item}</p>
        ))}
      </div>
        </div>
      </details>
    </div>
  )
}

function LegacyCostPanel({ estimate }: { estimate: DifficultyLegacyCostEstimate }) {
  return (
    <div className="space-y-4">
      <div className="grid overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60 md:grid-cols-3 md:divide-x md:divide-slate-200">
        <CostPhase label="30天验证期" value={formatMoneyRange(estimate.validation30Days)} />
        <CostPhase label="90天稳定期" value={formatMoneyRange(estimate.stabilization90Days)} />
        <CostPhase label="180天规模期" value={formatMoneyRange(estimate.scale180Days)} />
      </div>
      <div className="grid gap-x-4 gap-y-3 border-y border-slate-200 py-3 sm:grid-cols-2 xl:grid-cols-5">
        <CostLine label="一次性基础建设" value={formatMoneyRange(estimate.oneTimeFoundation)} />
        <CostLine label="每月内容生产" value={formatMoneyRange(estimate.monthlyContent)} />
        <CostLine label="权威信源资产" value={formatMoneyRange(estimate.authorityAssets)} />
        <CostLine label="地域覆盖建设" value={formatMoneyRange(estimate.regionalCoverage)} />
        <CostLine label="每月监测复盘" value={formatMoneyRange(estimate.monthlyMonitoring)} />
      </div>
      <p className="text-xs leading-5 text-slate-500">
        这是较早生成的报告。重新评估后会提供更完整的内容数量、渠道分配和成本说明。
      </p>
    </div>
  )
}

function CostCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-1">
      <div className="geo-data-number text-sm font-bold text-slate-800">{value}</div>
      <div className="mt-0.5 text-[9px] text-slate-400">{label}</div>
    </div>
  )
}

function CostBasis({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-800">{value}</div>
      <div className="mt-0.5 text-[10px] text-slate-400">{detail}</div>
    </div>
  )
}

function CostPhase({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="geo-data-number mt-1 text-xl font-bold text-[#0958D9]">{value}</div>
    </div>
  )
}

function CostLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-slate-800" title={value}>{value}</div>
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
