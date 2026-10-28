import { NextRequest, NextResponse } from "next/server"
import {
  createBackgroundJob,
  createBackgroundJobsBatch,
} from "@/lib/background-jobs"
import { kv } from "@/lib/kv"
import { requireOperationAccess } from "@/lib/team-access"
import {
  NO_STORE_HEADERS,
  reconcileVideoItemWithJob,
  videoProductionErrorStatus,
} from "@/lib/video-production/access"
import { normalizeVideoProductionSettings } from "@/lib/video-production/options"
import {
  deleteVideoProductionItem,
  getVideoProductionItem,
  listVideoProductionItems,
  newVideoProductionId,
  saveVideoProductionItem,
  toPublicVideoProductionItem,
  type StoredVideoProductionItem,
} from "@/lib/video-production/store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const MAX_QUESTIONS = 50

export async function GET(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const clientId = String(req.nextUrl.searchParams.get("clientId") || "").trim()
    if (!clientId) return NextResponse.json({ error: "缺少客户" }, { status: 400, headers: NO_STORE_HEADERS })
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "article",
      action: "view",
      teamId: String(req.nextUrl.searchParams.get("teamId") || "").trim() || undefined,
    })
    const items = await listVideoProductionItems(access.dataOwnerUserId, clientId)
    const reconciled = await Promise.all(items.map(item => reconcileVideoItemWithJob(item)))
    return NextResponse.json(
      { items: reconciled.map(toPublicVideoProductionItem) },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取视频任务失败" },
      { status: videoProductionErrorStatus(error), headers: NO_STORE_HEADERS },
    )
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as Record<string, unknown>
    const clientId = String(body.clientId || "").trim()
    const requestId = String(body.requestId || "").trim()
    if (!clientId) return NextResponse.json({ error: "缺少客户" }, { status: 400, headers: NO_STORE_HEADERS })
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestId)) {
      return NextResponse.json({ error: "请求编号无效，请刷新后重试" }, { status: 400, headers: NO_STORE_HEADERS })
    }
    const seen = new Set<string>()
    const questions = (Array.isArray(body.questions) ? body.questions : [])
      .map(entry => {
        const value = entry && typeof entry === "object" ? entry as Record<string, unknown> : {}
        return {
          question: String(value.question || "").trim().slice(0, 300),
          advantage: String(value.advantage || "").trim().slice(0, 1_000),
        }
      })
      .filter(entry => entry.question && !seen.has(entry.question) && seen.add(entry.question))
    if (questions.length === 0) {
      return NextResponse.json({ error: "请至少选择一个疑问句" }, { status: 400, headers: NO_STORE_HEADERS })
    }
    if (questions.length > MAX_QUESTIONS) {
      return NextResponse.json({ error: `单次最多生成 ${MAX_QUESTIONS} 条视频` }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "article",
      action: "execute",
      teamId: String(body.teamId || "").trim() || undefined,
    })
    const requestKey = `geo:video-production:request:${access.actorUserId}:${requestId}`
    const existingBatch = await kv.get<string>(requestKey)
    if (existingBatch) {
      const items = (await listVideoProductionItems(access.dataOwnerUserId, clientId))
        .filter(item => item.batchId === existingBatch)
      return NextResponse.json({ items: items.map(toPublicVideoProductionItem) }, { headers: NO_STORE_HEADERS })
    }
    const batchId = newVideoProductionId("vpb")
    if (!await kv.set(requestKey, batchId, { nx: true, ex: 60 * 60 * 24 })) {
      return NextResponse.json({ error: "任务正在创建，请稍后刷新" }, { status: 409, headers: NO_STORE_HEADERS })
    }

    const settings = normalizeVideoProductionSettings(body.settings)
    const now = new Date().toISOString()
    const items: StoredVideoProductionItem[] = questions.map(entry => {
      const id = newVideoProductionId("vpi")
      return {
        id,
        batchId,
        clientId,
        teamId: access.teamId,
        question: entry.question,
        advantage: entry.advantage,
        settings,
        status: "queued",
        stage: "等待生成",
        dataOwnerUserId: access.dataOwnerUserId,
        createdByUserId: access.actorUserId,
        requestId: id,
        createdAt: now,
        updatedAt: now,
      }
    })
    for (const item of items) await saveVideoProductionItem(item)

    const jobArgs = {
      kind: "videoProduction" as const,
      clientId,
      ownerUserId: access.actorUserId,
      billingUserId: access.billingUserId,
      runtimeUserId: access.billingUserId,
      workspaceOwnerUserId: access.dataOwnerUserId,
      teamId: access.teamId,
    }
    const jobPayload = (item: StoredVideoProductionItem) => ({ itemId: item.id, type: settings.type })
    const result = items.length === 1
      ? await createBackgroundJob({ ...jobArgs, requestId: items[0].requestId, payload: jobPayload(items[0]) })
      : await createBackgroundJobsBatch({
          ...jobArgs,
          batchId,
          items: items.map(item => ({ requestId: item.requestId, payload: jobPayload(item) })),
        })
    if (!result.ok) {
      for (const item of items) await deleteVideoProductionItem(item)
      await kv.del(requestKey)
      return result.response
    }
    // Jobs are found again by request id, so nothing races the run endpoint's writes here.
    const saved = await Promise.all(items.map(async item => await getVideoProductionItem(item.id) || item))
    return NextResponse.json(
      { items: saved.map(toPublicVideoProductionItem) },
      { status: 202, headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建视频任务失败" },
      { status: videoProductionErrorStatus(error), headers: NO_STORE_HEADERS },
    )
  }
}
