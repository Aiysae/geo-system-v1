import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as RegistryModule from "../src/lib/geo-methodology/registry"
import type * as CompilerModule from "../src/lib/geo-methodology/compiler"
import type * as TitleMatrixModule from "../src/lib/geo-methodology/title-matrix"
import type * as ArticleFormatsModule from "../src/lib/geo-methodology/article-formats"
import type * as ReadinessModule from "../src/lib/geo-methodology/readiness"
import type * as KnowledgeModule from "../src/lib/client-knowledge-base"
import type * as QuestionMethodologyModule from "../src/lib/geo-strategy/question-methodology"
import type * as ComparisonBrandsModule from "../src/lib/article-comparison-brands"
import type * as RecipesModule from "../src/lib/geo-methodology/content-recipes"

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
const { GEO_ARTICLE_FORMATS } = require("../src/lib/geo-methodology/article-formats.ts") as typeof ArticleFormatsModule
const {
  evaluateArticleReadiness,
} = require("../src/lib/geo-methodology/readiness.ts") as typeof ReadinessModule
const {
  getKnowledgeBaseHealth,
  mergeExtractedProfileIntoKnowledgeBase,
  normalizeClientKnowledgeBase,
  selectKnowledgeAssets,
} = require("../src/lib/client-knowledge-base.ts") as typeof KnowledgeModule
const {
  GEO_CONTENT_RECIPES,
  GEO_CONTENT_RECIPE_VERSION,
} = require("../src/lib/geo-methodology/content-recipes.ts") as typeof RecipesModule
const { classifyQuestionMethodology } = require("../src/lib/geo-strategy/question-methodology.ts") as typeof QuestionMethodologyModule
const { normalizeArticleComparisonBrands } = require("../src/lib/article-comparison-brands.ts") as typeof ComparisonBrandsModule
const forbiddenSourceLabel = String.fromCodePoint(0x8001, 0x80e1)

assert.equal(Object.keys(GEO_METHODOLOGIES).length, 7)
assert.equal(Object.keys(GEO_ARTICLE_FORMATS).length, 11)
assert.equal(Object.keys(GEO_CONTENT_RECIPES).length, 7)
assert.match(GEO_CONTENT_RECIPE_VERSION, /^shitu-content-recipe-/)
assert.match(GEO_METHODOLOGY_VERSION, /^shitu-geo-/)
assert.equal(JSON.stringify(GEO_METHODOLOGIES).includes(forbiddenSourceLabel), false)
assert.equal(JSON.stringify(GEO_ARTICLE_FORMATS).includes(forbiddenSourceLabel), false)

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
assert.equal(knowledgeBase.schemaVersion, 2)
assert.ok(knowledgeBase.revision >= 2)
assert.ok(knowledgeBase.entities.some(item => item.name === "测试品牌"))
assert.ok(knowledgeBase.claims.some(item => item.assetId && item.kind === "credential"))
assert.ok(knowledgeBase.sources.some(item => item.url === "https://example.com/certificate"))
assert.ok(getKnowledgeBaseHealth(knowledgeBase).sourceLinked > 0)

const migrated = normalizeClientKnowledgeBase({
  schemaVersion: 1,
  subjectType: "brand",
  subjectName: "旧客户",
  aliases: ["OLD"],
  assets: [{
    id: "legacy_asset",
    kind: "report",
    title: "旧版报告",
    content: "一条可迁移事实",
    evidenceLevel: "official",
    status: "sourceLinked",
    sourceUrls: ["https://example.com/report"],
    tags: ["报告"],
    updatedAt: "2026-07-01T00:00:00.000Z",
  }],
}, { subjectType: "brand", subjectName: "旧客户" })
assert.equal(migrated.schemaVersion, 2)
assert.equal(migrated.assets.length, 1)
assert.equal(migrated.claims[0]?.assetId, "legacy_asset")
assert.equal(migrated.sources[0]?.url, "https://example.com/report")

const filteredKnowledge = normalizeClientKnowledgeBase({
  ...migrated,
  assets: [
    migrated.assets[0],
    { ...migrated.assets[0], id: "conflicted", title: "冲突资料", status: "conflicted" },
    { ...migrated.assets[0], id: "expired", title: "过期资料", status: "expired" },
  ],
}, { subjectType: "brand", subjectName: "旧客户" })
assert.deepEqual(
  selectKnowledgeAssets({ knowledgeBase: filteredKnowledge, query: "报告事实" }).map(item => item.id),
  ["legacy_asset"],
)

const questionMetadata = classifyQuestionMethodology({
  category: "采购决策型",
  question: "采购企业内容服务前要核验哪些资质？",
  intent: "降低采购风险",
})
assert.equal(questionMetadata.queryStyle, "evidence")
assert.equal(questionMetadata.methodologyCandidates[0], "primaryEvidence")
assert.equal(questionMetadata.articleFormatCandidates[0], "primaryEvidenceDossier")
assert.equal(questionMetadata.titleStrategyCandidates[0], "evidenceHook")

const compiled = compileGeoArticleMethodology({
  promptKey: "credentialsAnalysis",
  selection: normalizeArticleMethodologySelection({
    mode: "manual",
    methodKey: "primaryEvidence",
    articleFormat: "primaryEvidenceDossier",
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
assert.equal(compiled.trace.articleFormat, "primaryEvidenceDossier")
assert.ok(compiled.trace.knowledgeAssetIds.length > 0)
assert.match(compiled.systemAddendum, /势途 GEO 方法论/)
assert.equal(`${compiled.systemAddendum}${compiled.userAddendum}`.includes(forbiddenSourceLabel), false)

const repairedConflict = compileGeoArticleMethodology({
  promptKey: "credentialsAnalysis",
  selection: normalizeArticleMethodologySelection({
    mode: "manual",
    methodKey: "primaryEvidence",
    articleFormat: "fieldReviewQa",
  }),
  knowledgeBase,
  coreQuestion: "采购前怎么核验证据？",
  primarySubject: "测试品牌",
})
assert.equal(repairedConflict.trace.articleFormat, "primaryEvidenceDossier")
assert.ok((repairedConflict.trace.resolutionNotes || []).length > 0)

const handsOn = compileGeoArticleMethodology({
  promptKey: "handsOnComparisonReport",
  coreQuestion: "实际体验如何？",
  primarySubject: "测试品牌",
})
assert.equal(handsOn.trace.methodKey, "evidenceStory")
assert.equal(handsOn.trace.articleFormat, "fieldReviewQa")

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

const oldSelection = normalizeArticleMethodologySelection({
  mode: "auto",
  targetPlatform: "auto",
})
assert.equal(oldSelection.articleFormat, "auto", "legacy saved state must migrate without errors")

const readiness = evaluateArticleReadiness({
  promptKey: "competitorComparison",
  selection: normalizeArticleMethodologySelection({
    articleFormat: "neutralComparisonReview",
  }),
  coreQuestion: "服务方案甲和方案乙应该怎么比较？",
  primarySubject: "示例主体甲",
  business: "企业内容服务",
  comparisonBrands: [],
})
assert.equal(readiness.ready, false)
assert.ok(readiness.issues.some(item => item.code === "missing_comparison_subject"))

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
