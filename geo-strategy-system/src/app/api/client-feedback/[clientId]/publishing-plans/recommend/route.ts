import { NextRequest, NextResponse } from "next/server"
import { recommendPublishingPlanPlatforms } from "@/lib/publishing-plan/recommendation"
import { requireOperationAccess } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type { PublishingCustomerStage } from "@/types/publishing-plan"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const body = await request.json().catch(() => ({})) as {
      teamId?: unknown
      customerStage?: PublishingCustomerStage
      useAi?: unknown
    }
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
      module: "feedback",
      action: "manage",
    })
    const client = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(record => record.client.id === access.clientId)?.client
    if (!client) throw new Error("客户面板不存在或无权访问")
    const recommendation = await recommendPublishingPlanPlatforms({
      client,
      customerStage: body.customerStage === "maintenance" ? "maintenance" : "new_launch",
      useAi: body.useAi !== false,
    })
    return NextResponse.json({ recommendation }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "平台规划建议生成失败",
    }, { status: 400 })
  }
}
