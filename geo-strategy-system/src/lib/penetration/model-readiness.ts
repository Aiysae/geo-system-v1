import { hasAdapterCredentialPoolCandidate } from "@/lib/ai-credential-adapter"
import { listAiCredentialRouteHealth } from "@/lib/ai-credential-route-health"
import { listAiCredentialsPublic } from "@/lib/ai-credential-store"
import { MODEL_LABELS } from "@/lib/model-labels"
import type { ModelKey } from "@/types"
import type {
  AiCredentialFailureClass,
  AiCredentialPublic,
  AiCredentialRouteHealth,
} from "@/types/ai-credentials"

export interface PenetrationModelReadiness {
  model: ModelKey
  ready: boolean
  reason?: string
}

// Vendors whose question detection runs on their own official web search and
// therefore needs an account verified for it.
const NATIVE_WEB_VENDORS = new Set<ModelKey>(["doubao", "qwen", "ernie", "hunyuan"])

const ACTION_REASONS: Partial<Record<AiCredentialFailureClass, string>> = {
  billing: "账号欠费或免费额度已用完（如未开通后付费），请在厂商控制台充值或开通后，到后台模型账号点击复检",
  authentication: "API Key 无效或已失效，请在后台模型账号中更换",
  permission: "账号未开通联网搜索服务，或接口地址、型号不支持官方联网，请按提示调整后台配置",
  model_unavailable: "所选型号未开通或已下线，请在后台模型账号中调整允许的型号",
}

function upstreamDetail(route: AiCredentialRouteHealth): string {
  const detail = String(route.lastErrorMessage || "").replace(/\s+/g, " ").trim()
  return detail ? `（${detail.slice(0, 80)}）` : ""
}

function strictRoutes(routes: AiCredentialRouteHealth[]): AiCredentialRouteHealth[] {
  return routes.filter(route => route.module === "penetration" && route.capabilityProfile === "strict_web")
}

/**
 * Explains why a model cannot run question detection, in the order an admin
 * would fix it: no account, account not set up for web search, a failure that
 * needs action, a route still recovering, or a check that has not run yet.
 */
function diagnose(
  model: ModelKey,
  credentials: AiCredentialPublic[],
  routes: AiCredentialRouteHealth[],
): string {
  const label = MODEL_LABELS[model]
  const usable = credentials.filter(credential => (
    credential.allowedModules.length === 0 || credential.allowedModules.includes("penetration")
  ))
  if (usable.length === 0) {
    return credentials.length === 0
      ? `后台没有已启用的${label}账号`
      : `${label}账号未开放给疑问句检测使用，请在后台模型账号的可用模块中勾选疑问句检测`
  }
  if (!NATIVE_WEB_VENDORS.has(model)) {
    return `${label}暂无已启用且通过严格联网验证的账号`
  }
  const declared = usable.filter(credential => (
    credential.declaredCapabilities.includes("native_web")
    && credential.declaredCapabilities.includes("auditable_sources")
  ))
  if (declared.length === 0) {
    return `${label}账号未声明“官方联网”和“可审计信源”能力，请在后台模型账号中勾选后保存，系统会自动检测`
  }

  const relevant = strictRoutes(routes)
  const actionRequired = relevant.find(route => route.state === "action_required")
  if (actionRequired) {
    const reason = ACTION_REASONS[actionRequired.failureClass] || "账号需要管理员处理"
    return `${label}：${reason}${upstreamDetail(actionRequired)}`
  }
  if (relevant.some(route => route.state === "half_open")) {
    return `${label}服务通道正在自动复检，请稍后重试`
  }
  const recovering = relevant.find(route => route.state === "open" || route.state === "degraded")
  if (recovering) {
    return `${label}服务通道正在冷却恢复，系统会自动复检${upstreamDetail(recovering)}`
  }
  if (declared.some(credential => credential.healthStatus === "unhealthy" && credential.cooldownUntil
    && Date.parse(credential.cooldownUntil) > Date.now())) {
    return `${label}账号处于冷却期，冷却结束后系统会自动复检`
  }
  return `${label}账号的官方联网能力尚未通过检测，系统会在几分钟内自动检测；也可以在后台模型账号中手动点击严格联网检测`
}

export async function getPenetrationModelReadiness(
  model: ModelKey,
): Promise<PenetrationModelReadiness> {
  try {
    const poolReady = await hasAdapterCredentialPoolCandidate(model, "penetration", {
      system: "",
      user: "",
      mode: "consumer",
      forceWebSearch: true,
      rawQuestionOnly: true,
      requireWebEvidence: true,
      officialWebOnly: true,
    })
    if (poolReady) return { model, ready: true }
  } catch (error) {
    console.warn(
      "[penetration-readiness] failed to inspect verified credential pool",
      model,
      error instanceof Error ? error.message : String(error),
    )
  }

  try {
    // DeepSeek borrows a Baidu or Kimi search account; Kimi searches with its own.
    const dependencyVendors = model === "deepseek"
      ? new Set<string>([model, "ernie", "kimi"])
      : new Set<string>([model])
    const credentials = (await listAiCredentialsPublic()).filter(
      credential => credential.enabled && dependencyVendors.has(credential.vendor),
    )
    const routes = await listAiCredentialRouteHealth(credentials.map(credential => credential.id))
    if (model === "kimi" || model === "deepseek") {
      const own = credentials.filter(credential => credential.vendor === model)
      if (own.length === 0) return { model, ready: false, reason: `后台没有已启用的${MODEL_LABELS[model]}账号` }
      if (model === "deepseek" && !credentials.some(credential => credential.vendor !== "deepseek")) {
        return { model, ready: false, reason: "DeepSeek 官方接口不带联网搜索，需要后台启用百度千帆搜索或 Kimi 账号作为检索来源" }
      }
      const strict = routes.filter(route => route.module === "penetration")
      const actionRequired = strict.find(route => route.state === "action_required")
      if (actionRequired) {
        const reason = ACTION_REASONS[actionRequired.failureClass] || "账号需要管理员处理权限或额度"
        return { model, ready: false, reason: `${MODEL_LABELS[model]}：${reason}${upstreamDetail(actionRequired)}` }
      }
      const recovering = strict.find(route => route.state === "open" || route.state === "degraded" || route.state === "half_open")
      if (recovering) {
        return { model, ready: false, reason: `${MODEL_LABELS[model]}服务通道正在冷却恢复，系统会自动复检${upstreamDetail(recovering)}` }
      }
      return { model, ready: false, reason: `${MODEL_LABELS[model]}暂无已启用且通过严格联网验证的账号` }
    }
    return { model, ready: false, reason: diagnose(model, credentials, routes) }
  } catch (error) {
    console.warn(
      "[penetration-readiness] failed to inspect route recovery state",
      model,
      error instanceof Error ? error.message : String(error),
    )
  }

  return {
    model,
    ready: false,
    reason: `${MODEL_LABELS[model]}暂无已启用且通过严格联网验证的账号`,
  }
}
