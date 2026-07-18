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
  return {
    total: concurrencyValue("PENETRATION_PROVIDER_TOTAL_CONCURRENCY", 8, 20),
    judge: concurrencyValue("PENETRATION_JUDGE_CONCURRENCY", 2, 6),
    providers: {
      doubao: concurrencyValue("PENETRATION_DOUBAO_CONCURRENCY", 1, 5),
      deepseek: concurrencyValue("PENETRATION_DEEPSEEK_CONCURRENCY", 3, 10),
      qwen: concurrencyValue("PENETRATION_QWEN_CONCURRENCY", 3, 10),
      kimi: concurrencyValue("PENETRATION_KIMI_CONCURRENCY", 1, 5),
      ernie: concurrencyValue("PENETRATION_ERNIE_CONCURRENCY", 2, 8),
      hunyuan: concurrencyValue("PENETRATION_HUNYUAN_CONCURRENCY", 3, 5),
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
