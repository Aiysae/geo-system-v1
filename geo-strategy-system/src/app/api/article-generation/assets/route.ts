import { NextRequest, NextResponse } from "next/server"
import {
  createArticleMediaAsset,
  toPublicArticleMediaAsset,
} from "@/lib/article-media/assets"
import {
  isTeamAccessError,
  requireArticleBatchAccess,
} from "@/lib/article-batches/access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 120
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" }

export async function POST(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const form = await req.formData()
    const clientId = String(form.get("clientId") || "").trim()
    const batchId = String(form.get("batchId") || "").trim()
    if (!clientId || !batchId) {
      return NextResponse.json(
        { error: "请选择需要配图的文章批次" },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }
    const authorized = await requireArticleBatchAccess({
      batchId,
      userId: auth.userId,
      action: "edit",
    })
    if (!authorized || authorized.batch.clientId !== clientId) {
      return NextResponse.json(
        { error: "文章批次不存在或无权配图" },
        { status: 404, headers: NO_STORE_HEADERS },
      )
    }

    const files = form.getAll("files").filter((value): value is File => value instanceof File)
    if (files.length === 0) {
      return NextResponse.json(
        { error: "请至少选择一张图片" },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }
    if (files.length > 30) {
      return NextResponse.json(
        { error: "单次最多上传 30 张图片" },
        { status: 413, headers: NO_STORE_HEADERS },
      )
    }

    const assets = []
    for (const file of files) {
      const asset = await createArticleMediaAsset({
        ownerUserId: auth.userId,
        clientId,
        batchId,
        originalName: file.name,
        buffer: Buffer.from(await file.arrayBuffer()),
      })
      assets.push(toPublicArticleMediaAsset(asset))
    }
    return NextResponse.json({ assets }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "上传图片失败" },
      { status: isTeamAccessError(error) ? 403 : 500, headers: NO_STORE_HEADERS },
    )
  }
}
