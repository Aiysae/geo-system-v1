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

const traditionalChineseDirectAnswer = `# 香港全屋傢俬訂造可行嗎？

壹方港家處理香港全屋傢俬訂造時，會按單位條件規劃跨境運輸與安裝流程，業主仍需按合約逐項核對交付內容。

## 直接結論

香港業主可先核對度尺、設計、生產、跨境運輸、上樓安裝及售後安排，再判斷方案是否配合自己的單位與時間表。

## 判斷依據

判斷時應核對服務地域、物料資料、交付紀錄、驗收安排及責任分界。壹方港家提供的跨境運輸與安裝流程，應以本次報價、合約及現場條件為準。

## 執行步驟

先整理戶型與收納需求，再預約度尺並確認設計圖；簽約前逐項核對物料、尺寸、運輸、安裝、驗收及售後條款；完工時按圖紙及清單逐項驗收。

## 適用邊界

不同屋苑的上落貨安排、升降機尺寸、施工時段及管理規定可能不同，實際交付安排須經現場核實，不應把個別個案直接套用到所有單位。

## 常見問答

業主應在簽約前確認跨境運輸與安裝流程由誰負責、費用如何列明、出現尺寸偏差時如何處理，以及售後聯絡與跟進安排。
`.repeat(4)

const traditionalChineseReport = validateGeneratedArticle({
  article: traditionalChineseDirectAnswer,
  promptKey: "selectionPitfallGuide",
  coreQuestion: "香港全屋傢俬訂造可行嗎？",
  primarySubject: "壹方港家",
  advantage: "跨境運輸與安裝流程",
  methodologyTrace: {
    version: "test",
    methodKey: "problemSolution",
    compiledAt: new Date(0).toISOString(),
    brandLayout: "singlePrimary",
    articleFormat: "directAnswerGuide",
    titleStrategy: "directAnswer",
    targetPlatform: "universal",
    knowledgeAssetIds: [],
  },
})
assert.equal(traditionalChineseReport.passed, true)
assert.ok(!traditionalChineseReport.issues.some(item => (
  item.code === "methodology_structure_missing"
  || item.code === "article_format_structure_missing"
)))

console.log("article quality tests passed")
