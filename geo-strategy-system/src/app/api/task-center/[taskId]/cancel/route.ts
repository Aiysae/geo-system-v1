import { NextRequest, NextResponse } from "next/server"
import {
  cancelTaskCenterTask,
  TaskCenterCancelError,
} from "@/lib/task-center/cancel"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { taskId } = await context.params
    const result = await cancelTaskCenterTask(taskId, auth.userId)
    return NextResponse.json(
      { ok: true, ...result },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    const known = error instanceof TaskCenterCancelError
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "停止任务失败，请稍后重试",
      },
      {
        status: known && error.code === "NOT_FOUND"
          ? 404
          : known && error.code === "NOT_CANCELLABLE"
            ? 409
            : 500,
        headers: NO_STORE_HEADERS,
      },
    )
  }
}
