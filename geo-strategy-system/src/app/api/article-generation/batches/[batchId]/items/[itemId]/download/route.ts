import { NextRequest, NextResponse } from "next/server"
import { getArticleBatch, getArticleBatchDocx } from "@/lib/article-batches/manager"
import { requireUserId } from "@/lib/with-credits"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

function disposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ batchId: string; itemId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const { batchId, itemId } = await context.params
  const access = await resolveWorkspaceAccess(auth.userId)
  if (!access.ok) {
    return NextResponse.json({ error: access.message, code: access.code }, { status: 403 })
  }
  const batch = await getArticleBatch(batchId, access.ownerUserId)
  if (!batch || (access.mode === "client" && batch.clientId !== access.clientId)) {
    return NextResponse.json({ error: "Word 文档不存在或尚未生成" }, { status: 404 })
  }
  const file = await getArticleBatchDocx({
    batchId,
    itemId,
    ownerUserId: access.ownerUserId,
  })
  if (!file) return NextResponse.json({ error: "Word 文档不存在或尚未生成" }, { status: 404 })
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": disposition(file.fileName),
      "Content-Length": String(file.buffer.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
