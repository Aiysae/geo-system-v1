import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AiCredentialSelectionRequest } from "../src/types/ai-credentials"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-v3-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-penetration-v3-encryption-key"
process.env.PENETRATION_SCHEDULER_V3 = "true"
process.env.PENETRATION_V3_MAX_LANES_PER_JOB = "6"
process.env.PENETRATION_V3_WAVE_SLOT_LIMIT = "24"
process.env.PENETRATION_V3_QWEN_QUESTION_BATCH_SIZE = "6"

const {
  saveAiCredential,
  setAiCredentialEnabled,
  updateAiCredentialHealth,
} = await import("../src/lib/ai-credential-store")
const {
  acquireAiCredential,
  getAiCredentialPoolSnapshot,
} = await import("../src/lib/ai-credential-router")
const {
  releasePenetrationWaveReservations,
  selectPenetrationDueWaveV3,
} = await import("../src/lib/penetration/wave-scheduler")

try {
  for (let account = 1; account <= 3; account++) {
    const credential = await saveAiCredential({
      vendor: "qwen",
      name: `千问独立账号 ${account}`,
      accountLabel: `${account}号账号`,
      quotaGroup: `qwen-independent-account-${account}`,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      chatPath: "/chat/completions",
      apiKey: `sk-v3-independent-${account}`,
      enabled: false,
      priority: 1,
      maxConcurrency: 3,
      quotaGroupMaxConcurrency: 3,
      allowedModels: ["qwen-plus"],
      allowedModules: ["penetration"],
      declaredCapabilities: ["chat", "native_web", "auditable_sources"],
    }, "v3-test")
    await updateAiCredentialHealth(credential.id, {
      status: "healthy",
      verifiedCapabilities: ["chat", "native_web", "auditable_sources"],
      consecutiveFailures: 0,
      latencyMs: 20 + account,
    })
    await setAiCredentialEnabled(credential.id, true, "v3-test")
  }

  const request: AiCredentialSelectionRequest = {
    vendor: "qwen",
    module: "penetration",
    model: "qwen-plus",
    requiredCapabilities: ["native_web", "auditable_sources"],
  }
  const initial = await getAiCredentialPoolSnapshot(request)
  assert.deepEqual(initial, {
    candidateCount: 3,
    maxConcurrency: 9,
    quotaGroupCount: 3,
    activeConcurrency: 0,
    availableConcurrency: 9,
  })

  const leases = await Promise.all(
    Array.from({ length: 9 }, () =>
      acquireAiCredential({
        ...request,
        waitTimeoutMs: 0,
      }),
    ),
  )
  const usageByCredential = new Map<string, number>()
  for (const lease of leases) {
    usageByCredential.set(
      lease.credential.id,
      (usageByCredential.get(lease.credential.id) || 0) + 1,
    )
  }
  assert.equal(usageByCredential.size, 3)
  assert.deepEqual(
    [...usageByCredential.values()].sort((a, b) => a - b),
    [3, 3, 3],
    "three independent accounts must each provide their own three lanes",
  )
  const saturated = await getAiCredentialPoolSnapshot(request)
  assert.equal(saturated.activeConcurrency, 9)
  assert.equal(saturated.availableConcurrency, 0)
  await Promise.all(leases.map(lease => lease.release()))

  const questions = Array.from({ length: 10 }, (_, index) => `独立检测问题 ${index + 1}`)
  const states = Object.fromEntries(
    questions.map((_, index) => [
      `qwen:${index}`,
      {
        model: "qwen" as const,
        questionIndex: index,
        status: "queued" as const,
      },
    ]),
  )
  const select = (rotationSeed: number) => selectPenetrationDueWaveV3({
    models: ["qwen"],
    questions,
    states,
    nowMs: Date.now(),
    rotationSeed,
  })

  const firstWave = await select(0)
  assert.equal(firstWave.reduce((sum, batch) => sum + batch.questions.length, 0), 6)
  assert.equal(firstWave.every(batch => batch.models.length === 1), true)

  const secondWave = await select(1)
  assert.equal(
    secondWave.reduce((sum, batch) => sum + batch.questions.length, 0),
    3,
    "a concurrent job may only reserve the three provider lanes left globally",
  )

  const thirdWave = await select(2)
  assert.equal(thirdWave.length, 0, "no job may overbook all nine reserved lanes")

  await releasePenetrationWaveReservations(firstWave)
  const recoveredWave = await select(3)
  assert.equal(
    recoveredWave.reduce((sum, batch) => sum + batch.questions.length, 0),
    6,
    "released scheduler lanes must become reusable immediately",
  )

  await Promise.all([
    releasePenetrationWaveReservations(secondWave),
    releasePenetrationWaveReservations(recoveredWave),
  ])
  const recoveredPool = await getAiCredentialPoolSnapshot(request)
  assert.equal(recoveredPool.activeConcurrency, 0)
  assert.equal(recoveredPool.availableConcurrency, 9)

  console.log("Penetration V3 live capacity, global reservations and account sharding passed.")
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
