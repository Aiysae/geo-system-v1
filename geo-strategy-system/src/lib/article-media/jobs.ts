import "server-only"

import { createHash, randomUUID } from "crypto"
import { Pool } from "pg"
import { kv } from "@/lib/kv"
import {
  getOwnedArticleMediaAssets,
  type StoredArticleMediaAsset,
} from "@/lib/article-media/assets"
import {
  articleMediaTemplateCount,
  insertArticleMedia,
} from "@/lib/article-media/markdown"
import {
  getOwnedStoredArticleBatch,
  mutateStoredArticleBatch,
} from "@/lib/article-batches/store"
import { syncArticleMediaJobTask } from "@/lib/task-center/adapters"
import {
  clearTaskCancellation,
  isTaskCancellationRequested,
  signalTaskCancellation,
} from "@/lib/task-cancellation"
import {
  dispatchDurableTaskOrFallback,
  type TaskWorkerOutcome,
} from "@/lib/task-queue"
import type {
  ArticleMediaJobRecord,
  ArticleMediaMappingMode,
  ArticleMediaTemplateKey,
} from "@/types"

interface StoredArticleMediaJob extends ArticleMediaJobRecord {
  ownerUserId: string
  workspaceOwnerUserId?: string
  teamId?: string
  itemIds: string[]
  assetIds: string[]
  itemAssetMap: Record<string, string[]>
  failedItemIds: string[]
}

type ArticleMediaJobGlobal = typeof globalThis & {
  __geoArticleMediaJobPool?: Pool
  __geoArticleMediaJobSchemaPromise?: Promise<unknown>
}

const globalState = globalThis as ArticleMediaJobGlobal
const JOB_TTL_SECONDS = 60 * 60 * 24 * 30
const PENDING_SET_KEY = "geo:article-media-jobs:pending"
const runningLocalJobs = new Set<string>()

const ARTICLE_MEDIA_JOB_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_article_media_jobs_v1 (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, request_id)
);
CREATE INDEX IF NOT EXISTS geo_article_media_jobs_v1_owner_batch_created_idx
  ON geo_article_media_jobs_v1 (owner_user_id, batch_id, created_at DESC);
`

function backend(): "postgres" | "kv" {
  const configured = String(process.env.ARTICLE_MEDIA_JOB_STORE || "").trim().toLowerCase()
  if (configured === "kv") return "kv"
  if (configured === "postgres") return "postgres"
  return process.env.DATABASE_URL ? "postgres" : "kv"
}

function pool(): Pool {
  if (globalState.__geoArticleMediaJobPool) return globalState.__geoArticleMediaJobPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required for article media jobs")
  globalState.__geoArticleMediaJobPool = new Pool({
    connectionString,
    max: Math.max(1, Math.min(4, Number(process.env.ARTICLE_MEDIA_JOB_DB_POOL_MAX) || 2)),
    ssl: /^(1|true|yes|on)$/i.test(String(process.env.DATABASE_SSL || ""))
      ? { rejectUnauthorized: false }
      : undefined,
  })
  return globalState.__geoArticleMediaJobPool
}

async function ensureSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!globalState.__geoArticleMediaJobSchemaPromise) {
    globalState.__geoArticleMediaJobSchemaPromise = pool().query(ARTICLE_MEDIA_JOB_SCHEMA_SQL)
  }
  await globalState.__geoArticleMediaJobSchemaPromise
}

const jobKey = (id: string) => `geo:article-media-jobs:${id}`
const requestKey = (ownerUserId: string, requestId: string) => (
  `geo:article-media-jobs:request:${createHash("sha256").update(ownerUserId).digest("hex").slice(0, 20)}:${requestId}`
)
const indexKey = (ownerUserId: string, batchId: string) => (
  `geo:article-media-jobs:index:${createHash("sha256").update(ownerUserId).digest("hex").slice(0, 20)}:${batchId}`
)

function nowIso(): string {
  return new Date().toISOString()
}

function cloneJob(job: StoredArticleMediaJob): StoredArticleMediaJob {
  return JSON.parse(JSON.stringify(job)) as StoredArticleMediaJob
}

function normalizeStoredJob(value: unknown): StoredArticleMediaJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const job = value as StoredArticleMediaJob
  if (!job.id || !job.ownerUserId || !job.batchId || !Array.isArray(job.itemIds)) return null
  return cloneJob(job)
}

function toPublicJob(job: StoredArticleMediaJob): ArticleMediaJobRecord {
  return {
    id: job.id,
    batchId: job.batchId,
    clientId: job.clientId,
    requestId: job.requestId,
    status: job.status,
    template: job.template,
    mappingMode: job.mappingMode,
    requestedCount: job.requestedCount,
    completedCount: job.completedCount,
    failedCount: job.failedCount,
    progressPercent: job.progressPercent,
    stage: job.stage,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }
}

async function syncPending(job: StoredArticleMediaJob): Promise<void> {
  const terminal = ["succeeded", "partial", "failed", "cancelled"].includes(job.status)
  if (terminal) await kv.srem(PENDING_SET_KEY, job.id)
  else await kv.sadd(PENDING_SET_KEY, job.id)
}

async function saveJob(job: StoredArticleMediaJob): Promise<void> {
  job.updatedAt = nowIso()
  if (backend() === "postgres") {
    await ensureSchema()
    await pool().query(
      `INSERT INTO geo_article_media_jobs_v1
        (id, owner_user_id, batch_id, request_id, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [job.id, job.ownerUserId, job.batchId, job.requestId, JSON.stringify(job), job.createdAt, job.updatedAt],
    )
  } else {
    await kv.set(jobKey(job.id), job, { ex: JOB_TTL_SECONDS })
    await kv.set(requestKey(job.ownerUserId, job.requestId), job.id, { ex: JOB_TTL_SECONDS })
    await kv.sadd(indexKey(job.ownerUserId, job.batchId), job.id)
  }
  await syncArticleMediaJobTask(job)
  await syncPending(job)
}

async function getJob(id: string): Promise<StoredArticleMediaJob | null> {
  if (backend() === "postgres") {
    await ensureSchema()
    const result = await pool().query<{ data: unknown }>(
      "SELECT data FROM geo_article_media_jobs_v1 WHERE id = $1 LIMIT 1",
      [id],
    )
    return normalizeStoredJob(result.rows[0]?.data)
  }
  return normalizeStoredJob(await kv.get<StoredArticleMediaJob>(jobKey(id)))
}

async function findByRequest(ownerUserId: string, requestId: string): Promise<StoredArticleMediaJob | null> {
  if (backend() === "postgres") {
    await ensureSchema()
    const result = await pool().query<{ data: unknown }>(
      `SELECT data FROM geo_article_media_jobs_v1
       WHERE owner_user_id = $1 AND request_id = $2 LIMIT 1`,
      [ownerUserId, requestId],
    )
    return normalizeStoredJob(result.rows[0]?.data)
  }
  const id = await kv.get<string>(requestKey(ownerUserId, requestId))
  return id ? getJob(id) : null
}

function assignedAssets(input: {
  job: StoredArticleMediaJob
  itemId: string
  itemIndex: number
  assets: Map<string, StoredArticleMediaAsset>
}): StoredArticleMediaAsset[] {
  const { job, itemId, itemIndex, assets } = input
  const count = articleMediaTemplateCount(job.template)
  let ids: string[]
  if (job.mappingMode === "per_article") {
    ids = job.itemAssetMap[itemId] || []
  } else if (job.mappingMode === "same_set") {
    ids = job.assetIds.slice(0, count)
  } else {
    const offset = job.assetIds.length > 0 ? itemIndex % job.assetIds.length : 0
    ids = [...job.assetIds.slice(offset), ...job.assetIds.slice(0, offset)].slice(0, count)
  }
  return [...new Set(ids)].map(id => assets.get(id)).filter((asset): asset is StoredArticleMediaAsset => Boolean(asset))
}

function scheduleLocal(jobId: string): void {
  if (runningLocalJobs.has(jobId)) return
  runningLocalJobs.add(jobId)
  setTimeout(() => {
    void runArticleMediaJobFromWorker(jobId)
      .catch(error => console.error("[article-media] local job failed", jobId, error))
      .finally(() => runningLocalJobs.delete(jobId))
  }, 0)
}

export async function createArticleMediaJob(input: {
  ownerUserId: string
  workspaceOwnerUserId?: string
  teamId?: string
  batchId: string
  requestId: string
  itemIds: string[]
  assetIds: string[]
  itemAssetMap?: Record<string, string[]>
  template: ArticleMediaTemplateKey
  mappingMode: ArticleMediaMappingMode
}): Promise<{ job: ArticleMediaJobRecord; reused: boolean }> {
  const existing = await findByRequest(input.ownerUserId, input.requestId)
  if (existing) return { job: toPublicJob(existing), reused: true }
  const batch = await getOwnedStoredArticleBatch(input.batchId, input.ownerUserId)
  if (!batch) throw new Error("文章批次不存在")

  const itemIds = [...new Set(input.itemIds)].filter(id => (
    batch.items.some(item => item.id === id && Boolean(item.markdown))
  ))
  if (itemIds.length === 0) throw new Error("请选择至少一篇已经生成正文的文章")
  const allAssetIds = [...new Set([
    ...input.assetIds,
    ...Object.values(input.itemAssetMap || {}).flat(),
  ].filter(Boolean))]
  const assets = await getOwnedArticleMediaAssets(allAssetIds, input.ownerUserId)
  if (assets.length !== allAssetIds.length || assets.length === 0) {
    throw new Error("部分图片不存在或已经失效，请重新上传")
  }

  const now = nowIso()
  const job: StoredArticleMediaJob = {
    id: `amj_${randomUUID().replace(/-/g, "")}`,
    ownerUserId: input.ownerUserId,
    workspaceOwnerUserId: input.workspaceOwnerUserId,
    teamId: input.teamId,
    batchId: input.batchId,
    clientId: batch.clientId,
    requestId: input.requestId,
    status: "queued",
    template: input.template,
    mappingMode: input.mappingMode,
    itemIds,
    assetIds: input.assetIds,
    itemAssetMap: input.itemAssetMap || {},
    failedItemIds: [],
    requestedCount: itemIds.length,
    completedCount: 0,
    failedCount: 0,
    progressPercent: 0,
    stage: "批量配图任务已进入后台队列",
    createdAt: now,
    updatedAt: now,
  }
  try {
    await saveJob(job)
  } catch (error) {
    const raced = await findByRequest(input.ownerUserId, input.requestId)
    if (raced) return { job: toPublicJob(raced), reused: true }
    throw error
  }
  await dispatchDurableTaskOrFallback("articleMedia", job.id, () => scheduleLocal(job.id))
  return { job: toPublicJob(job), reused: false }
}

export async function runArticleMediaJobFromWorker(jobId: string): Promise<TaskWorkerOutcome> {
  const job = await getJob(jobId)
  if (!job || ["succeeded", "partial", "failed", "cancelled"].includes(job.status)) return {}
  job.status = "running"
  job.startedAt ||= nowIso()
  job.stage = "正在按文章结构插入图片"
  await saveJob(job)

  try {
    const batch = await getOwnedStoredArticleBatch(job.batchId, job.ownerUserId)
    if (!batch) throw new Error("原文章批次不存在")
    const allAssetIds = [...new Set([
      ...job.assetIds,
      ...Object.values(job.itemAssetMap).flat(),
    ])]
    const assets = new Map(
      (await getOwnedArticleMediaAssets(allAssetIds, job.ownerUserId)).map(asset => [asset.id, asset]),
    )

    for (let index = job.completedCount + job.failedCount; index < job.itemIds.length; index++) {
      if (await isTaskCancellationRequested("articleMedia", job.id)) {
        job.status = "cancelled"
        job.stage = `已停止，已完成 ${job.completedCount}/${job.requestedCount} 篇`
        job.finishedAt = nowIso()
        job.progressPercent = Math.round((job.completedCount + job.failedCount) / job.requestedCount * 100)
        await saveJob(job)
        await clearTaskCancellation("articleMedia", job.id)
        return {}
      }
      const itemId = job.itemIds[index]
      try {
        const item = batch.items.find(candidate => candidate.id === itemId)
        if (!item?.markdown) throw new Error("文章正文不存在")
        const selectedAssets = assignedAssets({ job, itemId, itemIndex: index, assets })
        if (selectedAssets.length === 0) throw new Error("这篇文章没有可用图片")
        const revision = insertArticleMedia({
          markdown: item.markdown,
          assets: selectedAssets.map(asset => ({
            id: asset.id,
            alt: asset.originalName.replace(/\.[^.]+$/, ""),
          })),
          template: job.template,
          mappingMode: job.mappingMode,
        })
        if (revision.placements.length === 0) throw new Error("文章结构中没有找到安全的插图位置")
        await mutateStoredArticleBatch(job.batchId, current => {
          const currentItem = current.items.find(candidate => candidate.id === itemId)
          if (!currentItem) throw new Error("文章已被删除")
          currentItem.mediaRevision = revision
          currentItem.mediaArtifactPath = undefined
          currentItem.mediaFileName = undefined
          currentItem.updatedAt = nowIso()
        })
        job.completedCount += 1
      } catch (error) {
        job.failedCount += 1
        job.failedItemIds.push(itemId)
        job.error = error instanceof Error ? error.message : "配图失败"
      }
      job.progressPercent = Math.round((job.completedCount + job.failedCount) / job.requestedCount * 100)
      job.stage = `已处理 ${job.completedCount + job.failedCount}/${job.requestedCount} 篇`
      await saveJob(job)
    }

    job.status = job.failedCount === 0 ? "succeeded" : job.completedCount > 0 ? "partial" : "failed"
    job.progressPercent = 100
    job.stage = job.failedCount === 0
      ? `图文版本已生成，共 ${job.completedCount} 篇`
      : `图文版本完成 ${job.completedCount} 篇，失败 ${job.failedCount} 篇`
    job.finishedAt = nowIso()
    await saveJob(job)
    await clearTaskCancellation("articleMedia", job.id)
    return {}
  } catch (error) {
    job.status = "failed"
    job.progressPercent = 100
    job.stage = "批量配图失败"
    job.error = error instanceof Error ? error.message : "批量配图失败"
    job.finishedAt = nowIso()
    await saveJob(job)
    await clearTaskCancellation("articleMedia", job.id)
    throw error
  }
}

export async function listArticleMediaJobs(
  ownerUserId: string,
  batchId: string,
  limit = 8,
): Promise<ArticleMediaJobRecord[]> {
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)))
  let jobs: StoredArticleMediaJob[]
  if (backend() === "postgres") {
    await ensureSchema()
    const result = await pool().query<{ data: unknown }>(
      `SELECT data FROM geo_article_media_jobs_v1
       WHERE owner_user_id = $1 AND batch_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [ownerUserId, batchId, safeLimit],
    )
    jobs = result.rows.map(row => normalizeStoredJob(row.data)).filter((job): job is StoredArticleMediaJob => Boolean(job))
  } else {
    const ids = await kv.smembers<string[]>(indexKey(ownerUserId, batchId))
    jobs = (await Promise.all(ids.map(id => getJob(id))))
      .filter((job): job is StoredArticleMediaJob => Boolean(job?.ownerUserId === ownerUserId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, safeLimit)
  }
  return jobs.map(toPublicJob)
}

export async function getOwnedArticleMediaJob(
  id: string,
  ownerUserId: string,
): Promise<ArticleMediaJobRecord | null> {
  const job = await getJob(id)
  return job?.ownerUserId === ownerUserId ? toPublicJob(job) : null
}

export async function cancelArticleMediaJob(
  id: string,
  ownerUserId: string,
): Promise<ArticleMediaJobRecord | null> {
  const job = await getJob(id)
  if (!job || job.ownerUserId !== ownerUserId) return null
  if (["succeeded", "partial", "failed", "cancelled"].includes(job.status)) return toPublicJob(job)
  await signalTaskCancellation("articleMedia", job.id, ownerUserId)
  if (job.status === "queued") {
    job.status = "cancelled"
    job.stage = "任务已停止"
    job.finishedAt = nowIso()
    await saveJob(job)
  }
  return toPublicJob(job)
}

export async function resumePendingArticleMediaJobs(): Promise<void> {
  const ids = await kv.smembers<string[]>(PENDING_SET_KEY)
  await Promise.all(ids.slice(0, 200).map(async id => {
    const job = await getJob(id)
    if (!job || ["succeeded", "partial", "failed", "cancelled"].includes(job.status)) {
      await kv.srem(PENDING_SET_KEY, id)
      return
    }
    await dispatchDurableTaskOrFallback("articleMedia", id, () => scheduleLocal(id))
  }))
}

export { ARTICLE_MEDIA_JOB_SCHEMA_SQL }
