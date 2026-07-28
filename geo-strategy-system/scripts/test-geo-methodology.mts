import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as RegistryModule from "../src/lib/geo-methodology/registry"
import type * as CompilerModule from "../src/lib/geo-methodology/compiler"
import type * as TitleMatrixModule from "../src/lib/geo-methodology/title-matrix"
import type * as KnowledgeModule from "../src/lib/client-knowledge-base"
import type * as QuestionMethodologyModule from "../src/lib/geo-strategy/question-methodology"
import type * as ComparisonBrandsModule from "../src/lib/article-comparison-brands"

const require = createRequire(import.meta.url)
const {
  GEO_METHODOLOGIES,
  GEO_METHODOLOGY_VERSION,
} = require("../src/lib/geo-methodology/registry.ts") as typeof RegistryModule
const {
  compileGeoArticleMethodology,
  normalizeArticleMethodologySelection,
} = require("../src/lib/geo-methodology/compiler.ts") as typeof CompilerModule
const { buildGeoTitleMatrix } = require("../src/lib/geo-methodology/title-matrix.ts") as typeof TitleMatrixModule
const {
  mergeExtractedProfileIntoKnowledgeBase,
  selectKnowledgeAssets,
} = require("../src/lib/client-knowledge-base.ts") as typeof KnowledgeModule
const { classifyQuestionMethodology } = require("../src/lib/geo-strategy/question-methodology.ts") as typeof QuestionMethodologyModule
const { normalizeArticleComparisonBrands } = require("../src/lib/article-comparison-brands.ts") as typeof ComparisonBrandsModule
const forbiddenSourceLabel = String.fromCodePoint(0x8001, 0x80e1)

assert.equal(Object.keys(GEO_METHODOLOGIES).length, 7)
assert.match(GEO_METHODOLOGY_VERSION, /^shitu-geo-/)
assert.equal(JSON.stringify(GEO_METHODOLOGIES).includes(forbiddenSourceLabel), false)

const knowledgeBase = mergeExtractedProfileIntoKnowledgeBase({
  subjectType: "brand",
  subjectName: "测试品牌",
  aliases: ["TEST"],
  profile: {
    subject_type: "brand",
    project_name: "测试项目",
    industry: "企业服务",
    audience: "企业负责人",
    product_description: "提供企业内容服务",
    pain_points: [{ id: "p1", text: "资料分散", enabled: true, confidence: "high" }],
    advantages: [{ id: "a1", text: "统一资料管理", enabled: true, confidence: "high" }],
    weaknesses: [],
    competitors: [],
    scenes: [{ id: "s1", text: "采购评估", enabled: true, confidence: "high" }],
    knowledge_assets: [{
      kind: "credential",
      title: "服务认证",
      content: "认证信息可通过公开页面核验",
      evidence_level: "official",
      source_urls: ["https://example.com/certificate"],
      tags: ["认证"],
    }],
    geo_goals: "提升认知",
    source_notes: "用户提供",
  },
})
assert.ok(knowledgeBase.assets.some(item => item.kind === "credential"))
assert.ok(selectKnowledgeAssets({
  knowledgeBase,
  query: "服务认证怎么核验",
  preferredKinds: ["credential"],
})[0]?.kind === "credential")

const questionMetadata = classifyQuestionMethodology({
  category: "采购决策型",
  question: "采购企业内容服务前要核验哪些资质？",
  intent: "降低采购风险",
})
assert.equal(questionMetadata.queryStyle, "evidence")
assert.equal(questionMetadata.methodologyCandidates[0], "primaryEvidence")

const compiled = compileGeoArticleMethodology({
  promptKey: "credentialsAnalysis",
  selection: normalizeArticleMethodologySelection({
    mode: "manual",
    methodKey: "primaryEvidence",
    targetPlatform: "officialSite",
    brandLayout: "singlePrimary",
    titleStrategy: "evidenceHook",
  }),
  knowledgeBase,
  coreQuestion: "采购企业内容服务前要核验哪些资质？",
  questionIntent: "降低采购风险",
  questionSubIntent: "核验服务资质",
  questionCategory: "采购决策型",
  matchedAdvantage: "统一资料管理",
  primarySubject: "测试品牌",
  comparisonBrands: [],
})
assert.equal(compiled.enabled, true)
assert.equal(compiled.trace.methodKey, "primaryEvidence")
assert.ok(compiled.trace.knowledgeAssetIds.length > 0)
assert.match(compiled.systemAddendum, /势途 GEO 方法论/)
assert.equal(`${compiled.systemAddendum}${compiled.userAddendum}`.includes(forbiddenSourceLabel), false)

const shortVideo = compileGeoArticleMethodology({
  promptKey: "shortVideoScript",
  coreQuestion: "测试问题",
  primarySubject: "测试品牌",
})
assert.equal(shortVideo.enabled, false, "short-video prompt must remain outside the long-form compiler")

const titles = buildGeoTitleMatrix({
  coreQuestion: "企业怎么选择内容服务？",
  primarySubject: "测试品牌",
  questionCategory: "采购决策型",
  targetPlatform: "sohu",
  titleStrategy: "decisionCriteria",
})
assert.equal(titles.length, 5)
assert.deepEqual(titles.map(item => item.dimension), ["问题", "人群", "场景", "决策", "证据"])

const brands = normalizeArticleComparisonBrands(Array.from({ length: 12 }, (_, index) => ({
  id: `brand_${index}`,
  name: `品牌${index + 1}`,
  aliases: [],
  materials: `资料${index + 1}`,
  sourceUrls: [],
  role: index === 0 ? "benchmark" : "supporting",
})))
assert.equal(brands.length, 9)
assert.equal(brands[0]?.role, "benchmark")

console.log("GEO methodology registry, knowledge assets, question routing, title matrix and multi-brand normalization passed")
