import { NextRequest, NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import { requireUserId } from "@/lib/with-credits"
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
      return NextResponse.json({ error: "请从当前工作台上传素材" }, { status: 403, headers })
  } catch { return NextResponse.json({ error: "请求来源无效" }, { status: 403, headers }) }
  const length = Number(request.headers.get("content-length") || 0)
  if (length > 260 * 1024 * 1024)
    return NextResponse.json({ error: "单次上传不能超过 260MB" }, { status: 413, headers })
  let incoming = ""
  try {
    const form = await request.formData()
    const file = form.get("file")
    const kind = String(form.get("kind") || "")
    if (!(file instanceof File) || !["image", "video", "audio"].includes(kind))
      return NextResponse.json({ error: "请选择图片、视频或音频文件" }, { status: 400, headers })
    const max = kind === "image" ? 12 : kind === "video" ? 250 : 100
    if (!file.size || file.size > max * 1024 * 1024)
      return NextResponse.json({ error: `${kind}素材超过 ${max}MB 限制` }, { status: 413, headers })
    const uploadId = randomUUID()
    const directory = process.env.LOCAL_PUBLISHER_DATA_DIR || path.join(process.cwd(), ".data/local-publishing")
    incoming = path.join(directory, "incoming", createHash("sha256").update(auth.userId).digest("hex").slice(0,20), uploadId)
    await mkdir(path.dirname(incoming), { recursive: true, mode: 0o700 })
    await writeFile(incoming, Buffer.from(await file.arrayBuffer()), { flag: "wx", mode: 0o600 })
    const asset = await publishingService().request(auth.userId, "asset.register", { uploadId, kind, name: file.name })
    return NextResponse.json({ asset }, { headers })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "上传失败" }, { status: 400, headers })
  } finally {
    if (incoming) await rm(incoming, { force: true }).catch(() => {})
  }
}
