import { NextRequest, NextResponse } from "next/server"
import { extractArticleFromUrl } from "@/lib/article-extract"
import { requireUserId } from "@/lib/with-credits"
import { requireStandardAccountMode } from "@/lib/client-accounts"

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
    const accountAccess = await requireStandardAccountMode(userGuard.userId)
    if (!accountAccess.ok) {
      return NextResponse.json(
        { error: accountAccess.message, code: "CLIENT_ACCOUNT_READ_ONLY" },
        { status: 403 },
      )
    }

    const body = await req.json()
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
    const status = /Unauthorized/i.test(message) ? 401 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
