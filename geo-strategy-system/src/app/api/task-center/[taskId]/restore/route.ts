import { NextRequest, NextResponse } from "next/server"
import { restoreTaskCenterResult } from "@/lib/task-center/restore"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { taskId } = await context.params
    const restored = await restoreTaskCenterResult(taskId, auth.userId)
    if (!restored) {
      return NextResponse.json(
        { error: "\u4efb\u52a1\u4e0d\u5b58\u5728\u6216\u65e0\u6743\u6062\u590d" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      )
    }
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    console.error("[task-center-api] result restore failed", error)
    return NextResponse.json(
      { error: "\u7ed3\u679c\u6062\u590d\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5" },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    )
  }
}
