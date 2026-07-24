import { NextRequest, NextResponse } from "next/server"
import {
  getTeamEntitlement,
  resolveOperationAccess,
} from "@/lib/team-access"
import { hasTeamPermission } from "@/lib/team-permissions"
import { getTeamMember } from "@/lib/team-store"
import { requireUserId } from "@/lib/with-credits"
import type { WorkspaceAccountAccess } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim()
  const clientId = String(request.nextUrl.searchParams.get("clientId") || "").trim()
  if (!teamId || !clientId) {
    return noStore(NextResponse.json({ error: "团队和客户参数不完整" }, { status: 400 }))
  }
  try {
    const result = await resolveOperationAccess({
      userId: auth.userId,
      teamId,
      clientId,
      module: "client",
      action: "view",
    })
    if (!result.ok || result.access.mode !== "team" || !result.access.teamId) {
      return noStore(NextResponse.json({
        error: result.ok ? "当前客户不属于团队空间" : result.message,
      }, { status: 403 }))
    }
    const [membership, entitlement] = await Promise.all([
      getTeamMember(result.access.teamId, auth.userId),
      getTeamEntitlement(result.access.billingUserId),
    ])
    if (!membership || membership.status !== "active") {
      return noStore(NextResponse.json({ error: "团队成员权限已失效" }, { status: 403 }))
    }
    const permissions = result.access.permissionKeys
    const canExecute = (module: "research" | "diagnosis" | "difficulty" | "keyword" | "article") => (
      hasTeamPermission(permissions, module, "execute")
    )
    const access: WorkspaceAccountAccess = {
      mode: "team",
      status: "active",
      clientId,
      teamId: result.access.teamId,
      teamName: result.access.teamName,
      teamRole: membership.role,
      teamReadOnly: !entitlement.eligible,
      dataOwnerUserId: result.access.dataOwnerUserId,
      billingUserId: result.access.billingUserId,
      permissionKeys: permissions,
      canCreateClients: false,
      canManageClientIdentity: entitlement.eligible && (
        hasTeamPermission(permissions, "client", "edit")
        || hasTeamPermission(permissions, "client", "manage")
      ),
      canRunPenetration: entitlement.eligible
        && hasTeamPermission(permissions, "penetration", "execute"),
      canRunOtherModules: entitlement.eligible && (
        canExecute("research")
        || canExecute("diagnosis")
        || canExecute("difficulty")
        || canExecute("keyword")
        || canExecute("article")
      ),
      canCreateReports: entitlement.eligible
        && hasTeamPermission(permissions, "report", "execute"),
      canViewFeedbackReports: hasTeamPermission(permissions, "feedback", "view"),
      canManageFeedbackReports: entitlement.eligible && (
        hasTeamPermission(permissions, "feedback", "edit")
        || hasTeamPermission(permissions, "feedback", "manage")
      ),
    }
    return noStore(NextResponse.json({ access }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "团队工作区权限读取失败",
    }, { status: 403 }))
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}
