import { NextResponse } from "next/server"
import { getDesktopDownload } from "@/lib/desktop-downloads"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(
  _request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params
  const download = getDesktopDownload(platform)
  if (!download) {
    return NextResponse.json({ error: "暂不支持该系统" }, { status: 404 })
  }

  return NextResponse.redirect(download.url, {
    status: 302,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  })
}
