import { NextRequest, NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { requireUserId } from "@/lib/with-credits"
import { publishingService } from "@/lib/local-publishing/service"
import { ARTICLE_FILE_LIMITS, ArticleFileImportError, parseArticleFiles, resolveArticleFileImages } from "@/lib/local-publishing/file-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }
const MAX_REQUEST_BYTES = ARTICLE_FILE_LIMITS.totalBytes + 1024 * 1024

async function readForm(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) throw new ArticleFileImportError("请选择要上传的文章文件")
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) throw new ArticleFileImportError("单次文章上传总量不能超过 32MB", 413)
  if (!request.body) throw new ArticleFileImportError("上传内容为空")
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new ArticleFileImportError("单次文章上传总量不能超过 32MB", 413) }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  return new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData()
}

export async function POST(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const origin = new URL(request.headers.get("origin") || "")
    if (origin.host !== (request.headers.get("host") || request.nextUrl.host) || origin.protocol !== request.nextUrl.protocol)
      return NextResponse.json({ error: "请从当前工作台导入文章" }, { status: 403, headers })
  } catch { return NextResponse.json({ error: "请求来源无效" }, { status: 403, headers }) }
  try {
    const form = await readForm(request)
    const mode = form.get("mode")
    if (mode !== "preview" && mode !== "import") throw new ArticleFileImportError("请先预览文章，再确认导入")
    const files = form.getAll("files")
    if (!files.length || files.length > ARTICLE_FILE_LIMITS.count || files.some(file => !(file instanceof File))) throw new ArticleFileImportError("每次请选择 1～20 个文章文件")
    const parsed = await parseArticleFiles(await Promise.all((files as File[]).map(async file => ({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()) }))))
    if (mode === "preview") return NextResponse.json({
      items: parsed.map(item => ({ name: item.name, title: item.title, markdown: resolveArticleFileImages(item).markdown,
        warnings: item.warnings, sourceHash: item.sourceHash, imageCount: item.images.length })),
      warnings: [],
    }, { headers })

    const service = publishingService()
    const items: { name: string; title: string; article: unknown; status: string; warnings: string[] }[] = []
    for (const item of parsed) {
      const source = { kind: "file", id: `file:${item.sourceHash}`, version: item.sourceHash, name: item.name }
      const existing = await service.request(auth.userId, "article.import.lookup", { sourceKey: source.id, sourceVersion: source.version }) as { article: unknown; status: string } | null
      if (existing) { items.push({ name: item.name, title: item.title, ...existing, warnings: item.warnings }); continue }
      const imageUrls = new Map<string, string>(), assetIds: string[] = []
      for (const image of item.images) {
        const uploadId = randomUUID()
        const directory = process.env.LOCAL_PUBLISHER_DATA_DIR || path.join(process.cwd(), ".data/local-publishing")
        const incoming = path.join(directory, "incoming", createHash("sha256").update(auth.userId).digest("hex").slice(0, 20), uploadId)
        try {
          await mkdir(path.dirname(incoming), { recursive: true, mode: 0o700 })
          await writeFile(incoming, image.buffer, { flag: "wx", mode: 0o600 })
          const asset = await service.request(auth.userId, "asset.register", { uploadId, kind: "image", name: image.name }) as { id: string }
          imageUrls.set(image.key, `local-asset:${asset.id}`)
          assetIds.push(asset.id)
        } finally { await rm(incoming, { force: true }).catch(() => {}) }
      }
      const content = resolveArticleFileImages(item, imageUrls)
      const imported = await service.request(auth.userId, "article.import", { title: item.title, ...content,
        metadata: { contentType: "article", digest: item.digest, tags: [], assetIds }, source }) as { article: unknown; status: string }
      items.push({ name: item.name, title: item.title, ...imported, warnings: item.warnings })
    }
    return NextResponse.json({ items, importedCount: items.filter(item => item.status !== "existing").length,
      reusedCount: items.filter(item => item.status === "existing").length, warnings: [] }, { headers })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "文章导入失败" }, { status: error instanceof ArticleFileImportError ? error.status : 400, headers })
  }
}
