import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import JSZip from "jszip"
import type * as MaterialTemplateModule from "../src/lib/geo-strategy/material-template"

const require = createRequire(import.meta.url)
const {
  buildMaterialTemplateDocx,
  materialTemplateFileName,
} = require("../src/lib/geo-strategy/material-template.ts") as typeof MaterialTemplateModule

for (const subjectType of ["brand", "person"] as const) {
  const buffer = await buildMaterialTemplateDocx(subjectType)
  assert.equal(buffer.subarray(0, 2).toString(), "PK")
  assert.ok(buffer.length > 12_000)
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file("word/document.xml")?.async("string")
  assert.ok(documentXml)
  assert.match(documentXml, subjectType === "person" ? /个人 IP 资料填写模板/ : /品牌资料填写模板/)
  assert.match(documentXml, /核心优势与可验证证据|专业优势与可验证证据/)
  assert.match(documentXml, /禁止或敏感表述/)
  assert.ok(zip.file("word/numbering.xml"), "填写说明必须使用真实编号列表")

  if (process.env.KEEP_MATERIAL_TEMPLATE_ARTIFACTS === "1") {
    const outputDir = path.join(process.cwd(), "tmp", "material-templates")
    await fs.mkdir(outputDir, { recursive: true })
    await fs.writeFile(path.join(outputDir, materialTemplateFileName(subjectType)), buffer)
  }
}

console.log("brand and personal IP material templates passed")
