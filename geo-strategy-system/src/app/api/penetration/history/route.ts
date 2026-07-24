import { NextRequest, NextResponse } from "next/server"
import { listPenetrationHistoryRecords } from "@/lib/penetration/history-store"
import {
  isPenetrationHistoryAccessError,
} from "@/lib/penetration/history-access"
import { requireOperationAccess } from "@/lib/team-access"
import { listAccessibleTeamClientShares } from "@/lib/team-store"
import { hasTeamPermission } from "@/lib/team-permissions"
import { requireUserId } from "@/lib/with-credits"
import type {
  PenetrationHistoryListItem,
  PenetrationHistorySource,
  PenetrationHistoryStatus,
  PenetrationJobOperation,
} from "@/types"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"

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

  try {
    const params = req.nextUrl.searchParams
    const clientId = limitedString(params.get("clientId"), 160)
    const teamId = limitedString(params.get("teamId"), 160) || undefined
    const statusValue = limitedString(params.get("status"), 32) as PenetrationHistoryStatus
    const operationValue = limitedString(params.get("operation"), 32) as PenetrationJobOperation
    const sourceValue = limitedString(params.get("source"), 32) as PenetrationHistorySource
    const page = Math.max(1, Math.floor(Number(params.get("page")) || 1))
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(params.get("pageSize")) || 20)))
    const daysValue = Math.floor(Number(params.get("days")) || 0)
    const filters = {
      status: HISTORY_STATUSES.has(statusValue) ? statusValue : undefined,
      operation: HISTORY_OPERATIONS.has(operationValue) ? operationValue : undefined,
      source: HISTORY_SOURCES.has(sourceValue) ? sourceValue : undefined,
      days: daysValue > 0 ? Math.min(3_650, daysValue) : undefined,
    }

    if (teamId && !clientId) {
      return NextResponse.json(
        await listTeamHistory(userGuard.userId, teamId, page, pageSize, filters),
        { headers: { "Cache-Control": "private, no-store, max-age=0" } },
      )
    }

    let ownerUserId = userGuard.userId
    let scopedClientId = clientId || undefined
    if (clientId) {
      const access = await requireOperationAccess({
        userId: userGuard.userId,
        clientId,
        module: "penetration",
        action: "view",
        teamId,
      })
      ownerUserId = access.dataOwnerUserId
    } else {
      const access = await resolveWorkspaceAccess(userGuard.userId)
      if (!access.ok) {
        return NextResponse.json({ error: access.message, code: access.code }, { status: 403 })
      }
      ownerUserId = access.ownerUserId
      scopedClientId = access.mode === "client" ? access.clientId : undefined
    }

    const history = await listPenetrationHistoryRecords(ownerUserId, {
      clientId: scopedClientId,
      ...filters,
      page,
      pageSize,
    })

    return NextResponse.json(history, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取检测历史失败" },
      { status: isPenetrationHistoryAccessError(error) ? 403 : 500 },
    )
  }
}

async function listTeamHistory(
  userId: string,
  teamId: string,
  page: number,
  pageSize: number,
  filters: {
    status?: PenetrationHistoryStatus
    operation?: PenetrationJobOperation
    source?: PenetrationHistorySource
    days?: number
  },
) {
  const visible = (await listAccessibleTeamClientShares(userId, teamId))
    .filter(item => hasTeamPermission(item.permissionKeys, "penetration", "view"))
  const uniqueShares = [...new Map(visible.map(item => [
    `${item.share.clientOwnerUserId}:${item.share.clientId}`,
    item.share,
  ])).values()]
  if (uniqueShares.length === 0) {
    const error = new Error("当前团队没有可查看的检测历史")
    error.name = "TEAM_PERMISSION_DENIED"
    throw error
  }

  const targetCount = Math.min(1_000, page * pageSize)
  const chunks = await Promise.all(uniqueShares.map(async share => {
    const items: PenetrationHistoryListItem[] = []
    let total = 0
    let cursor = 1
    let hasMore = true
    while (hasMore && items.length < targetCount && cursor <= 20) {
      const result = await listPenetrationHistoryRecords(share.clientOwnerUserId, {
        clientId: share.clientId,
        ...filters,
        page: cursor,
        pageSize: 50,
      })
      items.push(...result.items)
      total = result.total
      hasMore = result.hasMore
      cursor += 1
    }
    return { items, total }
  }))
  const items = [...new Map(
    chunks.flatMap(chunk => chunk.items).map(item => [item.id, item]),
  ).values()].sort((left, right) => (
    Date.parse(right.completedAt || right.updatedAt || right.createdAt)
    - Date.parse(left.completedAt || left.updatedAt || left.createdAt)
  ))
  const offset = (page - 1) * pageSize
  const total = chunks.reduce((sum, chunk) => sum + chunk.total, 0)
  return {
    items: items.slice(offset, offset + pageSize),
    page,
    pageSize,
    total,
    hasMore: offset + pageSize < total,
  }
}
