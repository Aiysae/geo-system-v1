import { NextRequest, NextResponse } from "next/server"
import { cancelBackgroundJob, getBackgroundJobByRequest } from "@/lib/background-jobs"
import {
  NO_STORE_HEADERS,
  reconcileVideoItemWithJob,
  requireVideoItemAccess,
  videoProductionErrorStatus,
} from "@/lib/video-production/access"
import {
  deleteVideoProductionItem,
  patchVideoProductionItem,
  toPublicVideoProductionItem,
} from "@/lib/video-production/store"
import { requireUserId } from "@/lib/with-credits"
import type { VideoScript, VideoScriptSegment } from "@/types/video-production"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ itemId: string }> }

function notFound() {
  return NextResponse.json({ error: "视频任务不存在或无权访问" }, { status: 404, headers: NO_STORE_HEADERS })
}

function failure(error: unknown, fallback: string) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: videoProductionErrorStatus(error), headers: NO_STORE_HEADERS },
  )
}

function editedText(value: unknown, current: string | undefined, max: number): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, max) : current
}

/** Applies the user's text edits; images, ids and timings stay as generated. */
function editedScript(script: VideoScript, input: Record<string, unknown>, tagCount: number): VideoScript {
  const segmentEdits = new Map(
    (Array.isArray(input.segments) ? input.segments : [])
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map(entry => [String(entry.id || ""), entry]),
  )
  const segments = script.segments.map((segment): VideoScriptSegment => {
    const edit = segmentEdits.get(segment.id)
    if (!edit) return segment
    return {
      ...segment,
      voiceover: editedText(edit.voiceover, segment.voiceover, 600) || segment.voiceover,
      screenText: editedText(edit.screenText, segment.screenText, 40),
      imageBrief: editedText(edit.imageBrief, segment.imageBrief, 400),
      action: editedText(edit.action, segment.action, 80),
      broll: editedText(edit.broll, segment.broll, 200),
    }
  })
  const tags = Array.isArray(input.tags)
    ? Array.from(new Set(input.tags
        .map(tag => String(tag || "").trim().replace(/^#+/, "").replace(/[\s#]+/g, ""))
        .filter(Boolean)
        .map(tag => `#${tag.slice(0, 40)}`))).slice(0, Math.max(tagCount, 30))
    : script.tags
  return {
    ...script,
    title: editedText(input.title, script.title, 60) || script.title,
    coverTitle: editedText(input.coverTitle, script.coverTitle, 40) || script.coverTitle,
    description: editedText(input.description, script.description, 800) ?? script.description,
    tags,
    segments,
  }
}

export async function GET(_req: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { itemId } = await context.params
    const authorized = await requireVideoItemAccess({ itemId, userId: auth.userId, action: "view" })
    if (!authorized) return notFound()
    const item = await reconcileVideoItemWithJob(authorized.item)
    return NextResponse.json({ item: toPublicVideoProductionItem(item) }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return failure(error, "读取视频任务失败")
  }
}

export async function PATCH(req: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { itemId } = await context.params
    const authorized = await requireVideoItemAccess({ itemId, userId: auth.userId, action: "edit" })
    if (!authorized) return notFound()
    if (!authorized.item.script || authorized.item.status !== "succeeded") {
      return NextResponse.json({ error: "文案生成完成后才能修改" }, { status: 409, headers: NO_STORE_HEADERS })
    }
    const body = await req.json() as Record<string, unknown>
    const saved = await patchVideoProductionItem(itemId, current => ({
      script: current.script
        ? editedScript(current.script, body, current.settings.tagCount)
        : current.script,
    }))
    if (!saved) return notFound()
    return NextResponse.json({ item: toPublicVideoProductionItem(saved) }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return failure(error, "保存失败")
  }
}

/** Stops a queued or running video (the job refunds its credits) or deletes a finished one. */
export async function DELETE(_req: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { itemId } = await context.params
    const authorized = await requireVideoItemAccess({ itemId, userId: auth.userId, action: "edit" })
    if (!authorized) return notFound()
    const { item } = authorized
    if (item.status === "queued" || item.status === "running") {
      const job = await getBackgroundJobByRequest(item.createdByUserId, "videoProduction", item.requestId)
      if (job) await cancelBackgroundJob(job.id, item.createdByUserId)
      const saved = await patchVideoProductionItem(itemId, { status: "cancelled", stage: undefined, error: "任务已停止" })
      return NextResponse.json(
        { item: saved ? toPublicVideoProductionItem(saved) : null },
        { headers: NO_STORE_HEADERS },
      )
    }
    await deleteVideoProductionItem(item)
    return NextResponse.json({ deleted: true }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return failure(error, "操作失败")
  }
}
