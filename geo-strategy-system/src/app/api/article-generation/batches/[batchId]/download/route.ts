import { NextRequest, NextResponse } from "next/server"
import JSZip from "jszip"
import { getArticleBatch, getArticleBatchDownloadItems } from "@/lib/article-batches/manager"
import { sanitizeArticleFileName } from "@/lib/article-batches/docx"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 120
export const dynamic = "force-dynamic"

function disposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const { batchId } = await context.params
  const [batch, files] = await Promise.all([
    getArticleBatch(batchId, auth.userId),
    getArticleBatchDownloadItems(batchId, auth.userId),
  ])
  if (!batch || !files) return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
  if (files.length === 0) return NextResponse.json({ error: "当前还没有可下载的 Word 文档" }, { status: 409 })

  const zip = new JSZip()
  for (const file of files) zip.file(file.fileName, file.buffer)
  zip.file("生成清单.txt", [
    `模板：${batch.promptTitle}`,
    `模型：${batch.model || batch.modelProvider}`,
    `创建时间：${batch.createdAt}`,
    `已完成：${batch.completedCount}/${batch.requestedCount}`,
    "",
    ...files.map(file => `${file.position}. ${file.title}`),
  ].join("\n"))
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
  const fileName = `${sanitizeArticleFileName(batch.promptTitle)}_${batch.completedCount}篇_${new Date().toISOString().slice(0, 10)}.zip`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": disposition(fileName),
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
