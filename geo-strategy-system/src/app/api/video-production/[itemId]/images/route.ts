import { NextRequest, NextResponse } from "next/server"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"
import {
  NO_STORE_HEADERS,
  requireVideoItemAccess,
  videoProductionErrorStatus,
} from "@/lib/video-production/access"
import { imageWithStyle } from "@/lib/video-production/generate"
import { generateVideoImage } from "@/lib/video-production/images"
import { isVideoImageModel } from "@/lib/video-production/options"
import {
  patchVideoProductionItem,
  toPublicVideoProductionItem,
} from "@/lib/video-production/store"
import {
  refundReservedCreditsQuietly,
  requireUserId,
  reserveCreditsForUser,
  type CreditReservation,
} from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const FEATURE_KEY = "videoProductionImage"

/** Regenerates the cover or one page image, optionally from an edited prompt. */
export async function POST(req: NextRequest, context: { params: Promise<{ itemId: string }> }) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  let reservation: CreditReservation | null = null
  try {
    const { itemId } = await context.params
    const authorized = await requireVideoItemAccess({ itemId, userId: auth.userId, action: "execute" })
    if (!authorized) {
      return NextResponse.json({ error: "视频任务不存在或无权访问" }, { status: 404, headers: NO_STORE_HEADERS })
    }
    const { item, access } = authorized
    const script = item.script
    if (!script || item.status !== "succeeded") {
      return NextResponse.json({ error: "文案生成完成后才能重新生成图片" }, { status: 409, headers: NO_STORE_HEADERS })
    }
    const body = await req.json() as { target?: string; prompt?: string; imageModel?: string }
    const target = String(body.target || "cover")
    const segmentIndex = target === "cover" ? -1 : script.segments.findIndex(segment => segment.id === target)
    if (target !== "cover" && segmentIndex < 0) {
      return NextResponse.json({ error: "找不到这一页" }, { status: 404, headers: NO_STORE_HEADERS })
    }
    const previous = segmentIndex < 0 ? item.cover : script.segments[segmentIndex].image
    const fallbackBrief = segmentIndex < 0
      ? script.coverImageBrief
      : script.segments[segmentIndex].imageBrief || script.segments[segmentIndex].voiceover
    const prompt = String(body.prompt || "").trim().slice(0, 800) || previous?.prompt || fallbackBrief
    const model = isVideoImageModel(body.imageModel) ? body.imageModel : item.settings.imageModel

    const credits = estimateFeatureCredits(FEATURE_KEY)
    const creditGuard = await reserveCreditsForUser(access.billingUserId, credits, {
      featureKey: FEATURE_KEY,
      source: "api:video-production:images",
      sourceId: itemId,
      description: getFeaturePrice(FEATURE_KEY).label,
      metadata: { clientId: item.clientId, target, actorUserId: access.actorUserId, teamId: access.teamId },
    })
    if (!creditGuard.ok) return creditGuard.response
    reservation = creditGuard.reservation

    const image = await generateVideoImage({
      prompt: imageWithStyle(prompt, item.settings),
      model,
      ownerUserId: item.dataOwnerUserId,
      clientId: item.clientId,
      itemId,
      name: segmentIndex < 0 ? "封面" : `第${segmentIndex + 1}页`,
      signal: req.signal,
    })
    if (image.status !== "succeeded") {
      await refundReservedCreditsQuietly(reservation)
      reservation = null
      return NextResponse.json(
        { error: `${image.error || "生图失败"}，已退回积分` },
        { status: 502, headers: NO_STORE_HEADERS },
      )
    }
    reservation = null
    const saved = await patchVideoProductionItem(itemId, current => {
      if (!current.script) return {}
      if (segmentIndex < 0) return { cover: image }
      return {
        script: {
          ...current.script,
          segments: current.script.segments.map(segment => (
            segment.id === target ? { ...segment, image } : segment
          )),
        },
      }
    })
    return NextResponse.json(
      { item: saved ? toPublicVideoProductionItem(saved) : null },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    await refundReservedCreditsQuietly(reservation)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "重新生成图片失败" },
      { status: videoProductionErrorStatus(error), headers: NO_STORE_HEADERS },
    )
  }
}
