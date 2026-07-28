import { NextRequest, NextResponse } from "next/server"
import {
  ClientExecutionActionDetailError,
  getClientExecutionActionDetail,
} from "@/lib/client-feedback/action-detail"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      ...init?.headers,
      "Cache-Control": "private, no-store, max-age=0",
    },
  })
}

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{ clientId: string; actionId: string }>
  },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, actionId } = await context.params
    const detail = await getClientExecutionActionDetail({
      userId: auth.userId,
      clientId,
      actionId,
    })
    return noStore({ detail })
  } catch (error) {
    if (error instanceof ClientExecutionActionDetailError) {
      return noStore(
        { error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : 403 },
      )
    }
    return noStore({
      error: error instanceof Error ? error.message : "动作详情读取失败",
    }, { status: 403 })
  }
}
