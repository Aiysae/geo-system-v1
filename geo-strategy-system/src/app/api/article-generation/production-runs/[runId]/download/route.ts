import { NextRequest, NextResponse } from "next/server"
import JSZip from "jszip"
import { getArticleBatchDownloadItems } from "@/lib/article-batches/manager"
import { sanitizeArticleFileName } from "@/lib/article-batches/docx"
import { getContentProductionRun } from "@/lib/content-production/store"
import { syncContentProductionRun } from "@/lib/content-production/service"
import { requireOperationAccess, isOperationAccessError } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import type { ContentProductionItem } from "@/types/content-production"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`
}

function disposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function folderName(value: string): string {
  return String(value || "未命名平台")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "未命名平台"
}

function qualityLabel(item: ContentProductionItem): string {
  if (item.status === "ready") return "质检通过"
  if (item.status === "review_required") return "待人工复核"
  if (item.status === "failed") return "生成失败"
  if (item.status === "cancelled") return "已停止"
  return "处理中"
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { runId } = await context.params
    const clientId = String(request.nextUrl.searchParams.get("clientId") || "").trim()
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    const scope = request.nextUrl.searchParams.get("scope") === "passed" ? "passed" : "all"
    if (!clientId) return NextResponse.json({ error: "客户标识缺失" }, { status: 400 })
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId,
      module: "article",
      action: "export",
    })
    const stored = await getContentProductionRun(access.dataOwnerUserId, runId)
    if (!stored || stored.clientId !== access.clientId) {
      return NextResponse.json({ error: "内容生产批次不存在" }, { status: 404 })
    }
    const run = await syncContentProductionRun(stored)
    const eligibleItems = run.items.filter(item => (
      item.articleBatchId
      && item.articleItemId
      && (scope === "all"
        ? item.status === "ready" || item.status === "review_required"
        : item.status === "ready")
    ))
    if (eligibleItems.length === 0) {
      return NextResponse.json({
        error: scope === "passed" ? "当前还没有质检通过的文章" : "当前还没有可下载的文章",
      }, { status: 409 })
    }

    const batches = [...new Set(eligibleItems.map(item => item.articleBatchId || "").filter(Boolean))]
    const batchFiles = await Promise.all(batches.map(async batchId => ({
      batchId,
      files: await getArticleBatchDownloadItems(batchId, run.articleOwnerUserId, scope, "original"),
    })))
    const fileMap = new Map(batchFiles.flatMap(batch => (
      (batch.files || []).map(file => [`${batch.batchId}\u0000${file.itemId}`, file] as const)
    )))
    const zip = new JSZip()
    const exportedDeliveries = new Set<string>()
    const rows: unknown[][] = [[
      "计划日期",
      "发布平台",
      "账号槽位",
      "文章标题",
      "疑问句",
      "匹配优势",
      "复用方式",
      "Prompt",
      "质量状态",
      "发布任务编号",
      "内容资产编号",
      "文章任务编号",
      "文件路径",
    ]]

    for (const [itemIndex, item] of eligibleItems.entries()) {
      const file = fileMap.get(`${item.articleBatchId}\u0000${item.articleItemId}`)
      if (!file) continue
      for (const delivery of item.deliveries) {
        if (exportedDeliveries.has(delivery.publishingTaskId)) continue
        exportedDeliveries.add(delivery.publishingTaskId)
        const platformFolder = folderName(delivery.platformName)
        const reviewFolder = item.status === "review_required" ? "/待人工复核" : ""
        const baseName = `${delivery.plannedDate}_${String(itemIndex + 1).padStart(3, "0")}_${sanitizeArticleFileName(file.title || item.title || item.question)}`
        const relativePath = `${platformFolder}${reviewFolder}/${baseName}.docx`
        zip.file(relativePath, file.buffer)
        rows.push([
          delivery.plannedDate,
          delivery.platformName,
          delivery.accountSlot,
          file.title || item.title || item.question,
          item.question,
          item.matchedAdvantage || "",
          item.reuseMode === "master_reuse" ? "跨平台母稿复用" : "平台专稿",
          item.promptTitle || item.promptKey || "",
          qualityLabel(item),
          delivery.publishingTaskId,
          item.assetId,
          item.articleItemId || "",
          relativePath,
        ])
      }
    }

    if (exportedDeliveries.size === 0) {
      return NextResponse.json({ error: "文章文档尚未整理完成，请稍后重试" }, { status: 409 })
    }
    zip.file("发布清单.csv", "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n"))
    zip.file(
      "使用说明.txt",
      [
        "文件已按发布平台分组。",
        "同一母稿跨平台复用时，会分别出现在对应平台文件夹中；同一发布任务只导出一次。",
        "“待人工复核”目录中的文章保留了可读草稿，请审核后决定是否发布。",
        "发布完成后，请在系统中登记真实网址，系统才会将任务计入执行反馈。",
      ].join("\r\n"),
    )
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
    const dateLabel = run.dateFrom === run.dateTo ? run.dateFrom : `${run.dateFrom}_至_${run.dateTo}`
    const fileName = `${sanitizeArticleFileName(run.clientName)}_${dateLabel}_分平台发布内容_${exportedDeliveries.size}项.zip`
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
    return NextResponse.json({
      error: error instanceof Error ? error.message : "分平台内容打包失败",
    }, { status: isOperationAccessError(error) ? 403 : 500 })
  }
}
