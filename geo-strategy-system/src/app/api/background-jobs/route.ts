import { NextRequest, NextResponse } from "next/server"
import {
  createBackgroundJob,
  isBackgroundJobKind,
} from "@/lib/background-jobs"
import { requireOperationAccess } from "@/lib/team-access"
import { moduleForBackgroundJob } from "@/lib/team-job-modules"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response
    const body = await req.json()
    const kind = body.kind
    const clientId = String(body.clientId || "").trim()
    const requestId = String(body.requestId || "").trim()

    if (!isBackgroundJobKind(kind)) {
      return NextResponse.json({ error: "后台任务类型无效" }, { status: 400 })
    }
    if (!clientId || clientId.length > 200) {
      return NextResponse.json({ error: "客户标识缺失，请刷新页面后重试" }, { status: 400 })
    }

    const access = await requireOperationAccess({
      userId: userGuard.userId,
      clientId,
      module: moduleForBackgroundJob(kind),
      action: "execute",
      teamId: String(body.teamId || "").trim() || undefined,
    })
    const result = await createBackgroundJob({
      kind,
      clientId,
      requestId,
      payload: body.payload,
      ownerUserId: access.actorUserId,
      billingUserId: access.billingUserId,
      runtimeUserId: access.billingUserId,
      workspaceOwnerUserId: access.dataOwnerUserId,
      teamId: access.teamId,
    })
    if (!result.ok) return result.response

    return NextResponse.json(result.job, {
      status: result.reused ? 200 : 202,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "后台任务创建失败"
    const forbidden = error instanceof Error && (
      error.name.startsWith("TEAM_")
      || error.name.startsWith("CLIENT_")
      || /权限|无权|只读|VIP4/.test(message)
    )
    const isInputError = /(无效|缺失|请选择|超过 22MB|至少|最多)/.test(message)
    return NextResponse.json(
      { error: message, code: error instanceof Error ? error.name : undefined },
      { status: forbidden ? 403 : isInputError ? 400 : 500 },
    )
  }
}
