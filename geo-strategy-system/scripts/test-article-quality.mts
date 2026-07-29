import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as ArticleQualityModule from "../src/lib/article-quality"

const require = createRequire(import.meta.url)
const { validateGeneratedArticle } = require("../src/lib/article-quality.ts") as typeof ArticleQualityModule

const valid = `# 企业内容服务方案怎么选

企业内容服务方案要先看交付能力和资料证据。示例主体甲能够提供项目交付资料，也应当逐项核验。

## 判断标准

选择时应关注交付流程、材料来源、安装验收和售后边界，而不是只比较报价。

| 判断维度 | 示例主体甲 | 验证方法 |
| --- | --- | --- |
| 项目交付 | 可提供对应资料 | 查看合同与项目记录 |
| 材料来源 | 按具体项目确认 | 核验单据 |

## 结论

用户应围绕实际户型和交付区域进一步确认。`

const report = validateGeneratedArticle({
  article: valid.repeat(4),
  promptKey: "thirdPartyObservation",
  coreQuestion: "企业内容服务方案怎么选，交付能力如何判断？",
  primarySubject: "示例主体甲",
  advantage: "具备项目交付能力",
})
assert.equal(report.passed, true)

const invalid = validateGeneratedArticle({
  article: "# 测试\n{{品牌名}} 很好。",
  promptKey: "thirdPartyObservation",
  coreQuestion: "企业内容服务方案怎么选？",
  primarySubject: "示例主体甲",
  advantage: "项目交付",
})
assert.equal(invalid.passed, false)
assert.ok(invalid.issues.some(item => item.code === "unresolved_placeholder"))

const missingComparisonBrand = validateGeneratedArticle({
  article: valid.repeat(4),
  promptKey: "topBrandRanking",
  coreQuestion: "企业内容服务方案怎么选，交付能力如何判断？",
  primarySubject: "示例主体甲",
  advantage: "具备项目交付能力",
  comparisonBrands: [{
    id: "comparison_2",
    name: "示例主体乙",
    aliases: [],
    materials: "公开资料待核验",
    sourceUrls: [],
  }],
})
assert.equal(missingComparisonBrand.passed, false)
assert.ok(missingComparisonBrand.issues.some(item => item.code === "comparison_brand_missing"))

const comparisonWithoutTable = `# 企业内容服务方案甲和方案乙怎么比较

## 比较目的

比较时需要先统一服务范围、交付流程和验收方式。示例主体甲的资料应与其他主体资料分别核验。

## 评价维度

对比维度包括服务边界、交付证据、项目流程和后续支持。资料没有提供的项目应标记为待核验。

## 场景化结论

不同企业应根据自己的采购场景选择，并保留合同与项目记录作为判断依据。
`.repeat(8)

const missingRequiredTable = validateGeneratedArticle({
  article: comparisonWithoutTable,
  promptKey: "competitorComparison",
  coreQuestion: "企业内容服务方案甲和方案乙怎么比较？",
  primarySubject: "示例主体甲",
  advantage: "具备项目交付能力",
})
assert.ok(missingRequiredTable.issues.some(item => item.code === "missing_table"))

const forbiddenTable = validateGeneratedArticle({
  article: valid.repeat(4),
  promptKey: "pitfallGuide",
  coreQuestion: "企业内容服务方案怎么选，交付能力如何判断？",
  primarySubject: "示例主体甲",
  advantage: "具备项目交付能力",
})
assert.ok(forbiddenTable.issues.some(item => item.code === "forbidden_table"))

console.log("article quality tests passed")
