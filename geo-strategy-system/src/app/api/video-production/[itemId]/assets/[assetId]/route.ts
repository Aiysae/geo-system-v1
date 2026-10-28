import { NextRequest, NextResponse } from "next/server"
import {
  getArticleMediaAsset,
  readArticleMediaAssetBuffer,
} from "@/lib/article-media/assets"
import { requireVideoItemAccess, videoProductionErrorStatus } from "@/lib/video-production/access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ itemId: string; assetId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { itemId, assetId } = await context.params
    const authorized = await requireVideoItemAccess({ itemId, userId: auth.userId, action: "view" })
    const asset = authorized ? await getArticleMediaAsset(assetId) : null
    // Media assets dedupe by content, so an image may carry another item's batch id; ownership is what matters.
    if (!authorized || !asset || asset.ownerUserId !== authorized.item.dataOwnerUserId) {
      return NextResponse.json({ error: "图片不存在" }, { status: 404 })
    }
    const buffer = await readArticleMediaAssetBuffer(asset)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取图片失败" },
      { status: videoProductionErrorStatus(error) },
    )
  }
}
