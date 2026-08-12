import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "geo-penetration-automation-"))
process.env.PENETRATION_AUTOMATION_STORE = "file"
process.env.PENETRATION_AUTOMATION_FILE = path.join(tempDir, "automations.json")

const {
  claimDuePenetrationAutomationExecutions,
  createPenetrationAutomationExecution,
  getPenetrationAutomationScheduleByClient,
  listPenetrationAutomationExecutions,
  patchPenetrationAutomationExecution,
  recordPenetrationAutomationScheduleProgress,
  setPenetrationAutomationScheduleStatus,
  upsertPenetrationAutomationSchedule,
} = await import("../src/lib/penetration/automation-store")
const {
  nextPenetrationAutomationRun,
  shanghaiLocalDateTime,
  shanghaiMonthRange,
} = await import("../src/lib/penetration/automation-time")
const {
  buildPenetrationComparisonSignature,
  comparePenetrationAutomationResult,
} = await import("../src/lib/penetration/automation-comparison")
const {
  penetrationAutomationSchedule,
} = await import("../src/lib/penetration/automation-scheduler")

function historyRecord(input: {
  id: string
  rate: number
  completedAt: string
  questions?: string[]
  models?: Array<"doubao" | "qwen">
  status?: "succeeded" | "partial"
}) {
  const questions = input.questions || ["测试问题一", "测试问题二"]
  const activeModels = input.models || ["doubao", "qwen"]
  return {
    id: input.id,
    clientId: "client-1",
    clientName: "测试客户",
    operation: "replace" as const,
    status: input.status || "succeeded" as const,
    source: "job" as const,
    request: {
      clientId: "client-1",
      clientName: "测试客户",
      subjectType: "brand" as const,
      ourBrand: "测试品牌",
      brandAliases: ["Test Brand"],
      industry: "测试行业",
      website: "",
      questions,
      questionIntents: [],
      competitors: ["竞品甲"],
      models: activeModels,
      activeModels,
      skippedModels: [],
      operation: "replace" as const,
    },
    summary: {
      ourBrand: "测试品牌",
      industry: "测试行业",
      questionCount: questions.length,
      modelCount: activeModels.length,
      completedSlots: questions.length * activeModels.length,
      totalSlots: questions.length * activeModels.length,
      penetrationRate: input.rate,
      sourceCount: 6,
      completionRate: 1,
    },
    dashboard: { brandVoice: [], keywordCompetition: [] },
    schemaVersion: 3,
    createdAt: input.completedAt,
    completedAt: input.completedAt,
    updatedAt: input.completedAt,
  }
}

try {
  const firstRun = shanghaiLocalDateTime("2026-08-14", "22:00")
  assert.equal(firstRun.toISOString(), "2026-08-14T14:00:00.000Z")
  assert.equal(
    nextPenetrationAutomationRun({
      startDate: "2026-08-14",
      timeLocal: "22:00",
      intervalDays: 3,
      after: new Date("2026-08-15T00:00:00.000Z"),
    }),
    "2026-08-17T14:00:00.000Z",
  )
  assert.deepEqual(shanghaiMonthRange(new Date("2026-08-31T20:00:00.000Z")), {
    start: "2026-08-31T16:00:00.000Z",
    end: "2026-09-30T16:00:00.000Z",
  })
  assert.deepEqual(penetrationAutomationSchedule(), {
    pattern: "* * * * *",
    timezone: "Asia/Shanghai",
  })

  const baseline = historyRecord({
    id: "history-baseline",
    rate: 0.5,
    completedAt: "2026-08-10T00:00:00.000Z",
  })
  const current = historyRecord({
    id: "history-current",
    rate: 0.35,
    completedAt: "2026-08-13T00:00:00.000Z",
  })
  assert.equal(
    buildPenetrationComparisonSignature(current.request),
    buildPenetrationComparisonSignature({
      ...current.request,
      questions: [...current.request.questions].reverse(),
      activeModels: [...current.request.activeModels].reverse(),
    }),
  )
  assert.notEqual(
    buildPenetrationComparisonSignature(current.request),
    buildPenetrationComparisonSignature({
      ...current.request,
      questions: [...current.request.questions, current.request.questions[0]],
    }),
  )
  const comparison = comparePenetrationAutomationResult({
    current,
    candidates: [current, baseline],
    relativeDropThresholdPct: 20,
    minimumAbsoluteDropPoints: 3,
  })
  assert.equal(comparison.comparable, true)
  assert.equal(comparison.alertTriggered, true)
  assert.equal(comparison.absoluteDropPoints, 15)
  assert.equal(comparison.relativeDropPct, 30)

  const changedScope = comparePenetrationAutomationResult({
    current,
    candidates: [historyRecord({
      id: "history-other-scope",
      rate: 0.8,
      questions: ["另一个问题"],
      completedAt: "2026-08-11T00:00:00.000Z",
    })],
    relativeDropThresholdPct: 20,
    minimumAbsoluteDropPoints: 3,
  })
  assert.equal(changedScope.comparable, false)
  assert.equal(changedScope.alertTriggered, false)

  const schedule = await upsertPenetrationAutomationSchedule({
    ownerUserId: "owner-1",
    clientId: "client-1",
    clientName: "测试客户",
    actorUserId: "actor-1",
    billingUserId: "billing-1",
    intervalDays: 2,
    timeLocal: "09:30",
    startDate: "2026-08-01",
    relativeDropThresholdPct: 18,
    minimumAbsoluteDropPoints: 4,
    inAppEnabled: true,
    emailEnabled: true,
    monthlyCreditLimit: 3000,
  })
  assert.equal(schedule.status, "active")
  assert.equal(schedule.intervalDays, 2)

  const updated = await upsertPenetrationAutomationSchedule({
    ownerUserId: "owner-1",
    clientId: "client-1",
    clientName: "测试客户（更新）",
    actorUserId: "actor-1",
    billingUserId: "billing-1",
    intervalDays: 3,
    timeLocal: "10:00",
    startDate: "2026-08-01",
    relativeDropThresholdPct: 20,
    minimumAbsoluteDropPoints: 3,
    inAppEnabled: true,
    emailEnabled: false,
  })
  assert.equal(updated.id, schedule.id)
  assert.equal(updated.intervalDays, 3)

  const paused = await setPenetrationAutomationScheduleStatus({
    ownerUserId: "owner-1",
    id: schedule.id,
    status: "paused",
  })
  assert.equal(paused?.status, "paused")
  assert.equal(paused?.nextRunAt, undefined)

  const resumed = await setPenetrationAutomationScheduleStatus({
    ownerUserId: "owner-1",
    id: schedule.id,
    status: "active",
  })
  assert.equal(resumed?.status, "active")
  assert.ok(resumed?.nextRunAt)

  const manual = await createPenetrationAutomationExecution({
    schedule: resumed!,
    trigger: "manual",
    scheduledFor: "2026-08-13T01:00:00.000Z",
  })
  const duplicate = await createPenetrationAutomationExecution({
    schedule: resumed!,
    trigger: "manual",
    scheduledFor: "2026-08-13T01:00:00.000Z",
  })
  assert.equal(duplicate.id, manual.id)

  const patched = await patchPenetrationAutomationExecution({
    ownerUserId: "owner-1",
    id: manual.id,
    patch: { status: "running", attemptCount: 1, estimatedCredits: 24 },
  })
  assert.equal(patched?.status, "running")
  assert.equal(patched?.estimatedCredits, 24)

  const noDueWhileRunning = await claimDuePenetrationAutomationExecutions(
    new Date("2099-01-01T00:00:00.000Z"),
  )
  assert.equal(noDueWhileRunning.length, 0)

  const completed = await patchPenetrationAutomationExecution({
    ownerUserId: "owner-1",
    id: manual.id,
    patch: { status: "succeeded", completedAt: new Date().toISOString() },
  })
  await recordPenetrationAutomationScheduleProgress({
    schedule: resumed!,
    execution: completed!,
    outcome: "succeeded",
  })

  const due = await claimDuePenetrationAutomationExecutions(
    new Date("2099-01-01T00:00:00.000Z"),
  )
  assert.equal(due.length, 1)
  assert.equal(due[0].trigger, "scheduled")
  const afterClaim = await getPenetrationAutomationScheduleByClient("owner-1", "client-1")
  assert.ok(afterClaim?.nextRunAt)
  assert.ok(Date.parse(afterClaim!.nextRunAt!) > Date.parse(due[0].scheduledFor))

  const executions = await listPenetrationAutomationExecutions({
    ownerUserId: "owner-1",
    scheduleId: schedule.id,
  })
  assert.equal(executions.length, 2)

  let failureSchedule = await upsertPenetrationAutomationSchedule({
    ownerUserId: "owner-2",
    clientId: "client-2",
    clientName: "失败暂停测试",
    actorUserId: "owner-2",
    billingUserId: "owner-2",
    intervalDays: 1,
    timeLocal: "08:00",
    startDate: "2026-08-01",
    relativeDropThresholdPct: 20,
    minimumAbsoluteDropPoints: 3,
    inAppEnabled: true,
    emailEnabled: false,
  })
  for (let index = 0; index < 3; index++) {
    const execution = await createPenetrationAutomationExecution({
      schedule: failureSchedule,
      trigger: "manual",
      scheduledFor: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    })
    const started = await patchPenetrationAutomationExecution({
      ownerUserId: failureSchedule.ownerUserId,
      id: execution.id,
      patch: { status: "running", startedAt: new Date().toISOString() },
    })
    failureSchedule = (await recordPenetrationAutomationScheduleProgress({
      schedule: failureSchedule,
      execution: started!,
      outcome: "started",
    }))!
    assert.equal(failureSchedule.consecutiveFailures, index)
    const failed = await patchPenetrationAutomationExecution({
      ownerUserId: failureSchedule.ownerUserId,
      id: execution.id,
      patch: { status: "failed", completedAt: new Date().toISOString() },
    })
    failureSchedule = (await recordPenetrationAutomationScheduleProgress({
      schedule: failureSchedule,
      execution: failed!,
      outcome: "failed",
      error: "测试失败",
    }))!
  }
  assert.equal(failureSchedule.status, "paused")
  assert.equal(failureSchedule.consecutiveFailures, 3)
  assert.equal(failureSchedule.nextRunAt, undefined)

  const concurrentSchedule = await upsertPenetrationAutomationSchedule({
    ownerUserId: "owner-3",
    clientId: "client-3",
    clientName: "并发状态测试",
    actorUserId: "owner-3",
    billingUserId: "owner-3",
    intervalDays: 1,
    timeLocal: "08:30",
    startDate: "2026-08-01",
    relativeDropThresholdPct: 20,
    minimumAbsoluteDropPoints: 3,
    inAppEnabled: true,
    emailEnabled: false,
  })
  const concurrentExecution = await createPenetrationAutomationExecution({
    schedule: concurrentSchedule,
    trigger: "manual",
    scheduledFor: "2026-08-13T02:00:00.000Z",
  })
  await setPenetrationAutomationScheduleStatus({
    ownerUserId: concurrentSchedule.ownerUserId,
    id: concurrentSchedule.id,
    status: "paused",
  })
  const afterStaleCompletion = await recordPenetrationAutomationScheduleProgress({
    schedule: concurrentSchedule,
    execution: concurrentExecution,
    outcome: "succeeded",
  })
  assert.equal(afterStaleCompletion?.status, "paused")
  assert.equal(afterStaleCompletion?.nextRunAt, undefined)

  console.log("penetration automation storage tests passed")
} finally {
  await fs.rm(tempDir, { recursive: true, force: true })
}
