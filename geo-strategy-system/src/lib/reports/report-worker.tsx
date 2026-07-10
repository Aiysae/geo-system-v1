import { randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"
import { renderToBuffer } from "@react-pdf/renderer"
import { CommercialReportDocument } from "./commercial-report-document"
import type { CommercialReportInput } from "../../types"

async function main(): Promise<void> {
  const [inputPath, outputPath] = process.argv.slice(2)
  if (!inputPath || !outputPath) throw new Error("报告工作进程缺少输入或输出路径")

  const input = JSON.parse(await fs.readFile(inputPath, "utf8")) as CommercialReportInput
  const buffer = await renderToBuffer(<CommercialReportDocument input={input} />)
  const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(tempPath, buffer)
  await fs.rename(tempPath, outputPath)
  process.stdout.write(JSON.stringify({ fileSize: buffer.length }))
}

main().catch(error => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
