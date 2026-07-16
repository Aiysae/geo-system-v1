import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { JSDOM } from "jsdom"
import type * as ArticlePublishingModule from "../src/lib/article-publishing/content"

const require = createRequire(import.meta.url)
const {
  countMarkdownTables,
  extractMarkdownDigest,
  extractMarkdownTitle,
  normalizePublishHtml,
  parsePublishTags,
  preparePublishArticle,
  removeDuplicateMarkdownTitle,
} = require("../src/lib/article-publishing/content.ts") as typeof ArticlePublishingModule

const markdown = `# 中国 GEO 服务怎么选？

这是一段用于摘要提取的正文，包含选择标准和实施建议。

| 服务阶段 | 目标 | 周期 |
| --- | --- | --- |
| 首次提及 | 进入答案 | 14 天 |
| 稳定提及 | 提及率提升 | 30 天 |

![示意图](https://example.com/geo.png)`

assert.equal(extractMarkdownTitle(markdown), "中国 GEO 服务怎么选？")
assert.equal(countMarkdownTables(markdown), 1)
assert.ok(extractMarkdownDigest(markdown).startsWith("这是一段用于摘要提取的正文"))
assert.ok(removeDuplicateMarkdownTitle(markdown, "中国 GEO 服务怎么选？").startsWith("这是一段"))
assert.deepEqual(parsePublishTags("#GEO，AI 搜索\nGEO, 品牌"), ["GEO", "AI 搜索", "品牌"])

const rawHtml = `<article style="padding: 30px">
  <h1>中国 GEO 服务怎么选？</h1>
  <p onclick="alert(1)">正文 <a href="javascript:alert(1)">危险链接</a></p>
  <div style="overflow-x:auto"><table><thead><tr><th>阶段</th><th>目标</th></tr></thead><tbody><tr><td>首次提及</td><td>进入答案</td></tr></tbody></table></div>
  <img src="https://example.com/geo.png" onerror="alert(1)" />
  <script>alert(1)</script>
</article>`

const createDocument = (html: string) => new JSDOM(html).window.document
const normalized = normalizePublishHtml(rawHtml, "中国 GEO 服务怎么选？", createDocument)

assert.equal(normalized.tableCount, 1)
assert.equal(normalized.images.length, 1)
assert.ok(!normalized.html.includes("<h1"), "单独标题字段存在时正文不应重复 H1")
assert.ok(!normalized.html.includes("script"))
assert.ok(!normalized.html.includes("onclick"))
assert.ok(!normalized.html.includes("onerror"))
assert.ok(!normalized.html.includes("javascript:"))
assert.ok(normalized.html.includes("<table"))
assert.ok(normalized.html.includes("border-collapse: collapse"))
assert.ok(!normalized.html.includes("overflow-x"), "发布表格不应依赖平台可能剥离的滚动容器")

const prepared = preparePublishArticle({
  markdown,
  renderedHtml: rawHtml,
  tags: "GEO, AI 搜索",
  createDocument,
})

assert.equal(prepared.title, "中国 GEO 服务怎么选？")
assert.equal(prepared.tableCount, 1)
assert.ok(prepared.markdownContent.includes("| 服务阶段 | 目标 | 周期 |"), "GFM 表格源码必须保留")
assert.ok(prepared.htmlContent.includes("<table"), "富文本表格必须保留")
assert.equal(prepared.images[0]?.url, "https://example.com/geo.png")

console.log("article publishing regression tests passed")
