export const PRICING_VERSION = "commercial-v3-2026-07-24"

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
    label: "文章生成 · 第三方测评",
    credits: 8,
    unitLabel: "篇",
  },
  articlePitfallGuide: {
    label: "文章生成 · 专家问答",
    credits: 5,
    unitLabel: "篇",
  },
  articleCompetitorComparison: {
    label: "文章生成 · 行业热点",
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
  articleBrandSingleQuestionVideoScript: {
    label: "文章生成 · 品牌单问题视频文案",
    credits: 2,
    unitLabel: "条",
  },
  articleRewrite: {
    label: "文章生成 · 文章改写",
    credits: 8,
    unitLabel: "篇",
  },
  reportCustomBranding: {
    label: "专业报告 · 白标交付版",
    credits: 9,
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
  brandSingleQuestionVideoScript: "articleBrandSingleQuestionVideoScript",
  rewrite: "articleRewrite",
} as const

export type RechargePackageDefinition = {
  key: string
  name: string
  priceCents: number
  credits: number
  badge: string | null
  firstPurchaseOnly: boolean
  recommended: boolean
  kind: "intro" | "regular" | "recommended" | "enterprise"
  description: string
}

export const RECHARGE_PACKAGES = [
  {
    key: "trial_990",
    name: "首购体验包",
    priceCents: 990,
    credits: 100,
    badge: "首购专享",
    firstPurchaseOnly: true,
    recommended: false,
    kind: "intro",
    description: "第一次体验 GEO 检测、内容生成和白标报告。",
  },
  {
    key: "standard_128",
    name: "标准运营包",
    priceCents: 12800,
    credits: 700,
    badge: "单品牌优选",
    firstPurchaseOnly: false,
    recommended: false,
    kind: "regular",
    description: "适合单品牌日常检测与内容生产。",
  },
  {
    key: "team_598",
    name: "单客户团队协作包",
    priceCents: 59800,
    credits: 4000,
    badge: "限 1 个客户",
    firstPurchaseOnly: false,
    recommended: false,
    kind: "regular",
    description: "同一团队最多对接 1 个客户，适合单一品牌、公司或个人 IP 的高频交付。",
  },
  {
    key: "enterprise_1298",
    name: "多客户企业运营包",
    priceCents: 129800,
    credits: 10000,
    badge: "对公优选",
    firstPurchaseOnly: false,
    recommended: false,
    kind: "enterprise",
    description: "适合企业市场部或代运营团队同时服务多个客户，并进行长期积分储备。",
  },
] as const satisfies readonly RechargePackageDefinition[]

export const LEGACY_RECHARGE_PACKAGE_KEYS = [
  "light_66",
  "growth_298",
  "light_49",
  "standard_99",
  "growth_299",
  "team_699",
  "enterprise_1999",
] as const

export type ActiveRechargePackageKey = (typeof RECHARGE_PACKAGES)[number]["key"]
export type LegacyRechargePackageKey = (typeof LEGACY_RECHARGE_PACKAGE_KEYS)[number]
export type RechargePackageKey = ActiveRechargePackageKey | LegacyRechargePackageKey
export type RechargePackage = (typeof RECHARGE_PACKAGES)[number]

export function getRechargePackage(key: string): RechargePackage | null {
  return RECHARGE_PACKAGES.find(item => item.key === key) ?? null
}

export function rechargeUnitPrice(packageItem: RechargePackage): number {
  return packageItem.priceCents / 100 / packageItem.credits
}

export function rechargeSavingsPercent(packageItem: RechargePackage): number {
  const baseline = RECHARGE_PACKAGES.find(item => item.key === "standard_128")
  if (!baseline || packageItem.key === baseline.key) return 0
  const percentage = (1 - rechargeUnitPrice(packageItem) / rechargeUnitPrice(baseline)) * 100
  return Math.max(0, Math.round(percentage))
}

export function estimatePackageFeatureUses(
  packageItem: RechargePackage,
  featureKey: FeaturePriceKey,
): number {
  return Math.floor(packageItem.credits / FEATURE_PRICES[featureKey].credits)
}

export function formatYuan(priceCents: number): string {
  return `¥${(priceCents / 100).toFixed(priceCents % 100 === 0 ? 0 : 2)}`
}
