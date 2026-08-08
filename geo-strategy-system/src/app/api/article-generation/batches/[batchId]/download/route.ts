import { NextRequest, NextResponse } from "next/server"
import JSZip from "jszip"
import { getArticleBatch, getArticleBatchDownloadItems } from "@/lib/article-batches/manager"
import { sanitizeArticleFileName } from "@/lib/article-batches/docx"
import {
  isTeamAccessError,
  requireArticleBatchAccess,
} from "@/lib/article-batches/access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 120
export const dynamic = "force-dynamic"

function disposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`
}

function qualityLabel(value: string | undefined): string {
  if (value === "passed") return "质检通过"
  if (value === "review_required") return "待人工复核"
  if (value === "pending") return "处理中"
  return "未产生正文"
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { batchId } = await context.params
    const scope = req.nextUrl.searchParams.get("scope") === "all" ? "all" : "passed"
    const authorized = await requireArticleBatchAccess({
      batchId,
      userId: auth.userId,
      action: "export",
    })
    if (!authorized) return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
    const [batch, files] = await Promise.all([
      getArticleBatch(batchId, auth.userId),
      getArticleBatchDownloadItems(batchId, auth.userId, scope),
    ])
    if (!batch || !files) return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
    if (files.length === 0) {
      return NextResponse.json({ error: "当前还没有可下载的 Word 文档" }, { status: 409 })
    }

    const zip = new JSZip()
    for (const file of files) {
      const folder = file.qualityStatus === "review_required" ? "待人工复核" : "质检通过"
      zip.file(`${folder}/${file.fileName}`, file.buffer)
    }
    const manifestItems = scope === "all"
      ? batch.items
      : batch.items.filter(item => item.qualityStatus === "passed")
    const manifestRows = [
      ["序号", "标题", "状态", "Prompt", "模型", "质量分", "质检说明", "文件名"],
      ...manifestItems.map(item => {
        const score = item.qualityAudit?.semanticScore ?? item.qualityAudit?.deterministicScore
        return [
          item.position,
          item.title || item.topic,
          qualityLabel(item.qualityStatus),
          item.promptTitle || batch.promptTitle,
          batch.model || batch.modelProvider,
          score === undefined ? "" : score,
          item.qualityAudit?.issues.join("；") || item.error || "",
          item.fileName || "",
        ]
      }),
    ]
    zip.file(
      "文章生成清单.csv",
      "\uFEFF" + manifestRows.map(row => row.map(csvCell).join(",")).join("\r\n"),
    )
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
    const scopeLabel = scope === "all" ? "全部已生成" : "质检通过"
    const fileName = `${sanitizeArticleFileName(batch.promptTitle)}_${scopeLabel}${files.length}篇_${new Date().toISOString().slice(0, 10)}.zip`
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": disposition(fileName),
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "下载文章批次失败" },
      { status: isTeamAccessError(error) ? 403 : 500 },
    )
  }
}
