import { NextRequest, NextResponse } from "next/server"
import { ADAPTERS } from "@/lib/llm"
import { createPenetrationJob, type PenetrationJobRequest } from "@/lib/penetration/jobs"
import {
  refundReservedCreditsQuietly,
  requireUserId,
  reserveCreditsForUser,
  type CreditReservation,
} from "@/lib/with-credits"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"
import type { ModelKey } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const MAX_PENETRATION_QUESTIONS = 600

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : []
}

export async function POST(req: NextRequest) {
  let reservation: CreditReservation | null = null
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response

    const body = await req.json()
    const requestedModels = stringList(body.models).filter(
      (model): model is ModelKey => model in ADAPTERS,
    )
    const questions = stringList(body.questions)
    const ourBrand = String(body.ourBrand || "").trim()
    const clientId = String(body.clientId || "").trim()

    if (!clientId) return NextResponse.json({ error: "客户标识缺失，请刷新页面后重试" }, { status: 400 })
    if (!ourBrand) return NextResponse.json({ error: "请填写我方品牌名" }, { status: 400 })
    if (questions.length === 0) return NextResponse.json({ error: "请至少提供一个疑问句" }, { status: 400 })
    if (questions.length > MAX_PENETRATION_QUESTIONS) {
      return NextResponse.json(
        { error: `单次最多检测 ${MAX_PENETRATION_QUESTIONS} 条疑问句` },
        { status: 400 },
      )
    }
    if (requestedModels.length === 0) {
      return NextResponse.json({ error: "请至少选择一个模型" }, { status: 400 })
    }

    const configured = await Promise.all(
      requestedModels.map(async model => ({ model, configured: await ADAPTERS[model].configured() })),
    )
    const activeModels = configured.filter(item => item.configured).map(item => item.model)
    const skipped = configured.filter(item => !item.configured).map(item => ADAPTERS[item.model].label)
    if (activeModels.length === 0) {
      return NextResponse.json(
        { error: `所选模型均未配置 API Key（缺失：${skipped.join("、")}）`, skipped },
        { status: 400 },
      )
    }

    const request: PenetrationJobRequest = {
      clientId,
      ourBrand,
      brandAliases: stringList(body.brandAliases),
      industry: String(body.industry || "").trim(),
      questions,
      competitors: stringList(body.competitors),
      models: activeModels,
    }
    const slotCount = questions.length * activeModels.length
    const credits = estimateFeatureCredits("penetrationSlot", slotCount)
    const creditGuard = await reserveCreditsForUser(userGuard.userId, credits, {
      featureKey: "penetrationSlot",
      source: "api:penetration:jobs",
      description: getFeaturePrice("penetrationSlot").label,
      metadata: {
        clientId,
        modelCount: activeModels.length,
        questionCount: questions.length,
        slotCount,
      },
    })
    if (!creditGuard.ok) return creditGuard.response
    reservation = creditGuard.reservation

    const job = await createPenetrationJob({
      request,
      ownerUserId: userGuard.userId,
      reservation,
      skipped,
    })
    reservation = null
    return NextResponse.json(job, { status: 202 })
  } catch (error) {
    await refundReservedCreditsQuietly(reservation)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建疑问句检测任务失败" },
      { status: 400 },
    )
  }
}
