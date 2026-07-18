import { NextRequest, NextResponse } from "next/server"
import { createBackgroundJob, isBackgroundJobKind } from "@/lib/background-jobs"
import { requireUserId } from "@/lib/with-credits"
import { requireStandardAccountMode } from "@/lib/client-accounts"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response
    const accountAccess = await requireStandardAccountMode(userGuard.userId)
    if (!accountAccess.ok) {
      return NextResponse.json(
        { error: accountAccess.message, code: "CLIENT_ACCOUNT_READ_ONLY" },
        { status: 403 },
      )
    }

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

    const result = await createBackgroundJob({
      kind,
      clientId,
      requestId,
      payload: body.payload,
      ownerUserId: userGuard.userId,
    })
    if (!result.ok) return result.response

    return NextResponse.json(result.job, {
      status: result.reused ? 200 : 202,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "后台任务创建失败"
    const isInputError = /(无效|缺失|请选择|超过 22MB|至少|最多)/.test(message)
    return NextResponse.json(
      { error: message },
      { status: isInputError ? 400 : 500 },
    )
  }
}
