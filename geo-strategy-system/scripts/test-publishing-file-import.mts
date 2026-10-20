import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, ImageRun } from "docx"
import sharp from "sharp"
import type * as FileImportModule from "../src/lib/local-publishing/file-import"

const require = createRequire(import.meta.url)
const { ARTICLE_FILE_LIMITS, parseArticleFiles, resolveArticleFileImages } = require("../src/lib/local-publishing/file-import.ts") as typeof FileImportModule

let passed = 0
async function test(name: string, run: () => Promise<void>) {
  await run()
  passed++
  console.log(`✓ ${name}`)
}
const textFile = (name: string, value: string) => ({ name, buffer: Buffer.from(value) })

await test("Markdown retains headings, lists, tables and removes unsafe HTML", async () => {
  const [item] = await parseArticleFiles([textFile("example.md", "# 测试文章\n\n## 小标题\n\n- 内容一\n- 内容二\n\n| 项目 | 内容 |\n| --- | --- |\n| 测试 | 正常 |\n\n<script>alert(1)</script><a href='javascript:alert(2)'>链接</a>\n\n![丢失图片](./image.png)")])
  assert.equal(item.title, "测试文章")
  assert.match(item.markdown, /## 小标题/)
  assert.match(item.markdown, /-\s+内容一/)
  assert.match(item.markdown, /\| 测试 \| 正常 \|/)
  assert.doesNotMatch(item.markdown, /<script|javascript:|\.\/image\.png/)
  assert.doesNotMatch(item.html, /<script|javascript:/)
  assert(item.warnings.some(warning => warning.includes("本地路径")))
})

await test("Plain text and UTF-16 are read without interpreting HTML", async () => {
  const body = "正文第一段\n\n<b>保留为文字</b>"
  const files = [textFile("中文标题.txt", body), { name: "UTF16.txt", buffer: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, "utf16le")]) }]
  const parsed = await parseArticleFiles(files)
  assert.equal(parsed[0].title, "中文标题")
  assert.match(parsed[0].html, /&lt;b&gt;保留为文字&lt;\/b&gt;/)
  assert.match(parsed[1].markdown, /正文第一段/)
})

await test("Word imports headings, lists, tables and embedded pictures", async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#006699" } }).png().toBuffer()
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ text: "Word 标题", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: "正文小标题", heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ text: "第一条", bullet: { level: 0 } }),
    new Paragraph({ text: "第二条", bullet: { level: 0 } }),
    new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("列一")] }), new TableCell({ children: [new Paragraph("列二")] })] }),
      new TableRow({ children: [new TableCell({ children: [new Paragraph("表格内容")] }), new TableCell({ children: [new Paragraph("正常")] })] })] }),
    new Paragraph({ children: [new ImageRun({ type: "png", data: png, transformation: { width: 8, height: 8 } })] }),
  ] }] })
  const buffer = await Packer.toBuffer(doc)
  const [item] = await parseArticleFiles([{ name: "word.docx", buffer }])
  assert.equal(item.title, "Word 标题")
  assert.match(item.markdown, /## 正文小标题/)
  assert.match(item.markdown, /-\s+第一条/)
  assert.match(item.markdown, /\| 表格内容 \| 正常 \|/)
  assert.equal(item.images.length, 1)
  assert.equal(item.sourceHash, createHash("sha256").update(buffer).digest("hex"))
  assert.match(resolveArticleFileImages(item).markdown, /data:image\/png;base64,/)
  const resolved = resolveArticleFileImages(item, new Map([[item.images[0].key, "local-asset:lpa_test"]]))
  assert.match(resolved.markdown, /local-asset:lpa_test/)
  assert.match(resolved.html, /local-asset:lpa_test/)
  assert.doesNotMatch(resolved.markdown, /file-import\.invalid|data:image/)
  assert(item.warnings.some(warning => warning.includes("页眉页脚")))
})

await test("Text limits and unsupported or empty files fail before import", async () => {
  await assert.rejects(() => parseArticleFiles([textFile("old.doc", "旧 Word")]), /仅支持/)
  await assert.rejects(() => parseArticleFiles([textFile("empty.txt", " ")]), /正文为空/)
  await assert.rejects(() => parseArticleFiles([textFile("broken.docx", "not a ZIP")]), /Word 文件损坏/)
  await assert.rejects(() => parseArticleFiles(Array.from({ length: 21 }, () => textFile("test.md", "正文"))), /1～20/)
  await assert.rejects(() => parseArticleFiles([{ name: "big.txt", buffer: Buffer.alloc(ARTICLE_FILE_LIMITS.fileBytes + 1) }]), /12MB/)
  await assert.rejects(() => parseArticleFiles([textFile("too-long.md", "x".repeat(300_001))]), /30 万字/)
})

await test("Word ZIP inflated size is rejected before decompression", async () => {
  const doc = new Document({ sections: [{ children: [new Paragraph("正常正文")] }] })
  const buffer = await Packer.toBuffer(doc)
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert(central > 0)
  buffer.writeUInt32LE(65 * 1024 * 1024, central + 24)
  await assert.rejects(() => parseArticleFiles([{ name: "inflated.docx", buffer }]), /64MB/)
})

console.log(`${passed} 个文章文件导入测试通过；未调用任何平台发布接口。`)
