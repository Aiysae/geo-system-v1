import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import type { CommercialReportInput } from "../src/types"
import type { GeoStrategyPlan, QuestionItem } from "../src/types/geo-strategy"

const require = createRequire(import.meta.url)
const React = require("react") as typeof import("react")
const { renderToBuffer } = require("@react-pdf/renderer") as typeof import("@react-pdf/renderer")
const { CommercialReportDocument } = require("../src/lib/reports/commercial-report-document.tsx") as typeof import("../src/lib/reports/commercial-report-document")

const generatedAt = "2026-08-01T08:00:00.000Z"
const categories = ["品牌认知", "产品比较", "场景需求", "价格决策", "信任验证", "风险规避", "购买决策"]

const questions: QuestionItem[] = Array.from({ length: 600 }, (_, index) => ({
  id: `question-${index + 1}`,
  category: categories[index % categories.length],
  difficulty: index % 3 === 0 ? "高" : index % 3 === 1 ? "中" : "低",
  keyword: `GEO 测试关键词 ${index % 40 + 1}`,
  question: `批量疑问句 ${index + 1}：企业在第 ${index % 12 + 1} 个业务场景中应该如何判断 GEO 服务方案是否值得长期投入？`,
  intent: `验证第 ${index % 7 + 1} 类用户决策意图`,
  decisionDimension: `决策维度 ${index % 10 + 1}`,
  content_angle: `结合公开证据、实际执行流程和阶段验收标准回答问题 ${index + 1}。`,
  matched_advantage: `匹配优势 ${index % 8 + 1}：提供可核验的多模型检测、来源索引和持续复测记录。`,
  userStage: index % 2 === 0 ? "比较期" : "决策期",
  geo_optimization: {
    keyword_placement: "标题和首段自然出现核心关键词",
    conclusion_first: "先给明确结论，再解释判断依据",
    structure_format: "结论、证据、场景、行动建议",
    long_tail_terms: [`长尾词 ${index + 1}`, "AI 搜索可见度", "GEO 服务选择"],
  },
}))

const keywordItem = (prefix: string, index: number) => ({
  priority: index < 3 ? "P0" : index < 7 ? "P1" : "P2",
  keyword: `${prefix} ${index + 1}`,
  logic: `围绕${prefix}的用户决策需求、证据缺口与内容覆盖机会进行布局。`,
})

const plan: GeoStrategyPlan = {
  project_name: "600 条疑问句关键词策略压力测试",
  summary: "以四类关键词为起点，连接真实疑问句、优势匹配、信源平台和阶段执行动作。",
  profile: {
    brand_or_product: "测试品牌",
    industry: "企业级 GEO 服务",
    audience: "需要提升 AI 搜索可见度的企业",
    product_description: "提供检测、策略、内容与持续复测服务。",
    business_goals: "形成稳定、可核验的 AI 推荐心智。",
    competitors: ["甲品牌", "乙品牌"],
    terms: ["GEO", "AI 搜索优化"],
    pain_points: ["不知道模型为什么不提及品牌", "缺少可点击来源"],
    advantages: ["多模型独立检测", "信源可审计", "持续复测"],
    weaknesses: ["公开案例仍需积累"],
    scenes: ["服务商选型", "竞品比较", "预算决策"],
  },
  keyword_strategy: {
    core_keywords: Array.from({ length: 10 }, (_, index) => keywordItem("核心关键词", index)),
    pain_advantage_keywords: Array.from({ length: 10 }, (_, index) => keywordItem("痛点优势词", index)),
    weakness_conversion_keywords: Array.from({ length: 10 }, (_, index) => keywordItem("劣势转化词", index)),
    scenario_keywords: Array.from({ length: 10 }, (_, index) => keywordItem("场景需求词", index)),
  },
  official_site_strategy: [
    { module: "解决方案中心", action: "按行业与场景建立可检索专题页。", goal: "形成清晰的主题权威结构。" },
    { module: "证据中心", action: "公开案例、方法与复测记录。", goal: "提高可验证性。" },
  ],
  third_party_site_strategy: [{
    priority: "P0",
    site_type: "行业知识站",
    suggested_name: "AI 搜索实践库",
    positioning: "以行业实践与决策指南提供第三方信息补充。",
    content_pillars: "选型、测评、案例、避坑",
    cross_validation_role: "与官网事实形成交叉验证。",
  }],
  media_plan: [{
    platform: "搜狐",
    platform_type: "self_media",
    source_origin: "penetration_detected",
    evidence_domains: ["sohu.com"],
    answer_hits: 8,
    citation_events: 12,
    adoption_rate: 60,
    model_coverage: 4,
    question_coverage: 7,
    role: "发布行业决策与场景内容。",
    keyword_focus: "GEO 服务商选型",
    sample_title: "企业应该如何选择 GEO 服务商",
    cadence: "每周 2 篇",
  }],
  authority_media_plan: [{
    platform: "行业协会网站",
    platform_type: "government_association",
    source_origin: "system_recommended",
    role: "承载权威事实与标准说明。",
    keyword_focus: "AI 搜索行业标准",
    sample_title: "生成式搜索环境下的企业信息建设",
    cadence: "每月 1 篇",
  }],
  source_platform_snapshot: {
    calculated_at: generatedAt,
    successful_answer_count: 20,
    successful_model_count: 4,
    total_citation_events: 30,
    distinct_question_count: 10,
    semantic_intent_count: 7,
    unique_url_count: 18,
    unique_domain_count: 6,
    duplicate_citation_rate: 0.4,
    sample_confidence: "high",
    platforms: [
      {
        platform_key: "sohu",
        platform: "搜狐",
        category: "self_media",
        domains: ["sohu.com"],
        answer_hits: 8,
        citation_events: 12,
        unique_url_count: 5,
        adoption_rate: 60,
        citation_share: 40,
        balanced_adoption_rate: 55,
        model_keys: ["doubao", "qwen", "kimi"],
        question_count: 7,
        evidence: [{
          title: "企业 GEO 服务选择指南",
          url: "https://www.sohu.com/a/geo-test-1",
          domain: "sohu.com",
          model: "doubao",
          question: "企业应该如何选择 GEO 服务商？",
        }],
      },
      {
        platform_key: "csdn",
        platform: "CSDN",
        category: "industry_vertical",
        domains: ["csdn.net"],
        answer_hits: 5,
        citation_events: 9,
        unique_url_count: 4,
        adoption_rate: 45,
        citation_share: 30,
        balanced_adoption_rate: 42,
        model_keys: ["qwen", "kimi"],
        question_count: 5,
        evidence: [{
          title: "AI 搜索可见度实践",
          url: "https://blog.csdn.net/example/article/details/10001",
          domain: "csdn.net",
          model: "qwen",
          question: "如何提升品牌在 AI 回答中的提及率？",
        }],
      },
    ],
  },
  geo_monitoring_plan: [{ metric: "品牌稳定提及率", method: "按固定问题池进行多模型复测", target: "连续三次达到 50%", cadence: "每周" }],
  execution_roadmap: [
    { phase: "第 1-2 周", focus: "建立基线与关键词矩阵", deliverable: "问题池、证据清单、渠道优先级" },
    { phase: "第 3-6 周", focus: "内容与信源上线", deliverable: "官网专题、媒体内容、第三方证据" },
    { phase: "第 7-12 周", focus: "复测与迭代", deliverable: "周报、月报和优化清单" },
  ],
  strategy_engine_version: "keyword-strategy-v3",
  generation_settings: {
    target_region: "全国",
    language_style: "mainland_simplified",
    custom_keywords: ["GEO 全链路工具"],
  },
  keyword_research: {
    methodology_version: "keyword-research-v1",
    provider: "doubao",
    model: "doubao-seed-2-0-pro",
    target_region: "全国",
    language_style: "mainland_simplified",
    searched_at: generatedAt,
    search_executed: true,
    query: "企业 GEO 服务用户真实搜索表达",
    brief: "用户主要关心可验证效果、执行成本、内容质量和持续复测。",
    user_language_patterns: ["哪家好", "怎么选", "值不值得"],
    decision_signals: ["案例", "信源", "成本", "周期"],
    regional_expressions: ["全国"],
    sources: [{
      title: "企业 AI 搜索优化趋势",
      url: "https://example.com/keyword-research",
      domain: "example.com",
    }],
  },
  quality_audit: {
    checked_at: generatedAt,
    methodology_version: "keyword-quality-v1",
    keyword_count: 40,
    duplicate_keyword_count: 0,
    missing_keyword_logic_count: 0,
    custom_keyword_count: 1,
    covered_custom_keyword_count: 1,
    valid_source_count: 3,
    seven_category_ready: true,
    passed: true,
    notes: ["四类关键词结构完整", "七类问题意图已覆盖"],
  },
  website_prompts: {
    official: `官网执行指令\n${"建立结构清晰、证据可核验的页面内容。\n".repeat(180)}`,
    third_party: {
      0: `第三方网站执行指令\n${"围绕用户真实问题组织选型、比较与案例内容。\n".repeat(120)}`,
    },
    updated_at: generatedAt,
  },
}

const input: CommercialReportInput = {
  kind: "keyword",
  detail: "full",
  client: {
    id: "keyword-report-600-client",
    name: "关键词策略报告测试客户",
    subjectType: "brand",
    ourBrand: "测试品牌",
    brandAliases: ["Test Brand"],
    industry: "企业级 GEO 服务",
    website: "https://example.com",
  },
  keyword: {
    strategyPlan: plan,
    questions,
    strategyGeneratedAt: generatedAt,
    questionsGeneratedAt: generatedAt,
    totalQuestionCount: questions.length,
  },
}

const documentElement = CommercialReportDocument({ input }) as React.ReactElement<{ children?: React.ReactNode }>
const sectionNames: string[] = []
React.Children.forEach(documentElement.props.children, child => {
  if (React.isValidElement(child) && typeof child.type === "function") sectionNames.push(child.type.name)
})
for (const name of [
  "KeywordOverviewPage",
  "KeywordMatrixPages",
  "KeywordPlatformPage",
  "KeywordPlatformTablePages",
  "KeywordExecutionPages",
  "KeywordQuestionPages",
  "KeywordPromptPages",
  "KeywordEvidencePages",
]) {
  assert.ok(sectionNames.includes(name), `关键词策略报告应包含 ${name}`)
}
assert.ok(sectionNames.indexOf("KeywordQuestionPages") < sectionNames.indexOf("ActionPage"), "疑问句明细应位于行动路线之前")
assert.ok(sectionNames.indexOf("KeywordEvidencePages") > sectionNames.indexOf("AppendixPages"), "关键词证据应位于报告末尾证据区")
assert.ok(sectionNames.indexOf("KeywordEvidencePages") < sectionNames.indexOf("ClosingPage"), "关键词证据应位于封底之前")

const pdf = await renderToBuffer(React.createElement(CommercialReportDocument, { input }) as Parameters<typeof renderToBuffer>[0])
assert.ok(pdf.length > 300_000, "600 条疑问句关键词策略 PDF 应成功渲染")

const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
const parsed = await getDocument({ data: new Uint8Array(pdf) }).promise
assert.ok(parsed.numPages >= 60, `600 条疑问句应形成完整分页，当前仅 ${parsed.numPages} 页`)

let foundLastQuestion = false
const seenQuestionNumbers = new Set<number>()
for (let pageNumber = 1; pageNumber <= parsed.numPages; pageNumber += 1) {
  const page = await parsed.getPage(pageNumber)
  const content = await page.getTextContent()
  const text = content.items.map(item => "str" in item ? item.str : "").join("")
  const pageQuestionNumbers = Array.from(text.matchAll(/批量疑问句\s*(\d+)/g), match => Number(match[1]))
  for (const questionNumber of pageQuestionNumbers) seenQuestionNumbers.add(questionNumber)
  if (pageQuestionNumbers.length > 0) {
    assert.ok(text.includes("QUESTION STRATEGY"), `疑问句第 ${pageNumber} 页不应出现无章节标题的自动溢出页`)
    assert.ok(text.includes("疑问句与优势匹配明细"), `疑问句第 ${pageNumber} 页应保留中文章节标题`)
    assert.ok(text.replace(/\s+/g, "").includes("势途GEO"), `疑问句第 ${pageNumber} 页应保留报告页眉`)
  }
  if (text.includes("批量疑问句 600")) {
    foundLastQuestion = true
  }
}
assert.equal(foundLastQuestion, true, "完整证据版必须包含第 600 条疑问句")
assert.equal(seenQuestionNumbers.size, 600, "完整证据版必须逐条保留 600 条疑问句")

if (process.env.KEEP_REPORT_TEST_ARTIFACTS === "1") {
  const outputDir = path.join(process.cwd(), "tmp", "pdfs")
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(path.join(outputDir, "report-keyword-600.pdf"), pdf)
}

console.log(`keyword commercial PDF rendering passed: ${parsed.numPages} pages, ${pdf.length} bytes`)
