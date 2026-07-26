import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-task-worker-health-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")

const {
  getDurableTaskWorkerHeartbeats,
  recordDurableTaskWorkerHeartbeat,
  removeDurableTaskWorkerHeartbeat,
} = await import("../src/lib/task-queue/index")

const workerId = "test-worker-1"

try {
  await recordDurableTaskWorkerHeartbeat({
    workerId,
    startedAt: "2026-07-26T00:00:00.000Z",
    queues: [
      {
        lane: "penetration",
        queueName: "geo-long-tasks-v1-penetration",
        concurrency: 4,
      },
    ],
  })

  const active = await getDurableTaskWorkerHeartbeats()
  assert.equal(active.length, 1)
  assert.equal(active[0]?.workerId, workerId)
  assert.equal(active[0]?.queues[0]?.lane, "penetration")
  assert.equal(active[0]?.queues[0]?.concurrency, 4)
  assert.ok(Date.parse(active[0]?.heartbeatAt || "") > 0)

  await removeDurableTaskWorkerHeartbeat(workerId)
  assert.deepEqual(await getDurableTaskWorkerHeartbeats(), [])

  console.log("Durable task worker heartbeat tests passed.")
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
