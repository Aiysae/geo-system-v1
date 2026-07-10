import "server-only"

import { randomUUID } from "crypto"
import { gzipSync, gunzipSync } from "zlib"
import { kv } from "@/lib/kv"
import {
  createInternalApiHeaders,
  INTERNAL_API_USER_HEADER,
} from "@/lib/internal-api"
import {
  ARTICLE_PROMPT_PRICE_KEYS,
  estimateFeatureCredits,
  getFeaturePrice,
  type FeaturePriceKey,
} from "@/lib/pricing"
import {
  refundReservedCredits,
  reserveCreditsForUser,
  settleReservedCredits,
  type CreditReservation,
} from "@/lib/with-credits"
import type {
  ArticlePromptKey,
  BackgroundJobKind,
  BackgroundJobRecord,
} from "@/types"

type StoredBackgroundJob = BackgroundJobRecord & {
  ownerUserId: string
  payloadGzip: string
  endpoint: string
  reservation: CreditReservation
  creditCost: number
  creditsSettledAt?: string
}

type TaskDefinition = {
  endpoint: string
  featureKey: FeaturePriceKey
  units: number
  label: string
}

export type CreateBackgroundJobResult =
  | { ok: true; job: BackgroundJobRecord; reused: boolean }
  | { ok: false; response: Response }

const JOB_TTL_SECONDS = 60 * 60 * 24 * 7
const IDEMPOTENCY_CLAIM_SECONDS = 120
const MAX_PAYLOAD_BYTES = 22 * 1024 * 1024
const JOB_TIMEOUT_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 2
const MAX_CONCURRENT_JOBS = Math.max(
  1,
  Math.min(4, Math.floor(Number(process.env.BACKGROUND_JOB_CONCURRENCY) || 2)),
)

const memoryJobs = new Map<string, StoredBackgroundJob>()
const activeJobs = new Set<string>()
const scheduledJobs = new Set<string>()
const pendingJobs: string[] = []
const activeControllers = new Map<string, AbortController>()
const settlingJobs = new Set<string>()

const jobKey = (id: string) => `geo:background-jobs:${id}`
const requestKey = (ownerUserId: string, kind: BackgroundJobKind, requestId: string) =>
  `geo:background-job-requests:${ownerUserId}:${kind}:${requestId}`

function nowIso(): string {
  return new Date().toISOString()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "未知错误")
  return message
    .replace(/sk-[A-Za-z0-9_.*-]{6,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .slice(0, 600)
}

function isRetryable(error: unknown): boolean {
  return /(408|425|429|500|502|503|504|timeout|timed out|超时|ECONN|fetch failed|network|socket|temporar)/i.test(
    safeError(error),
  )
}

function resolveTask(kind: BackgroundJobKind, payload: unknown): TaskDefinition {
  const body = record(payload)
  switch (kind) {
    case "articleGeneration": {
      const promptKey = String(body.promptKey || "") as ArticlePromptKey
      const featureKey = ARTICLE_PROMPT_PRICE_KEYS[promptKey]
      if (!featureKey) throw new Error("请选择有效的文章 Prompt")
      return {
        endpoint: "/api/article-generation",
        featureKey,
        units: 1,
        label: getFeaturePrice(featureKey).label,
      }
    }
    case "queryGeneration": {
      const units = Math.min(30, Math.max(1, Math.floor(Number(body.count) || 5)))
      return {
        endpoint: "/api/generate-queries",
        featureKey: "legacyQueryGenerateUnit",
        units,
        label: getFeaturePrice("legacyQueryGenerateUnit").label,
      }
    }
    case "research": {
      const featureKey = body.mode === "hypothesis" ? "researchHypothesis" : "researchAi"
      return {
        endpoint: "/api/research",
        featureKey,
        units: 1,
        label: getFeaturePrice(featureKey).label,
      }
    }
    case "diagnosis":
      return {
        endpoint: "/api/diagnose",
        featureKey: "diagnose",
        units: 1,
        label: getFeaturePrice("diagnose").label,
      }
    case "competitorCompare": {
      const competitors = Array.isArray(body.selectedCompetitors)
        ? body.selectedCompetitors.filter(Boolean).slice(0, 5)
        : []
      return {
        endpoint: "/api/competitor-compare",
        featureKey: "competitorCompareUnit",
        units: Math.max(1, competitors.length),
        label: getFeaturePrice("competitorCompareUnit").label,
      }
    }
    case "keywordExtract":
      return {
        endpoint: "/api/geo-strategy/extract",
        featureKey: "keywordExtract",
        units: 1,
        label: getFeaturePrice("keywordExtract").label,
      }
    case "keywordAdvantages":
      return {
        endpoint: "/api/geo-strategy/advantages",
        featureKey: "keywordAdvantages",
        units: 1,
        label: getFeaturePrice("keywordAdvantages").label,
      }
    case "keywordStrategy":
      return {
        endpoint: "/api/geo-strategy/generate",
        featureKey: "keywordStrategyGenerate",
        units: 1,
        label: getFeaturePrice("keywordStrategyGenerate").label,
      }
    case "keywordWebsitePrompt":
      return {
        endpoint: "/api/geo-strategy/website-prompt",
        featureKey: "keywordWebsitePrompt",
        units: 1,
        label: getFeaturePrice("keywordWebsitePrompt").label,
      }
  }
}

function encodePayload(payload: unknown): string {
  const json = JSON.stringify(payload)
  const size = Buffer.byteLength(json)
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Error("本次任务资料超过 22MB，请减少单次上传文件后重试")
  }
  return gzipSync(Buffer.from(json)).toString("base64")
}

function decodePayload(payloadGzip: string): unknown {
  return JSON.parse(gunzipSync(Buffer.from(payloadGzip, "base64")).toString("utf8"))
}

function toPublicJob(job: StoredBackgroundJob): BackgroundJobRecord {
  const publicJob: Partial<StoredBackgroundJob> = { ...job }
  delete publicJob.ownerUserId
  delete publicJob.payloadGzip
  delete publicJob.endpoint
  delete publicJob.reservation
  delete publicJob.creditCost
  delete publicJob.creditsSettledAt
  return publicJob as BackgroundJobRecord
}

async function saveJob(job: StoredBackgroundJob): Promise<void> {
  memoryJobs.set(job.id, job)
  await kv.set(jobKey(job.id), job, { ex: JOB_TTL_SECONDS })
}

async function getStoredJob(id: string): Promise<StoredBackgroundJob | null> {
  const memory = memoryJobs.get(id)
  try {
    const stored = await kv.get<StoredBackgroundJob>(jobKey(id))
    if (stored) {
      memoryJobs.set(id, stored)
      return stored
    }
  } catch (error) {
    console.warn("[background-jobs] KV read failed, using memory fallback:", safeError(error))
  }
  return memory || null
}

async function patchJob(
  id: string,
  patch: Partial<StoredBackgroundJob>,
): Promise<StoredBackgroundJob | null> {
  const current = await getStoredJob(id)
  if (!current) return null
  if (current.status === "cancelled" && patch.status && patch.status !== "cancelled") return current
  const next = { ...current, ...patch, updatedAt: nowIso() }
  await saveJob(next)
  return next
}

async function waitForClaimedJob(
  ownerUserId: string,
  kind: BackgroundJobKind,
  requestId: string,
): Promise<StoredBackgroundJob | null> {
  const key = requestKey(ownerUserId, kind, requestId)
  for (let attempt = 0; attempt < 20; attempt++) {
    const pointer = await kv.get<string>(key)
    if (pointer && !pointer.startsWith("pending:")) {
      const job = await getStoredJob(pointer)
      if (job?.ownerUserId === ownerUserId) return job
    }
    await sleep(100)
  }
  return null
}

async function settleJobCredits(jobId: string, successful: boolean): Promise<void> {
  for (let attempt = 0; settlingJobs.has(jobId) && attempt < 100; attempt++) {
    await sleep(50)
  }
  if (settlingJobs.has(jobId)) throw new Error("任务积分结算繁忙，请稍后自动重试")

  settlingJobs.add(jobId)
  try {
    const job = await getStoredJob(jobId)
    if (!job || job.creditsSettledAt) return
    const shouldCharge = successful && job.status !== "cancelled"
    if (shouldCharge) {
      await settleReservedCredits(job.reservation, job.creditCost)
    } else {
      await refundReservedCredits(job.reservation)
    }
    await patchJob(jobId, {
      creditsSettledAt: nowIso(),
      creditsRefunded: !shouldCharge,
    })
  } finally {
    settlingJobs.delete(jobId)
  }
}

function internalBaseUrls(): string[] {
  return Array.from(new Set([
    `http://127.0.0.1:${process.env.PORT || "3000"}`,
    process.env.GEO_INTERNAL_BASE_URL?.trim().replace(/\/+$/, ""),
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, ""),
  ].filter((value): value is string => Boolean(value))))
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) throw new Error(`后台任务未返回数据（HTTP ${response.status}）`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`后台任务返回格式异常（HTTP ${response.status}）`)
  }
}

async function executeInternalRequest(job: StoredBackgroundJob): Promise<unknown> {
  const payload = decodePayload(job.payloadGzip)
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    for (const baseUrl of internalBaseUrls()) {
      const current = await getStoredJob(job.id)
      if (!current || current.status === "cancelled") throw new Error("用户已停止任务")

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS)
      activeControllers.set(job.id, controller)
      try {
        const response = await fetch(`${baseUrl}${job.endpoint}`, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...createInternalApiHeaders("background-job"),
            [INTERNAL_API_USER_HEADER]: job.ownerUserId,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        const data = await readJsonResponse(response)
        if (!response.ok) {
          const message = record(data).error
          throw new Error(String(message || `后台任务执行失败（HTTP ${response.status}）`))
        }
        return data
      } catch (error) {
        lastError = controller.signal.aborted
          ? new Error("后台任务执行超时")
          : error
      } finally {
        clearTimeout(timer)
        if (activeControllers.get(job.id) === controller) activeControllers.delete(job.id)
      }
    }

    if (!isRetryable(lastError) || attempt >= MAX_ATTEMPTS) break
    await sleep(attempt === 1 ? 1500 : 4000)
  }

  throw lastError instanceof Error ? lastError : new Error("后台任务执行失败")
}

async function runJob(jobId: string): Promise<void> {
  if (activeJobs.has(jobId)) return
  activeJobs.add(jobId)

  try {
    let job = await getStoredJob(jobId)
    if (!job || ["succeeded", "failed", "cancelled"].includes(job.status)) return
    job = await patchJob(jobId, {
      status: "running",
      progressPercent: 10,
      stage: "AI 正在后台处理",
      startedAt: job.startedAt || nowIso(),
      error: undefined,
    }) || job

    const result = await executeInternalRequest(job)
    const current = await getStoredJob(jobId)
    if (!current || current.status === "cancelled") throw new Error("用户已停止任务")

    await patchJob(jobId, {
      result,
      progressPercent: 100,
      stage: "结果已保存",
    })
    await settleJobCredits(jobId, true)
    await patchJob(jobId, {
      status: "succeeded",
      finishedAt: nowIso(),
    })
  } catch (error) {
    const current = await getStoredJob(jobId)
    const cancelled = current?.status === "cancelled" || /用户已停止任务/.test(safeError(error))
    if (cancelled) {
      await patchJob(jobId, {
        status: "cancelled",
        error: "用户已停止任务",
        finishedAt: current?.finishedAt || nowIso(),
      })
      await settleJobCredits(jobId, false)
      return
    }

    console.error("[background-jobs] job failed", jobId, safeError(error))
    await patchJob(jobId, {
      status: "failed",
      stage: "任务失败",
      error: safeError(error),
      finishedAt: nowIso(),
    })
    await settleJobCredits(jobId, false)
  } finally {
    activeJobs.delete(jobId)
    activeControllers.delete(jobId)
    drainQueue()
  }
}

function drainQueue(): void {
  while (activeJobs.size < MAX_CONCURRENT_JOBS && pendingJobs.length > 0) {
    const jobId = pendingJobs.shift()
    if (!jobId) continue
    scheduledJobs.delete(jobId)
    void runJob(jobId)
  }
}

function scheduleJob(jobId: string): void {
  if (activeJobs.has(jobId) || scheduledJobs.has(jobId)) return
  scheduledJobs.add(jobId)
  pendingJobs.push(jobId)
  drainQueue()
}

export function isBackgroundJobKind(value: unknown): value is BackgroundJobKind {
  return [
    "articleGeneration",
    "queryGeneration",
    "research",
    "diagnosis",
    "competitorCompare",
    "keywordExtract",
    "keywordAdvantages",
    "keywordStrategy",
    "keywordWebsitePrompt",
  ].includes(String(value))
}

export async function createBackgroundJob(args: {
  kind: BackgroundJobKind
  clientId: string
  requestId: string
  payload: unknown
  ownerUserId: string
}): Promise<CreateBackgroundJobResult> {
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(args.requestId)) {
    return {
      ok: false,
      response: Response.json({ error: "任务请求编号无效，请刷新后重试" }, { status: 400 }),
    }
  }

  const definition = resolveTask(args.kind, args.payload)
  const payloadGzip = encodePayload(args.payload)
  const key = requestKey(args.ownerUserId, args.kind, args.requestId)
  const existingPointer = await kv.get<string>(key)
  if (existingPointer) {
    const existing = existingPointer.startsWith("pending:")
      ? await waitForClaimedJob(args.ownerUserId, args.kind, args.requestId)
      : await getStoredJob(existingPointer)
    if (existing?.ownerUserId === args.ownerUserId) {
      return { ok: true, job: toPublicJob(existing), reused: true }
    }
  }

  const claim = `pending:${randomUUID()}`
  const claimed = await kv.set(key, claim, { nx: true, ex: IDEMPOTENCY_CLAIM_SECONDS })
  if (!claimed) {
    const existing = await waitForClaimedJob(args.ownerUserId, args.kind, args.requestId)
    if (existing) return { ok: true, job: toPublicJob(existing), reused: true }
    return {
      ok: false,
      response: Response.json({ error: "任务正在创建，系统会自动重试" }, { status: 409 }),
    }
  }

  const id = `bgjob_${randomUUID().replace(/-/g, "")}`
  const creditCost = estimateFeatureCredits(definition.featureKey, definition.units)
  const creditGuard = await reserveCreditsForUser(args.ownerUserId, creditCost, {
    featureKey: definition.featureKey,
    source: "api:background-jobs",
    sourceId: id,
    description: definition.label,
    metadata: {
      kind: args.kind,
      clientId: args.clientId,
      requestId: args.requestId,
      units: definition.units,
    },
  })
  if (!creditGuard.ok) {
    await kv.del(key)
    return creditGuard
  }

  const now = nowIso()
  const job: StoredBackgroundJob = {
    id,
    kind: args.kind,
    clientId: args.clientId,
    requestId: args.requestId,
    status: "queued",
    progressPercent: 0,
    stage: "任务已进入后台队列",
    createdAt: now,
    updatedAt: now,
    ownerUserId: args.ownerUserId,
    payloadGzip,
    endpoint: definition.endpoint,
    reservation: creditGuard.reservation,
    creditCost,
  }

  try {
    await saveJob(job)
    await kv.set(key, id, { ex: JOB_TTL_SECONDS })
    scheduleJob(id)
    return { ok: true, job: toPublicJob(job), reused: false }
  } catch (error) {
    await kv.del(key)
    await refundReservedCredits(creditGuard.reservation)
    throw error
  }
}

export async function getBackgroundJob(
  id: string,
  ownerUserId: string,
): Promise<BackgroundJobRecord | null> {
  const job = await getStoredJob(id)
  if (!job || job.ownerUserId !== ownerUserId) return null
  if ((job.status === "queued" || job.status === "running") && !activeJobs.has(id)) {
    scheduleJob(id)
  }
  return toPublicJob(job)
}

export async function cancelBackgroundJob(
  id: string,
  ownerUserId: string,
): Promise<BackgroundJobRecord | null> {
  const job = await getStoredJob(id)
  if (!job || job.ownerUserId !== ownerUserId) return null
  if (["succeeded", "failed", "cancelled"].includes(job.status)) return toPublicJob(job)

  const cancelled = await patchJob(id, {
    status: "cancelled",
    stage: "任务已停止",
    error: "用户已停止任务",
    finishedAt: nowIso(),
  }) || job
  activeControllers.get(id)?.abort()
  await settleJobCredits(id, false)
  return toPublicJob(cancelled)
}
