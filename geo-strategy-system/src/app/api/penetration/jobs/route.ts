import { NextRequest, NextResponse } from "next/server"
import { ADAPTERS } from "@/lib/llm"
import { createPenetrationJob, getPenetrationJob, type PenetrationJobRequest } from "@/lib/penetration/jobs"
import {
  acquireJobRequest,
  jobIdFromRequest,
  normalizeJobRequestId,
  releaseJobRequestClaim,
  type JobRequestClaim,
} from "@/lib/job-request-idempotency"
import {
  refundReservedCreditsQuietly,
  requireUserId,
  reserveCreditsForUser,
  type CreditReservation,
} from "@/lib/with-credits"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"
import { listWorkspaceClients } from "@/lib/workspace-store"
import { getPenetrationModelReadiness } from "@/lib/penetration/model-readiness"
import type { ModelKey, PenetrationJobOperation, PenetrationResult } from "@/types"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"

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
  let requestClaim: JobRequestClaim | null = null
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response

    const body = await req.json()
    const requestedModels = stringList(body.models).filter(
      (model): model is ModelKey => model in ADAPTERS,
    )
    const questions = stringList(body.questions)
    const requestedOurBrand = String(body.ourBrand || "").trim()
    const clientId = String(body.clientId || "").trim()
    const requestId = normalizeJobRequestId(body.requestId)
    const jobId = jobIdFromRequest("pjob", userGuard.userId, requestId)
    const operation: PenetrationJobOperation = body.operation === "append" ? "append" : "replace"

    if (!clientId) return NextResponse.json({ error: "客户标识缺失，请刷新页面后重试" }, { status: 400 })
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

    const access = await resolveWorkspaceAccess(userGuard.userId, clientId)
    if (!access.ok) {
      return NextResponse.json(
        { error: access.message, code: access.code },
        { status: 403 },
      )
    }
    const currentClient = (await listWorkspaceClients(access.ownerUserId))
      .find(item => item.client.id === clientId)?.client
    if (!currentClient) {
      return NextResponse.json({ error: "当前客户不存在或已被删除，请刷新页面后重试" }, { status: 404 })
    }
    const ourBrand = access.mode === "client"
      ? currentClient.ourBrand.trim()
      : requestedOurBrand
    if (!ourBrand) return NextResponse.json({ error: "请填写我方品牌名" }, { status: 400 })
    const brandAliases = access.mode === "client"
      ? currentClient.brandAliases ?? []
      : stringList(body.brandAliases)
    const competitors = access.mode === "client"
      ? currentClient.competitors
      : stringList(body.competitors)
    const industry = access.mode === "client"
      ? currentClient.industry
      : String(body.industry || "").trim()

    const readiness = await Promise.all(requestedModels.map(getPenetrationModelReadiness))
    const activeModels = readiness.filter(item => item.ready).map(item => item.model)
    const skipped = readiness
      .filter(item => !item.ready)
      .map(item => `${ADAPTERS[item.model].label}（${item.reason || "严格联网预检未通过"}）`)
    if (activeModels.length === 0) {
      return NextResponse.json(
        { error: `所选模型均未通过严格联网预检：${skipped.join("、")}`, skipped },
        { status: 400 },
      )
    }

    const acquired = await acquireJobRequest({
      namespace: "penetration",
      ownerUserId: userGuard.userId,
      requestId,
      existingJobId: jobId,
      loadExisting: id => getPenetrationJob(id, userGuard.userId),
    })
    if (acquired.status === "existing") {
      return NextResponse.json(acquired.job, { status: 202 })
    }
    if (acquired.status === "pending") {
      return NextResponse.json({ error: "检测任务正在创建，系统会自动重试" }, { status: 409 })
    }
    requestClaim = acquired.claim

    const request: PenetrationJobRequest = {
      clientId,
      clientName: currentClient.name,
      runId: requestId,
      operation,
      ourBrand,
      brandAliases,
      industry,
      website: currentClient.website,
      questions,
      competitors,
      selectedModels: requestedModels,
      models: activeModels,
    }
    const baseResult: PenetrationResult | undefined = operation === "append"
      ? currentClient.penetration
      : undefined
    const slotCount = questions.length * activeModels.length
    const credits = estimateFeatureCredits("penetrationSlot", slotCount)
    const creditGuard = await reserveCreditsForUser(userGuard.userId, credits, {
      featureKey: "penetrationSlot",
      source: "api:penetration:jobs",
      sourceId: jobId,
      description: getFeaturePrice("penetrationSlot").label,
      metadata: {
        clientId,
        modelCount: activeModels.length,
        questionCount: questions.length,
        slotCount,
      },
    })
    if (!creditGuard.ok) {
      await releaseJobRequestClaim(requestClaim)
      requestClaim = null
      return creditGuard.response
    }
    reservation = creditGuard.reservation

    const job = await createPenetrationJob({
      id: jobId,
      request,
      ownerUserId: userGuard.userId,
      workspaceOwnerUserId: access.ownerUserId,
      reservation,
      skipped,
      baseResult,
    })
    reservation = null
    await releaseJobRequestClaim(requestClaim)
    requestClaim = null
    return NextResponse.json(job, { status: 202 })
  } catch (error) {
    await releaseJobRequestClaim(requestClaim)
    await refundReservedCreditsQuietly(reservation)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建疑问句检测任务失败" },
      { status: 400 },
    )
  }
}
