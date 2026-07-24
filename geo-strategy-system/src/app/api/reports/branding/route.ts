import { NextRequest, NextResponse } from "next/server"
import {
  getReportBranding,
  ReportBrandingValidationError,
  saveReportBranding,
  validateReportBranding,
} from "@/lib/reports/report-branding-store"
import { getReportBrandingAccess } from "@/lib/report-access"
import { requireUserId } from "@/lib/with-credits"
import {
  isOperationAccessError,
  requireOperationAccess,
} from "@/lib/team-access"

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

function limitedString(value: unknown, maxLength = 160): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const clientId = limitedString(req.nextUrl.searchParams.get("clientId"))
    const teamId = limitedString(req.nextUrl.searchParams.get("teamId")) || undefined
    if (!clientId) return noStore({ error: "客户标识缺失，请刷新页面后重试" }, { status: 400 })
    const operationAccess = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "report",
      action: "view",
      teamId,
    })
    const [branding, access] = await Promise.all([
      getReportBranding(operationAccess.billingUserId),
      getReportBrandingAccess(operationAccess.billingUserId),
    ])
    return noStore({ branding, access })
  } catch (error) {
    return noStore(
      { error: error instanceof Error ? error.message : "读取报告出品方失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const contentLength = Number(req.headers.get("content-length") || 0)
    if (contentLength > MAX_SETTINGS_PAYLOAD_BYTES) {
      return noStore({ error: "Logo 文件过大，请压缩后重试" }, { status: 413 })
    }
    const body = await req.json() as {
      clientId?: unknown
      teamId?: unknown
      branding?: unknown
    }
    const clientId = limitedString(body.clientId)
    const teamId = limitedString(body.teamId) || undefined
    if (!clientId) return noStore({ error: "客户标识缺失，请刷新页面后重试" }, { status: 400 })
    const operationAccess = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "report",
      action: "edit",
      teamId,
    })
    const candidate = validateReportBranding(body.branding)
    if (candidate.mode === "custom") {
      const access = await getReportBrandingAccess(operationAccess.billingUserId)
      if (!access.canUseCustomBranding) {
        return noStore({
          error: "充值任意套餐并到账后，即可解锁白标报告",
          code: "VIP_REQUIRED",
          access,
        }, { status: 403 })
      }
    }
    const branding = await saveReportBranding(operationAccess.billingUserId, candidate)
    return noStore({ branding })
  } catch (error) {
    const message = error instanceof ReportBrandingValidationError
      ? error.message
      : "报告出品方设置保存失败"
    return noStore(
      { error: error instanceof ReportBrandingValidationError ? message : error instanceof Error ? error.message : message },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}
