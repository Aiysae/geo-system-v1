import { NextRequest, NextResponse } from "next/server"
import {
  listTaskCenterTasks,
  markAllTaskCenterTasksRead,
} from "@/lib/task-center/store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { reconcileContentProductionRunsForUser } = await import("@/lib/content-production/service")
    await reconcileContentProductionRunsForUser(auth.userId).catch(error => {
      console.error("[task-center-api] content production reconciliation failed", error)
    })
    const requestedLimit = Number(req.nextUrl.searchParams.get("limit") || 50)
    const response = await listTaskCenterTasks(auth.userId, requestedLimit)
    return NextResponse.json(response, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error("[task-center-api] list failed", error)
    return NextResponse.json(
      { error: "任务列表读取失败，请稍后重试" },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const body = await req.json().catch(() => ({})) as { action?: string }
    if (body.action !== "mark_all_read") {
      return NextResponse.json({ error: "任务中心操作无效" }, { status: 400 })
    }
    const updated = await markAllTaskCenterTasksRead(auth.userId)
    return NextResponse.json({ ok: true, updated }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error("[task-center-api] mark all read failed", error)
    return NextResponse.json(
      { error: "任务已读状态保存失败，请稍后重试" },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}
