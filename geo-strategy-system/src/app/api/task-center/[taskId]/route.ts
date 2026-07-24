import { NextRequest, NextResponse } from "next/server"
import { markTaskCenterTaskRead } from "@/lib/task-center/store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(
  _req: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { taskId } = await context.params
    const updated = await markTaskCenterTaskRead(taskId, auth.userId)
    if (!updated) {
      return NextResponse.json(
        { error: "任务不存在或无权查看" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      )
    }
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    console.error("[task-center-api] mark read failed", error)
    return NextResponse.json(
      { error: "任务已读状态保存失败，请稍后重试" },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    )
  }
}
