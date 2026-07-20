import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type { ModelKey, PenetrationItem, PenetrationResult, PenetrationSource } from "../src/types"
import type { GeoStrategyPlan } from "../src/types/geo-strategy"
import type * as SourcePlatformModule from "../src/lib/source-platform-intelligence"

const require = createRequire(import.meta.url)
const {
  buildSourcePlatformSnapshot,
  linkStrategyToSourcePlatforms,
} = require("../src/lib/source-platform-intelligence.ts") as typeof SourcePlatformModule

function source(url: string, title: string): PenetrationSource {
  return {
    title,
    snippet: `${title} 的可读取文章摘要，用于信源采信率回归测试。`,
    url,
    domain: new URL(url).hostname,
    query: "测试问题",
  }
}

function answer(sampleId: string, question: string, sources: PenetrationSource[]): PenetrationItem {
  return {
    sampleId,
    sampledAt: new Date().toISOString(),
    question,
    answer: `这是 ${sampleId} 的独立联网原始回答。`,
    mentionedBrands: [],
    topRecommended: null,
    searchSources: sources,
    webVerified: true,
    webExecutionVerified: true,
    hitOur: false,
  }
}

const sohuUrl = "https://www.sohu.com/a/123456789_100001?utm_source=test"
const byModel: Partial<Record<ModelKey, PenetrationItem[]>> = {
  doubao: [
    answer("doubao-1", "问题一", [
      source(sohuUrl, "搜狐行业文章"),
      source(sohuUrl, "同一次回答重复返回的搜狐文章"),
      source("https://p1.itc.cn/images/logo.png", "搜狐图片资源"),
    ]),
    {
      ...answer("doubao-failed", "失败问题", [source("https://blog.csdn.net/test/article/details/1", "CSDN文章")]),
      answer: "",
    },
  ],
  qwen: [
    answer("qwen-1", "问题二", [source(sohuUrl, "另一模型采信同一篇搜狐文章")]),
    answer("qwen-2", "问题三", [
      source("https://blog.csdn.net/test/article/details/2", "CSDN技术文章"),
      source("https://finance.people.com.cn/n1/2026/0717/c1004-1.html", "人民网行业报道"),
    ]),
  ],
  kimi: [
    answer("kimi-1", "问题四", [
      source("https://www.tubatu.com/yezhu/z12345.html", "土巴兔装修指南"),
      source("https://m.sohu.com/a/987654321_100002", "搜狐场景文章一"),
      source("https://m.sohu.com/a/987654322_100002", "搜狐场景文章二"),
      source("https://www.hangzhou.gov.cn/art/2026/7/17/art_1_1.html", "杭州市政府公开信息"),
    ]),
  ],
}

const penetration: PenetrationResult = {
  byModel,
  aggregated: {
    penetrationRate: 0,
    ourMentions: 0,
    totalSlots: 5,
    industryShare: [],
    ourRanking: null,
    perModelRate: [],
    missedQuestions: [],
    topCompetitors: [],
  },
  generatedAt: "2026-07-17T08:00:00.000Z",
}

const snapshot = buildSourcePlatformSnapshot(penetration)
assert.equal(snapshot.successful_answer_count, 4, "失败或无原始回答的模型结果不得进入采信率分母")
assert.equal(snapshot.successful_model_count, 3)
assert.equal(snapshot.total_citation_events, 8)
assert.equal(snapshot.unique_url_count, 7, "跨模型重复引用不得伪装成新的唯一网址")
assert.equal(snapshot.unique_domain_count, 6)
assert.equal(snapshot.semantic_intent_count, 4)
assert.equal(snapshot.platforms.some(platform => platform.domains.some(domain => domain === "p1.itc.cn")), false)

const sohu = snapshot.platforms.find(platform => platform.platform_key === "sohu")
assert.ok(sohu)
assert.equal(sohu.answer_hits, 3, "同一网址被不同独立回答采信时必须分别计入回答命中")
assert.equal(sohu.citation_events, 4, "同一次回答内重复网址只计一次，不同网址与不同回答分别计入")
assert.equal(sohu.unique_url_count, 3)
assert.equal(sohu.adoption_rate, 75)
assert.equal(sohu.intent_count, 3)
assert.equal(sohu.intent_adoption_rate, 75)
assert.equal(sohu.category_count, 1)
assert.deepEqual(sohu.model_keys, ["doubao", "kimi", "qwen"])

const csdn = snapshot.platforms.find(platform => platform.platform_key === "csdn")
assert.ok(csdn)
assert.equal(csdn.answer_hits, 1)
assert.equal(csdn.adoption_rate, 25)

const tubatu = snapshot.platforms.find(platform => platform.platform_key === "tubatu")
assert.equal(tubatu?.category, "industry_vertical")
const people = snapshot.platforms.find(platform => platform.platform_key === "people")
assert.equal(people?.category, "authority_media")
const government = snapshot.platforms.find(platform => platform.platform_key.startsWith("government:"))
assert.equal(government?.category, "government_association")

const generatedPlan: GeoStrategyPlan = {
  project_name: "测试品牌 GEO 策略",
  summary: "测试策略",
  profile: {
    brand_or_product: "测试品牌",
    industry: "装修行业",
    audience: "装修业主",
    product_description: "测试产品",
    business_goals: "提升采信率",
    competitors: [],
    terms: [],
    pain_points: [],
    advantages: [],
    weaknesses: [],
    scenes: [],
  },
  keyword_strategy: {
    core_keywords: [{ priority: "1", keyword: "装修公司怎么选", logic: "覆盖核心需求" }],
    pain_advantage_keywords: [],
    weakness_conversion_keywords: [],
    scenario_keywords: [],
  },
  official_site_strategy: [],
  third_party_site_strategy: [],
  media_plan: [
    {
      platform_key: "sohu",
      platform: "搜狐号",
      role: "发布行业问答",
      keyword_focus: "装修选择",
      sample_title: "装修怎么选",
      cadence: "每周两篇",
    },
    {
      platform: "知乎",
      role: "补充问答",
      keyword_focus: "装修知识",
      sample_title: "装修避坑",
      cadence: "每周一篇",
    },
  ],
  authority_media_plan: [],
  geo_monitoring_plan: [],
  execution_roadmap: [],
}

const linked = linkStrategyToSourcePlatforms(generatedPlan, snapshot)
for (const platformKey of ["sohu", "csdn", "tubatu"]) {
  const item = linked.media_plan.find(candidate => candidate.platform_key === platformKey)
  assert.ok(item, `${platformKey} 检测命中后必须进入自媒体/行业平台策略`)
  assert.equal(item.source_origin, "penetration_detected")
}
assert.equal(linked.media_plan.find(item => item.platform_key === "zhihu")?.source_origin, "system_recommended")
assert.ok(linked.authority_media_plan?.some(item => item.platform_key === "people"))
assert.ok(linked.authority_media_plan?.some(item => item.platform_key?.startsWith("government:")))
assert.equal(linked.authority_media_plan?.some(item => item.platform_key === "people" && item.platform_type === "authority_media"), true)
assert.equal(linked.source_platform_snapshot?.successful_answer_count, 4)

console.log("source platform intelligence regression tests passed")
