import { NextRequest, NextResponse } from "next/server"
import {
  getReportBranding,
  ReportBrandingValidationError,
  saveReportBranding,
} from "@/lib/reports/report-branding-store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const MAX_SETTINGS_PAYLOAD_BYTES = 900 * 1024

function noStore(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { ...init?.headers, "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
  })
}

export async function GET() {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  return noStore({ branding: await getReportBranding(auth.userId) })
}

export async function PUT(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const contentLength = Number(req.headers.get("content-length") || 0)
    if (contentLength > MAX_SETTINGS_PAYLOAD_BYTES) {
      return noStore({ error: "Logo 文件过大，请压缩后重试" }, { status: 413 })
    }
    const body = await req.json() as { branding?: unknown }
    const branding = await saveReportBranding(auth.userId, body.branding)
    return noStore({ branding })
  } catch (error) {
    const message = error instanceof ReportBrandingValidationError
      ? error.message
      : "报告出品方设置保存失败"
    return noStore({ error: message }, { status: 400 })
  }
}
