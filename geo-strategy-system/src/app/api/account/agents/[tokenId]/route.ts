import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { agentTokenManagementEnabled } from "@/lib/agent/api"
import { getAgentAccessEligibility } from "@/lib/agent/eligibility"
import { appendAgentAudit, revokeAgentToken } from "@/lib/agent/store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" }

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    if (!agentTokenManagementEnabled()) throw new Error("Agent 密钥管理当前未开放")
    const eligibility = await getAgentAccessEligibility(auth.userId)
    if (!eligibility.eligible) throw new Error(eligibility.reason || "当前账号不能管理 Agent 密钥")
    const { tokenId } = await context.params
    const token = await revokeAgentToken({ ownerUserId: auth.userId, tokenId })
    if (!token) return NextResponse.json({ error: "Agent 密钥不存在" }, { status: 404, headers: NO_STORE })
    await appendAgentAudit({
      tokenId: token.id,
      ownerUserId: auth.userId,
      action: "agent.token.revoke",
      method: "DELETE",
      path: `/api/account/agents/${encodeURIComponent(token.id)}`,
      traceId: `trace_${randomUUID().replace(/-/g, "")}`,
      status: "succeeded",
      httpStatus: 200,
      estimatedCredits: 0,
      metadata: { name: token.name, tokenPrefix: token.tokenPrefix },
    }).catch(error => {
      console.error("[agent-audit] token revoke audit failed", error instanceof Error ? error.message : error)
    })
    return NextResponse.json({ token }, { headers: NO_STORE })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Agent 密钥撤销失败" },
      { status: 403, headers: NO_STORE },
    )
  }
}
