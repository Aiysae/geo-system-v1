import { NextRequest, NextResponse } from "next/server"
import { listPenetrationHistoryRecords } from "@/lib/penetration/history-store"
import { requireUserId } from "@/lib/with-credits"
import type {
  PenetrationHistorySource,
  PenetrationHistoryStatus,
  PenetrationJobOperation,
} from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const HISTORY_STATUSES = new Set<PenetrationHistoryStatus>([
  "succeeded",
  "partial",
  "cancelled",
  "failed",
])
const HISTORY_OPERATIONS = new Set<PenetrationJobOperation>(["replace", "append"])
const HISTORY_SOURCES = new Set<PenetrationHistorySource>(["job", "workspace_backfill"])

function limitedString(value: string | null, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength)
}

export async function GET(req: NextRequest) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response

  const params = req.nextUrl.searchParams
  const clientId = limitedString(params.get("clientId"), 160)
  const statusValue = limitedString(params.get("status"), 32) as PenetrationHistoryStatus
  const operationValue = limitedString(params.get("operation"), 32) as PenetrationJobOperation
  const sourceValue = limitedString(params.get("source"), 32) as PenetrationHistorySource
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1))
  const pageSize = Math.max(1, Math.min(50, Math.floor(Number(params.get("pageSize")) || 20)))
  const daysValue = Math.floor(Number(params.get("days")) || 0)

  const history = await listPenetrationHistoryRecords(userGuard.userId, {
    clientId: clientId || undefined,
    status: HISTORY_STATUSES.has(statusValue) ? statusValue : undefined,
    operation: HISTORY_OPERATIONS.has(operationValue) ? operationValue : undefined,
    source: HISTORY_SOURCES.has(sourceValue) ? sourceValue : undefined,
    days: daysValue > 0 ? Math.min(3_650, daysValue) : undefined,
    page,
    pageSize,
  })

  return NextResponse.json(history, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  })
}
