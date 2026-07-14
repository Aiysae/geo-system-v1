import assert from "node:assert/strict"
import { createRequire } from "node:module"
import JSZip from "jszip"
import type * as ArticleDocxModule from "../src/lib/article-batches/docx"
import type * as ArticlePlanningModule from "../src/lib/article-batches/planning"

const require = createRequire(import.meta.url)
const { buildArticleDocxBuffer } = require("../src/lib/article-batches/docx.ts") as typeof ArticleDocxModule
const {
  ARTICLE_SIMILARITY_RETRY_THRESHOLD,
  articleSimilarity,
  planArticleBatch,
} = require("../src/lib/article-batches/planning.ts") as typeof ArticlePlanningModule

const planned = planArticleBatch({
  count: 10,
  topicMode: "auto",
  coreQuestion: "企业做 GEO 内容为什么进不了 AI 搜索答案？",
  keywords: "GEO 内容怎么写\nAI 搜索优化如何验证\n企业如何选择 GEO 服务商",
})
assert.equal(planned.length, 10)
assert.equal(new Set(planned.map(item => item.brief)).size, 10)
assert.ok(planned.every((item, index) => item.position === index + 1))
assert.ok(planned.every(item => item.brief.includes("独立主题")))

assert.throws(() => planArticleBatch({
  count: 5,
  topicMode: "custom",
  coreQuestion: "测试",
  keywords: "",
  customTopics: "主题一\n主题二",
}), /补足到 5 个/)

const repeatedA = "# GEO 内容方法\n\n企业应先梳理用户问题，再建设可信资料，最后持续监测模型回答。".repeat(20)
const repeatedB = "# GEO 内容方法\n\n企业应先梳理用户问题，再建设可信资料，最后持续监测模型回答。".repeat(20)
const distinct = "# 工业采购验收指南\n\n采购人员需要核对材料批次、工况参数、交付记录和售后边界。".repeat(20)
assert.ok(articleSimilarity(repeatedA, repeatedB) > ARTICLE_SIMILARITY_RETRY_THRESHOLD)
assert.ok(articleSimilarity(repeatedA, distinct) < ARTICLE_SIMILARITY_RETRY_THRESHOLD)

const docx = await buildArticleDocxBuffer([
  "# GEO 批量文章测试",
  "",
  "这是包含 **加粗内容** 和 [势途 GEO](https://shitugeo.top/) 的正文。",
  "",
  "## 核心清单",
  "",
  "1. 第一项",
  "2. 第二项",
  "",
  "| 维度 | 说明 |",
  "| --- | --- |",
  "| 独立请求 | 不携带上一篇上下文 |",
].join("\n"), "GEO 批量文章测试")
assert.equal(docx.subarray(0, 2).toString(), "PK")
const zip = await JSZip.loadAsync(docx)
assert.ok(zip.file("word/document.xml"))
const documentXml = await zip.file("word/document.xml")!.async("string")
assert.match(documentXml, /GEO 批量文章测试/)
assert.match(documentXml, /独立请求/)

console.log("article batch tests passed")
