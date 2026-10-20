import { NextRequest, NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import { requireUserId } from "@/lib/with-credits"
import { getOwnedArticleMediaAsset, readArticleMediaAssetBuffer } from "@/lib/article-media/assets"
import { publishingService } from "@/lib/local-publishing/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }

export async function POST(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const origin = request.headers.get("origin")
  try {
    if (!origin || new URL(origin).origin !== request.nextUrl.origin)
      return NextResponse.json({ error: "请从当前工作台导入素材" }, { status: 403, headers })
  } catch { return NextResponse.json({ error: "请求来源无效" }, { status: 403, headers }) }
  let incoming = ""
  try {
    const body = await request.json() as { id?: string }
    if (!/^amia_[a-f0-9]{32}$/.test(body.id || ""))
      return NextResponse.json({ error: "GEO 图片素材编号无效" }, { status: 400, headers })
    const source = await getOwnedArticleMediaAsset(body.id!, auth.userId)
    if (!source) return NextResponse.json({ error: "素材不存在或无权访问" }, { status: 404, headers })
    const uploadId = randomUUID()
    const directory = process.env.LOCAL_PUBLISHER_DATA_DIR || path.join(process.cwd(), ".data/local-publishing")
    incoming = path.join(directory, "incoming", createHash("sha256").update(auth.userId).digest("hex").slice(0,20), uploadId)
    await mkdir(path.dirname(incoming), { recursive: true, mode: 0o700 })
    await writeFile(incoming, await readArticleMediaAssetBuffer(source), { flag: "wx", mode: 0o600 })
    const asset = await publishingService().request(auth.userId, "asset.register", {
      uploadId, kind: "image", name: source.originalName,
    })
    return NextResponse.json({ asset }, { headers })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 400, headers })
  } finally {
    if (incoming) await rm(incoming, { force: true }).catch(() => {})
  }
}
