import "server-only"

import { createHash, randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"
import { Pool } from "pg"
import sharp from "sharp"
import { kv } from "@/lib/kv"
import type { ArticleMediaAssetRecord } from "@/types"

export interface StoredArticleMediaAsset extends ArticleMediaAssetRecord {
  ownerUserId: string
  sha256: string
  storagePath: string
}

type ArticleMediaGlobal = typeof globalThis & {
  __geoArticleMediaPool?: Pool
  __geoArticleMediaSchemaPromise?: Promise<unknown>
}

const globalState = globalThis as ArticleMediaGlobal
const ASSET_TTL_SECONDS = 60 * 60 * 24 * 365
const MAX_INPUT_BYTES = 12 * 1024 * 1024
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_EDGE = 2400

const ARTICLE_MEDIA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_article_media_assets_v1 (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, sha256)
);
CREATE INDEX IF NOT EXISTS geo_article_media_assets_v1_owner_client_created_idx
  ON geo_article_media_assets_v1 (owner_user_id, client_id, created_at DESC);
`

function backend(): "postgres" | "kv" {
  const configured = String(process.env.ARTICLE_MEDIA_STORE || "").trim().toLowerCase()
  if (configured === "kv") return "kv"
  if (configured === "postgres") return "postgres"
  return process.env.DATABASE_URL ? "postgres" : "kv"
}

function pool(): Pool {
  if (globalState.__geoArticleMediaPool) return globalState.__geoArticleMediaPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required for article media storage")
  globalState.__geoArticleMediaPool = new Pool({
    connectionString,
    max: Math.max(1, Math.min(4, Number(process.env.ARTICLE_MEDIA_DB_POOL_MAX) || 2)),
    ssl: /^(1|true|yes|on)$/i.test(String(process.env.DATABASE_SSL || ""))
      ? { rejectUnauthorized: false }
      : undefined,
  })
  return globalState.__geoArticleMediaPool
}

async function ensureSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!globalState.__geoArticleMediaSchemaPromise) {
    globalState.__geoArticleMediaSchemaPromise = pool().query(ARTICLE_MEDIA_SCHEMA_SQL)
  }
  await globalState.__geoArticleMediaSchemaPromise
}

function assetRoot(): string {
  const configured = String(process.env.ARTICLE_MEDIA_ASSETS_DIR || "").trim()
  if (configured) return configured
  return process.env.NODE_ENV === "production"
    ? "/var/lib/geo-system/article-media-assets"
    : "/tmp/geo-system/article-media-assets"
}

function safeAssetPath(ownerUserId: string, id: string, extension: string): string {
  const owner = createHash("sha256").update(ownerUserId).digest("hex").slice(0, 20)
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "")
  return path.join(assetRoot(), owner, `${safeId}.${extension}`)
}

function cleanOriginalName(value: string): string {
  return String(value || "图片")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120) || "图片"
}

function cloneAsset(asset: StoredArticleMediaAsset): StoredArticleMediaAsset {
  return JSON.parse(JSON.stringify(asset)) as StoredArticleMediaAsset
}

function normalizeStoredAsset(value: unknown): StoredArticleMediaAsset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const asset = value as StoredArticleMediaAsset
  if (!asset.id || !asset.ownerUserId || !asset.storagePath || !asset.sha256) return null
  return cloneAsset(asset)
}

const assetKey = (id: string) => `geo:article-media-assets:${id}`
const dedupeKey = (ownerUserId: string, sha256: string) => (
  `geo:article-media-assets:dedupe:${createHash("sha256").update(ownerUserId).digest("hex").slice(0, 20)}:${sha256}`
)

async function readPostgres(id: string): Promise<StoredArticleMediaAsset | null> {
  await ensureSchema()
  const result = await pool().query<{ data: unknown }>(
    "SELECT data FROM geo_article_media_assets_v1 WHERE id = $1 LIMIT 1",
    [id],
  )
  return normalizeStoredAsset(result.rows[0]?.data)
}

async function findPostgresByHash(
  ownerUserId: string,
  sha256: string,
): Promise<StoredArticleMediaAsset | null> {
  await ensureSchema()
  const result = await pool().query<{ data: unknown }>(
    `SELECT data FROM geo_article_media_assets_v1
     WHERE owner_user_id = $1 AND sha256 = $2 LIMIT 1`,
    [ownerUserId, sha256],
  )
  return normalizeStoredAsset(result.rows[0]?.data)
}

async function saveMetadata(asset: StoredArticleMediaAsset): Promise<void> {
  if (backend() === "postgres") {
    await ensureSchema()
    await pool().query(
      `INSERT INTO geo_article_media_assets_v1
        (id, owner_user_id, client_id, sha256, data, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
       ON CONFLICT (owner_user_id, sha256) DO NOTHING`,
      [asset.id, asset.ownerUserId, asset.clientId, asset.sha256, JSON.stringify(asset), asset.createdAt],
    )
    return
  }
  await kv.set(assetKey(asset.id), asset, { ex: ASSET_TTL_SECONDS })
  await kv.set(dedupeKey(asset.ownerUserId, asset.sha256), asset.id, { ex: ASSET_TTL_SECONDS })
}

async function existingByHash(ownerUserId: string, sha256: string): Promise<StoredArticleMediaAsset | null> {
  if (backend() === "postgres") return findPostgresByHash(ownerUserId, sha256)
  const id = await kv.get<string>(dedupeKey(ownerUserId, sha256))
  return id ? normalizeStoredAsset(await kv.get<StoredArticleMediaAsset>(assetKey(id))) : null
}

export function toPublicArticleMediaAsset(asset: StoredArticleMediaAsset): ArticleMediaAssetRecord {
  return {
    id: asset.id,
    clientId: asset.clientId,
    batchId: asset.batchId,
    originalName: asset.originalName,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt,
  }
}

export async function createArticleMediaAsset(input: {
  ownerUserId: string
  clientId: string
  batchId?: string
  originalName: string
  buffer: Buffer
}): Promise<StoredArticleMediaAsset> {
  if (!input.buffer.length || input.buffer.length > MAX_INPUT_BYTES) {
    throw new Error("单张图片需要小于 12MB")
  }

  let pipeline = sharp(input.buffer, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
  }).rotate().resize({
    width: MAX_IMAGE_EDGE,
    height: MAX_IMAGE_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  })
  const sourceMetadata = await sharp(input.buffer, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
  }).metadata()
  if (!sourceMetadata.width || !sourceMetadata.height || !sourceMetadata.format) {
    throw new Error("无法读取这张图片，请换用 JPG、PNG 或 WebP 文件")
  }
  if (!new Set(["jpeg", "jpg", "png", "webp"]).has(sourceMetadata.format)) {
    throw new Error("仅支持 JPG、PNG 和 WebP 图片")
  }

  const preserveAlpha = Boolean(sourceMetadata.hasAlpha)
  pipeline = preserveAlpha
    ? pipeline.png({ compressionLevel: 8, palette: true, quality: 90 })
    : pipeline.jpeg({ quality: 88, mozjpeg: true })
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  if (data.length > MAX_OUTPUT_BYTES) {
    throw new Error("图片压缩后仍超过 8MB，请降低分辨率后重试")
  }

  const sha256 = createHash("sha256").update(data).digest("hex")
  const existing = await existingByHash(input.ownerUserId, sha256)
  if (existing) {
    try {
      await fs.access(/*turbopackIgnore: true*/ existing.storagePath)
      return existing
    } catch {
      await fs.mkdir(path.dirname(existing.storagePath), { recursive: true })
      await fs.writeFile(existing.storagePath, data)
      return existing
    }
  }

  const id = `amia_${randomUUID().replace(/-/g, "")}`
  const extension = preserveAlpha ? "png" : "jpg"
  const mimeType = preserveAlpha ? "image/png" : "image/jpeg"
  const storagePath = safeAssetPath(input.ownerUserId, id, extension)
  const originalName = cleanOriginalName(input.originalName)
  const baseName = cleanOriginalName(originalName.replace(/\.[^.]+$/, ""))
  const asset: StoredArticleMediaAsset = {
    id,
    ownerUserId: input.ownerUserId,
    clientId: input.clientId,
    batchId: input.batchId,
    originalName,
    fileName: `${baseName}.${extension}`,
    mimeType,
    sizeBytes: data.length,
    width: info.width,
    height: info.height,
    sha256,
    storagePath,
    createdAt: new Date().toISOString(),
  }
  await fs.mkdir(path.dirname(storagePath), { recursive: true })
  const tempPath = `${storagePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, data)
  await fs.rename(tempPath, storagePath)
  await saveMetadata(asset)

  const stored = await existingByHash(input.ownerUserId, sha256)
  if (stored && stored.id !== asset.id) {
    await fs.rm(storagePath, { force: true })
    return stored
  }
  return asset
}

export async function getArticleMediaAsset(id: string): Promise<StoredArticleMediaAsset | null> {
  if (backend() === "postgres") return readPostgres(id)
  return normalizeStoredAsset(await kv.get<StoredArticleMediaAsset>(assetKey(id)))
}

export async function getOwnedArticleMediaAsset(
  id: string,
  ownerUserId: string,
): Promise<StoredArticleMediaAsset | null> {
  const asset = await getArticleMediaAsset(id)
  return asset?.ownerUserId === ownerUserId ? asset : null
}

export async function getOwnedArticleMediaAssets(
  ids: string[],
  ownerUserId: string,
): Promise<StoredArticleMediaAsset[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  const assets = await Promise.all(uniqueIds.map(id => getOwnedArticleMediaAsset(id, ownerUserId)))
  return assets.filter((asset): asset is StoredArticleMediaAsset => Boolean(asset))
}

export async function readArticleMediaAssetBuffer(
  asset: StoredArticleMediaAsset,
): Promise<Buffer> {
  return fs.readFile(/*turbopackIgnore: true*/ asset.storagePath)
}

export { ARTICLE_MEDIA_SCHEMA_SQL, MAX_INPUT_BYTES }
