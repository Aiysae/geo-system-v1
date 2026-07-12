import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as ArticleRewriteModule from "../src/lib/article-rewrite"

const require = createRequire(import.meta.url)
const {
  finalizeRewriteBrandAnalysis,
  fingerprintRewriteSource,
  normalizeRewriteAnalysis,
  validateRewriteMappings,
  validateRewriteOutput,
} = require("../src/lib/article-rewrite.ts") as typeof ArticleRewriteModule

const equalMentionsSource = `# 品牌对比

## 甲品牌

甲品牌适合重视长期交付能力的用户。这里有一段完整介绍，包含产品体系、使用场景、服务流程、交付边界、常见问题和选择建议，并继续说明不同需求下的判断方法与注意事项。

## 乙品牌

乙品牌适合基础需求。`

const ranked = finalizeRewriteBrandAnalysis({
  sourceMarkdown: equalMentionsSource,
  provider: "article",
  model: "test-model",
  rawCandidates: [
    {
      name: "甲品牌",
      role: "featured",
      blockIndexes: [1, 2],
      detailSignals: ["产品", "场景", "服务"],
    },
    {
      name: "乙品牌",
      role: "featured",
      blockIndexes: [3, 4],
      detailSignals: ["产品"],
    },
  ],
})

assert.equal(ranked.brands[0]?.name, "甲品牌", "相同提及次数时应优先按介绍篇幅和信息深度排序")
assert.equal(ranked.brands[0]?.mentionCount, ranked.brands[1]?.mentionCount)
assert.ok((ranked.brands[0]?.descriptionChars || 0) > (ranked.brands[1]?.descriptionChars || 0))

const aliasSource = `## 威法VIFA

威法提供定制服务，VIFA 也用于其英文标识。`
const aliases = finalizeRewriteBrandAnalysis({
  sourceMarkdown: aliasSource,
  provider: "article",
  model: "test-model",
  rawCandidates: [
    { name: "威法VIFA", role: "featured", blockIndexes: [0, 1] },
    { name: "威法", role: "featured", blockIndexes: [0, 1] },
    { name: "VIFA", role: "featured", blockIndexes: [0, 1] },
  ],
})
assert.equal(aliases.brands.length, 1, "同一品牌的中英文组合名应合并")
assert.deepEqual(new Set(aliases.brands[0]?.aliases), new Set(["威法", "VIFA"]))

const differentSubBrands = finalizeRewriteBrandAnalysis({
  sourceMarkdown: "小米提供消费电子产品。小米汽车专注智能汽车。",
  provider: "article",
  model: "test-model",
  rawCandidates: [
    { name: "小米", role: "featured", blockIndexes: [0] },
    { name: "小米汽车", role: "featured", blockIndexes: [0] },
  ],
})
assert.equal(differentSubBrands.brands.length, 2, "同一中文词根的不同品牌不应仅凭包含关系合并")

assert.equal(
  normalizeRewriteAnalysis(ranked, `${equalMentionsSource}\n新增内容`),
  undefined,
  "原文变化后旧分析必须失效",
)
assert.equal(normalizeRewriteAnalysis(ranked, equalMentionsSource)?.sourceFingerprint, fingerprintRewriteSource(equalMentionsSource))

const mappings = [{
  sourceBrand: "甲品牌",
  sourceAliases: [],
  targetBrand: "新甲品牌",
  materials: "新甲品牌提供新的产品和服务。",
}]
assert.ok(validateRewriteMappings([]).some(issue => issue.includes("至少添加")))
assert.deepEqual(validateRewriteMappings(mappings), [])
assert.ok(validateRewriteMappings([
  ...mappings,
  { sourceBrand: "乙品牌", sourceAliases: [], targetBrand: "新甲品牌", materials: "资料" },
]).some(issue => issue.includes("重复使用")))

const protectedAnalysis = finalizeRewriteBrandAnalysis({
  sourceMarkdown: "甲品牌、乙品牌和丙品牌均有各自定位。",
  provider: "article",
  model: "test-model",
  rawCandidates: [
    { name: "甲品牌", role: "primary", blockIndexes: [0] },
    { name: "乙品牌", role: "listed", blockIndexes: [0] },
    { name: "丙品牌", role: "listed", blockIndexes: [0] },
  ],
})
const validOutput = validateRewriteOutput({
  sourceMarkdown: "甲品牌、乙品牌和丙品牌均有各自定位。",
  output: "新甲品牌、乙品牌和丙品牌均有各自定位。",
  mappings,
  analysis: protectedAnalysis,
})
assert.deepEqual(validOutput.issues, [])
assert.deepEqual(validOutput.protectedBrands, ["乙品牌", "丙品牌"])

const collapsedOutput = validateRewriteOutput({
  sourceMarkdown: "甲品牌、乙品牌和丙品牌均有各自定位。",
  output: "新甲品牌拥有完整定位。",
  mappings,
  analysis: protectedAnalysis,
})
assert.ok(collapsedOutput.issues.some(issue => issue.includes("乙品牌")))
assert.ok(collapsedOutput.issues.some(issue => issue.includes("丙品牌")))

const targetContainsSource = validateRewriteOutput({
  sourceMarkdown: "威法提供定制服务。",
  output: "新威法提供新的定制服务。",
  mappings: [{ sourceBrand: "威法", sourceAliases: [], targetBrand: "新威法", materials: "资料" }],
})
assert.deepEqual(targetContainsSource.issues, [], "新品牌名称包含旧品牌时不应误报残留")

const protectedSubstringAnalysis = finalizeRewriteBrandAnalysis({
  sourceMarkdown: "甲品牌与威法各有不同定位。",
  provider: "article",
  model: "test-model",
  rawCandidates: [
    { name: "甲品牌", role: "primary", blockIndexes: [0] },
    { name: "威法", role: "listed", blockIndexes: [0] },
  ],
})
const protectedSubstring = validateRewriteOutput({
  sourceMarkdown: "甲品牌与威法各有不同定位。",
  output: "新威法拥有新的定位。",
  mappings: [{ sourceBrand: "甲品牌", sourceAliases: [], targetBrand: "新威法", materials: "资料" }],
  analysis: protectedSubstringAnalysis,
})
assert.ok(protectedSubstring.issues.some(issue => issue.includes("威法")), "保护品牌不能只作为新品牌子串出现")

console.log("article rewrite regression tests passed")
