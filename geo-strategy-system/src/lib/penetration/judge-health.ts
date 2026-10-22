import { kv } from "@/lib/kv"
import type { ModelKey } from "@/types"

// Which judge to ask first, from how judges have done lately. A batch tries
// judges in turn and each failure costs up to its timeout, so an unreliable
// judge at the front cost minutes per batch; on a Qwen-only re-run, the rule
// that kept the tested model last pushed the steadiest judge to the end.

interface JudgeHealth {
  /** Recent successes and failures, decayed so old outcomes fade. */
  ok: number
  failed: number
  failStreak: number
  /** Smoothed time of a successful judgement. */
  latencyMs: number
  /** Asked only as a last resort until then. */
  skipUntil?: number
  updatedAt: number
}

const DECAY = 0.9
const SKIP_AFTER_STREAK = 2
const SKIP_BASE_MS = 5 * 60_000
const SKIP_MAX_MS = 30 * 60_000
const UNKNOWN_LATENCY_MS = 30_000
const KEY = (model: ModelKey) => `geo:penetration:judge-health:${model}`

export async function recordJudgeOutcome(model: ModelKey, ok: boolean, latencyMs: number): Promise<void> {
  const now = Date.now()
  const current = await kv.get<JudgeHealth>(KEY(model)).catch(() => null)
  const failStreak = ok ? 0 : (current?.failStreak || 0) + 1
  const next: JudgeHealth = {
    ok: (current?.ok || 0) * DECAY + (ok ? 1 : 0),
    failed: (current?.failed || 0) * DECAY + (ok ? 0 : 1),
    failStreak,
    latencyMs: ok
      ? current?.latencyMs ? Math.round(current.latencyMs * 0.7 + latencyMs * 0.3) : latencyMs
      : current?.latencyMs || 0,
    // A judge failing in a row sits out, longer each time it keeps failing.
    skipUntil: ok
      ? undefined
      : failStreak >= SKIP_AFTER_STREAK
        ? now + Math.min(SKIP_MAX_MS, SKIP_BASE_MS * 2 ** (failStreak - SKIP_AFTER_STREAK))
        : current?.skipUntil,
    updatedAt: now,
  }
  await kv.set(KEY(model), next, { ex: 24 * 60 * 60 }).catch(() => undefined)
}

/**
 * Orders judges: those sitting out last, then by success rate (in steps of
 * ten points, so small differences do not reshuffle), then by speed, then by
 * the given order. Every judge stays in the list as a last resort.
 */
export async function orderJudgesByHealth(models: ModelKey[], now = Date.now()): Promise<ModelKey[]> {
  const health = await Promise.all(models.map(model => kv.get<JudgeHealth>(KEY(model)).catch(() => null)))
  return models
    .map((model, index) => {
      const item = health[index]
      return {
        model,
        index,
        sittingOut: Boolean(item?.skipUntil && item.skipUntil > now),
        // Laplace-smoothed, so one outcome does not decide a new judge's rank.
        rate: Math.round((((item?.ok || 0) + 1) / ((item?.ok || 0) + (item?.failed || 0) + 2)) * 10),
        latencyMs: item?.latencyMs || UNKNOWN_LATENCY_MS,
      }
    })
    .sort((a, b) => (
      Number(a.sittingOut) - Number(b.sittingOut)
      || b.rate - a.rate
      || a.latencyMs - b.latencyMs
      || a.index - b.index
    ))
    .map(item => item.model)
}
