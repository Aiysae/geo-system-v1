import { NextRequest, NextResponse } from "next/server"
import { requireUserId } from "@/lib/with-credits"
import { isOperationAccessError } from "@/lib/team-access"
import { importProductionArticles, listProductionImportSources } from "@/lib/local-publishing/production-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120
const headers = { "Cache-Control": "private, no-store, max-age=0" }
function reply(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }) }
export async function GET(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const value = (name: string) => request.nextUrl.searchParams.get(name)?.trim().slice(0, 200) || undefined
    return reply(await listProductionImportSources(auth.userId, { clientId: value("clientId"), teamId: value("teamId"), batchId: value("batchId") }))
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "读取生成文章失败" }, isOperationAccessError(error) ? 403 : 400)
  }
}
export async function POST(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const origin = request.headers.get("origin")
    if (!origin || new URL(origin).origin !== request.nextUrl.origin) return reply({ error: "请从当前工作台导入文章" }, 403)
  } catch { return reply({ error: "请求来源无效" }, 403) }
  try {
    const source = await request.text()
    if (source.length > 1200000) return reply({ error: "文章导入请求过大" }, 413)
    const body: unknown = JSON.parse(source)
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "文章导入格式无效" }, 400)
    return reply(await importProductionArticles(auth.userId, body as Record<string, unknown>))
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "文章导入失败" }, isOperationAccessError(error) ? 403 : 400)
  }
}
