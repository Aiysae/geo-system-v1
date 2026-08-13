import { NextRequest, NextResponse } from "next/server"
import JSZip from "jszip"
import { getArticleBatch, getArticleBatchDownloadItems } from "@/lib/article-batches/manager"
import { sanitizeArticleFileName } from "@/lib/article-batches/docx"
import {
  getOwnedArticleMediaAssets,
  readArticleMediaAssetBuffer,
} from "@/lib/article-media/assets"
import {
  articleMediaAssetIds,
  replaceArticleMediaUrls,
} from "@/lib/article-media/markdown"
import { renderStandaloneArticleHtml } from "@/lib/article-media/export"
import {
  isTeamAccessError,
  requireArticleBatchAccess,
} from "@/lib/article-batches/access"
import { requireUserId } from "@/lib/with-credits"
import {
  articleQuestionSelectionLabel,
  ensureTimelyArticleMarkdown,
  isDirectRecommendationQuestion,
} from "@/lib/article-question-selection"
import type { ArticleBatchDownloadScope } from "@/lib/article-batches/manager"
import {
  articleVideoPlatformLabel,
  isBrandVideoScriptPrompt,
  normalizeArticleVideoScriptConfig,
  parseBrandVideoScript,
} from "@/lib/article-video-script"

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
    const requestedScope = req.nextUrl.searchParams.get("scope")
    const scope: ArticleBatchDownloadScope = requestedScope === "all"
      ? "all"
      : requestedScope === "direct"
        ? "direct"
        : "passed"
    const variant = req.nextUrl.searchParams.get("variant") === "media" ? "media" : "original"
    const authorized = await requireArticleBatchAccess({
      batchId,
      userId: auth.userId,
      action: "export",
    })
    if (!authorized) return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
    const [batch, files] = await Promise.all([
      getArticleBatch(batchId, auth.userId),
      getArticleBatchDownloadItems(batchId, auth.userId, scope, variant),
    ])
    if (!batch || !files) return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
    if (files.length === 0) {
      return NextResponse.json({
        error: scope === "direct"
          ? "当前没有质检通过的直推榜单文章"
          : variant === "media"
            ? "当前还没有可下载的图文版本"
            : "当前还没有可下载的 Word 文档",
      }, { status: 409 })
    }

    const zip = new JSZip()
    for (const file of files) {
      const folder = scope === "direct"
        ? "直推榜单"
        : file.qualityStatus === "review_required"
          ? "待人工复核"
          : "质检通过"
      zip.file(`${variant === "media" ? "Word图文成品/" : ""}${folder}/${file.fileName}`, file.buffer)
    }
    const exportedFiles = new Map(files.map(file => [file.itemId, file]))
    const manifestItems = batch.items.filter(item => exportedFiles.has(item.id))
    const videoScriptBatch = isBrandVideoScriptPrompt(batch.promptKey)
    const storedItems = new Map(authorized.batch.items.map(item => [item.id, item]))
    const videoConfig = normalizeArticleVideoScriptConfig(authorized.batch.basePayload.videoScriptConfig)
    const manifestRows = videoScriptBatch
      ? [
          ["序号", "核心疑问", "匹配优势", "专业视角", "标题", "正文", "标签", "平台", "目标时长", "状态", "质量分", "质检说明", "文件名"],
          ...manifestItems.map(item => {
            const stored = storedItems.get(item.id)
            const parsed = parseBrandVideoScript(stored?.markdown || "")
            const score = item.qualityAudit?.semanticScore ?? item.qualityAudit?.deterministicScore
            const exported = exportedFiles.get(item.id)
            return [
              item.position,
              item.topic,
              item.matchedAdvantage || "",
              parsed.perspective,
              parsed.title || exported?.title || item.title || "",
              parsed.body,
              parsed.tagsText,
              articleVideoPlatformLabel(videoConfig),
              `${videoConfig.targetDurationSeconds} 秒`,
              qualityLabel(item.qualityStatus),
              score === undefined ? "" : score,
              item.qualityAudit?.issues.join("；") || item.error || "",
              exported?.fileName || item.fileName || "",
            ]
          }),
        ]
      : [
          ["序号", "标题", "状态", "疑问句类型", "分类置信度", "分类依据", "Prompt", "模型", "质量分", "质检说明", "插图数", "文件名"],
          ...manifestItems.map(item => {
            const score = item.qualityAudit?.semanticScore ?? item.qualityAudit?.deterministicScore
            const exported = exportedFiles.get(item.id)
            return [
              item.position,
              exported?.title || item.title || item.topic,
              qualityLabel(item.qualityStatus),
              articleQuestionSelectionLabel(item.questionSelectionType),
              item.questionSelectionConfidence === undefined
                ? ""
                : `${Math.round(item.questionSelectionConfidence * 100)}%`,
              item.questionSelectionReason || "",
              item.promptTitle || batch.promptTitle,
              batch.model || batch.modelProvider,
              score === undefined ? "" : score,
              item.qualityAudit?.issues.join("；") || item.error || "",
              item.mediaImageCount || 0,
              exported?.fileName || item.fileName || "",
            ]
          }),
        ]
    zip.file(
      videoScriptBatch ? "短视频文案清单.csv" : "文章生成清单.csv",
      "\uFEFF" + manifestRows.map(row => row.map(csvCell).join(",")).join("\r\n"),
    )

    if (variant === "media") {
      const storedItems = authorized.batch.items.filter(item => (
        Boolean(item.mediaRevision?.markdown)
        && (scope === "all" || item.qualityStatus === "passed")
        && (scope !== "direct" || isDirectRecommendationQuestion(item))
      ))
      const assetIds = [...new Set(storedItems.flatMap(item => (
        articleMediaAssetIds(item.mediaRevision?.markdown || "")
      )))]
      const assets = await getOwnedArticleMediaAssets(assetIds, auth.userId)
      const assetPaths = new Map<string, string>()
      for (const asset of assets) {
        const fileName = `${asset.id.slice(-10)}_${sanitizeArticleFileName(asset.fileName, "配图")}`
        const relativePath = `images/${fileName}`
        assetPaths.set(asset.id, relativePath)
        zip.file(relativePath, await readArticleMediaAssetBuffer(asset))
      }
      for (const item of storedItems) {
        const sourceMarkdown = item.mediaRevision?.markdown || ""
        const exportArticle = scope === "direct"
          ? ensureTimelyArticleMarkdown({
              markdown: sourceMarkdown,
              title: item.title || item.topic,
            })
          : {
              markdown: sourceMarkdown,
              title: item.title || item.topic,
            }
        const baseName = `${String(item.position).padStart(2, "0")}_${sanitizeArticleFileName(exportArticle.title)}`
        const offlineMarkdown = replaceArticleMediaUrls(
          exportArticle.markdown,
          assetId => `../${assetPaths.get(assetId) || `images/${assetId}.jpg`}`,
        )
        zip.file(`Markdown图文成品/${baseName}.md`, offlineMarkdown)
        zip.file(`HTML图文成品/${baseName}.html`, renderStandaloneArticleHtml({
          title: exportArticle.title,
          markdown: offlineMarkdown,
        }))
      }
      zip.file(
        "图文成品使用说明.txt",
        "Word图文成品可直接查看和编辑；HTML图文成品可在浏览器离线打开；Markdown图文成品需与 images 文件夹保持当前相对位置。\r\n原始无图文章仍保留在系统中，可随时重新下载。",
      )
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
    const scopeLabel = `${scope === "all"
      ? "全部已生成"
      : scope === "direct"
        ? "直推榜单_已补当年标题"
        : "质检通过"}${variant === "media" ? "_图文成品" : ""}`
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
