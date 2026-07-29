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
import { requireOperationAccess } from "@/lib/team-access"
import { hasTeamPermission } from "@/lib/team-permissions"
import {
  normalizeAnalysisSubjectType,
  normalizePersonSubjectProfile,
} from "@/lib/analysis-subject"
import { normalizePenetrationQuestionIntentHints } from "@/lib/penetration/sample-design"

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
    const hasSlotSelection = Array.isArray(body.slotSelection)
    const parsedSlotSelection = hasSlotSelection
      ? (body.slotSelection as unknown[]).map(value => {
          const entry = value && typeof value === "object"
            ? value as { model?: unknown; questionIndex?: unknown }
            : {}
          return {
            model: String(entry.model || "") as ModelKey,
            questionIndex: Number(entry.questionIndex),
          }
        })
      : []
    const questionIntents = normalizePenetrationQuestionIntentHints(
      body.questionIntents,
      questions,
    )
    const requestedOurBrand = String(body.ourBrand || "").trim()
    const requestedSubjectType = normalizeAnalysisSubjectType(body.subjectType)
    const requestedPersonProfile = normalizePersonSubjectProfile(body.personProfile)
    const clientId = String(body.clientId || "").trim()
    const requestId = normalizeJobRequestId(body.requestId)
    const jobId = jobIdFromRequest("pjob", userGuard.userId, requestId)
    const operation: PenetrationJobOperation = body.operation === "append" ? "append" : "replace"

    if (!clientId) return NextResponse.json({ error: "客户标识缺失，请刷新页面后重试" }, { status: 400 })
    if (hasSlotSelection && operation !== "append") {
      return NextResponse.json(
        { error: "未完成项重试必须追加到原报告，不能覆盖已有检测结果" },
        { status: 400 },
      )
    }
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
    if (
      hasSlotSelection
      && (
        parsedSlotSelection.length === 0
        || parsedSlotSelection.some(slot =>
          !requestedModels.includes(slot.model)
          || !Number.isInteger(slot.questionIndex)
          || slot.questionIndex < 0
          || slot.questionIndex >= questions.length
        )
      )
    ) {
      return NextResponse.json({ error: "未完成检测项参数无效，请刷新后重试" }, { status: 400 })
    }

    const access = await requireOperationAccess({
      userId: userGuard.userId,
      clientId,
      module: "penetration",
      action: "execute",
      teamId: String(body.teamId || "").trim() || undefined,
    })
    const currentClient = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(item => item.client.id === clientId)?.client
    if (!currentClient) {
      return NextResponse.json({ error: "当前客户不存在或已被删除，请刷新页面后重试" }, { status: 404 })
    }
    const identityLocked = access.mode === "client"
      || (access.mode === "team" && !hasTeamPermission(access.permissionKeys, "client", "edit"))
    const ourBrand = identityLocked
      ? currentClient.ourBrand.trim()
      : requestedOurBrand
    const subjectType = identityLocked
      ? normalizeAnalysisSubjectType(currentClient.subjectType)
      : requestedSubjectType
    const personProfile = identityLocked
      ? normalizePersonSubjectProfile(currentClient.personProfile)
      : requestedPersonProfile
    if (!ourBrand) {
      return NextResponse.json(
        { error: subjectType === "person" ? "请填写目标人物姓名" : "请填写我方品牌名" },
        { status: 400 },
      )
    }
    const brandAliases = identityLocked
      ? currentClient.brandAliases ?? []
      : stringList(body.brandAliases)
    const competitors = identityLocked
      ? currentClient.competitors
      : stringList(body.competitors)
    const industry = identityLocked
      ? currentClient.industry
      : String(body.industry || "").trim()

    const readiness = await Promise.all(requestedModels.map(getPenetrationModelReadiness))
    let activeModels = readiness.filter(item => item.ready).map(item => item.model)
    const skipped = readiness
      .filter(item => !item.ready)
      .map(item => `${ADAPTERS[item.model].label}（${item.reason || "严格联网预检未通过"}）`)
    if (activeModels.length === 0) {
      return NextResponse.json(
        { error: `所选模型均未通过严格联网预检：${skipped.join("、")}`, skipped },
        { status: 400 },
      )
    }
    const slotSelection = hasSlotSelection
      ? Array.from(
          new Map(
            parsedSlotSelection
              .filter(slot => activeModels.includes(slot.model))
              .map(slot => [`${slot.model}:${slot.questionIndex}`, slot]),
          ).values(),
        )
      : undefined
    if (hasSlotSelection && slotSelection?.length === 0) {
      return NextResponse.json(
        { error: `未完成项所需模型均未通过严格联网预检：${skipped.join("、")}` },
        { status: 400 },
      )
    }
    if (slotSelection) {
      const selectedModels = new Set(slotSelection.map(slot => slot.model))
      activeModels = activeModels.filter(model => selectedModels.has(model))
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
      subjectType,
      personProfile: subjectType === "person" ? personProfile : undefined,
      ourBrand,
      brandAliases,
      industry,
      website: currentClient.website,
      questions,
      questionIntents,
      competitors,
      selectedModels: requestedModels,
      models: activeModels,
      slotSelection,
    }
    const baseResult: PenetrationResult | undefined = operation === "append"
      ? currentClient.penetration
      : undefined
    const slotCount = slotSelection?.length || questions.length * activeModels.length
    const credits = estimateFeatureCredits("penetrationSlot", slotCount)
    const creditGuard = await reserveCreditsForUser(access.billingUserId, credits, {
      featureKey: "penetrationSlot",
      source: "api:penetration:jobs",
      sourceId: jobId,
      description: getFeaturePrice("penetrationSlot").label,
      metadata: {
        clientId,
        modelCount: activeModels.length,
        questionCount: questions.length,
        slotCount,
        selectiveRetry: Boolean(slotSelection),
        subjectType,
        actorUserId: access.actorUserId,
        billingUserId: access.billingUserId,
        workspaceOwnerUserId: access.dataOwnerUserId,
        teamId: access.teamId,
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
      ownerUserId: access.actorUserId,
      workspaceOwnerUserId: access.dataOwnerUserId,
      teamId: access.teamId,
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
    const forbidden = error instanceof Error && (
      error.name.startsWith("TEAM_")
      || error.name.startsWith("CLIENT_")
      || /权限|无权|只读|VIP4/.test(error.message)
    )
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建疑问句检测任务失败", code: error instanceof Error ? error.name : undefined },
      { status: forbidden ? 403 : 400 },
    )
  }
}
