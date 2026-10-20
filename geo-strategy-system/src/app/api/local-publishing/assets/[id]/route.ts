import { NextRequest, NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import { requireUserId } from "@/lib/with-credits"
import { publishingService } from "@/lib/local-publishing/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { id } = await context.params
    const asset = await publishingService().request(auth.userId, "asset.path", { id }) as {
      pathOrUrl: string; mime_type: string; name: string
    }
    const body = await readFile(asset.pathOrUrl)
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": asset.mime_type,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch {
    return NextResponse.json({ error: "素材不存在或无权访问" }, { status: 404 })
  }
}
