import { isAuditableSourceUrl } from "@/lib/llm/source-extract"
import { isRetryableAiCredentialAuditFailure } from "@/lib/ai-credential-errors"
import type { PenetrationItem } from "@/types"

export const PENETRATION_SLOT_RETRY_DELAYS_MS = [
  3_000,
  10_000,
  30_000,
  90_000,
  180_000,
  300_000,
] as const

export const PENETRATION_SLOT_MAX_ATTEMPTS = PENETRATION_SLOT_RETRY_DELAYS_MS.length + 1

export const PENETRATION_AUDIT_RETRY_DELAYS_MS = [
  5_000,
  30_000,
] as const

function auditableSources(item: PenetrationItem) {
  return (item.searchSources || []).filter(source =>
    isAuditableSourceUrl(source.url, source.title, source.snippet),
  )
}

const AUDITABLE_SEARCH_MODES = new Set([
  "native_web",
  "provider_hosted_web",
  "external_tool_web",
])

export function getPenetrationSlotValidationError(item: PenetrationItem | undefined): string | null {
  if (!item?.answer.trim()) return "模型没有返回完整原始回答"
  if (!item.searchMode || !AUDITABLE_SEARCH_MODES.has(item.searchMode)) {
    return "本次回答不是可审计的联网搜索结果"
  }
  if (item.promptPurity !== "raw_question_only") return "本次请求没有保持仅发送原始问题"
  if (item.requestAuditVerified !== true) return "没有取得真实出站请求的纯净度证明"
  if (item.webExecutionVerified !== true) return "没有确认厂商联网搜索实际执行"
  if (auditableSources(item).length === 0) return "没有返回可点击、可读取的有效信源网址"
  if (!(item.providerRequestIds || []).some(value => value.trim())) return "厂商没有返回可审计请求编号"
  return null
}

export function isCompletePenetrationItem(item: PenetrationItem | undefined): item is PenetrationItem {
  return getPenetrationSlotValidationError(item) === null
}

function deterministicRetryJitter(delayMs: number, seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const ratio = 0.1 + ((hash >>> 0) % 2001) / 10_000
  return Math.floor(delayMs * ratio)
}

export function nextPenetrationCapacityRetryAt(
  deferrals: number,
  fromMs = Date.now(),
  jitterSeed?: string,
): string {
  const delays = [2_000, 4_000, 8_000, 15_000, 30_000] as const
  const delay = delays[Math.min(delays.length - 1, Math.max(0, deferrals - 1))]
  const jitter = jitterSeed ? deterministicRetryJitter(delay, jitterSeed) : 0
  return new Date(fromMs + delay + jitter).toISOString()
}

export function nextPenetrationRetryAt(
  attempts: number,
  fromMs = Date.now(),
  jitterSeed?: string,
): string | null {
  const delay = PENETRATION_SLOT_RETRY_DELAYS_MS[attempts - 1]
  if (delay === undefined) return null
  const jitter = jitterSeed ? deterministicRetryJitter(delay, jitterSeed) : 0
  return new Date(fromMs + delay + jitter).toISOString()
}

export function nextPenetrationRetryAtForError(
  message: string,
  attempts: number,
  fromMs = Date.now(),
  jitterSeed?: string,
): string | null {
  if (!isRetryableAiCredentialAuditFailure(message)) {
    return nextPenetrationRetryAt(attempts, fromMs, jitterSeed)
  }
  const delay = PENETRATION_AUDIT_RETRY_DELAYS_MS[attempts - 1]
  if (delay === undefined) return null
  const jitter = jitterSeed ? deterministicRetryJitter(delay, jitterSeed) : 0
  return new Date(fromMs + delay + jitter).toISOString()
}
