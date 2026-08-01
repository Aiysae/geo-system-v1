import "server-only"

import { isAdminUser } from "@/lib/admin"
import { getClientAccountLink } from "@/lib/client-accounts"
import { getUserById } from "@/lib/auth"
import {
  getMembershipWithPaymentRepair,
  hasMembershipTier,
  membershipTierRank,
} from "@/lib/membership"
import type { AgentAccessEligibility, AgentAccessMode, AgentScopePreset } from "@/types/agent"

type AgentQuota = {
  maxActiveTokens: number
  maxRateLimitPerMinute: number
}

const QUOTAS: Record<Exclude<AgentAccessEligibility["tier"], "admin">, AgentQuota> = {
  free: { maxActiveTokens: 1, maxRateLimitPerMinute: 60 },
  vip1: { maxActiveTokens: 1, maxRateLimitPerMinute: 60 },
  vip2: { maxActiveTokens: 2, maxRateLimitPerMinute: 90 },
  vip3: { maxActiveTokens: 5, maxRateLimitPerMinute: 120 },
  vip4: { maxActiveTokens: 10, maxRateLimitPerMinute: 240 },
  vip5: { maxActiveTokens: 20, maxRateLimitPerMinute: 360 },
  vip6: { maxActiveTokens: 50, maxRateLimitPerMinute: 600 },
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined || value === "") return fallback
  return /^(1|true|yes|on)$/i.test(value)
}

export function agentGuideEnabled(): boolean {
  return envFlag("AGENT_GUIDE_ENABLED", true)
}

export function agentSelfServiceEnabled(): boolean {
  return envFlag("AGENT_SELF_SERVICE_ENABLED", process.env.NODE_ENV !== "production")
}

function configuredMode(): AgentAccessMode {
  const configured = String(process.env.AGENT_ACCESS_MIN_TIER || "").trim().toLowerCase()
  if (configured === "all" || configured === "vip4" || configured === "admin") return configured
  return process.env.NODE_ENV === "production" ? "admin" : "all"
}

export async function getAgentExecutionEligibility(userId: string): Promise<{
  eligible: boolean
  reason?: string
  mode: AgentAccessMode
}> {
  const mode = configuredMode()
  const user = await getUserById(userId)
  if (!user || user.status !== "active") {
    return { eligible: false, reason: "账号不存在或已停用", mode }
  }
  if (isAdminUser(user) || mode === "all") return { eligible: true, mode }
  if (mode === "admin") {
    return { eligible: false, reason: "Agent 能力目前处于管理员灰度阶段", mode }
  }
  const membership = await getMembershipWithPaymentRepair(userId)
  return hasMembershipTier(membership, "vip4")
    ? { eligible: true, mode }
    : { eligible: false, reason: "VIP4 及以上可以创建和使用 Agent", mode }
}

export async function getAgentAccessEligibility(
  userId: string,
): Promise<AgentAccessEligibility> {
  const mode = configuredMode()
  const guideEnabled = agentGuideEnabled()
  const [user, membership, clientLink] = await Promise.all([
    getUserById(userId),
    getMembershipWithPaymentRepair(userId),
    getClientAccountLink(userId),
  ])
  const accountMode: AgentAccessEligibility["accountMode"] = clientLink ? "client" : "standard"
  const admin = isAdminUser(user)
  const tier: AgentAccessEligibility["tier"] = admin ? "admin" : membership.tier
  const quota = admin
    ? { maxActiveTokens: 50, maxRateLimitPerMinute: 600 }
    : QUOTAS[membership.tier]
  const allowedPresets: AgentScopePreset[] = ["observer", "operator"]
  if (admin || (accountMode === "standard" && membershipTierRank(membership.tier) >= membershipTierRank("vip4"))) {
    allowedPresets.push("full")
  }
  const base = {
    guideEnabled,
    mode,
    tier,
    accountMode,
    maxActiveTokens: accountMode === "client" ? 1 : quota.maxActiveTokens,
    maxRateLimitPerMinute: accountMode === "client" ? Math.min(60, quota.maxRateLimitPerMinute) : quota.maxRateLimitPerMinute,
    allowedPresets,
  }
  if (!user || user.status !== "active") {
    return { ...base, eligible: false, canCreateTokens: false, reason: "账号不存在或已停用" }
  }
  const eligible = admin
    || mode === "all"
    || (mode === "vip4" && hasMembershipTier(membership, "vip4"))
  const reason = eligible
    ? undefined
    : mode === "admin"
      ? "Agent 能力目前处于管理员灰度阶段"
      : "VIP4 及以上可以创建和使用 Agent"
  return {
    ...base,
    eligible,
    canCreateTokens: eligible && (admin || agentSelfServiceEnabled()),
    reason,
  }
}
