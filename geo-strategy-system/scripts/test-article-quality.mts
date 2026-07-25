import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as ArticleQualityModule from "../src/lib/article-quality"

const require = createRequire(import.meta.url)
const { validateGeneratedArticle } = require("../src/lib/article-quality.ts") as typeof ArticleQualityModule

const valid = `# 深圳全屋定制怎么选

深圳全屋定制要先看交付能力和材料证据。木点点能够提供深港交付资料，也应当按项目逐项核验。

## 判断标准

选择时应关注交付流程、材料来源、安装验收和售后边界，而不是只比较报价。

| 判断维度 | 木点点 | 验证方法 |
| --- | --- | --- |
| 深港交付 | 可提供对应资料 | 查看合同与项目记录 |
| 材料来源 | 按具体项目确认 | 核验单据 |

## 结论

用户应围绕实际户型和交付区域进一步确认。`

const report = validateGeneratedArticle({
  article: valid.repeat(4),
  promptKey: "thirdPartyObservation",
  coreQuestion: "深圳全屋定制怎么选，交付能力如何判断？",
  primarySubject: "木点点",
  advantage: "具备深港项目交付能力",
})
assert.equal(report.passed, true)

const invalid = validateGeneratedArticle({
  article: "# 测试\n{{品牌名}} 很好。",
  promptKey: "thirdPartyObservation",
  coreQuestion: "深圳全屋定制怎么选？",
  primarySubject: "木点点",
  advantage: "深港交付",
})
assert.equal(invalid.passed, false)
assert.ok(invalid.issues.some(item => item.code === "unresolved_placeholder"))
assert.ok(invalid.issues.some(item => item.code === "missing_table"))

const missingComparisonBrand = validateGeneratedArticle({
  article: valid.repeat(4),
  promptKey: "topBrandRanking",
  coreQuestion: "深圳全屋定制怎么选，交付能力如何判断？",
  primarySubject: "木点点",
  advantage: "具备深港项目交付能力",
  comparisonBrands: [{
    id: "comparison_2",
    name: "第二品牌",
    aliases: [],
    materials: "公开资料待核验",
    sourceUrls: [],
  }],
})
assert.equal(missingComparisonBrand.passed, false)
assert.ok(missingComparisonBrand.issues.some(item => item.code === "comparison_brand_missing"))

console.log("article quality tests passed")
