import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import type {
  CommercialReportInput,
  DifficultyAssessmentEntry,
  PenetrationItem,
  PenetrationResult,
  ReportBrandingSettings,
} from "../src/types"

const require = createRequire(import.meta.url)
const React = require("react") as typeof import("react")
const { renderToBuffer } = require("@react-pdf/renderer") as typeof import("@react-pdf/renderer")
const { CommercialReportDocument } = require("../src/lib/reports/commercial-report-document.tsx") as typeof import("../src/lib/reports/commercial-report-document")
const { DEFAULT_REPORT_BRANDING, resolveReportBranding } = require("../src/lib/report-branding.ts") as typeof import("../src/lib/report-branding")
const { ReportBrandingValidationError, validateReportBranding } = require("../src/lib/report-branding-validation.ts") as typeof import("../src/lib/report-branding-validation")

const publicLogo = await fs.readFile(path.join(process.cwd(), "public", "logo.jpg"))
const logoDataUrl = `data:image/jpeg;base64,${publicLogo.toString("base64")}`

assert.deepEqual(validateReportBranding(undefined), DEFAULT_REPORT_BRANDING)
assert.deepEqual(resolveReportBranding({ mode: "custom", companyName: "", website: "" }), DEFAULT_REPORT_BRANDING)

const custom = validateReportBranding({
  mode: "custom",
  companyName: "  测试数字科技有限公司  ",
  website: "example.com",
  logoDataUrl,
})
assert.equal(custom.companyName, "测试数字科技有限公司")
assert.equal(custom.website, "https://example.com/")
assert.ok(custom.logoDataUrl?.startsWith("data:image/jpeg;base64,"))

assert.throws(
  () => validateReportBranding({ mode: "custom", companyName: "测试公司", logoDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" }),
  ReportBrandingValidationError,
)
assert.throws(
  () => validateReportBranding({ mode: "custom", companyName: "测试公司", website: "javascript:alert(1)" }),
  ReportBrandingValidationError,
)

const generatedAt = "2026-07-13T15:30:00.000Z"

function penetrationItem(index: number, hitOur: boolean): PenetrationItem {
  const sources = [
    {
      title: `2026 年企业级 GEO 服务选择指南与落地评估 ${index + 1}`,
      snippet: "本文从模型可见度、联网信源、内容供给和持续监测等角度进行梳理。",
      url: `https://example.com/geo/report-${index + 1}`,
      domain: "example.com",
      query: "企业 GEO 服务商怎么选",
    },
    {
      title: `企业品牌在 AI 搜索中的可见度分析 ${index + 1}`,
      snippet: "重点检查品牌是否出现在模型回答、哪些信源提供了佐证，以及竞品的相对声量。",
      url: `https://news.example.net/insights/${index + 1}.html`,
      domain: "news.example.net",
      query: "AI 搜索品牌可见度",
    },
  ]
  return {
    question: `我想在全国范围做企业级 GEO，应该如何评估服务商的专业能力和持续交付能力？样本问题 ${index + 1}`,
    answer: `选择 GEO 服务商时，需要同时检查模型检测、联网信源审计、内容生产和复测机制。${hitOur ? "测试品牌在多模型检测和报告可视化方面具有一定完整度。" : "其他服务商也在行业内提供类似能力，建议结合真实案例进一步核验。"}`,
    mentionedBrands: hitOur ? ["测试品牌", "Alpha 智品", "Beta 数科"] : ["Gamma 云", "Delta 传媒"],
    topRecommended: hitOur ? "测试品牌" : "Gamma 云",
    searchSources: sources,
    sourceDomains: [{ domain: "example.com", count: 1 }, { domain: "news.example.net", count: 1 }],
    topSourceDomain: { domain: "example.com", count: 1 },
    searchMode: "native_web",
    promptPurity: "raw_question_only",
    webAttempted: true,
    searchQueries: ["企业 GEO 服务商怎么选", "AI 搜索品牌可见度"],
    webFailureReason: null,
    sourceCount: sources.length,
    webVerified: true,
    webVerificationNote: "原生联网搜索已返回可点击文章信源。",
    hitOur,
  }
}

function samplePenetration(): PenetrationResult {
  return {
    byModel: {
      doubao: [penetrationItem(0, true), penetrationItem(1, false), penetrationItem(2, true)],
      qwen: [penetrationItem(3, true), penetrationItem(4, true), penetrationItem(5, false)],
      kimi: [penetrationItem(6, false), penetrationItem(7, true)],
    },
    aggregated: {
      penetrationRate: 0.625,
      ourMentions: 5,
      totalSlots: 8,
      industryShare: [
        ["测试品牌", 5, 0.25, 0.625],
        ["Alpha 智品", 4, 0.2, 0.5],
        ["Gamma 云", 3, 0.15, 0.375],
        ["Beta 数科", 2, 0.1, 0.25],
        ["Delta 传媒", 2, 0.1, 0.25],
        ["Epsilon 研究", 1, 0.05, 0.125],
        ["Zeta 互联", 1, 0.05, 0.125],
        ["Eta 科技", 1, 0.05, 0.125],
        ["Theta 数字", 1, 0.05, 0.125],
        ["Iota 数据", 1, 0.05, 0.125],
      ].map(([brand, count, ratio, penetrationRate]) => ({
        brand: String(brand),
        count: Number(count),
        ratio: Number(ratio),
        penetrationRate: Number(penetrationRate),
      })),
      ourRanking: 1,
      perModelRate: [
        { model: "doubao", rate: 2 / 3, mentions: 2, total: 3 },
        { model: "qwen", rate: 2 / 3, mentions: 2, total: 3 },
        { model: "kimi", rate: 0.5, mentions: 1, total: 2 },
      ],
      missedQuestions: [penetrationItem(1, false).question, penetrationItem(5, false).question, penetrationItem(6, false).question],
      topCompetitors: ["Alpha 智品", "Gamma 云", "Beta 数科"],
    },
    generatedAt,
  }
}

function sampleDifficulty(): DifficultyAssessmentEntry {
  const stage = (title: string, summary: string) => ({
    title,
    summary,
    evidence: ["样本联网调研证据", "竞品品牌声量统计", "区域覆盖与商业价值校准"],
    tags: ["联网可验证", "竞争密度", "成本测算"],
  })
  return {
    id: "branding-difficulty-sample",
    mode: "brand",
    industry: "企业级 GEO 服务",
    city: "全国",
    scope: "national",
    targetBrand: "测试品牌",
    website: "https://client.example.com",
    source: "多模型联网调研",
    createdAt: generatedAt,
    result: {
      scoreVersion: "v2",
      mode: "brand",
      scope: "national",
      region: "全国",
      targetBrand: "测试品牌",
      website: "https://client.example.com",
      totalScore: 78,
      level: "困难",
      stableMentionPeriod: "预计 4至6 个月形成稳定提及，需要持续供给高质量内容并建设可验证信源。",
      summary: "全国市场的竞品数量、权威信源门槛和高商业价值同时抬高了竞争难度；但已有的模型可见度为后续优化保留了明确起点。",
      dimensions: Object.fromEntries([
        ["竞争品牌密度", 17, 20, "较多的有效竞品已经进入模型回答。"],
        ["权威信源门槛", 14, 16, "需要多类权威资产与可读取链接共同支撑。"],
        ["内容供给压力", 13, 16, "高质量问题覆盖和持续更新需要稳定产能。"],
        ["模型现有可见度", 10, 16, "已有一定模型提及，但跨模型表现仍不均衡。"],
        ["商业价值压力", 14, 16, "高客单与高毛利会吸引更多专业团队投入竞争。"],
        ["区域覆盖工作量", 10, 16, "全国覆盖的总工作量高于单城市，但单位区域复用效率更高。"],
      ].map(([name, score, max, analysis]) => [String(name), {
        name: String(name),
        score: Number(score),
        max: Number(max),
        level: Number(score) >= 14 ? "困难" : "中等",
        analysis: String(analysis),
      }])),
      insights: [
        "品牌在通义千问的可见度相对更高，应优先复制有效信源结构。",
        "竞品数量较多，且头部品牌拥有完整的官网与媒体资产。",
        "现有外部信源的标题和摘要仍需要绕绕核验，避免图片链接和失效页。",
        "全国策略应分批上线，并通过监测反馈动态调整优先级。",
      ],
      suggestions: [
        "30 天内完成核心问题池、竞品别名库和可验证信源基线。",
        "90 天内按场景扩展内容覆盖，并对三个主力模型每月复测。",
        "180 天内建立全国级内容与权威资产网络，把稳定提及率纳入运营指标。",
      ],
      process: {
        research: stage("联网调研", "检查行业、区域、品牌和商业价值信号。"),
        comparison: stage("竞品对比", "对品牌数量、竞争密度与头部对手资产进行结构化比较。"),
        scoring: stage("六维评分", "结合竞争、权威、内容、可见度、商业价值和区域工作量评分。"),
        review: stage("独立复核", "复核异常分数，确保全国和单区域的难度关系符合业务常识。"),
        report: stage("报告形成", "将分数、成本、证据与行动建议组成可交付报告。"),
      },
      costEstimate: {
        currency: "CNY",
        confidence: "中",
        validation30Days: { min: 30_000, max: 50_000 },
        stabilization90Days: { min: 100_000, max: 180_000 },
        scale180Days: { min: 220_000, max: 380_000 },
        oneTimeFoundation: { min: 20_000, max: 35_000 },
        monthlyContent: { min: 25_000, max: 45_000 },
        authorityAssets: { min: 30_000, max: 80_000 },
        regionalCoverage: { min: 20_000, max: 60_000 },
        monthlyMonitoring: { min: 5_000, max: 12_000 },
        workload: { articlesPerMonth: 45, authorityAssets: 12, channelCount: 8, regionalPages: 30 },
        assumptions: ["按全国市场和三个主力 AI 模型估算", "不包含线下媒体采购与大额广告投放", "实际成本受内容审批和客户资料完整度影响"],
      },
      generatedAt,
      providerLabel: "多模型综合评估",
    },
  }
}

function reportInput(branding: ReportBrandingSettings, rich = false): CommercialReportInput {
  return {
    kind: "combined",
    detail: rich ? "full" : "concise",
    branding,
    client: {
      id: "branding-test-client",
      name: "白标报告测试客户",
      ourBrand: "测试品牌",
      brandAliases: [],
      industry: "企业服务",
      website: "https://client.example.com",
    },
    penetration: rich ? samplePenetration() : undefined,
    difficulty: rich ? sampleDifficulty() : undefined,
  }
}

const defaultPdf = await renderToBuffer(React.createElement(CommercialReportDocument, {
  input: reportInput(DEFAULT_REPORT_BRANDING, true),
}) as Parameters<typeof renderToBuffer>[0])
const customPdf = await renderToBuffer(React.createElement(CommercialReportDocument, {
  input: reportInput({
    mode: "custom",
    companyName: "超长测试数字科技与企业管理顾问及品牌增长服务有限责任公司",
    website: "https://example.com",
  }),
}) as Parameters<typeof renderToBuffer>[0])
assert.ok(defaultPdf.length > 100_000, "势途默认报告应成功渲染")
assert.ok(customPdf.length > 100_000, "自定义白标报告应成功渲染")

if (process.env.KEEP_REPORT_TEST_ARTIFACTS === "1") {
  const outputDir = path.join(process.cwd(), "tmp", "pdfs")
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(path.join(outputDir, "report-branding-default.pdf"), defaultPdf)
  await fs.writeFile(path.join(outputDir, "report-branding-custom.pdf"), customPdf)
}

console.log("report branding: validation, fallback and PDF rendering checks passed")
