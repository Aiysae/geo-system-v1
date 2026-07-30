import { NextRequest, NextResponse } from "next/server"
import { requireOperationAccess } from "@/lib/team-access"
import { listSystemOutputRecords } from "@/lib/system-output/store"
import { requireUserId } from "@/lib/with-credits"
import type {
  SystemOutputKind,
  SystemOutputModule,
  SystemOutputStatus,
} from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MODULES = new Set<SystemOutputModule>([
  "penetration",
  "research",
  "diagnosis",
  "difficulty",
])
const KINDS = new Set<SystemOutputKind>([
  "penetration_analysis",
  "independent_research",
  "competitor_comparison",
  "website_diagnosis",
  "difficulty_assessment",
])
const STATUSES = new Set<SystemOutputStatus>([
  "succeeded",
  "partial",
  "failed",
  "cancelled",
])

export async function GET(request: NextRequest) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response

  try {
    const params = request.nextUrl.searchParams
    const clientId = limited(params.get("clientId"), 200)
    const outputModule = limited(params.get("module"), 40) as SystemOutputModule
    if (!clientId) {
      return noStore(NextResponse.json(
        { error: "请选择客户后查看云端产出记录" },
        { status: 400 },
      ))
    }
    if (!MODULES.has(outputModule)) {
      return noStore(NextResponse.json(
        { error: "请选择需要查看的结果模块" },
        { status: 400 },
      ))
    }

    const access = await requireOperationAccess({
      userId: userGuard.userId,
      clientId,
      module: outputModule,
      action: "view",
      teamId: limited(params.get("teamId"), 200) || undefined,
    })
    const kindValue = limited(params.get("kind"), 60) as SystemOutputKind
    const statusValue = limited(params.get("status"), 40) as SystemOutputStatus
    const page = await listSystemOutputRecords(access.dataOwnerUserId, {
      clientId,
      module: outputModule,
      kind: KINDS.has(kindValue) ? kindValue : undefined,
      status: STATUSES.has(statusValue) ? statusValue : undefined,
      days: number(params.get("days"), 0, 3650),
      page: number(params.get("page"), 1, 100_000),
      pageSize: number(params.get("pageSize"), 20, 100),
    })
    return noStore(NextResponse.json(page))
  } catch (error) {
    const forbidden = error instanceof Error && (
      error.name.startsWith("TEAM_")
      || error.name.startsWith("CLIENT_")
      || /权限|无权|只读/.test(error.message)
    )
    return noStore(NextResponse.json(
      { error: error instanceof Error ? error.message : "读取云端产出记录失败" },
      { status: forbidden ? 403 : 500 },
    ))
  }
}

function limited(value: unknown, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength)
}

function number(value: unknown, fallback: number, max: number): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : fallback
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate")
  return response
}
