import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"

interface DistributedConcurrencyInput {
  scope: string
  limit: number
  waitTimeoutMs: number
  leaseSeconds: number
  label: string
}

interface AcquiredDistributedSlot {
  key: string
  token: string
}

function safeScope(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9:._-]+/g, "_")
    .slice(0, 240)
}

async function tryAcquire(
  scope: string,
  limit: number,
  leaseSeconds: number,
): Promise<AcquiredDistributedSlot | null> {
  const token = randomUUID()
  for (let slot = 0; slot < limit; slot += 1) {
    const key = `geo:distributed-concurrency:${scope}:${slot}`
    const acquired = await kv.set(key, token, { nx: true, ex: leaseSeconds })
    if (acquired) return { key, token }
  }
  return null
}

async function release(slot: AcquiredDistributedSlot): Promise<void> {
  try {
    const current = await kv.get<string>(slot.key)
    if (current === slot.token) await kv.del(slot.key)
  } catch (error) {
    console.warn(
      "[distributed-concurrency] failed to release lease",
      error instanceof Error ? error.message : String(error),
    )
  }
}

export async function acquireDistributedConcurrency(
  input: DistributedConcurrencyInput,
): Promise<() => Promise<void>> {
  const scope = safeScope(input.scope)
  if (!scope) throw new Error("分布式并发租约缺少作用域")
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit)))
  const waitTimeoutMs = Math.max(0, Math.min(10 * 60_000, input.waitTimeoutMs))
  const leaseSeconds = Math.max(30, Math.min(60 * 60, input.leaseSeconds))
  const deadline = Date.now() + waitTimeoutMs
  let slot: AcquiredDistributedSlot | null = null

  do {
    slot = await tryAcquire(scope, limit, leaseSeconds)
    if (slot) break
    if (Date.now() >= deadline) break
    await new Promise(resolve => setTimeout(
      resolve,
      Math.min(500, Math.max(50, deadline - Date.now())),
    ))
  } while (Date.now() <= deadline)

  if (!slot) {
    throw new Error(`${input.label} 当前任务较多，排队等待超时，请稍后重试`)
  }

  let released = false
  return async () => {
    if (released) return
    released = true
    await release(slot)
  }
}
