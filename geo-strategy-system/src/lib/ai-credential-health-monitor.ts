import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import {
  buildAiCredentialRouteIdentity,
  ensureAiCredentialRouteHealth,
  getAiCredentialRouteHealthMap,
  listAiCredentialRouteHealth,
  listDueAiCredentialRouteProbes,
  markAiCredentialRouteHalfOpen,
  recordAiCredentialRouteFailure,
} from "@/lib/ai-credential-route-health"
import { classifyAiCredentialFailure } from "@/lib/ai-credential-failure-classifier"
import {
  getAiCredentialRuntime,
  listAiCredentialRuntimes,
} from "@/lib/ai-credential-store"
import { verifyAiCredentialChat } from "@/lib/ai-credential-verification"
import { verifyAiCredentialWeb } from "@/lib/ai-credential-web-verification"
import type {
  AiCredentialCapability,
  AiCredentialRouteHealth,
  AiCredentialRuntime,
} from "@/types/ai-credentials"

const SWEEP_LOCK_KEY = "geo:ai-credential-health-monitor:sweep:v1"
const STRICT_NATIVE_WEB_VENDORS = new Set([
  "doubao",
  "qwen",
  "hunyuan",
  "ernie",
])

type SweepOptions = {
  limit?: number
  credentialId?: string
  force?: boolean
}

export interface AiCredentialHealthSweepResult {
  inspected: number
  recovered: number
  failed: number
  skipped: number
}

let monitorTimer: ReturnType<typeof setInterval> | null = null
let monitorRunning = false

function probeLimit(value: unknown): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : 3
}

function isStrictWebRoute(route: AiCredentialRouteHealth): boolean {
  return route.capabilityProfile === "strict_web"
}

function routeProbeCapabilities(
  route: AiCredentialRouteHealth,
): AiCredentialCapability[] {
  return route.capabilityProfile
    .split("+")
    .map(value => value.trim())
    .filter((value): value is AiCredentialCapability =>
      value === "chat" || value === "json",
    )
}

function routeProbeKey(routeId: string): string {
  return `geo:ai-credential-health-monitor:probe:${routeId}`
}

async function acquireLock(key: string, seconds: number): Promise<string | null> {
  const token = randomUUID()
  const acquired = await kv.set(key, token, { nx: true, ex: seconds })
  return acquired ? token : null
}

async function releaseLock(key: string, token: string | null): Promise<void> {
  if (!token) return
  const current = await kv.get<string>(key)
  if (current === token) await kv.del(key)
}

function credentialSelected(
  credential: AiCredentialRuntime,
  options: SweepOptions,
): boolean {
  if (!credential.enabled || !credential.apiKey) return false
  if (options.credentialId && credential.id !== options.credentialId) return false
  return true
}

async function seedCredentialRoutes(
  credentials: AiCredentialRuntime[],
  options: SweepOptions,
): Promise<AiCredentialRouteHealth[]> {
  const seeded: AiCredentialRouteHealth[] = []
  const now = new Date().toISOString()

  for (const credential of credentials) {
    if (!credentialSelected(credential, options)) continue
    const needsBasicRecovery = credential.healthStatus !== "healthy"
      || credential.consecutiveFailures > 0
      || Boolean(
        credential.cooldownUntil
        && new Date(credential.cooldownUntil).getTime() <= Date.now(),
      )
    const includeBasicSeed = options.force || needsBasicRecovery
    if (includeBasicSeed) {
      const basicModels = credential.allowedModels.slice(0, 1)
      const routeModule = credential.allowedModules[0] || "article"
      for (const model of basicModels) {
        seeded.push(await ensureAiCredentialRouteHealth(
          buildAiCredentialRouteIdentity(credential, {
            module: routeModule,
            model,
            requiredCapabilities: ["chat"],
          }),
          {
            state: "open",
            failureClass: "unknown",
            failureScope: "route",
            lastErrorCode: "LEGACY_HEALTH_RECHECK",
            lastErrorMessage: "账号等待自动恢复检测",
            nextProbeAt: now,
            reopenClosed: needsBasicRecovery,
          },
        ))
      }
    }

    const declaresStrictWeb = credential.declaredCapabilities.includes("native_web")
      && credential.declaredCapabilities.includes("auditable_sources")
      && STRICT_NATIVE_WEB_VENDORS.has(credential.vendor)
    if (
      !declaresStrictWeb
      || (!options.force && !needsBasicRecovery && credential.verifiedWebModels.length > 0)
    ) continue
    const strictModels = credential.verifiedWebModels.length > 0
      ? credential.verifiedWebModels
      : credential.allowedModels.slice(0, 1)
    for (const model of strictModels) {
      seeded.push(await ensureAiCredentialRouteHealth(
        buildAiCredentialRouteIdentity(credential, {
          module: "penetration",
          model,
          requiredCapabilities: ["native_web", "auditable_sources"],
        }),
        {
          state: "open",
          failureClass: "unknown",
          failureScope: "capability",
          lastErrorCode: "STRICT_WEB_RECHECK",
          lastErrorMessage: "严格联网通道等待自动恢复检测",
          nextProbeAt: now,
          reopenClosed: needsBasicRecovery || credential.verifiedWebModels.length === 0,
        },
      ))
    }
  }
  return seeded
}

async function routeWasUpdatedByVerifier(
  route: AiCredentialRouteHealth,
): Promise<boolean> {
  const current = await getAiCredentialRouteHealthMap([route])
  return current.get(route.id)?.state !== "half_open"
}

async function probeRoute(route: AiCredentialRouteHealth): Promise<boolean> {
  const lockKey = routeProbeKey(route.id)
  const token = await acquireLock(lockKey, 4 * 60)
  if (!token) return false
  try {
    const credential = await getAiCredentialRuntime(route.credentialId)
    if (!credential.enabled || !credential.apiKey) return false
    await markAiCredentialRouteHalfOpen(route)
    try {
      if (isStrictWebRoute(route)) {
        await verifyAiCredentialWeb(credential.id, {
          model: route.model,
          module: route.module,
          isProbe: true,
        })
      } else {
        await verifyAiCredentialChat(credential.id, {
          model: route.model,
          module: route.module,
          isProbe: true,
          requiredCapabilities: routeProbeCapabilities(route),
        })
      }
      console.info(
        "[ai-credential-health-monitor] route recovered",
        credential.vendor,
        credential.accountLabel,
        route.model,
        route.capabilityProfile,
      )
      return true
    } catch (error) {
      if (!(await routeWasUpdatedByVerifier(route))) {
        await recordAiCredentialRouteFailure(
          route,
          classifyAiCredentialFailure(error),
          true,
        )
      }
      console.warn(
        "[ai-credential-health-monitor] route probe failed",
        credential.vendor,
        credential.accountLabel,
        route.model,
        route.capabilityProfile,
        error instanceof Error ? error.message : String(error),
      )
      return false
    }
  } catch (error) {
    console.warn(
      "[ai-credential-health-monitor] failed to prepare route probe",
      route.id,
      error instanceof Error ? error.message : String(error),
    )
    return false
  } finally {
    await releaseLock(lockKey, token).catch(() => undefined)
  }
}

export async function runAiCredentialHealthSweep(
  options: SweepOptions = {},
): Promise<AiCredentialHealthSweepResult> {
  const force = options.force === true
  const sweepToken = await acquireLock(
    force && options.credentialId
      ? `${SWEEP_LOCK_KEY}:${options.credentialId}`
      : SWEEP_LOCK_KEY,
    4 * 60,
  )
  if (!sweepToken) {
    return { inspected: 0, recovered: 0, failed: 0, skipped: 1 }
  }

  try {
    const credentials = await listAiCredentialRuntimes()
    const seeded = await seedCredentialRoutes(credentials, options)
    let candidates: AiCredentialRouteHealth[]
    if (force && options.credentialId) {
      const existing = await listAiCredentialRouteHealth([options.credentialId])
      const unique = new Map(
        [...seeded, ...existing].map(route => [route.id, route]),
      )
      candidates = [...unique.values()]
    } else {
      candidates = await listDueAiCredentialRouteProbes(
        probeLimit(options.limit || process.env.AI_CREDENTIAL_HEALTH_PROBE_BATCH),
      )
    }
    if (options.credentialId) {
      candidates = candidates.filter(
        route => route.credentialId === options.credentialId,
      )
    }
    candidates = candidates.slice(0, probeLimit(options.limit || candidates.length || 1))

    let recovered = 0
    let failed = 0
    let skipped = 0
    for (const route of candidates) {
      const succeeded = await probeRoute(route)
      if (succeeded) recovered += 1
      else if (route.state === "half_open") skipped += 1
      else failed += 1
    }
    return {
      inspected: candidates.length,
      recovered,
      failed,
      skipped,
    }
  } finally {
    await releaseLock(
      force && options.credentialId
        ? `${SWEEP_LOCK_KEY}:${options.credentialId}`
        : SWEEP_LOCK_KEY,
      sweepToken,
    ).catch(() => undefined)
  }
}

export function startAiCredentialHealthMonitor(): void {
  if (monitorTimer) return
  if (/^(0|false|off|no)$/i.test(String(process.env.AI_CREDENTIAL_HEALTH_MONITOR_ENABLED || "true"))) {
    return
  }
  const intervalMs = Math.max(
    30_000,
    Math.min(
      30 * 60_000,
      Number(process.env.AI_CREDENTIAL_HEALTH_MONITOR_INTERVAL_MS) || 60_000,
    ),
  )
  const run = () => {
    if (monitorRunning) return
    monitorRunning = true
    void runAiCredentialHealthSweep()
      .catch(error => {
        console.warn(
          "[ai-credential-health-monitor] sweep failed",
          error instanceof Error ? error.message : String(error),
        )
      })
      .finally(() => {
        monitorRunning = false
      })
  }
  const initialTimer = setTimeout(run, 10_000)
  initialTimer.unref()
  monitorTimer = setInterval(run, intervalMs)
  monitorTimer.unref()
}

export function stopAiCredentialHealthMonitor(): void {
  if (monitorTimer) clearInterval(monitorTimer)
  monitorTimer = null
  monitorRunning = false
}
