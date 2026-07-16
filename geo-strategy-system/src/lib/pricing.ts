export const PRICING_VERSION = "commercial-mvp-2026-07-16"

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
  articleCompetitorComparison: {
    label: "文章生成 · 竞品对比推荐",
    credits: 8,
    unitLabel: "篇",
  },
  articleIndustryRankingReport: {
    label: "文章生成 · 行业排名报告",
    credits: 8,
    unitLabel: "篇",
  },
  articleHandsOnComparisonReport: {
    label: "文章生成 · 第三方实测横评",
    credits: 8,
    unitLabel: "篇",
  },
  articleMediaIndustryAnalysis: {
    label: "文章生成 · 媒体行业解读",
    credits: 8,
    unitLabel: "篇",
  },
  articleClientCaseStudy: {
    label: "文章生成 · 客户合作案例",
    credits: 8,
    unitLabel: "篇",
  },
  articleCredentialsAnalysis: {
    label: "文章生成 · 标准资质解读",
    credits: 8,
    unitLabel: "篇",
  },
  articleSelectionPitfallGuide: {
    label: "文章生成 · 选型避坑指南",
    credits: 8,
    unitLabel: "篇",
  },
  articleTopBrandRanking: {
    label: "文章生成 · Top 品牌榜单",
    credits: 8,
    unitLabel: "篇",
  },
  articleShortVideoScript: {
    label: "文章生成 · 多模态视频文案",
    credits: 2,
    unitLabel: "篇",
  },
  articleRewrite: {
    label: "文章生成 · 文章改写",
    credits: 8,
    unitLabel: "篇",
  },
  reportCustomBranding: {
    label: "专业报告 · 白标交付版",
    credits: 15,
    unitLabel: "份",
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
  competitorComparison: "articleCompetitorComparison",
  industryRankingReport: "articleIndustryRankingReport",
  handsOnComparisonReport: "articleHandsOnComparisonReport",
  mediaIndustryAnalysis: "articleMediaIndustryAnalysis",
  clientCaseStudy: "articleClientCaseStudy",
  credentialsAnalysis: "articleCredentialsAnalysis",
  selectionPitfallGuide: "articleSelectionPitfallGuide",
  topBrandRanking: "articleTopBrandRanking",
  shortVideoScript: "articleShortVideoScript",
  rewrite: "articleRewrite",
} as const

export const RECHARGE_PACKAGES = [
  {
    key: "trial_990",
    name: "首购体验包",
    priceCents: 990,
    credits: 100,
    badge: "限首购",
    firstPurchaseOnly: true,
    description: "适合第一次体验 GEO 检测、疑问句生成和文章改写。",
  },
  {
    key: "light_49",
    name: "轻量包",
    priceCents: 4900,
    credits: 600,
    description: "适合个体老板、运营人员做小批量检测和内容生产。",
  },
  {
    key: "standard_99",
    name: "标准包",
    priceCents: 9900,
    credits: 1500,
    badge: "推荐",
    description: "适合单品牌商家持续做检测、关键词策略和文章生成。",
  },
  {
    key: "growth_299",
    name: "增长包",
    priceCents: 29900,
    credits: 5500,
    description: "适合本地服务商家、增长团队做月度高频检测。",
  },
  {
    key: "team_699",
    name: "团队包",
    priceCents: 69900,
    credits: 15000,
    description: "适合代运营、咨询顾问和多客户批量交付场景。",
  },
  {
    key: "enterprise_1999",
    name: "企业包",
    priceCents: 199900,
    credits: 50000,
    badge: "对公优先",
    description: "适合企业市场部、品牌方长期监控和批量报告需求。",
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
