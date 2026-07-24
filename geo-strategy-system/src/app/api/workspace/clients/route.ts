import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"
import {
  listAccessibleTeamClientShares,
  listTeamsForUser,
} from "@/lib/team-store"
import { requireUserId } from "@/lib/with-credits"
import {
  createWorkspaceClient,
  listWorkspaceClients,
} from "@/lib/workspace-store"
import { WorkspaceValidationError } from "@/lib/workspace-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const MAX_BODY_BYTES = 25 * 1024 * 1024

export async function GET(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim()
    if (teamId) {
      const teams = await listTeamsForUser(auth.userId)
      if (!teams.some(summary => summary.team.id === teamId)) {
        return noStore(NextResponse.json({
          error: "团队不存在或当前账号无权访问",
          code: "TEAM_ACCESS_DENIED",
        }, { status: 403 }))
      }
      const accesses = await listAccessibleTeamClientShares(auth.userId, teamId)
      const records = await Promise.all(accesses.map(async access => {
        const ownerRecords = await listWorkspaceClients(access.share.clientOwnerUserId)
        return ownerRecords.find(record => record.client.id === access.share.clientId) || null
      }))
      const unique = new Map(records
        .filter(record => Boolean(record))
        .map(record => [record!.client.id, record!]))
      return noStore(NextResponse.json({ clients: [...unique.values()] }))
    }

    const access = await resolveWorkspaceAccess(auth.userId)
    if (!access.ok) {
      return noStore(NextResponse.json(
        { error: access.message, code: access.code },
        { status: 403 },
      ))
    }
    let clients = await listWorkspaceClients(access.ownerUserId)
    if (access.mode === "client") {
      clients = clients.filter(record => record.client.id === access.clientId)
    }
    return noStore(NextResponse.json({ clients }))
  } catch (error) {
    console.error("[workspace-clients] list failed", error)
    return noStore(NextResponse.json({ error: "云端工作区读取失败" }, { status: 503 }))
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim()
  if (teamId) {
    return noStore(NextResponse.json({
      error: "团队空间不能新建客户，请先在“我的主页”创建客户后再开放给团队",
      code: "TEAM_CLIENT_CREATE_DENIED",
    }, { status: 403 }))
  }
  const access = await resolveWorkspaceAccess(auth.userId)
  if (!access.ok || access.mode === "client") {
    return noStore(NextResponse.json(
      {
        error: access.ok
          ? "客户专属账号不能新建其他客户"
          : access.message,
        code: "CLIENT_ACCOUNT_READ_ONLY",
      },
      { status: 403 },
    ))
  }
  if (requestTooLarge(request)) {
    return noStore(NextResponse.json({ error: "客户数据超过单次上传限制" }, { status: 413 }))
  }
  try {
    const body = await request.json() as { client?: unknown }
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) {
      throw new WorkspaceValidationError("客户数据超过单次上传限制")
    }
    const synced = await createWorkspaceClient(access.ownerUserId, body.client)
    return noStore(NextResponse.json(synced, { status: 201 }))
  } catch (error) {
    if (error instanceof WorkspaceValidationError || error instanceof SyntaxError) {
      const message = error instanceof Error ? error.message : "客户数据格式无效"
      return noStore(NextResponse.json({ error: message }, { status: 400 }))
    }
    console.error("[workspace-clients] create failed", error)
    return noStore(NextResponse.json({ error: "云端客户创建失败" }, { status: 503 }))
  }
}

function requestTooLarge(request: NextRequest): boolean {
  const contentLength = Number(request.headers.get("content-length") || 0)
  return Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  response.headers.set("Pragma", "no-cache")
  return response
}
