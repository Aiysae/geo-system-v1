import "server-only"

import { execFile } from "child_process"
import { randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"
import { promisify } from "util"
import { kv } from "@/lib/kv"
import {
  refundReservedCreditsOnce,
  settleReservedCredits,
  type CreditReservation,
} from "@/lib/with-credits"
import type { CommercialReportInput, CommercialReportJobRecord } from "@/types"

type StoredCommercialReportJob = CommercialReportJobRecord & {
  ownerUserId: string
  inputPath: string
  filePath: string
  requestId?: string
  reservation?: CreditReservation
  refundOperationId?: string
  creditsSettledAt?: string
}

export type CommercialReportFile = {
  buffer: Buffer
  fileName: string
  fileSize: number
}

const REPORT_JOB_TTL_SECONDS = 60 * 60 * 24 * 365
const REPORT_FILE_MAX_AGE_MS = REPORT_JOB_TTL_SECONDS * 1000
const REPORT_HISTORY_LIMIT = 100
const memoryJobs = new Map<string, StoredCommercialReportJob>()
const memoryHistory = new Map<string, Set<string>>()
const historyDiscoveryCompleted = new Set<string>()
const activeJobs = new Set<string>()
const scheduledJobs = new Set<string>()
const settlingJobs = new Set<string>()
const execFileAsync = promisify(execFile)
let reportQueue: Promise<void> = Promise.resolve()

const jobKey = (id: string) => `geo:commercial-report-jobs:${id}`
const historyKey = (ownerUserId: string) => `geo:commercial-report-history:${ownerUserId}`

function nowIso(): string {
  return new Date().toISOString()
}

function reportsDirectory(): string {
  if (process.env.REPORTS_DIR?.trim()) return process.env.REPORTS_DIR.trim()
  return process.env.NODE_ENV === "production"
    ? "/var/lib/geo-system/reports"
    : path.join(process.cwd(), ".data", "reports")
}

function toPublicJob(job: StoredCommercialReportJob): CommercialReportJobRecord {
  const publicJob: Partial<StoredCommercialReportJob> = { ...job }
  delete publicJob.ownerUserId
  delete publicJob.inputPath
  delete publicJob.filePath
  delete publicJob.requestId
  delete publicJob.reservation
  delete publicJob.refundOperationId
  delete publicJob.creditsSettledAt
  return publicJob as CommercialReportJobRecord
}

function reportKindLabel(kind: CommercialReportInput["kind"]): string {
  if (kind === "penetration") return "渗透率情报"
  if (kind === "difficulty") return "难度测评"
  return "综合洞察"
}

function safeDownloadName(input: CommercialReportInput): string {
  const clientName = input.client.name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48) || "客户"
  const date = new Date().toISOString().slice(0, 10)
  return `${clientName}-GEO-${reportKindLabel(input.kind)}-${date}.pdf`
}

async function writeAtomic(filePath: string, data: string | Buffer): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(tempPath, data)
  await fs.rename(tempPath, filePath)
}

async function saveJob(job: StoredCommercialReportJob): Promise<void> {
  memoryJobs.set(job.id, job)
  try {
    await kv.set(jobKey(job.id), job, { ex: REPORT_JOB_TTL_SECONDS })
  } catch (error) {
    console.warn("[commercial-report-jobs] KV write failed, using memory fallback:", error)
  }
}

function rememberHistory(ownerUserId: string, id: string): void {
  const ids = memoryHistory.get(ownerUserId) || new Set<string>()
  ids.add(id)
  memoryHistory.set(ownerUserId, ids)
}

function forgetHistory(ownerUserId: string, id: string): void {
  const ids = memoryHistory.get(ownerUserId)
  if (!ids) return
  ids.delete(id)
  if (ids.size === 0) memoryHistory.delete(ownerUserId)
}

async function addToHistory(ownerUserId: string, id: string): Promise<void> {
  if (memoryHistory.get(ownerUserId)?.has(id)) return
  rememberHistory(ownerUserId, id)
  try {
    await kv.sadd(historyKey(ownerUserId), id)
  } catch (error) {
    console.warn("[commercial-report-jobs] history index write failed, using memory fallback:", error)
  }
}

async function removeFromHistory(ownerUserId: string, id: string): Promise<void> {
  forgetHistory(ownerUserId, id)
  try {
    await kv.srem(historyKey(ownerUserId), id)
  } catch (error) {
    console.warn("[commercial-report-jobs] history index cleanup failed:", error)
  }
}

async function getStoredJob(id: string): Promise<StoredCommercialReportJob | null> {
  const memory = memoryJobs.get(id)
  try {
    const stored = await kv.get<StoredCommercialReportJob>(jobKey(id))
    if (stored) {
      memoryJobs.set(id, stored)
      return stored
    }
  } catch (error) {
    console.warn("[commercial-report-jobs] KV read failed, using memory fallback:", error)
  }
  return memory || null
}

async function historyIds(ownerUserId: string): Promise<string[]> {
  const ids = new Set(memoryHistory.get(ownerUserId) || [])
  try {
    const storedIds = await kv.smembers<string[]>(historyKey(ownerUserId))
    for (const id of storedIds || []) ids.add(String(id))
  } catch (error) {
    console.warn("[commercial-report-jobs] history index read failed, using memory fallback:", error)
  }
  memoryHistory.set(ownerUserId, new Set(ids))
  return [...ids]
}

async function discoverRecentHistory(ownerUserId: string): Promise<void> {
  if (historyDiscoveryCompleted.has(ownerUserId)) return
  const directory = reportsDirectory()
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const pdfEntries = await Promise.all(entries
      .filter(entry => entry.isFile() && /^rjob_[A-Za-z0-9_]+\.pdf$/.test(entry.name))
      .map(async entry => ({
        id: entry.name.slice(0, -4),
        mtimeMs: (await fs.stat(path.join(directory, entry.name))).mtimeMs,
      })))
    const recent = pdfEntries
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, REPORT_HISTORY_LIMIT * 2)
    for (const entry of recent) {
      const job = await getStoredJob(entry.id)
      if (job?.ownerUserId !== ownerUserId) continue
      const createdAtMs = Date.parse(job.createdAt)
      const desiredExpiresAt = Number.isFinite(createdAtMs)
        ? new Date(createdAtMs + REPORT_FILE_MAX_AGE_MS).toISOString()
        : new Date(Date.now() + REPORT_FILE_MAX_AGE_MS).toISOString()
      if (!Number.isFinite(Date.parse(job.expiresAt)) || Date.parse(job.expiresAt) < Date.parse(desiredExpiresAt)) {
        await saveJob({ ...job, expiresAt: desiredExpiresAt })
      }
      await addToHistory(ownerUserId, entry.id)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[commercial-report-jobs] recent report discovery failed:", error)
    }
  } finally {
    historyDiscoveryCompleted.add(ownerUserId)
  }
}

async function reportFileAvailable(job: StoredCommercialReportJob): Promise<boolean> {
  if (job.status !== "succeeded") return false
  try {
    await fs.access(job.filePath)
    return true
  } catch {
    return false
  }
}

async function deleteJobArtifacts(job: StoredCommercialReportJob): Promise<void> {
  await Promise.all([
    fs.unlink(job.inputPath).catch(() => undefined),
    fs.unlink(job.filePath).catch(() => undefined),
  ])
  memoryJobs.delete(job.id)
  try {
    await kv.del(jobKey(job.id))
  } catch (error) {
    console.warn("[commercial-report-jobs] job deletion failed in KV:", error)
  }
  await removeFromHistory(job.ownerUserId, job.id)
}

async function pruneHistory(ownerUserId: string): Promise<void> {
  const ids = await historyIds(ownerUserId)
  const jobs = (await Promise.all(ids.map(id => getStoredJob(id))))
    .filter((job): job is StoredCommercialReportJob => Boolean(job?.ownerUserId === ownerUserId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const staleIds = ids.filter(id => !jobs.some(job => job.id === id))
  await Promise.all(staleIds.map(id => removeFromHistory(ownerUserId, id)))

  const removable = jobs.slice(REPORT_HISTORY_LIMIT).filter(job => job.status !== "queued" && job.status !== "running")
  await Promise.all(removable.map(deleteJobArtifacts))
}

async function patchJob(
  id: string,
  patch: Partial<StoredCommercialReportJob>,
): Promise<StoredCommercialReportJob | null> {
  const current = await getStoredJob(id)
  if (!current) return null
  if (
    (current.status === "succeeded" || current.status === "failed")
    && patch.status
    && patch.status !== current.status
  ) return current
  const next = { ...current, ...patch, updatedAt: nowIso() }
  await saveJob(next)
  return next
}

async function settleJobCredits(id: string, successful: boolean): Promise<void> {
  if (settlingJobs.has(id)) return
  settlingJobs.add(id)
  try {
    const job = await getStoredJob(id)
    if (!job || job.creditsSettledAt) return

    if (job.reservation) {
      if (successful) {
        await settleReservedCredits(job.reservation, job.creditCost || job.reservation.amount)
      } else if (job.refundOperationId) {
        await refundReservedCreditsOnce(job.reservation, job.refundOperationId)
      } else {
        throw new Error("报告积分退回操作号缺失")
      }
    }

    await patchJob(id, {
      creditsSettledAt: nowIso(),
      creditsRefunded: !successful && Boolean(job.reservation?.amount),
    })
  } finally {
    settlingJobs.delete(id)
  }
}

async function settleJobCreditsQuietly(id: string, successful: boolean): Promise<void> {
  try {
    await settleJobCredits(id, successful)
  } catch (error) {
    console.error("[commercial-report-jobs] credit settlement failed", id, error)
  }
}

async function cleanupExpiredReportFiles(directory: string): Promise<void> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const cutoff = Date.now() - REPORT_FILE_MAX_AGE_MS
    await Promise.all(entries.map(async entry => {
      if (!entry.isFile() || (!entry.name.endsWith(".pdf") && !entry.name.endsWith(".input.json"))) return
      const filePath = path.join(directory, entry.name)
      const stats = await fs.stat(filePath)
      if (stats.mtimeMs < cutoff) await fs.unlink(filePath)
    }))
  } catch (error) {
    console.warn("[commercial-report-jobs] expired file cleanup failed:", error)
  }
}

async function runCommercialReportJob(id: string): Promise<void> {
  if (activeJobs.has(id)) return
  activeJobs.add(id)
  try {
    const job = await getStoredJob(id)
    if (!job || job.status === "succeeded" || job.status === "failed") return

    await patchJob(id, {
      status: "running",
      progress: 18,
      stage: "正在整理检测数据",
      startedAt: job.startedAt || nowIso(),
      error: undefined,
    })
    await fs.access(job.inputPath)

    await patchJob(id, { progress: 48, stage: "正在绘制图表与商业版式" })
    const tsxCliPath = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs")
    const workerPath = path.join(process.cwd(), "src", "lib", "reports", "report-worker.tsx")
    let renderProgress = 48
    let pendingProgressUpdate: Promise<unknown> = Promise.resolve()
    const progressTimer = setInterval(() => {
      renderProgress = Math.min(82, renderProgress + 7)
      pendingProgressUpdate = pendingProgressUpdate
        .catch(() => undefined)
        .then(() => patchJob(id, {
          progress: renderProgress,
          stage: renderProgress < 70 ? "正在绘制图表与商业版式" : "正在处理中文字体与分页",
        }))
    }, 8_000)
    let stdout = ""
    try {
      const workerResult = await execFileAsync(
        process.execPath,
        [tsxCliPath, workerPath, job.inputPath, job.filePath],
        {
          cwd: process.cwd(),
          env: {
            HOME: process.env.HOME,
            LANG: process.env.LANG || "zh_CN.UTF-8",
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH,
            TZ: process.env.TZ || "Asia/Shanghai",
          },
          timeout: 15 * 60 * 1000,
          maxBuffer: 1024 * 1024,
        },
      )
      stdout = workerResult.stdout
    } finally {
      clearInterval(progressTimer)
      await pendingProgressUpdate.catch(() => undefined)
    }
    const workerResult = JSON.parse(stdout || "{}") as { fileSize?: number }
    const fileSize = workerResult.fileSize || (await fs.stat(job.filePath)).size

    await patchJob(id, { progress: 86, stage: "正在生成 PDF 文件" })
    await fs.unlink(job.inputPath).catch(() => undefined)

    await settleJobCredits(id, true)

    await patchJob(id, {
      status: "succeeded",
      progress: 100,
      stage: "报告已生成",
      fileSize,
      finishedAt: nowIso(),
    })
  } catch (error) {
    console.error("[commercial-report-jobs] report generation failed", id, error)
    await settleJobCreditsQuietly(id, false)
    await patchJob(id, {
      status: "failed",
      progress: 100,
      stage: "报告生成失败",
      error: "专业报告生成失败，请稍后重试；如持续失败请联系管理员。",
      finishedAt: nowIso(),
    })
  } finally {
    activeJobs.delete(id)
  }
}

function queueJob(id: string): void {
  if (activeJobs.has(id) || scheduledJobs.has(id)) return
  scheduledJobs.add(id)
  reportQueue = reportQueue
    .catch(() => undefined)
    .then(() => runCommercialReportJob(id))
    .finally(() => {
      scheduledJobs.delete(id)
    })
}

export async function createCommercialReportJob(
  args: {
    id: string
    input: CommercialReportInput
    ownerUserId: string
    requestId: string
    creditCost: number
    reservation?: CreditReservation
    refundOperationId?: string
  },
): Promise<CommercialReportJobRecord> {
  const { id, input, ownerUserId } = args
  const directory = reportsDirectory()
  await fs.mkdir(directory, { recursive: true })
  void cleanupExpiredReportFiles(directory)

  const inputPath = path.join(directory, `${id}.input.json`)
  const filePath = path.join(directory, `${id}.pdf`)
  await writeAtomic(inputPath, JSON.stringify(input))

  const createdAt = nowIso()
  const job: StoredCommercialReportJob = {
    id,
    clientId: input.client.id,
    clientName: input.client.name,
    kind: input.kind,
    detail: input.detail,
    brandingMode: input.branding?.mode || "shitu",
    publisherName: input.branding?.companyName || "杭州势途数字科技有限公司",
    status: "queued",
    progress: 0,
    stage: "报告任务已创建",
    fileName: safeDownloadName(input),
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(Date.now() + REPORT_FILE_MAX_AGE_MS).toISOString(),
    creditCost: Math.max(0, Math.floor(args.creditCost)),
    creditsRefunded: false,
    ownerUserId,
    inputPath,
    filePath,
    requestId: args.requestId,
    reservation: args.reservation,
    refundOperationId: args.refundOperationId,
    creditsSettledAt: args.reservation ? undefined : createdAt,
  }
  await saveJob(job)
  await addToHistory(ownerUserId, id)
  void pruneHistory(ownerUserId)
  queueJob(id)
  return toPublicJob(job)
}

export async function listCommercialReportJobs(
  ownerUserId: string,
): Promise<CommercialReportJobRecord[]> {
  await discoverRecentHistory(ownerUserId)
  const ids = await historyIds(ownerUserId)
  const jobs = await Promise.all(ids.map(id => getStoredJob(id)))
  const ownedJobs = jobs
    .filter((job): job is StoredCommercialReportJob => Boolean(job?.ownerUserId === ownerUserId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  const staleIds = ids.filter(id => !ownedJobs.some(job => job.id === id))
  await Promise.all(staleIds.map(id => removeFromHistory(ownerUserId, id)))

  const removable = ownedJobs
    .slice(REPORT_HISTORY_LIMIT)
    .filter(job => job.status !== "queued" && job.status !== "running")
  await Promise.all(removable.map(deleteJobArtifacts))
  const visibleJobs = ownedJobs.slice(0, REPORT_HISTORY_LIMIT)

  return Promise.all(visibleJobs.map(async job => {
    if ((job.status === "queued" || job.status === "running") && !activeJobs.has(job.id) && !scheduledJobs.has(job.id)) {
      queueJob(job.id)
    }
    return {
      ...toPublicJob(job),
      fileAvailable: await reportFileAvailable(job),
    }
  }))
}

export type DeleteCommercialReportResult = "deleted" | "not_found" | "active"

export async function deleteCommercialReportJob(
  id: string,
  ownerUserId: string,
): Promise<DeleteCommercialReportResult> {
  const job = await getStoredJob(id)
  if (!job || job.ownerUserId !== ownerUserId) return "not_found"
  if (job.status === "queued" || job.status === "running") return "active"
  await deleteJobArtifacts(job)
  return "deleted"
}

export async function getCommercialReportJob(
  id: string,
  ownerUserId: string,
): Promise<CommercialReportJobRecord | null> {
  const job = await getStoredJob(id)
  if (!job || job.ownerUserId !== ownerUserId) return null
  if ((job.status === "queued" || job.status === "running") && !activeJobs.has(id) && !scheduledJobs.has(id)) queueJob(id)
  if (job.status === "failed" && !job.creditsSettledAt) {
    await settleJobCreditsQuietly(id, false)
  }
  return toPublicJob(await getStoredJob(id) || job)
}

export async function getCommercialReportFile(
  id: string,
  ownerUserId: string,
): Promise<CommercialReportFile | null> {
  const job = await getStoredJob(id)
  if (!job || job.ownerUserId !== ownerUserId || job.status !== "succeeded" || !job.fileName) return null
  try {
    const buffer = await fs.readFile(job.filePath)
    return { buffer, fileName: job.fileName, fileSize: buffer.length }
  } catch (error) {
    console.error("[commercial-report-jobs] report file read failed", id, error)
    return null
  }
}
