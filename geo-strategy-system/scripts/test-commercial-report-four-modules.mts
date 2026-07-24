import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import type { CommercialReportInput, DifficultyProcess, GeoAuditCategory } from "../src/types"

const require = createRequire(import.meta.url)
const React = require("react") as typeof import("react")
const { renderToBuffer } = require("@react-pdf/renderer") as typeof import("@react-pdf/renderer")
const { CommercialReportDocument } = require("../src/lib/reports/commercial-report-document.tsx") as typeof import("../src/lib/reports/commercial-report-document")

const generatedAt = "2026-07-24T08:00:00.000Z"
const auditCategories: Array<[GeoAuditCategory, string, number]> = [
  ["crawlability", "抓取可访问性", 14],
  ["discoverability", "资源可发现性", 10],
  ["contentStructure", "内容结构", 12],
  ["structuredData", "结构化数据", 8],
  ["trust", "可信度信号", 11],
  ["aiReadability", "AI 可读性", 13],
]

const difficultyProcess = Object.fromEntries([
  ["research", "联网调研"],
  ["comparison", "竞品对比"],
  ["scoring", "七维评分"],
  ["review", "独立复核"],
  ["report", "报告形成"],
].map(([key, title]) => [key, {
  title,
  summary: `${title}已完成，并保留结构化结论。`,
  evidence: ["客户资料", "联网结果"],
  tags: ["已核验", "可复盘"],
}])) as DifficultyProcess

const input: CommercialReportInput = {
  kind: "combined",
  detail: "full",
  client: {
    id: "four-module-client",
    name: "四模块报告测试客户",
    subjectType: "brand",
    ourBrand: "测试品牌",
    brandAliases: ["Test Brand"],
    industry: "企业服务",
    website: "https://example.com",
  },
  penetration: {
    byModel: {
      doubao: [{
        question: "企业应该如何选择 GEO 服务商？",
        answer: "建议检查多模型独立检测、联网信源审计和持续复测能力。测试品牌提供完整的检测与报告流程。",
        mentionedBrands: ["测试品牌", "甲品牌"],
        topRecommended: "测试品牌",
        searchSources: [{
          title: "企业 GEO 服务选择指南",
          snippet: "从检测、信源和持续运营角度进行评估。",
          url: "https://example.com/geo-guide",
          domain: "example.com",
          query: "GEO 服务商怎么选",
        }],
        searchMode: "native_web",
        promptPurity: "raw_question_only",
        webAttempted: true,
        webExecutionVerified: true,
        sourceCount: 1,
        webVerified: true,
        webVerificationNote: "返回了可点击文章信源。",
        hitOur: true,
      }],
      qwen: [{
        question: "企业应该如何选择 GEO 服务商？",
        answer: "应结合公开案例、第三方信源和跨模型复测结果综合判断。",
        mentionedBrands: ["甲品牌", "乙品牌"],
        topRecommended: "甲品牌",
        searchSources: [{
          title: "AI 搜索优化实践",
          snippet: "介绍企业内容被 AI 引用的主要条件。",
          url: "https://news.example.net/ai-search",
          domain: "news.example.net",
          query: "企业 AI 搜索优化",
        }],
        searchMode: "native_web",
        promptPurity: "raw_question_only",
        webAttempted: true,
        webExecutionVerified: true,
        sourceCount: 1,
        webVerified: true,
        webVerificationNote: "返回了可点击文章信源。",
        hitOur: false,
      }],
    },
    aggregated: {
      penetrationRate: 0.5,
      ourMentions: 1,
      totalSlots: 2,
      industryShare: [
        { brand: "测试品牌", count: 1, ratio: 0.25, penetrationRate: 0.5 },
        { brand: "甲品牌", count: 2, ratio: 0.5, penetrationRate: 1 },
        { brand: "乙品牌", count: 1, ratio: 0.25, penetrationRate: 0.5 },
      ],
      ourRanking: 2,
      perModelRate: [
        { model: "doubao", rate: 1, mentions: 1, total: 1 },
        { model: "qwen", rate: 0, mentions: 0, total: 1 },
      ],
      missedQuestions: ["企业应该如何选择 GEO 服务商？"],
      topCompetitors: ["甲品牌", "乙品牌"],
    },
    generatedAt,
  },
  research: {
    mode: "ai",
    sourceMode: "module",
    region: "全国",
    aliases: ["Test Brand"],
    executiveSummary: "品牌已形成基础认知，但跨模型提及和权威信源仍不稳定。",
    brandImage: "专业、务实，公开案例仍需补齐。",
    modelMentality: "模型更容易在有第三方证据的问题中提及该品牌。",
    dimensions: [
      { name: "品牌认知", score: 68, insight: "已有基础认知。", evidence: ["部分模型能准确识别品牌。"] },
      { name: "信任证据", score: 52, insight: "权威信源不足。", evidence: ["可点击第三方文章数量较少。"] },
      { name: "内容覆盖", score: 61, insight: "核心问题已有覆盖。", evidence: ["长尾场景仍存在缺口。"] },
    ],
    audiencePerception: ["服务流程完整", "需要更多公开案例"],
    trustSignals: ["官网信息结构清晰"],
    evidenceGaps: ["缺少行业权威媒体背书"],
    risks: ["竞品在通用推荐问题中占位更稳定"],
    opportunities: ["围绕真实检测数据形成差异化内容"],
    recommendations: ["补齐可验证案例页并建立月度复测机制"],
    generatedAt,
  },
  competitorCompare: {
    competitor: "甲品牌",
    positioningSummary: "甲品牌依靠早期内容积累形成较高通用推荐声量。",
    ourAdvantages: ["检测链路完整"],
    competitorAdvantages: ["公开内容数量更多"],
    ourWeaknesses: ["权威信源较少"],
    competitorWeaknesses: ["缺少透明的检测审计"],
    differentiators: ["提供独立联网回答与来源审计"],
    userChoiceDrivers: ["结果是否可验证"],
    contentActions: ["发布方法论、真实案例和月度复测结果"],
    selectedCompetitors: ["甲品牌"],
    generatedAt,
  },
  diagnosis: {
    version: 2,
    gemScore: 68,
    dimensions: { authority: 60, structure: 72, traceability: 58, coverage: 66, sentiment: 75 },
    modelDiagnosis: {
      doubao: { preference: "结构化问答", weakness: "权威信源不足", fix: "补齐案例与引用" },
      qwen: { preference: "清晰标题", weakness: "LLMs 文本缺失", fix: "增加 llms.txt" },
      deepseek: { preference: "完整正文", weakness: "实体证据少", fix: "补充资质信息" },
      kimi: { preference: "长文证据", weakness: "页面覆盖不足", fix: "增加专题页" },
    },
    audit: {
      version: 2,
      requestUrl: "https://example.com",
      finalUrl: "https://example.com/",
      auditedAt: generatedAt,
      durationMs: 1800,
      pagesRequested: 3,
      pagesFetched: 3,
      confidence: "high",
      confidenceLabel: "高",
      resources: [
        { kind: "robots", url: "https://example.com/robots.txt", status: 200, available: true, valid: true, summary: "robots.txt 可访问。" },
        { kind: "sitemap", url: "https://example.com/sitemap.xml", status: 200, available: true, valid: true, summary: "Sitemap 可访问。" },
        { kind: "llms", url: "https://example.com/llms.txt", status: 404, available: false, valid: false, summary: "未发现 llms.txt。" },
      ],
      botPolicies: [
        { key: "generic", label: "通用爬虫", userAgent: "*", status: "allowed", explicit: true, note: "允许抓取。" },
        { key: "oaiSearch", label: "OAI-SearchBot", userAgent: "OAI-SearchBot", status: "unknown", explicit: false, note: "未单独声明。" },
        { key: "gptBot", label: "GPTBot", userAgent: "GPTBot", status: "unknown", explicit: false, note: "未单独声明。" },
        { key: "googlebot", label: "Googlebot", userAgent: "Googlebot", status: "allowed", explicit: false, note: "继承通用规则。" },
        { key: "claudeBot", label: "ClaudeBot", userAgent: "ClaudeBot", status: "unknown", explicit: false, note: "未单独声明。" },
        { key: "bytespider", label: "Bytespider", userAgent: "Bytespider", status: "unknown", explicit: false, note: "未单独声明。" },
      ],
      pages: [{
        url: "https://example.com/",
        finalUrl: "https://example.com/",
        status: 200,
        title: "测试品牌 GEO 服务",
        description: "提供 GEO 检测、策略与内容执行。",
        language: "zh-CN",
        canonical: "https://example.com/",
        robotsMeta: "index,follow",
        xRobotsTag: "",
        wordCount: 1200,
        textLength: 4800,
        leadText: "测试品牌提供 GEO 全链路服务。",
        h1: ["测试品牌 GEO 服务"],
        h2: ["服务能力", "常见问题"],
        h3: ["检测范围"],
        headingLevelSkips: 0,
        visibleQuestionCount: 6,
        structuredDataTypes: ["Organization", "FAQPage"],
        structuredDataErrors: 0,
        entityNames: ["测试品牌"],
        authorSignals: ["编辑团队"],
        credentialSignals: ["服务案例"],
        dateSignals: ["2026-07-24"],
        trustLinks: ["/about", "/contact"],
        internalLinkCount: 18,
        externalCitationCount: 3,
        semanticLandmarks: ["main", "article", "nav"],
        jsShellRisk: false,
        loadTimeMs: 620,
      }],
      checks: auditCategories.map(([category, label, score], index) => ({
        id: `check-${index + 1}`,
        category,
        label,
        status: score >= 12 ? "pass" : score >= 9 ? "warning" : "fail",
        score,
        maxScore: 15,
        summary: `${label}已完成真实页面检查。`,
        evidence: [`检查得分 ${score}/15`, "保留了页面证据"],
        urls: ["https://example.com/"],
        recommendation: `继续优化${label}。`,
        priority: score < 9 ? "P0" : score < 12 ? "P1" : "P2",
      })),
      dimensions: auditCategories.map(([key, label, score]) => ({ key, label, score, maxScore: 15 })),
      score: 68,
      aiSummary: {
        executiveSummary: "网站基础抓取和结构较好，但 llms.txt、权威证据与实体信号需要加强。",
        strengths: ["H1/H2 层级清晰", "FAQPage 结构化数据可用"],
        risks: ["未提供 llms.txt"],
        actions: ["新增 llms.txt 并补齐权威引用"],
        generatedBy: "测试模型",
      },
    },
    generatedAt,
  },
  difficulty: {
    id: "difficulty-four-module",
    mode: "brand",
    subjectType: "brand",
    industry: "企业服务",
    city: "全国",
    scope: "national",
    targetBrand: "测试品牌",
    website: "https://example.com",
    source: "多模型联网评估",
    createdAt: generatedAt,
    result: {
      scoreVersion: "v2",
      mode: "brand",
      scope: "national",
      region: "全国",
      targetBrand: "测试品牌",
      website: "https://example.com",
      totalScore: 72,
      level: "困难",
      stableMentionPeriod: "预计 90 至 150 天形成稳定提及。",
      summary: "全国竞争和信源门槛共同抬高执行难度。",
      dimensions: Object.fromEntries([
        "行业竞争与头部封锁",
        "目标品牌可见度差距",
        "信任资产差距",
        "内容矩阵缺口",
        "地域覆盖与本地资源差距",
        "商业预算竞争压力",
        "AI 答案进入门槛",
      ].map((name, index) => [name, { name, score: 8 + index, max: 15, level: "中等", analysis: `${name}需要持续投入。` }])),
      insights: ["竞品数量较多", "需要分阶段建设信源"],
      suggestions: ["先补齐核心问题和权威证据", "每月按同一问题池复测"],
      process: difficultyProcess,
      generatedAt,
      providerLabel: "多模型综合评估",
    },
  },
}

const pdf = await renderToBuffer(React.createElement(CommercialReportDocument, { input }) as Parameters<typeof renderToBuffer>[0])
assert.ok(pdf.length > 120_000, "四模块综合报告应成功渲染并包含完整图表与正文")

if (process.env.KEEP_REPORT_TEST_ARTIFACTS === "1") {
  const outputDir = path.join(process.cwd(), "tmp", "pdfs")
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(path.join(outputDir, "report-four-modules.pdf"), pdf)
}

console.log("four-module commercial PDF rendering passed")
