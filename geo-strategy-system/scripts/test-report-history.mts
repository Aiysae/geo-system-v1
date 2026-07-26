import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const testDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-report-history-"))
const reportsDirectory = path.join(testDirectory, "reports")
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(testDirectory, "kv.json")
process.env.REPORTS_DIR = reportsDirectory

const { kv } = await import("../src/lib/kv")
const {
  deleteCommercialReportJob,
  getCommercialReportFileMetadata,
  listCommercialReportJobs,
} = await import("../src/lib/reports/report-jobs")

function storedJob(args: {
  id: string
  ownerUserId: string
  clientId?: string
  status?: "queued" | "succeeded"
  createdAt?: string
  expiresAt?: string
}) {
  const createdAt = args.createdAt || new Date().toISOString()
  const filePath = path.join(reportsDirectory, `${args.id}.pdf`)
  return {
    id: args.id,
    clientId: args.clientId || "client-history-test",
    clientName: "历史报告测试客户",
    kind: "difficulty" as const,
    detail: "full" as const,
    brandingMode: "shitu" as const,
    publisherName: "杭州势途数字科技有限公司",
    status: args.status || "succeeded",
    progress: args.status === "queued" ? 0 : 100,
    stage: args.status === "queued" ? "报告任务已创建" : "报告已生成",
    fileName: `${args.id}.pdf`,
    fileSize: 32,
    createdAt,
    updatedAt: createdAt,
    finishedAt: args.status === "queued" ? undefined : createdAt,
    expiresAt: args.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    creditCost: 0,
    creditsRefunded: false,
    ownerUserId: args.ownerUserId,
    inputPath: path.join(reportsDirectory, `${args.id}.input.json`),
    filePath,
    creditsSettledAt: createdAt,
  }
}

try {
  await fs.mkdir(reportsDirectory, { recursive: true })

  const owner = "report-history-owner"
  const job = storedJob({ id: "rjob_history_owned", ownerUserId: owner })
  await fs.writeFile(job.filePath, "%PDF-1.4\n%%EOF\n")
  await kv.set(`geo:commercial-report-jobs:${job.id}`, job, { ex: 365 * 24 * 60 * 60 })
  await kv.sadd(`geo:commercial-report-history:${owner}`, job.id)

  const ownerHistory = await listCommercialReportJobs(owner)
  assert.equal(ownerHistory.length, 1)
  assert.equal(ownerHistory[0]?.fileAvailable, true)
  assert.equal("ownerUserId" in ownerHistory[0], false)
  assert.equal("filePath" in ownerHistory[0], false)
  const metadata = await getCommercialReportFileMetadata(job.id, owner)
  assert.equal(metadata?.filePath, job.filePath)
  assert.equal(metadata?.fileSize, Buffer.byteLength("%PDF-1.4\n%%EOF\n"))
  assert.equal(await getCommercialReportFileMetadata(job.id, "different-owner"), null)
  assert.equal((await listCommercialReportJobs("different-owner")).length, 0)
  assert.equal(await deleteCommercialReportJob(job.id, "different-owner"), "not_found")
  assert.equal(await deleteCommercialReportJob(job.id, owner), "deleted")
  assert.equal((await listCommercialReportJobs(owner)).length, 0)
  await assert.rejects(fs.access(job.filePath))

  const active = storedJob({
    id: "rjob_history_active",
    ownerUserId: owner,
    status: "queued",
  })
  await kv.set(`geo:commercial-report-jobs:${active.id}`, active, { ex: 365 * 24 * 60 * 60 })
  assert.equal(await deleteCommercialReportJob(active.id, owner), "active")

  const legacyOwner = "report-history-legacy-owner"
  const legacyCreatedAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const legacy = storedJob({
    id: "rjob_history_legacy",
    ownerUserId: legacyOwner,
    createdAt: legacyCreatedAt,
    expiresAt: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
  })
  await fs.writeFile(legacy.filePath, "%PDF-1.4\n%%EOF\n")
  await kv.set(`geo:commercial-report-jobs:${legacy.id}`, legacy, { ex: 24 * 60 * 60 })

  const migrated = await listCommercialReportJobs(legacyOwner)
  assert.equal(migrated.length, 1)
  assert.equal(migrated[0]?.id, legacy.id)
  assert.ok(Date.parse(migrated[0]!.expiresAt) - Date.parse(legacyCreatedAt) > 360 * 24 * 60 * 60 * 1000)

  console.log("commercial report history: ownership, migration and deletion checks passed")
} finally {
  await fs.rm(testDirectory, { recursive: true, force: true })
}
