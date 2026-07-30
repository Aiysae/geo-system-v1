import { NextRequest, NextResponse } from "next/server"
import { requireOperationAccess } from "@/lib/team-access"
import {
  getSystemOutputRecord,
  getSystemOutputRecordScope,
} from "@/lib/system-output/store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ outputId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response

  try {
    const { outputId } = await context.params
    const scope = await getSystemOutputRecordScope(outputId)
    if (!scope) {
      return noStore(NextResponse.json({ error: "云端产出记录不存在" }, { status: 404 }))
    }
    const access = await requireOperationAccess({
      userId: userGuard.userId,
      clientId: scope.clientId,
      module: scope.module,
      action: "view",
      teamId: String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined,
    })
    if (access.dataOwnerUserId !== scope.ownerUserId) {
      return noStore(NextResponse.json({ error: "无权查看该云端产出记录" }, { status: 403 }))
    }
    const record = await getSystemOutputRecord(scope.ownerUserId, outputId)
    if (!record) {
      return noStore(NextResponse.json({ error: "云端产出记录不存在" }, { status: 404 }))
    }
    return noStore(NextResponse.json(record))
  } catch (error) {
    const forbidden = error instanceof Error && (
      error.name.startsWith("TEAM_")
      || error.name.startsWith("CLIENT_")
      || /权限|无权|只读/.test(error.message)
    )
    return noStore(NextResponse.json(
      { error: error instanceof Error ? error.message : "读取云端产出详情失败" },
      { status: forbidden ? 403 : 500 },
    ))
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate")
  return response
}
