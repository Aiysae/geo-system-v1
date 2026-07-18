import { NextRequest, NextResponse } from "next/server"
import {
  configuredDifficultyModels,
  DIFFICULTY_MODEL_ORDER,
  normalizeDifficultyInput,
} from "@/lib/difficulty/assessment"
import { createDifficultyJob, getDifficultyJob } from "@/lib/difficulty/jobs"
import {
  acquireJobRequest,
  jobIdFromRequest,
  normalizeJobRequestId,
  releaseJobRequestClaim,
  type JobRequestClaim,
} from "@/lib/job-request-idempotency"
import { ADAPTERS, MODEL_LABELS } from "@/lib/llm"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"
import { listWorkspaceClients } from "@/lib/workspace-store"
import {
  refundReservedCreditsQuietly,
  requireUserId,
  reserveCreditsForUser,
  type CreditReservation,
} from "@/lib/with-credits"
import type { DifficultyModelSelection, ModelKey } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

function requestedModel(value: unknown): DifficultyModelSelection {
  if (value === "auto" || value === undefined || value === null || value === "") return "auto"
  if (typeof value === "string" && value in ADAPTERS) return value as ModelKey
  throw new Error("请选择有效的测评模型")
}

export async function GET() {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  const models = await Promise.all(
    DIFFICULTY_MODEL_ORDER.map(async key => ({
      key,
      label: MODEL_LABELS[key],
      configured: await ADAPTERS[key].configured(),
    })),
  )
  return NextResponse.json({ models }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  let reservation: CreditReservation | null = null
  let requestClaim: JobRequestClaim | null = null
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response

    const body = await req.json()
    const clientId = String(body.clientId || "").trim()
    if (!clientId) {
      return NextResponse.json({ error: "客户标识缺失，请刷新页面后重试" }, { status: 400 })
    }
    const requestId = normalizeJobRequestId(body.requestId)
    const jobId = jobIdFromRequest("djob", userGuard.userId, requestId)
    const request = normalizeDifficultyInput(body)
    try {
      const workspaceClient = (await listWorkspaceClients(userGuard.userId))
        .find(item => item.client.id === clientId)?.client
      if (workspaceClient) {
        request.subjectType = workspaceClient.subjectType
        request.personProfile = workspaceClient.personProfile
      }
      const penetration = workspaceClient?.penetration
      if (penetration) {
        request.penetrationEvidence = {
          generatedAt: penetration.generatedAt,
          totalSlots: penetration.aggregated.totalSlots,
          topCompetitors: penetration.aggregated.topCompetitors.slice(0, 30),
          industryShare: penetration.aggregated.industryShare.slice(0, 30).map(item => ({
            brand: item.brand,
            count: item.count,
            ratio: item.ratio,
          })),
        }
      }
    } catch (error) {
      console.warn("[difficulty-assessment] penetration evidence unavailable", error instanceof Error ? error.message : "unknown")
    }
    const selected = requestedModel(body.model)
    if (selected !== "auto" && !await ADAPTERS[selected].configured()) {
      return NextResponse.json(
        { error: `${MODEL_LABELS[selected]}尚未配置可用的 API Key，请换一个模型或选择自动推荐` },
        { status: 400 },
      )
    }

    const modelCandidates = await configuredDifficultyModels(selected === "auto" ? undefined : selected)
    if (modelCandidates.length === 0) {
      return NextResponse.json(
        { error: "没有任何已配置的大模型可用，请先在后台管理页配置至少一个 API Key" },
        { status: 400 },
      )
    }

    const acquired = await acquireJobRequest({
      namespace: "difficulty",
      ownerUserId: userGuard.userId,
      requestId,
      existingJobId: jobId,
      loadExisting: id => getDifficultyJob(id, userGuard.userId),
    })
    if (acquired.status === "existing") {
      return NextResponse.json(acquired.job, { status: 202 })
    }
    if (acquired.status === "pending") {
      return NextResponse.json({ error: "测评任务正在创建，系统会自动重试" }, { status: 409 })
    }
    requestClaim = acquired.claim

    const featureKey = "difficultyAssessment"
    const cost = estimateFeatureCredits(featureKey)
    const creditGuard = await reserveCreditsForUser(userGuard.userId, cost, {
      featureKey,
      source: "api:difficulty-assessment:jobs",
      sourceId: jobId,
      description: getFeaturePrice(featureKey).label,
      metadata: {
        clientId,
        mode: request.mode,
        subjectType: request.subjectType,
        requestedModel: selected,
      },
    })
    if (!creditGuard.ok) {
      await releaseJobRequestClaim(requestClaim)
      requestClaim = null
      return creditGuard.response
    }
    reservation = creditGuard.reservation

    const job = await createDifficultyJob({
      id: jobId,
      clientId,
      request,
      requestedModel: selected,
      modelCandidates,
      ownerUserId: userGuard.userId,
      reservation,
    })
    reservation = null
    await releaseJobRequestClaim(requestClaim)
    requestClaim = null
    return NextResponse.json(job, { status: 202 })
  } catch (error) {
    await releaseJobRequestClaim(requestClaim)
    await refundReservedCreditsQuietly(reservation)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建难度测评任务失败" },
      { status: 400 },
    )
  }
}
