import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { Packer } from "docx"
import JSZip from "jszip"
import type * as WordExportModule from "../src/lib/geo-strategy/word-export"
import type { GeoStrategyPlan, QuestionItem } from "../src/types/geo-strategy"

const require = createRequire(import.meta.url)
const { createKeywordStrategyWordDocument } = require("../src/lib/geo-strategy/word-export.ts") as typeof WordExportModule

const plan: GeoStrategyPlan = {
  project_name: "测试品牌全国 GEO 策略",
  summary: "以可验证的官网信息、第三方信源和持续检测建立稳定的 AI 搜索可见度。",
  profile: {
    subject_type: "brand",
    brand_or_product: "测试品牌",
    industry: "企业服务",
    audience: "需要提升 AI 搜索可见度的企业管理者",
    product_description: "提供 GEO 检测、策略和内容执行服务。",
    business_goals: "提升跨模型稳定提及率与有效信源覆盖。",
    competitors: ["甲品牌", "乙品牌"],
    terms: ["全国", "杭州"],
    pain_points: ["AI 回答无法稳定提及", "信源缺少可验证网址"],
    advantages: ["提供多模型独立联网检测", "报告保留可点击的完整信源"],
    weaknesses: ["品牌公开资料仍需补齐"],
    scenes: ["项目启动前基线检测", "月度复盘"],
  },
  keyword_strategy: {
    core_keywords: [{ priority: "1", keyword: "GEO 服务", logic: "覆盖核心品类需求" }],
    pain_advantage_keywords: [{ priority: "1", keyword: "AI 搜索品牌不出现", logic: "承接显性问题" }],
    weakness_conversion_keywords: [{ priority: "2", keyword: "GEO 案例验证", logic: "用证据降低决策顾虑" }],
    scenario_keywords: [{ priority: "2", keyword: "企业 GEO 月报", logic: "覆盖持续运营场景" }],
  },
  official_site_strategy: [{ module: "问答中心", action: "建设可索引的 Q&A 页面", goal: "覆盖核心疑问句" }],
  third_party_site_strategy: [{
    priority: "1",
    site_type: "行业垂直平台",
    suggested_name: "企业 GEO 实践观察",
    positioning: "以实测案例解释 GEO 执行方法。",
    content_pillars: "检测、策略、内容与复盘。",
    weakness_conversion: "用公开方法与数据补足信任。",
    cross_validation_role: "与官网内容形成第三方佐证。",
  }],
  media_plan: [{
    platform: "搜狐",
    platform_type: "self_media",
    source_origin: "penetration_detected",
    adoption_rate: 42,
    role: "场景问题覆盖",
    keyword_focus: "企业 GEO 怎么做",
    sample_title: "企业开展 GEO 前应先检查哪些问题",
    cadence: "每周 2 篇",
  }],
  authority_media_plan: [{
    platform: "行业协会官网",
    platform_type: "government_association",
    source_origin: "system_recommended",
    role: "建立权威背书",
    keyword_focus: "AI 搜索优化规范",
    sample_title: "生成式 AI 搜索时代的企业内容建设",
    cadence: "每月 1 篇",
  }],
  source_platform_snapshot: {
    calculated_at: "2026-07-24T08:00:00.000Z",
    successful_answer_count: 12,
    successful_model_count: 4,
    total_citation_events: 18,
    platforms: [{
      platform_key: "sohu",
      platform: "搜狐",
      category: "self_media",
      domains: ["sohu.com"],
      answer_hits: 5,
      citation_events: 7,
      unique_url_count: 4,
      adoption_rate: 42,
      citation_share: 39,
      balanced_adoption_rate: 40,
      model_keys: ["doubao", "qwen", "kimi"],
      question_count: 4,
      evidence: [],
    }],
  },
  geo_monitoring_plan: [{ metric: "稳定提及率", method: "每月按同一问题池独立复测", target: "90 天达到 50%" }],
  execution_roadmap: [{ phase: "第 1 阶段", focus: "补齐基础信任资产", deliverable: "官网问答与资料库" }],
}

const questions: QuestionItem[] = [
  {
    id: "q-1",
    layer: "第一层",
    category: "品牌比较",
    difficulty: "中",
    keyword: "GEO 服务商",
    question: "企业选择 GEO 服务商时应该重点核验哪些能力？",
    intent: "比较筛选",
    content_angle: "服务能力与证据",
    matched_advantage: "提供多模型独立联网检测",
  },
  {
    id: "q-2",
    layer: "第一层",
    category: "风险顾虑",
    difficulty: "高",
    keyword: "GEO 信源",
    question: "如何确认 GEO 检测返回的信源是真实可访问的文章？",
    intent: "风险确认",
    content_angle: "信源审计",
  },
]

const logoData = new Uint8Array(await fs.readFile(path.join(process.cwd(), "public", "brand", "shitu-lockup-transparent-v2.png")))
const outputDir = path.join(process.cwd(), "tmp", "keyword-word")

for (const variant of ["strategy", "questions"] as const) {
  const document = createKeywordStrategyWordDocument({
    plan,
    questions,
    variant,
    logoData,
    generatedAt: new Date("2026-07-24T08:00:00.000Z"),
  })
  const buffer = await Packer.toBuffer(document)
  assert.equal(buffer.subarray(0, 2).toString(), "PK")
  assert.ok(buffer.length > 20_000, `${variant} DOCX 应包含品牌图像和完整内容`)

  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file("word/document.xml")?.async("string")
  const headerXml = await zip.file("word/header1.xml")?.async("string")
  const footerXml = await zip.file("word/footer1.xml")?.async("string")
  assert.ok(documentXml)
  assert.match(documentXml, /测试品牌全国 GEO 策略/)
  assert.match(documentXml, /疑问句池与优势匹配/)
  assert.match(documentXml, /提供多模型独立联网检测/)
  assert.match(headerXml || "", /势途 GEO/)
  assert.match(footerXml || "", /shitugeo\.top/)
  assert.ok(Object.keys(zip.files).some(name => /^word\/media\//.test(name)), "DOCX 应嵌入势途 Logo")

  if (process.env.KEEP_KEYWORD_WORD_ARTIFACTS === "1") {
    await fs.mkdir(outputDir, { recursive: true })
    await fs.writeFile(path.join(outputDir, `${variant}.docx`), buffer)
  }
}

console.log("keyword strategy branded DOCX exports passed")
