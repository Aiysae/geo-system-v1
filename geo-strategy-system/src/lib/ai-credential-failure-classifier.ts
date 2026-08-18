import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
import type {
  AiCredentialFailureClass,
  AiCredentialFailureDiagnosis,
  AiCredentialFailureScope,
} from "@/types/ai-credentials"

const MINUTE = 60_000
const HOUR = 60 * MINUTE

function normalizedError(error: unknown): { message: string; name: string } {
  const message = error instanceof Error ? error.message : String(error || "")
  return {
    message: sanitizeAiUpstreamMessage(message, 360),
    name: error instanceof Error ? error.name : "",
  }
}

function diagnosis(input: {
  failureClass: AiCredentialFailureClass
  scope: AiCredentialFailureScope
  code: string
  message: string
  countsTowardCircuit?: boolean
  actionRequired?: boolean
  retryable?: boolean
  cooldownMs?: number
}): AiCredentialFailureDiagnosis {
  return {
    failureClass: input.failureClass,
    scope: input.scope,
    code: input.code,
    message: input.message,
    countsTowardCircuit: input.countsTowardCircuit ?? true,
    actionRequired: input.actionRequired ?? false,
    retryable: input.retryable ?? true,
    cooldownMs: input.cooldownMs ?? 2 * MINUTE,
  }
}

export function classifyAiCredentialFailure(
  error: unknown,
): AiCredentialFailureDiagnosis {
  const normalized = normalizedError(error)
  const message = normalized.message || "未知模型调用错误"

  if (
    normalized.name === "AbortError"
    || /(?:用户|任务|请求|检测).{0,8}(?:停止|取消)|AI 请求已停止|等待账号.*已停止/i.test(message)
  ) {
    return diagnosis({
      failureClass: "cancelled",
      scope: "ignored",
      code: "REQUEST_CANCELLED",
      message,
      countsTowardCircuit: false,
      retryable: false,
      cooldownMs: 0,
    })
  }

  if (
    /(?:本地|独立)?账号.{0,12}(?:并发已满|任务较多|排队等待超时)|暂无空闲通道|AI 账号排队/i.test(message)
  ) {
    return diagnosis({
      failureClass: "local_capacity",
      scope: "ignored",
      code: "LOCAL_CAPACITY_FULL",
      message,
      countsTowardCircuit: false,
      cooldownMs: 0,
    })
  }

  if (
    /字数太少|问题太短|输入不能为空|参数无效|invalid parameter|thinking mode.{0,40}tool_choice|does not support.{0,30}tool_choice|content.?filter|safety|内容安全|敏感词|中立横向对比至少需要/i.test(message)
  ) {
    return diagnosis({
      failureClass: "request_rejected",
      scope: "ignored",
      code: "REQUEST_REJECTED",
      message,
      countsTowardCircuit: false,
      retryable: false,
      cooldownMs: 0,
    })
  }

  if (/HTTP\s*402|payment required|insufficient.{0,24}(?:balance|credit)|余额不足|欠费/i.test(message)) {
    return diagnosis({
      failureClass: "billing",
      scope: "credential",
      code: "BILLING_REQUIRED",
      message,
      actionRequired: true,
      retryable: false,
      cooldownMs: HOUR,
    })
  }

  if (/HTTP\s*401|invalid.{0,12}(?:api.)?key|unauthorized|鉴权失败|认证失败|key.{0,8}(?:失效|无效)/i.test(message)) {
    return diagnosis({
      failureClass: "authentication",
      scope: "credential",
      code: "AUTHENTICATION_FAILED",
      message,
      actionRequired: true,
      retryable: false,
      cooldownMs: 6 * HOUR,
    })
  }

  if (
    /ToolNotOpen|web search is not activated|联网搜索(?:服务|插件|资源包)?.{0,12}(?:未开通|未启用|无权限)|未开通.{0,12}联网搜索|HTTP\s*403|forbidden|permission denied|无权限/i.test(message)
  ) {
    return diagnosis({
      failureClass: "permission",
      scope: "capability",
      code: "CAPABILITY_PERMISSION_REQUIRED",
      message,
      actionRequired: true,
      retryable: false,
      cooldownMs: 6 * HOUR,
    })
  }

  if (/model.{0,24}(?:not found|unavailable|does not exist)|模型.{0,12}(?:不存在|已下线|不可用)|unknown model/i.test(message)) {
    return diagnosis({
      failureClass: "model_unavailable",
      scope: "model",
      code: "MODEL_UNAVAILABLE",
      message,
      actionRequired: true,
      retryable: false,
      cooldownMs: 12 * HOUR,
    })
  }

  if (/HTTP\s*429|too many requests|rate.?limit|限流|请求频率|QPS/i.test(message)) {
    return diagnosis({
      failureClass: "rate_limited",
      scope: "route",
      code: "UPSTREAM_RATE_LIMITED",
      message,
      cooldownMs: 2 * MINUTE,
    })
  }

  if (
    /search_results=0|(?:未返回|没有返回|未取得|没有取得).{0,30}(?:可审计|有效信源|信源网址|网页来源)|未执行.{0,12}(?:联网|web_search)|厂商未确认执行官方联网|联网返回空内容/i.test(message)
  ) {
    return diagnosis({
      failureClass: "web_evidence",
      scope: "capability",
      code: "WEB_EVIDENCE_MISSING",
      message,
      cooldownMs: 10 * MINUTE,
    })
  }

  if (
    /HTTP\s*(?:408|425|500|502|503|504)|timeout|timed out|超时|连接失败|fetch failed|network|socket|temporar|ECONNRESET|EAI_AGAIN|返回空内容|空响应/i.test(message)
  ) {
    return diagnosis({
      failureClass: "transient_upstream",
      scope: "route",
      code: "UPSTREAM_TEMPORARY_FAILURE",
      message,
      cooldownMs: 2 * MINUTE,
    })
  }

  return diagnosis({
    failureClass: "unknown",
    scope: "route",
    code: "UPSTREAM_UNKNOWN_FAILURE",
    message,
    cooldownMs: 5 * MINUTE,
  })
}

export function circuitCooldownMs(
  failureClass: AiCredentialFailureClass,
  consecutiveFailures: number,
  suggestedMs = 0,
): number {
  if (suggestedMs > 0 && [
    "authentication",
    "billing",
    "permission",
    "model_unavailable",
  ].includes(failureClass)) return suggestedMs

  const failures = Math.max(1, consecutiveFailures)
  const base = failureClass === "web_evidence"
    ? 10 * MINUTE
    : failureClass === "rate_limited"
      ? 2 * MINUTE
      : Math.max(2 * MINUTE, suggestedMs)
  return Math.min(HOUR, base * 2 ** Math.min(5, Math.max(0, failures - 3)))
}
