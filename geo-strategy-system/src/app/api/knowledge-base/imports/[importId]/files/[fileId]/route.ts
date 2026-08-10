import { NextRequest, NextResponse } from "next/server"
import {
  isKnowledgeImportAccessError,
  requireKnowledgeImportAccess,
} from "@/lib/knowledge-import/access"
import {
  getWorkspaceKnowledgeImport,
  readKnowledgeImportFile,
} from "@/lib/knowledge-import/store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  route: { params: Promise<{ importId: string; fileId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { importId, fileId } = await route.params
    const clientId = String(request.nextUrl.searchParams.get("clientId") || "").trim()
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    const access = await requireKnowledgeImportAccess({
      userId: auth.userId,
      clientId,
      teamId,
      action: "view",
    })
    const record = await getWorkspaceKnowledgeImport(importId, access.dataOwnerUserId, clientId)
    if (!record) return NextResponse.json({ error: "导入记录不存在" }, { status: 404 })
    const file = await readKnowledgeImportFile(record, fileId)
    if (!file) return NextResponse.json({ error: "原始资料文件不存在" }, { status: 404 })
    const safeName = file.metadata.name.replace(/[\r\n"]/g, "-")
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.metadata.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        "Content-Length": String(file.buffer.length),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "原始资料读取失败"
    return NextResponse.json({ error: message }, {
      status: isKnowledgeImportAccessError(error) ? 403 : 500,
    })
  }
}
