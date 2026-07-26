import assert from "node:assert/strict"

process.env.TASK_QUEUE_BACKEND = "local"
delete process.env.REDIS_URL

const {
  cancelQueuedDurableTask,
  dispatchDurableTaskOrFallback,
  durableTaskDispatchJobId,
  durableTaskQueueEnabled,
  durableTaskQueueLane,
  durableTaskQueueName,
  durableTaskQueueNameForLane,
  durableTaskQueueNameForSource,
  isDurableTaskSource,
} = await import("../src/lib/task-queue/index")

assert.equal(durableTaskQueueEnabled(), false)
assert.equal(durableTaskQueueEnabled("penetration"), false)
assert.equal(durableTaskQueueName(), "geo-long-tasks-v1")
assert.equal(durableTaskQueueLane("penetration"), "penetration")
assert.equal(durableTaskQueueLane("difficulty"), "generation")
assert.equal(durableTaskQueueLane("question"), "generation")
assert.equal(durableTaskQueueLane("articleBatch"), "generation")
assert.equal(durableTaskQueueLane("background"), "generation")
assert.equal(durableTaskQueueLane("report"), "utility")
assert.equal(
  durableTaskQueueNameForSource("penetration"),
  "geo-long-tasks-v1-penetration",
)
assert.equal(
  durableTaskQueueNameForLane("generation"),
  "geo-long-tasks-v1-generation",
)
assert.equal(
  durableTaskDispatchJobId(
    "penetration",
    "pjob_task_queue_fallback",
    "0ec0a2c7-40ba-4cd0-9f5b-f0f0f5af5b62",
  ),
  "penetration-pjob_task_queue_fallback-0ec0a2c740ba4cd09f5bf0f0f5af5b62",
)


let fallbackCalls = 0
await dispatchDurableTaskOrFallback(
  "penetration",
  "pjob_task_queue_fallback",
  () => {
    fallbackCalls++
  },
)
assert.equal(fallbackCalls, 1, "local backend must execute the in-process fallback")
assert.deepEqual(
  await cancelQueuedDurableTask("penetration", "pjob_task_queue_fallback"),
  { state: "local" },
  "local queue cancellation should be handled by the source task state",
)

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
