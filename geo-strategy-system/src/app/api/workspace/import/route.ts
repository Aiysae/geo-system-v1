import { NextRequest, NextResponse } from "next/server"
import { requireUserId } from "@/lib/with-credits"
import { importLegacyWorkspaceClients } from "@/lib/workspace-store"
import { WorkspaceValidationError } from "@/lib/workspace-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const MAX_BODY_BYTES = 25 * 1024 * 1024

export async function POST(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return noStore(NextResponse.json({ error: "本机历史数据超过单次导入限制" }, { status: 413 }))
  }
  try {
    const body = await request.json() as { importId?: unknown; clients?: unknown }
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) {
      throw new WorkspaceValidationError("本机历史数据超过单次导入限制")
    }
    const result = await importLegacyWorkspaceClients(
      auth.userId,
      String(body.importId || ""),
      Array.isArray(body.clients) ? body.clients : [],
    )
    return noStore(NextResponse.json(result))
  } catch (error) {
    if (error instanceof WorkspaceValidationError || error instanceof SyntaxError) {
      const message = error instanceof Error ? error.message : "本机历史数据格式无效"
      return noStore(NextResponse.json({ error: message }, { status: 400 }))
    }
    console.error("[workspace-import] failed", error)
    return noStore(NextResponse.json({ error: "本机历史数据导入失败" }, { status: 503 }))
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  response.headers.set("Pragma", "no-cache")
  return response
}
