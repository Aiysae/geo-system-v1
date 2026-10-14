import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ModelKey, PenetrationItem, PenetrationJobRecord } from "../src/types"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-user-location-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.PENETRATION_HISTORY_STORE = "file"
process.env.PENETRATION_HISTORY_FILE = path.join(tempDir, "penetration-history.json")
process.env.PORT = "3000"
process.env.PENETRATION_SCHEDULER_V3 = "false"
process.env.PENETRATION_SCHEDULER_V2 = "false"

const {
  distinctPenetrationQuestions,
  expandPenetrationQuestionSamples,
  normalizePenetrationSamplesPerQuestion,
  normalizePenetrationUserLocation,
} = await import("../src/lib/penetration/user-location")

// Location is cleaned search metadata, never free prompt text.
assert.deepEqual(normalizePenetrationUserLocation({ region: " 浙江<script> ", city: "杭州" }), { region: "浙江script", city: "杭州" })
assert.equal(normalizePenetrationUserLocation({ region: "  ", city: "" }), undefined)
assert.equal(normalizePenetrationUserLocation("杭州"), undefined)
assert.equal(normalizePenetrationSamplesPerQuestion(undefined), 1)
assert.equal(normalizePenetrationSamplesPerQuestion(9), 3)
assert.equal(normalizePenetrationSamplesPerQuestion("2"), 2)
assert.deepEqual(expandPenetrationQuestionSamples(["甲", "乙"], 3), ["甲", "甲", "甲", "乙", "乙", "乙"])
assert.deepEqual(expandPenetrationQuestionSamples(["甲"], 1), ["甲"])
assert.deepEqual(distinctPenetrationQuestions(["甲", "甲 ", "乙"]), ["甲", "乙"])

// A repeated question runs as independent slots, and every batch carries the
// asker's location to the detection API.
const originalFetch = globalThis.fetch
const runId = "penetration_user_location_test"
const batchLocations: unknown[] = []
const sampled: string[] = []
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}")) as {
    questions: string[]
    models: ModelKey[]
    sampleStart: number
    userLocation?: unknown
  }
  batchLocations.push(body.userLocation)
  const byModel: Partial<Record<ModelKey, PenetrationItem[]>> = {}
  for (const model of body.models) {
    byModel[model] = body.questions.map((question, offset): PenetrationItem => {
      const questionIndex = body.sampleStart + offset
      sampled.push(`${model}:${questionIndex}`)
      return {
        sampleId: `${runId}_${model}_${questionIndex + 1}`,
        sampledAt: new Date().toISOString(),
        question,
        answer: `第 ${questionIndex + 1} 次独立回答`,
        mentionedBrands: [],
        topRecommended: null,
        searchSources: [{
          title: "公开来源", snippet: "用于验证重复采样。", url: `https://example.com/news/${questionIndex + 1}`,
          domain: "example.com", query: question,
        }],
        sourceCount: 1,
        searchMode: "native_web",
        promptPurity: "raw_question_only",
        requestAuditVerified: true,
        webAttempted: true,
        webExecutionVerified: true,
        providerRequestIds: [`request-${questionIndex + 1}`],
        webVerified: true,
        hitOur: false,
      }
    })
  }
  return Response.json({ byModel, generatedAt: new Date().toISOString(), modelErrors: {} })
}

const { createPenetrationJob, getPenetrationJob } = await import("../src/lib/penetration/jobs")

async function waitForTerminal(timeoutMs: number): Promise<PenetrationJobRecord> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const job = await getPenetrationJob("pjob_user_location_test", "test-user")
    if (job && ["succeeded", "blocked", "failed"].includes(job.status)) return job
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error("Timed out waiting for repeated-sample job")
}

try {
  const questions = expandPenetrationQuestionSamples(["哪家监理公司做过斜拉桥项目？"], 3)
  const created = await createPenetrationJob({
    id: "pjob_user_location_test",
    request: {
      clientId: "client-test",
      clientName: "测试客户",
      runId,
      operation: "replace",
      subjectType: "brand",
      ourBrand: "测试品牌",
      brandAliases: [],
      industry: "工程监理",
      website: "https://example.com",
      questions,
      competitors: [],
      selectedModels: ["doubao"],
      models: ["doubao"],
      userLocation: { region: "浙江", city: "杭州" },
      samplesPerQuestion: 3,
    },
    ownerUserId: "test-user",
    reservation: {
      userId: "test-user",
      amount: 0,
      balanceAfterReserve: 0,
      ledgerContext: { featureKey: "penetrationSlot", source: "test", description: "test" },
    },
    skipped: [],
  })
  assert.equal(created.totalSlots, 3, "one question asked three times is three slots")

  const completed = await waitForTerminal(5_000)
  assert.equal(completed.status, "succeeded")
  assert.deepEqual(sampled.sort(), ["doubao:0", "doubao:1", "doubao:2"])
  assert.equal(completed.result?.byModel.doubao?.length, 3)
  assert.ok(batchLocations.length > 0)
  for (const location of batchLocations) assert.deepEqual(location, { region: "浙江", city: "杭州" })
  // Repeats are samples of one question, not three questions in the set.
  assert.equal(completed.result?.aggregated.sampleQuality?.questionCount, 1)

  console.log("Penetration repeated samples and asker location passed.")
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(tempDir, { recursive: true, force: true })
}
