import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
import { recommendPublishingPlanPlatforms } from "@/lib/publishing-plan/recommendation"
import { requirePublishingPlanAccess } from "@/lib/publishing-plan/access-control"
import { toUserFacingError } from "@/lib/user-facing-errors"
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
  const requestId = randomUUID()
  try {
    const { clientId } = await context.params
    const body = await request.json().catch(() => ({})) as {
      teamId?: unknown
      customerStage?: PublishingCustomerStage
      useAi?: unknown
    }
    const access = await requirePublishingPlanAccess({
      userId: auth.userId,
      clientId,
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
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
    const status = recommendationErrorStatus(error)
    console.error("[publishing-plan-recommendation-route]", JSON.stringify({
      requestId,
      userId: auth.userId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      detail: sanitizeAiUpstreamMessage(error instanceof Error ? error.message : String(error), 240),
    }))
    return NextResponse.json({
      error: recommendationPublicError(error, status),
    }, { status })
  }
}

function recommendationErrorStatus(error: unknown): number {
  const name = error instanceof Error ? error.name : ""
  const message = error instanceof Error ? error.message : String(error || "")
  if (/^(?:CLIENT_|TEAM_)/.test(name)) return 403
  if (/资料不足|客户面板不存在/.test(message)) return 422
  return 500
}

function recommendationPublicError(error: unknown, status: number): string {
  if (status === 422) return "当前客户资料不足，请先完善资料或完成一次联网检测。"
  return toUserFacingError(error, {
    status,
    subject: "平台建议",
    fallback: "平台建议暂未生成，请稍后重试。",
    hideUnknownDetails: true,
  })
}
