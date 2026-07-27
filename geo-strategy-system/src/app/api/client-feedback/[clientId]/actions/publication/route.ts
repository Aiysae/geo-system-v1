import { NextRequest, NextResponse } from "next/server"
import { listSystemClientExecutionActions } from "@/lib/client-feedback/builder"
import {
  setActionPublications,
  setDefaultPenetrationPublication,
} from "@/lib/client-feedback/publication"
import { listClientExecutionActions } from "@/lib/client-feedback/store"
import { requireOperationAccess } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import type { ClientExecutionActionPublication } from "@/types/client-feedback"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PUBLICATIONS = new Set<ClientExecutionActionPublication>([
  "internal",
  "summary",
  "full",
])

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "feedback",
      action: "manage",
    })
    const body = await request.json() as {
      action?: unknown
      actionIds?: unknown
      publication?: unknown
    }
    const publication = String(body.publication || "") as ClientExecutionActionPublication
    if (!PUBLICATIONS.has(publication)) throw new Error("请选择有效的客户展示范围")

    if (String(body.action || "") === "set-default") {
      const policy = await setDefaultPenetrationPublication({
        ownerUserId: access.dataOwnerUserId,
        clientId: access.clientId,
        publication,
        operatorUserId: auth.userId,
      })
      return noStore(NextResponse.json({ policy }))
    }

    const actionIds = Array.isArray(body.actionIds)
      ? body.actionIds.map(value => String(value || "").trim()).filter(Boolean)
      : []
    if (actionIds.length === 0 || actionIds.length > 200) {
      throw new Error("单次请选择 1 到 200 条动作")
    }
    const [manualActions, systemActions] = await Promise.all([
      listClientExecutionActions(access.dataOwnerUserId, access.clientId),
      listSystemClientExecutionActions(access.dataOwnerUserId, access.clientId),
    ])
    const available = new Set(
      [...manualActions, ...systemActions].map(action => action.id),
    )
    if (actionIds.some(actionId => !available.has(actionId))) {
      throw new Error("部分动作不存在或不属于当前客户")
    }
    const policy = await setActionPublications({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      actionIds,
      publication,
      operatorUserId: auth.userId,
    })
    return noStore(NextResponse.json({ policy }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "客户展示权限保存失败",
    }, { status: 403 }))
  }
}
