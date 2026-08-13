import { NextRequest, NextResponse } from "next/server"
import { listSystemClientExecutionActions } from "@/lib/client-feedback/builder"
import {
  clientFeedbackReportSharePath,
  executionCounters,
  feedbackPeriodForDate,
  getClientExecutionProfile,
  listClientExecutionActions,
  listClientFeedbackReports,
  saveClientExecutionProfile,
} from "@/lib/client-feedback/store"
import { requireOperationAccess } from "@/lib/team-access"
import { hasTeamPermission } from "@/lib/team-permissions"
import {
  applyActionPublication,
  getClientExecutionPublicationPolicy,
  publicationForClientViewer,
  sanitizeFeedbackReportForClient,
} from "@/lib/client-feedback/publication"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type { ClientExecutionProfile } from "@/types/client-feedback"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "feedback",
      action: "view",
      teamId,
    })
    const client = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(record => record.client.id === access.clientId)?.client
    if (!client) throw new Error("客户面板不存在或无权访问")

    const [profile, manualActions, systemActions, reports, publicationPolicy] = await Promise.all([
      getClientExecutionProfile(access.dataOwnerUserId, access.clientId),
      listClientExecutionActions(access.dataOwnerUserId, access.clientId),
      listSystemClientExecutionActions(access.dataOwnerUserId, access.clientId),
      listClientFeedbackReports(access.dataOwnerUserId, access.clientId),
      getClientExecutionPublicationPolicy(access.dataOwnerUserId, access.clientId),
    ])
    const actions = [
      ...manualActions.map(action => applyActionPublication(action, publicationPolicy)),
      ...systemActions,
    ]
      .map(action => {
        if (access.mode !== "client") return action
        let publication = publicationForClientViewer(
          action,
          auth.userId,
          publicationPolicy,
        )
        if (
          publication === "full"
          && action.resultRef?.module === "penetration"
          && !hasTeamPermission(access.permissionKeys, "penetration", "view")
        ) {
          publication = "summary"
        }
        return {
            ...action,
            publication,
            visibility: publication === "internal"
              ? "internal" as const
              : "client" as const,
          }
      })
      .filter(action => access.mode !== "client" || action.publication !== "internal")
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    const canManage = hasTeamPermission(access.permissionKeys, "feedback", "edit")
    const canManageVisibility = hasTeamPermission(
      access.permissionKeys,
      "feedback",
      "manage",
    )
    return noStore(NextResponse.json({
      accessMode: access.mode === "client" ? "client" : "standard",
      workspaceMode: access.mode,
      canManage,
      canManageVisibility,
      publicationPolicy: canManageVisibility ? publicationPolicy : undefined,
      profile,
      counters: executionCounters(profile),
      currentWeek: feedbackPeriodForDate(profile, "weekly"),
      currentMonth: feedbackPeriodForDate(profile, "monthly"),
      actions,
      reports: reports
        .filter(report => access.mode !== "client" || report.status === "published")
        .map(report => access.mode === "client"
          ? sanitizeFeedbackReportForClient(report, publicationPolicy, {
              allowPenetrationResults: hasTeamPermission(
                access.permissionKeys,
                "penetration",
                "view",
              ),
            })
          : {
              ...report,
              sharePath: clientFeedbackReportSharePath(report),
            }),
    }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "客户执行反馈读取失败",
    }, { status: 403 }))
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const body = await request.json() as {
      teamId?: unknown
      patch?: Partial<ClientExecutionProfile>
    }
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
      module: "feedback",
      action: "edit",
    })
    const profile = await saveClientExecutionProfile({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      updatedByUserId: auth.userId,
      patch: body.patch || {},
    })
    return noStore(NextResponse.json({ profile, counters: executionCounters(profile) }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "客户执行设置保存失败",
    }, { status: 403 }))
  }
}
