import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { JSDOM } from "jsdom"
import { marked } from "marked"
import { preparePublishArticle } from "@/lib/article-publishing/content"
import { getOwnedArticleMediaAsset, readArticleMediaAssetBuffer } from "@/lib/article-media/assets"
import { requireArticleBatchAccess } from "@/lib/article-batches/access"
import { getOwnedStoredArticleBatch, listOwnedStoredArticleBatches, type StoredArticleBatch, type StoredArticleBatchItem } from "@/lib/article-batches/store"
import { getContentProductionRun, listContentProductionRuns } from "@/lib/content-production/store"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"
import { listAccessibleTeamClientShares } from "@/lib/team-store"
import { listWorkspaceClientSummaries } from "@/lib/workspace-store"
import { requireOperationAccess, resolveOperationAccess } from "@/lib/team-access"
import { publishingService } from "@/lib/local-publishing/service"
import type { PublishingArticle, PublishingAsset, PublishingSource } from "@/lib/local-publishing/types"
import type { ContentProductionRun } from "@/types/content-production"

export type ProductionImportResult = {
  article: PublishingArticle
  status: "created" | "existing" | "new_version"
  sourceKey: string
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function requiredText(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name}为空或过长`)
  return value.trim()
}
function optionalText(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined
}
function sourceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
function batchSummary(batch: StoredArticleBatch) {
  return {
    id: batch.id, clientId: batch.clientId, createdAt: batch.createdAt, status: batch.status,
    promptTitle: batch.promptTitle,
    items: batch.items.map(item => ({
      id: item.id, title: item.title || item.topic, status: item.status,
      hasDraft: Boolean(item.markdown?.trim()), hasMediaVersion: Boolean(item.mediaRevision?.markdown?.trim()),
    })),
  }
}
function runSummary(run: ContentProductionRun) {
  return {
    id: run.id, clientId: run.clientId, createdAt: run.createdAt, status: run.status,
    items: run.items.filter(item => item.contentType !== "video").map(item => ({
      id: item.id, title: item.title || item.question, status: item.status,
      hasDraft: Boolean(item.articleBatchId && item.articleItemId && ["ready", "review_required"].includes(item.status)),
      hasMediaVersion: false,
    })),
  }
}
export async function listProductionImportSources(userId: string, query: { clientId?: string; teamId?: string; batchId?: string; runId?: string; itemId?: string }) {
  if (query.batchId) {
    const authorized = await requireArticleBatchAccess({ userId, batchId: query.batchId, action: "view" })
    if (!authorized) throw new Error("文章批次不存在或无权访问")
    return { batch: batchSummary(authorized.batch) }
  }
  if (query.runId) {
    if (!query.clientId) throw new Error("请先选择客户")
    const access = await requireOperationAccess({ userId, clientId: query.clientId, teamId: query.teamId, module: "article", action: "view" })
    const run = await getContentProductionRun(access.dataOwnerUserId, query.runId)
    if (!run || run.clientId !== query.clientId) throw new Error("内容生产记录不存在或无权查看")
    if (query.itemId) {
      const runItem = run.items.find(item => item.id === query.itemId)
      if (!runItem || runItem.contentType === "video" || !["ready", "review_required"].includes(runItem.status) || !runItem.articleBatchId || !runItem.articleItemId || !run.childBatches.some(child => child.id === runItem.articleBatchId)) throw new Error("文章不存在或尚未完成")
      const batch = await getOwnedStoredArticleBatch(runItem.articleBatchId, run.articleOwnerUserId)
      if (!batch || batch.clientId !== query.clientId || batch.teamId !== run.teamId) throw new Error("文章批次不存在或无权查看")
      const item = batch.items.find(candidate => candidate.id === runItem.articleItemId)
      if (!item?.markdown?.trim()) throw new Error("文章正文尚未完成")
      return { preview: { id: runItem.id, title: item.title || item.topic || "文章", markdown: item.markdown } }
    }
    return { run: runSummary(run) }
  }
  if (query.clientId) {
    const access = await requireOperationAccess({ userId, clientId: query.clientId, teamId: query.teamId, module: "article", action: "view" })
    const [batches, runs] = await Promise.all([
      listOwnedStoredArticleBatches(userId, query.clientId, 30),
      listContentProductionRuns(access.dataOwnerUserId, query.clientId, { limit: 30 }),
    ])
    // Individual batch authorization also accounts for a revoked team share.
    const visible = await Promise.all(batches.map(async batch => {
      const access = await resolveOperationAccess({ userId, clientId: batch.clientId, teamId: batch.teamId, module: "article", action: "view" })
      return access.ok ? batchSummary(batch) : null
    }))
    return { batches: visible.filter(batch => batch !== null), runs: runs.map(runSummary) }
  }
  const workspace = await resolveWorkspaceAccess(userId)
  if (!workspace.ok) throw new Error(workspace.message)
  const personal = (await listWorkspaceClientSummaries(workspace.ownerUserId))
    .filter(client => workspace.mode !== "client" || client.id === workspace.clientId)
    .map(client => ({ id: client.id, name: client.name, teamId: undefined as string | undefined }))
  const shared = workspace.mode === "client" ? [] : await listAccessibleTeamClientShares(userId)
  const sharedOwners = [...new Set(shared.map(entry => entry.share.clientOwnerUserId))]
  const summaries = new Map(await Promise.all(sharedOwners.map(async owner => [owner, await listWorkspaceClientSummaries(owner)] as const)))
  const candidates = [...personal, ...shared.flatMap(entry => {
    const client = summaries.get(entry.share.clientOwnerUserId)?.find(item => item.id === entry.share.clientId)
    return client ? [{ id: client.id, name: client.name, teamId: entry.team.id }] : []
  })]
  const clients = await Promise.all(candidates.map(async client => {
    const access = await resolveOperationAccess({ userId, clientId: client.id, teamId: client.teamId, module: "article", action: "view" })
    return access.ok ? client : null
  }))
  return { clients: clients.filter(client => client !== null) }
}

async function importGeoAsset(userId: string, sourceOwnerId: string, assetId: string): Promise<PublishingAsset> {
  const source = await getOwnedArticleMediaAsset(assetId, sourceOwnerId)
  if (!source) throw new Error("文章图片不存在或无权读取，请先检查配图")
  const uploadId = randomUUID()
  const root = process.env.LOCAL_PUBLISHER_DATA_DIR || path.join(process.cwd(), ".data/local-publishing")
  const incoming = path.join(root, "incoming", createHash("sha256").update(userId).digest("hex").slice(0, 20), uploadId)
  try {
    await mkdir(path.dirname(incoming), { recursive: true, mode: 0o700 })
    await writeFile(incoming, await readArticleMediaAssetBuffer(source), { flag: "wx", mode: 0o600 })
    return await publishingService().request(userId, "asset.register", { uploadId, kind: "image", name: source.originalName }) as PublishingAsset
  } finally {
    await rm(incoming, { force: true }).catch(() => {})
  }
}

async function importOne(userId: string, input: {
  source: PublishingSource; sourceOwnerId: string; title: string; markdown: string; metadata?: Record<string, unknown>
}): Promise<ProductionImportResult> {
  const existing = await publishingService().request(userId, "article.import.lookup", { source: input.source }) as ProductionImportResult | null
  if (existing) return existing
  let markdown = input.markdown
  const metadata = input.metadata || {}
  const coverUrl = optionalText(metadata.coverUrl, 2000)
  const geoAssetPattern = /\/api\/article-generation\/assets\/(amia_[a-f0-9]{32})\/content/g
  const assetIds = [...new Set([...`${markdown}\n${coverUrl || ""}`.matchAll(geoAssetPattern)].map(match => match[1]))]
  const importedAssets = new Map<string, PublishingAsset>()
  for (const id of assetIds) importedAssets.set(id, await importGeoAsset(userId, input.sourceOwnerId, id))
  markdown = markdown.replace(geoAssetPattern, (_match, id: string) => `local-asset:${importedAssets.get(id)!.id}`)
  // Local URLs are substituted only while sanitizing; they remain private asset references in stored content.
  const placeholders = new Map<string, string>()
  const safeMarkdown = markdown.replace(/local-asset:([A-Za-z0-9_-]+)/g, (local, id: string) => {
    const url = `https://local-asset.invalid/${id}`; placeholders.set(url, local); return url
  })
  const localIds = [...markdown.matchAll(/local-asset:([A-Za-z0-9_-]+)/g)].map(match => match[1])
  for (const id of new Set(localIds)) await publishingService().request(userId, "asset.path", { id })
  const prepared = preparePublishArticle({
    title: input.title, markdown: safeMarkdown, renderedHtml: await marked.parse(safeMarkdown),
    digest: optionalText(metadata.digest, 300) || optionalText(metadata.summary, 300),
    tags: Array.isArray(metadata.tags) ? metadata.tags.filter(tag => typeof tag === "string").join(",") : "",
    createDocument: html => new JSDOM(html).window.document,
  })
  const restore = (value: string) => {
    for (const [url, local] of placeholders) value = value.replaceAll(url, local)
    return value
  }
  const coverGeoId = coverUrl?.match(/\/api\/article-generation\/assets\/(amia_[a-f0-9]{32})\/content/)?.[1]
  const coverLocalId = optionalText(metadata.coverAssetId, 100) || (coverGeoId ? importedAssets.get(coverGeoId)?.id : undefined)
  if (coverLocalId) await publishingService().request(userId, "asset.path", { id: coverLocalId })
  return await publishingService().request(userId, "article.import", {
    title: prepared.title, markdown: restore(prepared.markdownContent), html: restore(prepared.htmlContent), source: input.source,
    metadata: {
      contentType: "article", digest: prepared.digest, tags: prepared.tags, original: metadata.original === true,
      ...(coverLocalId ? { coverAssetId: coverLocalId } : coverUrl ? { coverUrl } : {}),
    },
  }) as ProductionImportResult
}

async function importBatchItems(userId: string, batch: StoredArticleBatch, selected: StoredArticleBatchItem[], variant: "original" | "media", results: ProductionImportResult[], warnings: string[]) {
  if (!selected.length) throw new Error("请先选择已生成正文的文章")
  if (selected.length > 50) throw new Error("单次最多导入 50 篇文章")
  if (selected.some(item => !item.markdown?.trim() || ["queued", "running", "word_processing"].includes(item.status))) throw new Error("所选文章仍在生成或尚无正文，请等待完成后导入")
  if (variant === "media" && selected.some(item => !item.mediaRevision?.markdown?.trim())) throw new Error("所选文章尚未生成配图版本，请选择原文或先完成配图")
  for (const item of selected) {
    const markdown = variant === "media" ? item.mediaRevision?.markdown : item.markdown
    if (!markdown?.trim()) throw new Error("所选文章尚未生成配图版本，请选择原文或先完成配图")
    if (markdown.length > 300000) throw new Error("文章正文超过导入大小限制")
    const title = item.title || item.topic || "文章"
    const metadata = { tags: item.keyword ? [item.keyword] : [], original: false }
    const source: PublishingSource = {
      kind: "production", id: `production:batch:${batch.id}:${item.id}:${variant}`,
      version: sourceHash({ title, markdown, metadata }), name: title, clientId: batch.clientId, batchId: batch.id, itemId: item.id, variant,
    }
    results.push(await importOne(userId, { source, sourceOwnerId: batch.ownerUserId, title, markdown, metadata }))
    if (item.qualityStatus === "review_required" || item.qualityAudit?.finalPassed === false) warnings.push(`《${title}》待质量复核，分发前请检查正文`)
  }
}

export async function importProductionArticles(userId: string, raw: Record<string, unknown>) {
  const results: ProductionImportResult[] = [], warnings: string[] = []
  if (raw.kind === "current") {
    const clientId = requiredText(raw.clientId, "客户标识", 200)
    await requireOperationAccess({ userId, clientId, teamId: optionalText(raw.teamId, 200), module: "article", action: "export" })
    const title = optionalText(raw.title, 200) || "文章"
    const markdown = requiredText(raw.markdown, "文章正文", 300000)
    const inputMetadata = object(raw.metadata)
    const metadata = {
      digest: optionalText(inputMetadata.digest, 300) || optionalText(inputMetadata.summary, 300),
      tags: Array.isArray(inputMetadata.tags) ? inputMetadata.tags.filter(tag => typeof tag === "string").slice(0, 10) : [],
      coverUrl: optionalText(inputMetadata.coverUrl, 2000), coverAssetId: optionalText(inputMetadata.coverAssetId, 100), original: inputMetadata.original === true,
    }
    const source: PublishingSource = {
      kind: "production", id: `production:current:${clientId}:${sourceHash(title).slice(0, 24)}`,
      version: sourceHash({ title, markdown, metadata }), name: title, clientId,
    }
    results.push(await importOne(userId, { source, sourceOwnerId: userId, title, markdown, metadata }))
  } else if (raw.kind === "batch") {
    const batchId = requiredText(raw.batchId, "文章批次标识", 200)
    const authorized = await requireArticleBatchAccess({ userId, batchId, action: "export" })
    if (!authorized) throw new Error("文章批次不存在或无权导入")
    if (raw.variant !== undefined && raw.variant !== "original" && raw.variant !== "media") throw new Error("文章版本无效")
    const variant = raw.variant === "media" ? "media" : "original"
    if (raw.itemIds !== undefined && (!Array.isArray(raw.itemIds) || raw.itemIds.length > 50 || raw.itemIds.some(id => typeof id !== "string" || id.length > 200))) throw new Error("文章选择格式无效")
    const wanted = Array.isArray(raw.itemIds) ? new Set(raw.itemIds as string[]) : null
    const batch = authorized.batch
    if (wanted && [...wanted].some(id => !batch.items.some(item => item.id === id))) throw new Error("所选文章不属于此批次")
    if (wanted && batch.items.some(item => wanted.has(item.id) && !item.markdown?.trim())) throw new Error("所选文章还没有可导入的正文")
    const selected = batch.items.filter(item => (!wanted || wanted.has(item.id)) && Boolean(item.markdown?.trim()))
    await importBatchItems(userId, batch, selected, variant, results, warnings)
  } else if (raw.kind === "production_run") {
    const runId = requiredText(raw.runId, "生产记录标识", 200)
    const clientId = requiredText(raw.clientId, "客户标识", 200)
    const access = await requireOperationAccess({ userId, clientId, teamId: optionalText(raw.teamId, 200), module: "article", action: "export" })
    const run = await getContentProductionRun(access.dataOwnerUserId, runId)
    if (!run || run.clientId !== clientId) throw new Error("内容生产记录不存在或无权导入")
    if (!Array.isArray(raw.itemIds) || raw.itemIds.length < 1 || raw.itemIds.length > 50 || raw.itemIds.some(id => typeof id !== "string" || id.length > 200)) throw new Error("请选择 1～50 篇本次生产的文章")
    const wanted = new Set(raw.itemIds as string[])
    const selected = run.items.filter(item => wanted.has(item.id))
    if (selected.length !== wanted.size || selected.some(item => item.contentType === "video" || !["ready", "review_required"].includes(item.status) || !item.articleBatchId || !item.articleItemId)) throw new Error("所选文章不属于此生产记录或尚未完成")
    const groups = new Map<string, string[]>()
    for (const item of selected) {
      const ids = groups.get(item.articleBatchId!) || []
      ids.push(item.articleItemId!)
      groups.set(item.articleBatchId!, ids)
    }
    for (const [batchId, itemIds] of groups) {
      if (!run.childBatches.some(child => child.id === batchId)) throw new Error("文章批次与生产记录不匹配")
      const batch = await getOwnedStoredArticleBatch(batchId, run.articleOwnerUserId)
      if (!batch || batch.clientId !== clientId || batch.teamId !== run.teamId) throw new Error("文章批次不存在或无权导入")
      const items = itemIds.map(itemId => batch.items.find(item => item.id === itemId))
      if (items.some(item => !item)) throw new Error("文章与生产记录不匹配")
      await importBatchItems(userId, batch, items as StoredArticleBatchItem[], "original", results, warnings)
    }
  } else throw new Error("请选择有效的文章导入来源")
  return {
    articles: results.map(result => result.article), articleIds: results.map(result => result.article.id),
    reused: results.filter(result => result.status === "existing").length, results, warnings,
  }
}
