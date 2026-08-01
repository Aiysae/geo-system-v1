import "server-only"

import { isAdminUser } from "@/lib/admin"
import { getUserById } from "@/lib/auth"
import { getMembershipWithPaymentRepair, hasMembershipTier } from "@/lib/membership"

export type AgentAccessEligibility = {
  eligible: boolean
  reason?: string
  mode: "admin" | "vip4" | "all"
}

function configuredMode(): AgentAccessEligibility["mode"] {
  const configured = String(process.env.AGENT_ACCESS_MIN_TIER || "").trim().toLowerCase()
  if (configured === "all" || configured === "vip4" || configured === "admin") return configured
  return process.env.NODE_ENV === "production" ? "admin" : "all"
}

export async function getAgentAccessEligibility(
  userId: string,
): Promise<AgentAccessEligibility> {
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
