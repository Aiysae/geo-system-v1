import "server-only"

import { createHash, randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"
import { Pool } from "pg"
import { kv } from "@/lib/kv"
import type {
  KnowledgeImportCandidate,
  KnowledgeImportFileRecord,
  KnowledgeImportRecord,
} from "@/types/knowledge-import"

export interface StoredKnowledgeImportRecord extends KnowledgeImportRecord {
  ownerUserId: string
  workspaceOwnerUserId: string
  storagePaths: Record<string, string>
}

type KnowledgeImportGlobal = typeof globalThis & {
  __geoKnowledgeImportPool?: Pool
  __geoKnowledgeImportSchemaPromise?: Promise<unknown>
}

const globalState = globalThis as KnowledgeImportGlobal
const TTL_SECONDS = 60 * 60 * 24 * 90
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_knowledge_imports_v1 (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  workspace_owner_user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, request_id)
);
CREATE INDEX IF NOT EXISTS geo_knowledge_imports_v1_owner_client_created_idx
  ON geo_knowledge_imports_v1 (owner_user_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_knowledge_imports_v1_workspace_client_created_idx
  ON geo_knowledge_imports_v1 (workspace_owner_user_id, client_id, created_at DESC);
CREATE TABLE IF NOT EXISTS geo_knowledge_import_claims_v1 (
  claim_key TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS geo_knowledge_import_claims_v1_expires_idx
  ON geo_knowledge_import_claims_v1 (expires_at);
`

function backend(): "postgres" | "kv" {
  const configured = String(process.env.KNOWLEDGE_IMPORT_STORE || "").trim().toLowerCase()
  if (configured === "kv") return "kv"
  if (configured === "postgres") return "postgres"
  return process.env.DATABASE_URL ? "postgres" : "kv"
}

function pool(): Pool {
  if (globalState.__geoKnowledgeImportPool) return globalState.__geoKnowledgeImportPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required for knowledge imports")
  globalState.__geoKnowledgeImportPool = new Pool({
    connectionString,
    max: Math.max(1, Math.min(4, Number(process.env.KNOWLEDGE_IMPORT_DB_POOL_MAX) || 2)),
    ssl: /^(1|true|yes|on)$/i.test(String(process.env.DATABASE_SSL || ""))
      ? { rejectUnauthorized: false }
      : undefined,
  })
  return globalState.__geoKnowledgeImportPool
}

async function ensureSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!globalState.__geoKnowledgeImportSchemaPromise) {
    globalState.__geoKnowledgeImportSchemaPromise = pool().query(SCHEMA_SQL)
  }
  await globalState.__geoKnowledgeImportSchemaPromise
}

function rootDirectory(): string {
  const configured = String(process.env.KNOWLEDGE_IMPORT_FILES_DIR || "").trim()
  if (configured) return configured
  return process.env.NODE_ENV === "production"
    ? "/var/lib/geo-system/knowledge-imports"
    : "/tmp/geo-system/knowledge-imports"
}

const recordKey = (id: string) => `geo:knowledge-imports:${id}`
const createClaimKey = (ownerUserId: string, requestId: string) => (
  `geo:knowledge-imports:create-claim:${createHash("sha256").update(`${ownerUserId}:${requestId}`).digest("hex")}`
)
const commitClaimKey = (id: string) => `geo:knowledge-imports:commit-claim:${id}`
const requestKey = (ownerUserId: string, requestId: string) => (
  `geo:knowledge-imports:request:${createHash("sha256").update(ownerUserId).digest("hex").slice(0, 20)}:${requestId}`
)
const indexKey = (workspaceOwnerUserId: string, clientId: string) => (
  `geo:knowledge-imports:index:${createHash("sha256").update(workspaceOwnerUserId).digest("hex").slice(0, 20)}:${clientId}`
)

function clone(record: StoredKnowledgeImportRecord): StoredKnowledgeImportRecord {
  return JSON.parse(JSON.stringify(record)) as StoredKnowledgeImportRecord
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function acquireClaim(key: string, ttlSeconds: number): Promise<string | null> {
  const token = randomUUID()
  if (backend() === "postgres") {
    await ensureSchema()
    const result = await pool().query<{ token: string }>(
      `INSERT INTO geo_knowledge_import_claims_v1 (claim_key, token, expires_at)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))
       ON CONFLICT (claim_key) DO UPDATE
       SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
       WHERE geo_knowledge_import_claims_v1.expires_at <= NOW()
       RETURNING token`,
      [key, token, Math.max(10, Math.floor(ttlSeconds))],
    )
    return result.rows[0]?.token === token ? token : null
  }
  const claimed = await kv.set(key, token, { nx: true, ex: ttlSeconds })
  return claimed ? token : null
}

async function releaseClaim(key: string, token: string): Promise<void> {
  if (backend() === "postgres") {
    await ensureSchema()
    await pool().query(
      "DELETE FROM geo_knowledge_import_claims_v1 WHERE claim_key = $1 AND token = $2",
      [key, token],
    )
    return
  }
  const current = await kv.get<string>(key)
  if (current === token) await kv.del(key)
}

function normalize(value: unknown): StoredKnowledgeImportRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as StoredKnowledgeImportRecord
  if (!record.id || !record.ownerUserId || !record.clientId || !record.requestId) return null
  return clone(record)
}

function publicRecord(record: StoredKnowledgeImportRecord): KnowledgeImportRecord {
  const output: Partial<StoredKnowledgeImportRecord> = clone(record)
  delete output.ownerUserId
  delete output.workspaceOwnerUserId
  delete output.storagePaths
  return output as KnowledgeImportRecord
}

async function save(record: StoredKnowledgeImportRecord): Promise<void> {
  record.updatedAt = new Date().toISOString()
  if (backend() === "postgres") {
    await ensureSchema()
    await pool().query(
      `INSERT INTO geo_knowledge_imports_v1
        (id, owner_user_id, workspace_owner_user_id, client_id, request_id, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [
        record.id,
        record.ownerUserId,
        record.workspaceOwnerUserId,
        record.clientId,
        record.requestId,
        JSON.stringify(record),
        record.createdAt,
        record.updatedAt,
      ],
    )
    return
  }
  await kv.set(recordKey(record.id), record, { ex: TTL_SECONDS })
  await kv.set(requestKey(record.ownerUserId, record.requestId), record.id, { ex: TTL_SECONDS })
  await kv.sadd(indexKey(record.workspaceOwnerUserId, record.clientId), record.id)
}

async function load(id: string): Promise<StoredKnowledgeImportRecord | null> {
  if (backend() === "postgres") {
    await ensureSchema()
    const result = await pool().query<{ data: unknown }>(
      "SELECT data FROM geo_knowledge_imports_v1 WHERE id = $1 LIMIT 1",
      [id],
    )
    return normalize(result.rows[0]?.data)
  }
  return normalize(await kv.get<StoredKnowledgeImportRecord>(recordKey(id)))
}

function safeFileName(value: string): string {
  return String(value || "file")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 180) || "file"
}

function storagePath(ownerUserId: string, importId: string, fileId: string, name: string): string {
  const owner = createHash("sha256").update(ownerUserId).digest("hex").slice(0, 20)
  return path.join(rootDirectory(), owner, importId, `${fileId}_${safeFileName(name)}`)
}

export async function findKnowledgeImportByRequest(
  ownerUserId: string,
  requestId: string,
): Promise<StoredKnowledgeImportRecord | null> {
  if (backend() === "postgres") {
    await ensureSchema()
    const result = await pool().query<{ data: unknown }>(
      `SELECT data FROM geo_knowledge_imports_v1
       WHERE owner_user_id = $1 AND request_id = $2 LIMIT 1`,
      [ownerUserId, requestId],
    )
    return normalize(result.rows[0]?.data)
  }
  const id = await kv.get<string>(requestKey(ownerUserId, requestId))
  return id ? load(id) : null
}

export async function createKnowledgeImportRecord(input: {
  ownerUserId: string
  workspaceOwnerUserId: string
  clientId: string
  teamId?: string
  requestId: string
  files: Array<{
    metadata: KnowledgeImportFileRecord
    buffer: Buffer
  }>
}): Promise<StoredKnowledgeImportRecord> {
  const existing = await findKnowledgeImportByRequest(input.ownerUserId, input.requestId)
  if (existing) return existing
  const claimKey = createClaimKey(input.ownerUserId, input.requestId)
  const claimToken = await acquireClaim(claimKey, 120)
  if (!claimToken) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const concurrent = await findKnowledgeImportByRequest(input.ownerUserId, input.requestId)
      if (concurrent) return concurrent
      await sleep(100)
    }
    throw new Error("该批资料正在创建，请稍后刷新导入记录")
  }
  const id = `kimp_${randomUUID().replace(/-/g, "")}`
  try {
    const paths: Record<string, string> = {}
    for (const file of input.files) {
      const target = storagePath(input.ownerUserId, id, file.metadata.id, file.metadata.name)
      const directory = path.dirname(target)
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      await fs.chmod(directory, 0o700)
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(temporary, file.buffer, { mode: 0o600 })
      await fs.rename(temporary, target)
      paths[file.metadata.id] = target
    }
    const now = new Date().toISOString()
    const record: StoredKnowledgeImportRecord = {
      id,
      ownerUserId: input.ownerUserId,
      workspaceOwnerUserId: input.workspaceOwnerUserId,
      clientId: input.clientId,
      teamId: input.teamId,
      requestId: input.requestId,
      status: "queued",
      stage: "资料已上传，等待提炼",
      progressPercent: 10,
      files: input.files.map(file => file.metadata),
      candidates: [],
      approvedCount: 0,
      storagePaths: paths,
      createdAt: now,
      updatedAt: now,
    }
    await save(record)
    return record
  } finally {
    await releaseClaim(claimKey, claimToken).catch(() => undefined)
  }
}

export async function patchKnowledgeImportRecord(
  id: string,
  mutate: (record: StoredKnowledgeImportRecord) => void,
): Promise<StoredKnowledgeImportRecord | null> {
  const current = await load(id)
  if (!current) return null
  mutate(current)
  await save(current)
  return current
}

export async function getOwnedKnowledgeImport(
  id: string,
  ownerUserId: string,
): Promise<StoredKnowledgeImportRecord | null> {
  const record = await load(id)
  return record?.ownerUserId === ownerUserId ? record : null
}

export async function getPublicOwnedKnowledgeImport(
  id: string,
  ownerUserId: string,
): Promise<KnowledgeImportRecord | null> {
  const record = await getOwnedKnowledgeImport(id, ownerUserId)
  return record ? publicRecord(record) : null
}

export async function getWorkspaceKnowledgeImport(
  id: string,
  workspaceOwnerUserId: string,
  clientId: string,
): Promise<StoredKnowledgeImportRecord | null> {
  const record = await load(id)
  return record?.workspaceOwnerUserId === workspaceOwnerUserId && record.clientId === clientId
    ? record
    : null
}

export async function getPublicWorkspaceKnowledgeImport(
  id: string,
  workspaceOwnerUserId: string,
  clientId: string,
): Promise<KnowledgeImportRecord | null> {
  const record = await getWorkspaceKnowledgeImport(id, workspaceOwnerUserId, clientId)
  return record ? publicRecord(record) : null
}

export async function listWorkspaceKnowledgeImports(
  workspaceOwnerUserId: string,
  clientId: string,
  limit = 12,
): Promise<KnowledgeImportRecord[]> {
  const safeLimit = Math.max(1, Math.min(30, Math.floor(limit)))
  let records: StoredKnowledgeImportRecord[]
  if (backend() === "postgres") {
    await ensureSchema()
    const result = await pool().query<{ data: unknown }>(
      `SELECT data FROM geo_knowledge_imports_v1
       WHERE workspace_owner_user_id = $1 AND client_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [workspaceOwnerUserId, clientId, safeLimit],
    )
    records = result.rows.map(row => normalize(row.data)).filter((item): item is StoredKnowledgeImportRecord => Boolean(item))
  } else {
    const ids = await kv.smembers<string[]>(indexKey(workspaceOwnerUserId, clientId))
    records = (await Promise.all(ids.map(id => load(id))))
      .filter((item): item is StoredKnowledgeImportRecord => Boolean(
        item?.workspaceOwnerUserId === workspaceOwnerUserId && item.clientId === clientId,
      ))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, safeLimit)
  }
  return records.map(publicRecord)
}

/** @deprecated Prefer workspace-scoped imports so authorized team members share review history. */
export async function listOwnedKnowledgeImports(
  ownerUserId: string,
  clientId: string,
  limit = 12,
): Promise<KnowledgeImportRecord[]> {
  return listWorkspaceKnowledgeImports(ownerUserId, clientId, limit)
}

export async function readKnowledgeImportFile(
  record: StoredKnowledgeImportRecord,
  fileId: string,
): Promise<{ buffer: Buffer; metadata: KnowledgeImportFileRecord } | null> {
  const metadata = record.files.find(file => file.id === fileId)
  const target = record.storagePaths[fileId]
  if (!metadata || !target) return null
  const root = path.resolve(rootDirectory())
  const resolvedTarget = path.resolve(target)
  if (resolvedTarget !== root && !resolvedTarget.startsWith(`${root}${path.sep}`)) return null
  return { buffer: await fs.readFile(/* turbopackIgnore: true */ resolvedTarget), metadata }
}

export function setKnowledgeImportCandidates(
  record: StoredKnowledgeImportRecord,
  candidates: KnowledgeImportCandidate[],
): void {
  record.candidates = candidates
  record.status = "review"
  record.stage = `已提炼 ${candidates.length} 条候选资料，请审核`
  record.progressPercent = 100
}

export async function acquireKnowledgeImportCommitLease(
  id: string,
): Promise<string | null> {
  return acquireClaim(commitClaimKey(id), 120)
}

export async function releaseKnowledgeImportCommitLease(
  id: string,
  token: string,
): Promise<void> {
  await releaseClaim(commitClaimKey(id), token)
}

export { SCHEMA_SQL as KNOWLEDGE_IMPORT_SCHEMA_SQL }
