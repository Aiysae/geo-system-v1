import "server-only"

import { randomUUID } from "crypto"
import {
  getAdapterCredentialPoolCapacity,
  getAdapterCredentialPoolSnapshot,
} from "@/lib/ai-credential-adapter"
import { kv } from "@/lib/kv"
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
  schedulerReservation?: {
    token: string
    keys: string[]
  }
}

type PenetrationWaveReservationHolder = Pick<
  PenetrationWaveBatch,
  "schedulerReservation"
>

type CapacityRoute = {
  vendor: ModelKey
  maxConcurrency: number
}

type LiveCapacityRoute = CapacityRoute & {
  availableConcurrency: number
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

function v3QuestionBatchLimit(model: ModelKey): number {
  const fallback = model === "hunyuan"
    ? 1
    : model === "kimi" || model === "doubao"
      ? 3
      : model === "ernie"
        ? 4
        : 6
  return boundedEnv(
    `PENETRATION_V3_${model.toUpperCase()}_QUESTION_BATCH_SIZE`,
    fallback,
    12,
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

async function modelLiveCapacity(model: ModelKey): Promise<LiveCapacityRoute> {
  const snapshot = await getAdapterCredentialPoolSnapshot(
    model,
    "penetration",
    STRICT_WEB_ARGS,
  )
  if (snapshot.maxConcurrency <= 0) {
    // Job creation normally filters unavailable models. Keep one recovery
    // probe for legacy jobs and tests created before credential-pool metadata.
    return {
      vendor: snapshot.vendor,
      maxConcurrency: 1,
      availableConcurrency: 1,
    }
  }
  return {
    vendor: snapshot.vendor,
    maxConcurrency: snapshot.maxConcurrency,
    availableConcurrency: Math.max(0, snapshot.availableConcurrency),
  }
}

function schedulerSlotKey(vendor: ModelKey, slot: number): string {
  return `geo:penetration:scheduler-v3:${vendor}:${slot}`
}

async function reserveSchedulerSlots(args: {
  vendor: ModelKey
  capacity: number
  desired: number
  token: string
}): Promise<string[]> {
  const keys: string[] = []
  const leaseSeconds = boundedEnv(
    "PENETRATION_V3_RESERVATION_SECONDS",
    6 * 60,
    30 * 60,
  )
  for (let slot = 0; slot < args.capacity && keys.length < args.desired; slot++) {
    const key = schedulerSlotKey(args.vendor, slot)
    const acquired = await kv.set(key, args.token, {
      nx: true,
      ex: leaseSeconds,
    })
    if (acquired) keys.push(key)
  }
  return keys
}

async function releaseSchedulerReservation(
  reservation: PenetrationWaveBatch["schedulerReservation"],
): Promise<void> {
  if (!reservation || reservation.keys.length === 0) return
  await Promise.all(
    reservation.keys.map(async key => {
      try {
        const current = await kv.get<string>(key)
        if (current === reservation.token) await kv.del(key)
      } catch (error) {
        console.warn(
          "[penetration-wave] failed to release scheduler reservation",
          key,
          error instanceof Error ? error.message : String(error),
        )
      }
    }),
  )
}

export async function releasePenetrationWaveBatchReservation(
  batch: PenetrationWaveReservationHolder,
): Promise<void> {
  await releaseSchedulerReservation(batch.schedulerReservation)
}

export async function releasePenetrationWaveReservations(
  batches: PenetrationWaveReservationHolder[],
): Promise<void> {
  await Promise.all(batches.map(releasePenetrationWaveBatchReservation))
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

export async function selectPenetrationDueWaveV3(args: {
  models: ModelKey[]
  questions: string[]
  states: Record<string, PenetrationWaveSlotState>
  nowMs: number
  rotationSeed: number
  allowElasticCapacity?: boolean
}): Promise<PenetrationWaveBatch[]> {
  const batchLimit = boundedEnv("PENETRATION_V3_WAVE_BATCH_LIMIT", 12, 32)
  const slotLimit = boundedEnv("PENETRATION_V3_WAVE_SLOT_LIMIT", 24, 64)
  const stablePerJobVendorLimit = boundedEnv(
    "PENETRATION_V3_MAX_LANES_PER_JOB",
    6,
    24,
  )
  const elasticPerJobVendorLimit = boundedEnv(
    "PENETRATION_V3_ELASTIC_MAX_LANES_PER_JOB",
    12,
    24,
  )
  const perJobVendorLimit = args.allowElasticCapacity
    ? Math.max(stablePerJobVendorLimit, elasticPerJobVendorLimit)
    : stablePerJobVendorLimit
  const routes = new Map<ModelKey, LiveCapacityRoute>(
    await Promise.all(args.models.map(async model => (
      [model, await modelLiveCapacity(model)] as const
    ))),
  )
  const vendorCapacity = new Map<ModelKey, {
    maxConcurrency: number
    availableConcurrency: number
  }>()
  for (const route of routes.values()) {
    const current = vendorCapacity.get(route.vendor) || {
      maxConcurrency: 0,
      availableConcurrency: 0,
    }
    current.maxConcurrency = Math.max(current.maxConcurrency, route.maxConcurrency)
    current.availableConcurrency = Math.max(
      current.availableConcurrency,
      route.availableConcurrency,
    )
    vendorCapacity.set(route.vendor, current)
  }

  const token = `pwave_${randomUUID().replace(/-/g, "")}`
  const reservedByVendor = new Map<ModelKey, string[]>()
  try {
    await Promise.all(
      [...vendorCapacity.entries()].map(async ([vendor, capacity]) => {
        const desired = Math.min(
          capacity.availableConcurrency,
          capacity.maxConcurrency,
          perJobVendorLimit,
          slotLimit,
        )
        if (desired <= 0) return
        const keys = await reserveSchedulerSlots({
          vendor,
          capacity: capacity.maxConcurrency,
          desired,
          token,
        })
        if (keys.length > 0) reservedByVendor.set(vendor, keys)
      }),
    )

    const offset = args.models.length > 0
      ? Math.abs(Math.floor(args.rotationSeed)) % args.models.length
      : 0
    const models = [
      ...args.models.slice(offset),
      ...args.models.slice(0, offset),
    ]
    const selectedSlots = new Set<string>()
    const usedByVendor = new Map<ModelKey, number>()
    const usedByModel = new Map<ModelKey, number>()
    const dueModelCountByVendor = new Map<ModelKey, number>()
    for (const model of models) {
      const route = routes.get(model)
      if (!route) continue
      const hasDue = args.questions.some((_, index) =>
        isDue(args.states[`${model}:${index}`], args.nowMs),
      )
      if (!hasDue) continue
      dueModelCountByVendor.set(
        route.vendor,
        (dueModelCountByVendor.get(route.vendor) || 0) + 1,
      )
    }
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
        const vendorKeys = reservedByVendor.get(route.vendor) || []
        const vendorUsed = usedByVendor.get(route.vendor) || 0
        const remainingVendorCapacity = vendorKeys.length - vendorUsed
        const remainingModelCapacity = route.availableConcurrency
          - (usedByModel.get(model) || 0)
        if (remainingVendorCapacity <= 0 || remainingModelCapacity <= 0) continue

        let sampleStart = -1
        for (let index = 0; index < args.questions.length; index++) {
          const key = `${model}:${index}`
          if (selectedSlots.has(key) || !isDue(args.states[key], args.nowMs)) continue
          sampleStart = index
          break
        }
        if (sampleStart < 0) continue

        const fairVendorShare = Math.max(
          1,
          Math.ceil(
            vendorKeys.length / Math.max(1, dueModelCountByVendor.get(route.vendor) || 1),
          ),
        )
        const maxQuestions = Math.min(
          v3QuestionBatchLimit(model),
          fairVendorShare,
          remainingVendorCapacity,
          remainingModelCapacity,
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
          schedulerReservation: {
            token,
            keys: vendorKeys.slice(vendorUsed, vendorUsed + count),
          },
        })
        selectedCount += count
        usedByVendor.set(route.vendor, vendorUsed + count)
        usedByModel.set(model, (usedByModel.get(model) || 0) + count)
        madeProgress = true
      }
    }

    const usedKeys = new Set(
      batches.flatMap(batch => batch.schedulerReservation?.keys || []),
    )
    const unusedReservation: PenetrationWaveBatch["schedulerReservation"] = {
      token,
      keys: [...reservedByVendor.values()]
        .flat()
        .filter(key => !usedKeys.has(key)),
    }
    await releaseSchedulerReservation(unusedReservation)
    return batches
  } catch (error) {
    await releaseSchedulerReservation({
      token,
      keys: [...reservedByVendor.values()].flat(),
    })
    throw error
  }
}
