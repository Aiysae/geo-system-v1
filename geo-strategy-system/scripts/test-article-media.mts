import assert from "node:assert/strict"
import { createRequire } from "node:module"
import JSZip from "jszip"
import sharp from "sharp"
import type * as MarkdownModule from "../src/lib/article-media/markdown"
import type * as DocxModule from "../src/lib/article-batches/docx"
import type * as ExportModule from "../src/lib/article-media/export"

const require = createRequire(import.meta.url)
const {
  articleMediaAssetIds,
  insertArticleMedia,
  replaceArticleMediaUrls,
} = require("../src/lib/article-media/markdown.ts") as typeof MarkdownModule
const { buildArticleDocxBuffer } = require("../src/lib/article-batches/docx.ts") as typeof DocxModule
const { renderStandaloneArticleHtml } = require("../src/lib/article-media/export.tsx") as typeof ExportModule

const markdown = `# 测试文章

这是开篇导语，用于说明文章的核心问题。

## 第一部分

第一部分正文，包含足够的信息用于结构化插图。

| 项目 | 说明 |
| --- | --- |
| A | B |

\`\`\`ts
const value = "不要在这里插图"
\`\`\`

## 第二部分

第二部分正文，继续解释核心内容。

## 结语

这是文章结语。`

const assets = Array.from({ length: 5 }, (_, index) => ({
  id: `amia_test_${index + 1}`,
  alt: `测试图片 ${index + 1}`,
}))

for (const [template, count] of [["opening", 1], ["standard", 3], ["rich", 5]] as const) {
  const revision = insertArticleMedia({
    markdown,
    assets,
    template,
    mappingMode: "same_set",
  })
  assert.equal(revision.placements.length, count)
  assert.equal(articleMediaAssetIds(revision.markdown).length, count)
  assert.equal(revision.sourceHash.length, 64)
  assert.ok(!/```[\s\S]*shitu-article-media[\s\S]*```/.test(revision.markdown))
  assert.ok(!/\| A \| B \|\s*<!-- shitu-article-media/.test(revision.markdown))
}

const standard = insertArticleMedia({
  markdown,
  assets,
  template: "standard",
  mappingMode: "round_robin",
})
const offline = replaceArticleMediaUrls(standard.markdown, id => `../images/${id}.png`)
assert.ok(offline.includes("../images/amia_test_1.png"))
assert.ok(!offline.includes("/api/article-generation/assets/"))

const image = await sharp({
  create: {
    width: 320,
    height: 180,
    channels: 3,
    background: { r: 22, g: 119, b: 255 },
  },
}).png().toBuffer()
const docx = await buildArticleDocxBuffer(standard.markdown, "测试图文文章", async source => (
  source.includes("/assets/")
    ? { data: image, type: "png", width: 320, height: 180 }
    : null
))
const archive = await JSZip.loadAsync(docx)
assert.ok(Object.keys(archive.files).some(name => name.startsWith("word/media/")))

const html = renderStandaloneArticleHtml({
  title: "测试文章",
  markdown: `${offline}\n\n[安全链接](https://example.com)\n\n[异常链接](javascript:alert(1))`,
})
assert.ok(html.includes("<img"))
assert.ok(html.includes("../images/amia_test_1.png"))
assert.ok(!html.includes("<script>"))
assert.ok(html.includes('href="https://example.com"'))
assert.ok(!html.includes('href="javascript:'))

console.log("article media tests passed")
