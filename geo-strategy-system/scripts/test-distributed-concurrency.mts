import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDir = mkdtempSync(join(tmpdir(), "geo-distributed-concurrency-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")

const { acquireDistributedConcurrency } = await import(
  "../src/lib/distributed-concurrency"
)

const firstRelease = await acquireDistributedConcurrency({
  scope: "article-gateway:test-provider",
  limit: 1,
  waitTimeoutMs: 0,
  leaseSeconds: 60,
  label: "测试中转站",
})

await assert.rejects(
  () => acquireDistributedConcurrency({
    scope: "article-gateway:test-provider",
    limit: 1,
    waitTimeoutMs: 80,
    leaseSeconds: 60,
    label: "测试中转站",
  }),
  /排队等待超时/,
)

await firstRelease()
await firstRelease()

const secondRelease = await acquireDistributedConcurrency({
  scope: "article-gateway:test-provider",
  limit: 1,
  waitTimeoutMs: 0,
  leaseSeconds: 60,
  label: "测试中转站",
})
await secondRelease()

rmSync(tempDir, { recursive: true, force: true })
console.log("Distributed gateway concurrency leases enforce and release shared slots")
