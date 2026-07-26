import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-task-cancellation-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(directory, "kv.json")
process.env.TASK_QUEUE_BACKEND = "local"
delete process.env.REDIS_URL

const {
  clearTaskCancellation,
  getTaskCancellationRequest,
  isTaskCancellationRequested,
  registerTaskAbortController,
  requestTaskCancellation,
  signalTaskCancellation,
  startTaskCancellationMonitor,
} = await import("../src/lib/task-cancellation")

const sourceJobId = "pjob_cancel_signal_test"
const controller = new AbortController()
const unregister = registerTaskAbortController(
  "penetration",
  sourceJobId,
  controller,
)

const queueResult = await signalTaskCancellation(
  "penetration",
  sourceJobId,
  "user-a",
)
assert.equal(queueResult.state, "local")
assert.equal(controller.signal.aborted, true, "同进程控制器应立即收到停止信号")
assert.equal(await isTaskCancellationRequested("penetration", sourceJobId), true)
assert.equal(
  (await getTaskCancellationRequest("penetration", sourceJobId))?.requestedBy,
  "user-a",
)
unregister()

const workerJobId = "djob_cross_process_test"
await requestTaskCancellation("difficulty", workerJobId, "user-b")
const workerController = new AbortController()
const stopMonitor = startTaskCancellationMonitor("difficulty", workerJobId, 25)
const unregisterWorker = registerTaskAbortController(
  "difficulty",
  workerJobId,
  workerController,
)
await new Promise(resolve => setTimeout(resolve, 80))
assert.equal(
  workerController.signal.aborted,
  true,
  "独立 Worker 轮询共享状态后应中止本进程请求",
)
stopMonitor()
unregisterWorker()

await clearTaskCancellation("penetration", sourceJobId)
await clearTaskCancellation("difficulty", workerJobId)
assert.equal(await isTaskCancellationRequested("penetration", sourceJobId), false)
assert.equal(await isTaskCancellationRequested("difficulty", workerJobId), false)

await fs.rm(directory, { recursive: true, force: true })
console.log("task cancellation tests passed")
