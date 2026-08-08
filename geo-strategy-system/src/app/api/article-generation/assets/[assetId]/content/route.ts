import { NextRequest, NextResponse } from "next/server"
import {
  getOwnedArticleMediaAsset,
  readArticleMediaAssetBuffer,
} from "@/lib/article-media/assets"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { assetId } = await context.params
    const asset = await getOwnedArticleMediaAsset(assetId, auth.userId)
    if (!asset) {
      return NextResponse.json({ error: "图片不存在" }, { status: 404 })
    }
    const buffer = await readArticleMediaAssetBuffer(asset)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取图片失败" },
      { status: 500 },
    )
  }
}
