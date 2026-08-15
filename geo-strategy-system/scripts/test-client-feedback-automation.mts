import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-feedback-automation-"))
const file = path.join(directory, "automations.json")
process.env.CLIENT_FEEDBACK_AUTOMATION_STORE = "file"
process.env.CLIENT_FEEDBACK_AUTOMATION_FILE = file
process.env.AUTH_SECRET = "feedback-automation-test-secret-with-sufficient-length"

const {
  clientFeedbackAutomationRetryPatch,
  claimDueClientFeedbackAutomationExecutions,
  createClientFeedbackAutomationExecution,
  getClientFeedbackAutomationScheduleByClient,
  listClientFeedbackAutomationExecutions,
  patchClientFeedbackAutomationExecution,
  setClientFeedbackAutomationScheduleStatus,
  upsertClientFeedbackAutomationSchedule,
} = await import("../src/lib/client-feedback/automation-store")
const { buildClientFeedbackAutomationEmail } = await import("../src/lib/client-feedback/automation-email")

try {
  const schedule = await upsertClientFeedbackAutomationSchedule({
    ownerUserId: "owner-1",
    clientId: "client-1",
    clientName: "自动反馈测试客户",
    actorUserId: "owner-1",
    weeklyEnabled: true,
    monthlyEnabled: true,
    timeLocal: "10:00",
    startDate: "2099-01-01",
    endDate: "2099-01-20",
    periodMode: "service",
    recipientEmails: ["Customer@Example.com", "customer@example.com", "owner@example.com"],
    sendEmptyReports: true,
    finalReportEnabled: true,
  })
  assert.equal(schedule.status, "active")
  assert.deepEqual(schedule.recipientEmails, ["customer@example.com", "owner@example.com"])
  assert.equal(schedule.nextRunAt, "2099-01-08T02:00:00.000Z")
  const email = buildClientFeedbackAutomationEmail({
    schedule,
    reports: [{
      type: "weekly",
      periodStart: "2099-01-01",
      periodEnd: "2099-01-07",
      label: "服务第 1 周",
      reportId: "report-email-1",
      sharePath: "/feedback/share/test-token",
    }],
  })
  assert.match(email.subject, /自动反馈测试客户/)
  assert.match(email.text, /https:\/\/shitugeo\.top\/feedback\/share\/test-token/)
  const raw = await fs.readFile(file, "utf8")
  assert.equal(raw.includes("customer@example.com"), false, "file backend must encrypt recipient emails")

  const manualPeriod = {
    type: "weekly" as const,
    index: 1,
    start: "2099-01-01",
    end: "2099-01-03",
    label: "当前周进度",
    dueAt: new Date().toISOString(),
    final: false,
  }
  const manualFirst = await createClientFeedbackAutomationExecution({
    schedule,
    periods: [manualPeriod],
    trigger: "manual",
    idempotencyKey: "manual-request-0001",
  })
  const manualRetry = await createClientFeedbackAutomationExecution({
    schedule,
    periods: [manualPeriod],
    trigger: "manual",
    idempotencyKey: "manual-request-0001",
  })
  const manualSecond = await createClientFeedbackAutomationExecution({
    schedule,
    periods: [manualPeriod],
    trigger: "manual",
    idempotencyKey: "manual-request-0002",
  })
  assert.equal(manualRetry.id, manualFirst.id, "同一请求重试必须幂等")
  assert.notEqual(manualSecond.id, manualFirst.id, "用户再次立即报送应创建独立任务")
  const rawWithExecutions = await fs.readFile(file, "utf8")
  assert.equal(
    rawWithExecutions.includes("customer@example.com"),
    false,
    "execution delivery history must encrypt recipient emails",
  )
  const retryPatch = clientFeedbackAutomationRetryPatch({
    ...manualFirst,
    status: "partial",
    reports: [{
      type: "weekly",
      periodStart: manualPeriod.start,
      periodEnd: manualPeriod.end,
      label: manualPeriod.label,
      reportId: "report-retry",
      sharePath: "/feedback/share/retry",
    }],
    deliveries: [
      { email: "customer@example.com", status: "sent", sentAt: new Date().toISOString() },
      { email: "owner@example.com", status: "failed", error: "SMTP timeout" },
    ],
  })
  assert.equal(retryPatch.status, "generated")
  assert.deepEqual(retryPatch.deliveries?.map(item => item.status), ["sent", "pending"])

  const first = await claimDueClientFeedbackAutomationExecutions(
    new Date("2099-01-16T03:00:00.000Z"),
  )
  assert.equal(first.length, 1)
  assert.deepEqual(first[0]?.periods.map(item => [item.type, item.start, item.end]), [
    ["weekly", "2099-01-01", "2099-01-07"],
    ["weekly", "2099-01-08", "2099-01-14"],
  ])
  const afterFirst = await getClientFeedbackAutomationScheduleByClient("owner-1", "client-1")
  assert.equal(afterFirst?.lastWeeklyPeriodEnd, "2099-01-14")
  assert.equal(afterFirst?.nextRunAt, "2099-01-21T02:00:00.000Z")

  const second = await claimDueClientFeedbackAutomationExecutions(
    new Date("2099-01-21T03:00:00.000Z"),
  )
  assert.equal(second.length, 1)
  assert.equal(second[0]?.periods.length, 2, "收官周报和月报应合并到同一报送任务")
  assert.equal(second[0]?.periods.every(item => item.final), true)
  const completed = await getClientFeedbackAutomationScheduleByClient("owner-1", "client-1")
  assert.equal(completed?.status, "completed")
  assert.equal(completed?.nextRunAt, undefined)

  const execution = await patchClientFeedbackAutomationExecution({
    ownerUserId: "owner-1",
    id: first[0]!.id,
    patch: {
      status: "sent",
      reports: [{
        type: "weekly",
        periodStart: "2099-01-01",
        periodEnd: "2099-01-07",
        label: "服务第 1 周",
        reportId: "report-1",
        sharePath: "/feedback/share/test",
      }],
      deliveries: [{ email: "customer@example.com", status: "sent", sentAt: new Date().toISOString() }],
      completedAt: new Date().toISOString(),
    },
  })
  assert.equal(execution?.status, "sent")
  assert.equal((await listClientFeedbackAutomationExecutions({
    ownerUserId: "owner-1",
    scheduleId: schedule.id,
  })).length, 4)

  const paused = await setClientFeedbackAutomationScheduleStatus({
    ownerUserId: "owner-1",
    id: schedule.id,
    status: "paused",
  })
  assert.equal(paused?.status, "paused")
  console.log("Client feedback automation schedule and encrypted delivery store tests passed.")
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
