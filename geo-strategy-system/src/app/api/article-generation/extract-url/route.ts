import { NextRequest, NextResponse } from "next/server"
import { extractArticleFromUrl } from "@/lib/article-extract"
import { requireUserId } from "@/lib/with-credits"
import {
  isOperationAccessError,
  requireOperationAccess,
} from "@/lib/team-access"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

function text(value: unknown, max = 2000): string {
  return String(value ?? "")
    .trim()
    .slice(0, max)
}

export async function POST(req: NextRequest) {
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response
    const body = await req.json()
    await requireOperationAccess({
      userId: userGuard.userId,
      clientId: text(body.clientId, 200),
      module: "article",
      action: "execute",
    })
    const url = text(body.url)
    if (!url) {
      return NextResponse.json({ error: "请填写文章链接" }, { status: 400 })
    }

    const article = await extractArticleFromUrl(url)
    return NextResponse.json(article, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "文章读取失败"
    const status = isOperationAccessError(error)
      ? 403
      : /Unauthorized/i.test(message) ? 401 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
