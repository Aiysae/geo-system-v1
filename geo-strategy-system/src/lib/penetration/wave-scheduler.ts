import "server-only"

import { getAdapterCredentialPoolCapacity } from "@/lib/ai-credential-adapter"
import type { ModelKey } from "@/types"

export type PenetrationWaveSlotState = {
  model: ModelKey
  questionIndex: number
  status: "queued" | "running" | "retry_wait" | "success" | "provider_blocked"
  nextRetryAt?: string
}

export type PenetrationWaveBatch = {
  questions: string[]
  models: [ModelKey]
  sampleStart: number
}

type CapacityRoute = {
  vendor: ModelKey
  maxConcurrency: number
}

const capacityCache = new Map<ModelKey, {
  expiresAt: number
  value: CapacityRoute
}>()

const STRICT_WEB_ARGS = {
  system: "",
  user: "",
  mode: "consumer" as const,
  forceWebSearch: true,
  rawQuestionOnly: true,
  requireWebEvidence: true,
  officialWebOnly: true,
}

function boundedEnv(name: string, fallback: number, maximum: number): number {
  const configured = Math.floor(Number(process.env[name]))
  return Math.max(
    1,
    Math.min(
      maximum,
      Number.isFinite(configured) && configured > 0 ? configured : fallback,
    ),
  )
}

function questionBatchLimit(model: ModelKey): number {
  const fallback = model === "hunyuan" || model === "kimi"
    ? 1
    : model === "doubao" || model === "ernie"
      ? 2
      : 3
  return boundedEnv(
    `PENETRATION_${model.toUpperCase()}_QUESTION_BATCH_SIZE`,
    fallback,
    8,
  )
}

function isDue(state: PenetrationWaveSlotState | undefined, nowMs: number): boolean {
  if (!state) return false
  if (state.status === "queued") return true
  if (state.status !== "retry_wait") return false
  return !state.nextRetryAt || Date.parse(state.nextRetryAt) <= nowMs
}

async function modelCapacity(model: ModelKey): Promise<CapacityRoute> {
  const cached = capacityCache.get(model)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const capacity = await getAdapterCredentialPoolCapacity(
    model,
    "penetration",
    STRICT_WEB_ARGS,
  )
  const value: CapacityRoute = {
    vendor: capacity.vendor,
    // Readiness is checked before the job is created. A temporary cooldown may
    // report zero here; retain one probe lane so the slot can recover itself.
    maxConcurrency: Math.max(1, capacity.maxConcurrency),
  }
  capacityCache.set(model, {
    expiresAt: Date.now() + 15_000,
    value,
  })
  return value
}

export async function selectPenetrationDueWave(args: {
  models: ModelKey[]
  questions: string[]
  states: Record<string, PenetrationWaveSlotState>
  nowMs: number
  rotationSeed: number
}): Promise<PenetrationWaveBatch[]> {
  const batchLimit = boundedEnv("PENETRATION_JOB_WAVE_BATCH_LIMIT", 10, 24)
  const slotLimit = boundedEnv("PENETRATION_JOB_WAVE_SLOT_LIMIT", 24, 64)
  const routes = new Map<ModelKey, CapacityRoute>(
    await Promise.all(args.models.map(async model => (
      [model, await modelCapacity(model)] as const
    ))),
  )
  const vendorCapacity = new Map<ModelKey, number>()
  for (const route of routes.values()) {
    vendorCapacity.set(
      route.vendor,
      Math.max(vendorCapacity.get(route.vendor) || 0, route.maxConcurrency),
    )
  }

  const offset = args.models.length > 0
    ? Math.abs(Math.floor(args.rotationSeed)) % args.models.length
    : 0
  const models = [
    ...args.models.slice(offset),
    ...args.models.slice(0, offset),
  ]
  const selectedSlots = new Set<string>()
  const usedByVendor = new Map<ModelKey, number>()
  const batches: PenetrationWaveBatch[] = []
  let selectedCount = 0
  let madeProgress = true

  while (
    madeProgress
    && batches.length < batchLimit
    && selectedCount < slotLimit
  ) {
    madeProgress = false
    for (const model of models) {
      if (batches.length >= batchLimit || selectedCount >= slotLimit) break
      const route = routes.get(model)
      if (!route) continue
      const remainingVendorCapacity = (vendorCapacity.get(route.vendor) || 1)
        - (usedByVendor.get(route.vendor) || 0)
      if (remainingVendorCapacity <= 0) continue

      let sampleStart = -1
      for (let index = 0; index < args.questions.length; index++) {
        const key = `${model}:${index}`
        if (selectedSlots.has(key) || !isDue(args.states[key], args.nowMs)) continue
        sampleStart = index
        break
      }
      if (sampleStart < 0) continue

      const maxQuestions = Math.min(
        questionBatchLimit(model),
        remainingVendorCapacity,
        slotLimit - selectedCount,
      )
      let count = 0
      while (count < maxQuestions && sampleStart + count < args.questions.length) {
        const key = `${model}:${sampleStart + count}`
        if (selectedSlots.has(key) || !isDue(args.states[key], args.nowMs)) break
        selectedSlots.add(key)
        count++
      }
      if (count === 0) continue

      batches.push({
        models: [model],
        questions: args.questions.slice(sampleStart, sampleStart + count),
        sampleStart,
      })
      selectedCount += count
      usedByVendor.set(
        route.vendor,
        (usedByVendor.get(route.vendor) || 0) + count,
      )
      madeProgress = true
    }
  }

  return batches
}
