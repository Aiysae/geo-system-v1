import { NextRequest, NextResponse } from "next/server"
import { requireUserId } from "@/lib/with-credits"
import { createWorkspaceClient, listWorkspaceClients } from "@/lib/workspace-store"
import { WorkspaceValidationError } from "@/lib/workspace-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const MAX_BODY_BYTES = 25 * 1024 * 1024

export async function GET() {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const clients = await listWorkspaceClients(auth.userId)
    return noStore(NextResponse.json({ clients }))
  } catch (error) {
    console.error("[workspace-clients] list failed", error)
    return noStore(NextResponse.json({ error: "云端工作区读取失败" }, { status: 503 }))
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  if (requestTooLarge(request)) {
    return noStore(NextResponse.json({ error: "客户数据超过单次上传限制" }, { status: 413 }))
  }
  try {
    const body = await request.json() as { client?: unknown }
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) {
      throw new WorkspaceValidationError("客户数据超过单次上传限制")
    }
    const synced = await createWorkspaceClient(auth.userId, body.client)
    return noStore(NextResponse.json(synced, { status: 201 }))
  } catch (error) {
    if (error instanceof WorkspaceValidationError || error instanceof SyntaxError) {
      const message = error instanceof Error ? error.message : "客户数据格式无效"
      return noStore(NextResponse.json({ error: message }, { status: 400 }))
    }
    console.error("[workspace-clients] create failed", error)
    return noStore(NextResponse.json({ error: "云端客户创建失败" }, { status: 503 }))
  }
}

function requestTooLarge(request: NextRequest): boolean {
  const contentLength = Number(request.headers.get("content-length") || 0)
  return Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  response.headers.set("Pragma", "no-cache")
  return response
}
