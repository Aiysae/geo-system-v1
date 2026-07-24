import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-task-center-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(directory, "kv.json")
process.env.TASK_CENTER_STORE = "kv"
delete process.env.DATABASE_URL

const {
  listTaskCenterTasks,
  markAllTaskCenterTasksRead,
  markTaskCenterTaskRead,
  upsertTaskCenterTask,
} = await import("../src/lib/task-center/store")

const now = new Date().toISOString()
const standardTask = {
  source: "penetration" as const,
  sourceJobId: "pjob_test_standard",
  kind: "penetrationDetection",
  module: "penetration" as const,
  actorUserId: "owner-a",
  workspaceOwnerUserId: "owner-a",
  clientId: "client-a",
  clientName: "甲品牌",
  title: "甲品牌 · 疑问句检测",
  status: "queued" as const,
  progressPercent: 0,
  stage: "等待处理",
  resultUrl: "/workspace?clientId=client-a&module=penetration",
  canCancel: true,
  createdAt: now,
  updatedAt: now,
}

await upsertTaskCenterTask(standardTask)

const ownerQueued = await listTaskCenterTasks("owner-a")
assert.equal(ownerQueued.tasks.length, 1, "创建者应看见自己的任务")
assert.equal(ownerQueued.activeCount, 1, "排队任务应计入进行中")
assert.equal(ownerQueued.unreadCount, 0, "进行中任务不应计入未读完成提醒")

const unrelatedQueued = await listTaskCenterTasks("unrelated-user")
assert.equal(unrelatedQueued.tasks.length, 0, "无关账号不能看见其他账号任务")

await upsertTaskCenterTask({
  ...standardTask,
  status: "succeeded",
  progressPercent: 100,
  stage: "检测结果已保存",
  canCancel: false,
  updatedAt: new Date(Date.now() + 1_000).toISOString(),
  finishedAt: new Date(Date.now() + 1_000).toISOString(),
})

const ownerCompleted = await listTaskCenterTasks("owner-a")
assert.equal(ownerCompleted.tasks.length, 1, "同一来源任务更新不得产生重复记录")
assert.equal(ownerCompleted.activeCount, 0)
assert.equal(ownerCompleted.unreadCount, 1, "新完成任务应产生未读提醒")
assert.equal(ownerCompleted.tasks[0].unread, true)

assert.equal(
  await markTaskCenterTaskRead(ownerCompleted.tasks[0].id, "unrelated-user"),
  false,
  "无关账号不能修改任务已读状态",
)
assert.equal(
  await markTaskCenterTaskRead(ownerCompleted.tasks[0].id, "owner-a"),
  true,
)
assert.equal((await listTaskCenterTasks("owner-a")).unreadCount, 0)

const childTask = {
  source: "penetration" as const,
  sourceJobId: "pjob_test_child",
  kind: "penetrationDetection",
  module: "penetration" as const,
  actorUserId: "child-user",
  workspaceOwnerUserId: "workspace-owner",
  clientId: "client-child",
  clientName: "客户专属品牌",
  title: "客户专属品牌 · 疑问句检测",
  status: "succeeded" as const,
  progressPercent: 100,
  stage: "检测结果已保存",
  resultUrl: "/workspace?clientId=client-child&module=penetration",
  canCancel: false,
  createdAt: now,
  updatedAt: now,
  finishedAt: now,
}

await upsertTaskCenterTask(childTask)

const childView = await listTaskCenterTasks("child-user")
assert.equal(childView.tasks.length, 1)
assert.equal(childView.tasks[0].scope, "mine", "客户账号应把自己发起的任务标记为本人任务")
assert.equal(childView.unreadCount, 1)

const parentView = await listTaskCenterTasks("workspace-owner")
assert.equal(parentView.tasks.length, 1, "主账号应看见客户专属账号发起的任务")
assert.equal(parentView.tasks[0].scope, "workspace")
assert.equal(parentView.unreadCount, 1)

assert.equal((await listTaskCenterTasks("another-user")).tasks.length, 0)

assert.equal(await markAllTaskCenterTasksRead("workspace-owner"), 1)
assert.equal((await listTaskCenterTasks("workspace-owner")).unreadCount, 0)
assert.equal(
  (await listTaskCenterTasks("child-user")).unreadCount,
  1,
  "主账号已读不能替客户账号清除未读状态",
)

await upsertTaskCenterTask({
  ...childTask,
  status: "running",
  progressPercent: 45,
  stage: "恢复中的测试任务",
  canCancel: true,
  updatedAt: new Date(Date.now() + 2_000).toISOString(),
  finishedAt: undefined,
})
const resumed = await listTaskCenterTasks("child-user")
assert.equal(resumed.tasks.length, 1)
assert.equal(resumed.tasks[0].status, "running")
assert.equal(resumed.tasks[0].progressPercent, 45)
assert.equal(resumed.activeCount, 1)
assert.equal(resumed.unreadCount, 0)

await fs.rm(directory, { recursive: true, force: true })
console.log("task center tests passed")
