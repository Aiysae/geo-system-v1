import type { ModelKey } from "@/types"

export type PenetrationProviderPhase = "consumer" | "judge"

type SemaphoreSnapshot = {
  active: number
  waiting: number
  limit: number
}

type PenetrationConcurrencyConfig = {
  total: number
  judge: number
  providers: Record<ModelKey, number>
}

class AsyncSemaphore {
  private active = 0
  private readonly waiters: Array<(release: () => void) => void> = []

  constructor(readonly limit: number) {}

  private releaseFactory(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.waiters.shift()
      if (next) {
        next(this.releaseFactory())
        return
      }
      this.active = Math.max(0, this.active - 1)
    }
  }

  acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++
      return Promise.resolve(this.releaseFactory())
    }
    return new Promise(resolve => {
      this.waiters.push(resolve)
    })
  }

  snapshot(): SemaphoreSnapshot {
    return {
      active: this.active,
      waiting: this.waiters.length,
      limit: this.limit,
    }
  }
}

export class PenetrationConcurrencyController {
  private readonly total: AsyncSemaphore
  private readonly judge: AsyncSemaphore
  private readonly providers: Record<ModelKey, AsyncSemaphore>

  constructor(config: PenetrationConcurrencyConfig) {
    this.total = new AsyncSemaphore(config.total)
    this.judge = new AsyncSemaphore(config.judge)
    this.providers = {
      doubao: new AsyncSemaphore(config.providers.doubao),
      deepseek: new AsyncSemaphore(config.providers.deepseek),
      qwen: new AsyncSemaphore(config.providers.qwen),
      kimi: new AsyncSemaphore(config.providers.kimi),
      ernie: new AsyncSemaphore(config.providers.ernie),
      hunyuan: new AsyncSemaphore(config.providers.hunyuan),
    }
  }

  async run<T>(
    model: ModelKey,
    phase: PenetrationProviderPhase,
    task: () => Promise<T>,
  ): Promise<T> {
    // Judge requests enter their narrow lane before consuming provider/global
    // capacity, so a judge backlog cannot occupy all consumer request slots.
    const releaseJudge = phase === "judge" ? await this.judge.acquire() : null
    const releaseProvider = await this.providers[model].acquire()
    const releaseTotal = await this.total.acquire()
    try {
      return await task()
    } finally {
      releaseTotal()
      releaseProvider()
      releaseJudge?.()
    }
  }

  snapshot(): {
    total: SemaphoreSnapshot
    judge: SemaphoreSnapshot
    providers: Record<ModelKey, SemaphoreSnapshot>
  } {
    return {
      total: this.total.snapshot(),
      judge: this.judge.snapshot(),
      providers: {
        doubao: this.providers.doubao.snapshot(),
        deepseek: this.providers.deepseek.snapshot(),
        qwen: this.providers.qwen.snapshot(),
        kimi: this.providers.kimi.snapshot(),
        ernie: this.providers.ernie.snapshot(),
        hunyuan: this.providers.hunyuan.snapshot(),
      },
    }
  }
}

function concurrencyValue(name: string, fallback: number, maximum: number): number {
  const configured = Math.floor(Number(process.env[name]))
  return Math.max(
    1,
    Math.min(maximum, Number.isFinite(configured) && configured > 0 ? configured : fallback),
  )
}

function runtimeConfig(): PenetrationConcurrencyConfig {
  const schedulerV3 = process.env.PENETRATION_SCHEDULER_V3
    ?.trim().toLowerCase() !== "false"
  const schedulerV2 = process.env.PENETRATION_SCHEDULER_V2
    ?.trim().toLowerCase() !== "false"
  const variable = (suffix: string) => schedulerV3
    ? `PENETRATION_V3_${suffix}`
    : schedulerV2
      ? `PENETRATION_V2_${suffix}`
      : `PENETRATION_${suffix}`

  return {
    total: concurrencyValue(variable("PROVIDER_TOTAL_CONCURRENCY"), schedulerV3 ? 16 : 12, 24),
    judge: concurrencyValue(variable("JUDGE_CONCURRENCY"), schedulerV3 ? 4 : 3, 6),
    providers: {
      doubao: concurrencyValue(variable("DOUBAO_CONCURRENCY"), schedulerV3 ? 6 : 3, 6),
      deepseek: concurrencyValue(variable("DEEPSEEK_CONCURRENCY"), schedulerV3 ? 12 : 8, 12),
      qwen: concurrencyValue(variable("QWEN_CONCURRENCY"), schedulerV3 ? 12 : 8, 12),
      kimi: concurrencyValue(variable("KIMI_CONCURRENCY"), schedulerV3 ? 6 : 4, 6),
      ernie: concurrencyValue(variable("ERNIE_CONCURRENCY"), schedulerV3 ? 10 : 6, 10),
      hunyuan: concurrencyValue(variable("HUNYUAN_CONCURRENCY"), schedulerV3 ? 5 : 3, 5),
    },
  }
}

const concurrencyGlobal = globalThis as typeof globalThis & {
  __geoPenetrationConcurrencyController?: PenetrationConcurrencyController
}

const controller = concurrencyGlobal.__geoPenetrationConcurrencyController
  || new PenetrationConcurrencyController(runtimeConfig())

concurrencyGlobal.__geoPenetrationConcurrencyController = controller

export async function runPenetrationProviderCall<T>(
  model: ModelKey,
  phase: PenetrationProviderPhase,
  task: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  const result = await controller.run(model, phase, task)
  const elapsedMs = Date.now() - startedAt
  if (elapsedMs >= 30_000) {
    const snapshot = controller.snapshot()
    console.info(
      `[penetration-concurrency] ${model}/${phase} completed after ${elapsedMs}ms `
      + `(global ${snapshot.total.active}/${snapshot.total.limit}, waiting ${snapshot.total.waiting}; `
      + `provider waiting ${snapshot.providers[model].waiting})`,
    )
  }
  return result
}

export function getPenetrationConcurrencySnapshot() {
  return controller.snapshot()
}
