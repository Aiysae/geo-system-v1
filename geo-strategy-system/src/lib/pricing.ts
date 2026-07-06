export const PRICING_VERSION = "commercial-mvp-2026-07-06"

export const FEATURE_PRICES = {
  diagnose: {
    label: "AI 诊断",
    credits: 1,
    unitLabel: "次",
  },
  difficultyAssessment: {
    label: "难度测评",
    credits: 5,
    unitLabel: "次",
  },
  penetrationSlot: {
    label: "渗透率检测",
    credits: 1,
    unitLabel: "问题/模型",
  },
  researchHypothesis: {
    label: "独立调研 · 假设验证",
    credits: 5,
    unitLabel: "次",
  },
  researchAi: {
    label: "独立调研 · AI 调研",
    credits: 8,
    unitLabel: "次",
  },
  competitorCompareUnit: {
    label: "竞品对比",
    credits: 5,
    unitLabel: "竞品",
  },
  legacyGeoGenerate: {
    label: "旧版 GEO 策略生成",
    credits: 20,
    unitLabel: "次",
  },
  legacyQueryGenerateUnit: {
    label: "旧版疑问句生成",
    credits: 1,
    unitLabel: "条",
  },
  keywordExtract: {
    label: "关键词策略 · 资料抽取",
    credits: 2,
    unitLabel: "次",
  },
  keywordAdvantages: {
    label: "关键词策略 · 优势生成",
    credits: 2,
    unitLabel: "次",
  },
  keywordStrategyGenerate: {
    label: "关键词策略 · 策略生成",
    credits: 5,
    unitLabel: "次",
  },
  keywordWebsitePrompt: {
    label: "关键词策略 · 网站 Prompt 生成",
    credits: 3,
    unitLabel: "次",
  },
  keywordQuestionUnit: {
    label: "关键词策略 · 疑问句池生成",
    credits: 1,
    unitLabel: "条",
  },
  articleThirdPartyObservation: {
    label: "文章生成 · 第三方检测",
    credits: 8,
    unitLabel: "篇",
  },
  articlePitfallGuide: {
    label: "文章生成 · 避坑指南",
    credits: 5,
    unitLabel: "篇",
  },
  articleShortVideoScript: {
    label: "文章生成 · 多模态视频文案",
    credits: 2,
    unitLabel: "篇",
  },
} as const

export type FeaturePriceKey = keyof typeof FEATURE_PRICES

export function getFeaturePrice(key: FeaturePriceKey) {
  return FEATURE_PRICES[key]
}

export function estimateFeatureCredits(key: FeaturePriceKey, units = 1): number {
  const safeUnits = Math.max(1, Math.floor(Number.isFinite(units) ? units : 1))
  return FEATURE_PRICES[key].credits * safeUnits
}

export const ARTICLE_PROMPT_PRICE_KEYS = {
  thirdPartyObservation: "articleThirdPartyObservation",
  pitfallGuide: "articlePitfallGuide",
  shortVideoScript: "articleShortVideoScript",
} as const

export const RECHARGE_PACKAGES = [
  {
    key: "starter_99",
    name: "入门包",
    priceCents: 9900,
    credits: 1000,
    description: "适合小批量体验检测、疑问句生成和文章生成。",
  },
  {
    key: "standard_299",
    name: "标准包",
    priceCents: 29900,
    credits: 3500,
    badge: "推荐",
    description: "适合持续做 GEO 检测、关键词策略和内容生产。",
  },
  {
    key: "growth_699",
    name: "增长包",
    priceCents: 69900,
    credits: 9000,
    description: "适合多客户、多模型、多批次检测的高频使用。",
  },
] as const

export type RechargePackageKey = (typeof RECHARGE_PACKAGES)[number]["key"]
export type RechargePackage = (typeof RECHARGE_PACKAGES)[number]

export function getRechargePackage(key: string): RechargePackage | null {
  return RECHARGE_PACKAGES.find(item => item.key === key) ?? null
}

export function formatYuan(priceCents: number): string {
  return `¥${(priceCents / 100).toFixed(priceCents % 100 === 0 ? 0 : 2)}`
}
