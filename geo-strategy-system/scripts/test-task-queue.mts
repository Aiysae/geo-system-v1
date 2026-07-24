import assert from "node:assert/strict"

process.env.TASK_QUEUE_BACKEND = "local"
delete process.env.REDIS_URL

const {
  dispatchDurableTaskOrFallback,
  durableTaskQueueEnabled,
  durableTaskQueueName,
  isDurableTaskSource,
} = await import("../src/lib/task-queue/index")

assert.equal(durableTaskQueueEnabled(), false)
assert.equal(durableTaskQueueEnabled("penetration"), false)
assert.equal(durableTaskQueueName(), "geo-long-tasks-v1")

let fallbackCalls = 0
await dispatchDurableTaskOrFallback(
  "penetration",
  "pjob_task_queue_fallback",
  () => {
    fallbackCalls++
  },
)
assert.equal(fallbackCalls, 1, "local backend must execute the in-process fallback")

for (const source of [
  "penetration",
  "difficulty",
  "background",
  "question",
  "articleBatch",
  "report",
]) {
  assert.equal(isDurableTaskSource(source), true, `${source} must be a durable task source`)
}
assert.equal(isDurableTaskSource("unknown"), false)
assert.equal(isDurableTaskSource(null), false)

process.env.TASK_QUEUE_BACKEND = "bullmq"
assert.equal(
  durableTaskQueueEnabled("penetration"),
  false,
  "BullMQ must not start without REDIS_URL",
)

console.log("durable task queue fallback tests passed")
