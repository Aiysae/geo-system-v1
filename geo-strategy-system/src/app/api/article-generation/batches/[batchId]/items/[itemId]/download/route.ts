import { NextRequest, NextResponse } from "next/server"
import { getArticleBatchDocx } from "@/lib/article-batches/manager"
import { requireUserId } from "@/lib/with-credits"

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
  const file = await getArticleBatchDocx({ batchId, itemId, ownerUserId: auth.userId })
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
