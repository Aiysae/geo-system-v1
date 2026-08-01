import { isIP } from "node:net"
import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { AgentApiError, agentTokenManagementEnabled, readAgentJson } from "@/lib/agent/api"
import { getAgentAccessEligibility } from "@/lib/agent/eligibility"
import { listAgentClientCatalog } from "@/lib/agent/client-catalog"
import { AGENT_SCOPE_PRESETS, ALL_AGENT_SCOPES, normalizeAgentScopes } from "@/lib/agent/scopes"
import { appendAgentAudit, createAgentToken, listAgentAudits, listAgentTokens } from "@/lib/agent/store"
import { requireUserId } from "@/lib/with-credits"
import type { AgentClientGrant, AgentClientMode } from "@/types/agent"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function grants(value: unknown): AgentClientGrant[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const input = record(item)
    const clientId = String(input.clientId || "").trim()
    const teamId = String(input.teamId || "").trim() || undefined
    return clientId ? [{ clientId, teamId }] : []
  })
}

function allowedIps(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ips = Array.from(new Set(value.map(item => String(item || "").trim()).filter(Boolean)))
  if (ips.some(ip => isIP(ip) === 0)) throw new Error("IP 白名单只支持完整的 IPv4 或 IPv6 地址")
  return ips
}

async function access(userId: string, requireCreate = false) {
  if (!agentTokenManagementEnabled()) {
    throw new AgentApiError({ code: "AGENT_MANAGEMENT_DISABLED", message: "Agent 密钥管理当前未开放", status: 503 })
  }
  const eligibility = await getAgentAccessEligibility(userId)
  if (!eligibility.eligible) {
    throw new AgentApiError({ code: "AGENT_ACCESS_DENIED", message: eligibility.reason || "当前账号不能创建 Agent 密钥", status: 403 })
  }
  if (requireCreate && !eligibility.canCreateTokens) {
    throw new AgentApiError({ code: "AGENT_SELF_SERVICE_DISABLED", message: eligibility.reason || "Agent 自助接入当前未开放", status: 403 })
  }
  return eligibility
}

export async function GET() {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const resolvedEligibility = await getAgentAccessEligibility(auth.userId)
    const managementEnabled = agentTokenManagementEnabled()
    const eligibility = managementEnabled
      ? resolvedEligibility
      : { ...resolvedEligibility, canCreateTokens: false, reason: "Agent 密钥管理当前未开放" }
    if (!managementEnabled || !eligibility.eligible) {
      return NextResponse.json({
        eligibility,
        tokens: [],
        audits: [],
        clients: [],
        scopes: ALL_AGENT_SCOPES,
        presets: Object.fromEntries(
          eligibility.allowedPresets.map(preset => [preset, AGENT_SCOPE_PRESETS[preset]]),
        ),
      }, { headers: NO_STORE })
    }
    const [tokens, audits, clients] = await Promise.all([
      listAgentTokens(auth.userId),
      listAgentAudits(auth.userId, 100),
      listAgentClientCatalog(auth.userId),
    ])
    return NextResponse.json({
      eligibility,
      tokens,
      audits,
      clients: clients.map(client => ({
        clientId: client.id,
        clientName: client.name,
        ourBrand: client.ourBrand,
        teamId: client.teamId,
        teamName: client.teamName,
        sourceType: client.sourceType,
      })),
      scopes: ALL_AGENT_SCOPES,
      presets: Object.fromEntries(
        eligibility.allowedPresets.map(preset => [preset, AGENT_SCOPE_PRESETS[preset]]),
      ),
    }, { headers: NO_STORE })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Agent 密钥读取失败" },
      { status: 403, headers: NO_STORE },
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const eligibility = await access(auth.userId, true)
    const body = record(await readAgentJson(request, 64 * 1024))
    const existingTokens = await listAgentTokens(auth.userId)
    if (existingTokens.filter(token => token.status === "active").length >= eligibility.maxActiveTokens) {
      return NextResponse.json(
        { error: `当前账号最多保留 ${eligibility.maxActiveTokens} 枚有效 Agent 密钥，请先撤销不再使用的密钥` },
        { status: 409, headers: NO_STORE },
      )
    }
    const clientMode: AgentClientMode = body.clientMode === "all" ? "all" : "selected"
    const clientGrants = grants(body.clientGrants)
    const catalog = await listAgentClientCatalog(auth.userId)
    const allowed = new Set(catalog.map(client => `${client.teamId || "personal"}:${client.id}`))
    if (clientMode === "selected" && clientGrants.some(grant => (
      !allowed.has(`${grant.teamId || "personal"}:${grant.clientId}`)
    ))) {
      return NextResponse.json({ error: "客户授权中包含当前账号无权访问的客户" }, { status: 403, headers: NO_STORE })
    }
    const requestedScopes = normalizeAgentScopes(body.scopes)
    const allowedScopes = new Set(eligibility.allowedPresets.flatMap(preset => AGENT_SCOPE_PRESETS[preset]))
    if (requestedScopes.length === 0 || requestedScopes.some(scope => !allowedScopes.has(scope))) {
      return NextResponse.json({ error: "Agent 权限超出当前账号可授权范围" }, { status: 403, headers: NO_STORE })
    }
    const rateLimitPerMinute = Math.floor(Number(body.rateLimitPerMinute))
    if (!Number.isFinite(rateLimitPerMinute) || rateLimitPerMinute < 1 || rateLimitPerMinute > eligibility.maxRateLimitPerMinute) {
      return NextResponse.json(
        { error: `当前账号每枚密钥最多支持 ${eligibility.maxRateLimitPerMinute} 次/分钟` },
        { status: 400, headers: NO_STORE },
      )
    }
    const secret = await createAgentToken({
      ownerUserId: auth.userId,
      name: String(body.name || "").trim(),
      scopes: requestedScopes,
      clientMode,
      clientGrants,
      rateLimitPerMinute,
      dailyCreditLimit: Number(body.dailyCreditLimit),
      maxTaskCredits: Number(body.maxTaskCredits),
      allowedIps: allowedIps(body.allowedIps),
      expiresAt: String(body.expiresAt || "").trim() || undefined,
    })
    await appendAgentAudit({
      tokenId: secret.record.id,
      ownerUserId: auth.userId,
      action: "agent.token.create",
      method: "POST",
      path: "/api/account/agents",
      traceId: `trace_${randomUUID().replace(/-/g, "")}`,
      status: "succeeded",
      httpStatus: 201,
      estimatedCredits: 0,
      metadata: {
        name: secret.record.name,
        scopes: secret.record.scopes,
        clientMode: secret.record.clientMode,
        clientGrantCount: secret.record.clientGrants.length,
        dailyCreditLimit: secret.record.dailyCreditLimit,
        maxTaskCredits: secret.record.maxTaskCredits,
        tier: eligibility.tier,
        accountMode: eligibility.accountMode,
      },
    }).catch(error => {
      console.error("[agent-audit] token creation audit failed", error instanceof Error ? error.message : error)
    })
    return NextResponse.json(secret, { status: 201, headers: NO_STORE })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Agent 密钥创建失败" },
      { status: error instanceof AgentApiError ? error.status : 400, headers: NO_STORE },
    )
  }
}
