import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import {
  acquireJobRequest,
  jobIdFromRequest,
  normalizeJobRequestId,
  releaseJobRequestClaim,
  type JobRequestClaim,
} from "@/lib/job-request-idempotency"
import { getFeaturePrice } from "@/lib/pricing"
import { getReportBrandingAccess } from "@/lib/report-access"
import {
  createCommercialReportJob,
  getCommercialReportJob,
  listCommercialReportJobs,
} from "@/lib/reports/report-jobs"
import { validateReportBranding } from "@/lib/reports/report-branding-store"
import {
  refundReservedCreditsOnce,
  requireUserId,
  reserveCreditsForUser,
  type CreditReservation,
} from "@/lib/with-credits"
import type {
  CommercialReportDetail,
  CommercialReportInput,
  CommercialReportKind,
  DifficultyAssessmentEntry,
  PenetrationResult,
} from "@/types"
import {
  requireStandardAccountMode,
  resolveWorkspaceAccess,
} from "@/lib/client-accounts"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const MAX_REPORT_PAYLOAD_BYTES = 20 * 1024 * 1024
const REPORT_KINDS = new Set<CommercialReportKind>(["combined", "penetration", "difficulty"])
const REPORT_DETAILS = new Set<CommercialReportDetail>(["concise", "full"])
const MODEL_KEYS = new Set(["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function limitedString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .map(item => limitedString(item, maxLength))
    .filter(Boolean)
}

function validPenetration(value: unknown): value is PenetrationResult {
  if (!isRecord(value) || !isRecord(value.byModel) || !isRecord(value.aggregated)) return false
  if (typeof value.generatedAt !== "string") return false

  let totalAnswers = 0
  for (const [model, items] of Object.entries(value.byModel)) {
    if (!MODEL_KEYS.has(model) || !Array.isArray(items) || items.length > 600) return false
    totalAnswers += items.length
    if (totalAnswers > 3_600) return false
    for (const item of items) {
      if (!isRecord(item) || typeof item.question !== "string" || typeof item.answer !== "string") return false
      if (!Array.isArray(item.mentionedBrands)) return false
      if (item.hitOur !== undefined && typeof item.hitOur !== "boolean") return false
      if (item.searchSources !== undefined && (!Array.isArray(item.searchSources) || item.searchSources.length > 200)) return false
    }
  }

  const aggregated = value.aggregated
  return typeof aggregated.penetrationRate === "number"
    && typeof aggregated.ourMentions === "number"
    && typeof aggregated.totalSlots === "number"
    && Array.isArray(aggregated.industryShare)
    && aggregated.industryShare.length <= 1_000
    && Array.isArray(aggregated.perModelRate)
    && aggregated.perModelRate.length <= 6
    && Array.isArray(aggregated.missedQuestions)
    && aggregated.missedQuestions.length <= 600
    && Array.isArray(aggregated.topCompetitors)
}

function validDifficulty(value: unknown): value is DifficultyAssessmentEntry {
  if (!isRecord(value) || !isRecord(value.result) || !isRecord(value.result.dimensions)) return false
  return typeof value.id === "string"
    && typeof value.industry === "string"
    && typeof value.city === "string"
    && typeof value.createdAt === "string"
    && typeof value.result.totalScore === "number"
    && typeof value.result.level === "string"
    && typeof value.result.summary === "string"
    && Object.keys(value.result.dimensions).length <= 50
    && Array.isArray(value.result.insights)
    && Array.isArray(value.result.suggestions)
}

function parseInput(value: unknown): CommercialReportInput | null {
  if (!isRecord(value) || !isRecord(value.client)) return null
  const kind = value.kind as CommercialReportKind
  const detail = value.detail as CommercialReportDetail
  if (!REPORT_KINDS.has(kind) || !REPORT_DETAILS.has(detail)) return null

  const client = {
    id: limitedString(value.client.id, 160),
    name: limitedString(value.client.name, 160),
    ourBrand: limitedString(value.client.ourBrand, 160),
    brandAliases: stringList(value.client.brandAliases, 100, 160),
    industry: limitedString(value.client.industry, 240),
    website: limitedString(value.client.website, 2_000),
  }
  if (!client.id || !client.name) return null

  const penetration = value.penetration === undefined ? undefined : value.penetration
  const difficulty = value.difficulty === undefined ? undefined : value.difficulty
  if (penetration !== undefined && !validPenetration(penetration)) return null
  if (difficulty !== undefined && !validDifficulty(difficulty)) return null
  if (kind === "penetration" && !penetration) return null
  if (kind === "difficulty" && !difficulty) return null
  if (kind === "combined" && !penetration && !difficulty) return null

  return {
    kind,
    detail,
    branding: validateReportBranding(value.branding),
    client,
    penetration: penetration as PenetrationResult | undefined,
    difficulty: difficulty as DifficultyAssessmentEntry | undefined,
  }
}

export async function GET(req: NextRequest) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response

  const params = req.nextUrl.searchParams
  const clientId = limitedString(params.get("clientId"), 160)
  const kind = limitedString(params.get("kind"), 32)
  const status = limitedString(params.get("status"), 32)
  const days = Math.max(0, Math.min(365, Number(params.get("days") || 0)))
  const cutoff = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0

  const access = await resolveWorkspaceAccess(userGuard.userId, clientId || undefined)
  if (!access.ok) {
    return NextResponse.json({ error: access.message, code: access.code }, { status: 403 })
  }
  let jobs = await listCommercialReportJobs(access.ownerUserId)
  const scopedClientId = access.mode === "client" ? access.clientId : clientId
  if (scopedClientId) jobs = jobs.filter(job => job.clientId === scopedClientId)
  if (REPORT_KINDS.has(kind as CommercialReportKind)) jobs = jobs.filter(job => job.kind === kind)
  if (["queued", "running", "succeeded", "failed"].includes(status)) {
    jobs = jobs.filter(job => job.status === status)
  }
  if (cutoff) jobs = jobs.filter(job => Date.parse(job.createdAt) >= cutoff)

  return NextResponse.json(
    { jobs, retentionDays: 365, limit: 100 },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}

export async function POST(req: NextRequest) {
  let reservation: CreditReservation | null = null
  let refundOperationId: string | null = null
  let requestClaim: JobRequestClaim | null = null
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response
    const accountAccess = await requireStandardAccountMode(userGuard.userId)
    if (!accountAccess.ok) {
      return NextResponse.json(
        { error: accountAccess.message, code: "CLIENT_ACCOUNT_READ_ONLY" },
        { status: 403 },
      )
    }

    const contentLength = Number(req.headers.get("content-length") || 0)
    if (contentLength > MAX_REPORT_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "报告数据过大，请选择精简版后重试" }, { status: 413 })
    }

    const body = await req.json()
    const requestId = normalizeJobRequestId(isRecord(body) ? body.requestId : undefined)
    const jobId = jobIdFromRequest("rjob", userGuard.userId, requestId)
    const input = parseInput(isRecord(body) ? body.input : null)
    if (!input) {
      return NextResponse.json({ error: "报告数据不完整或格式异常" }, { status: 400 })
    }
    if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_REPORT_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "报告数据过大，请选择精简版后重试" }, { status: 413 })
    }

    let creditCost = 0
    if (input.branding?.mode === "custom") {
      const access = await getReportBrandingAccess(userGuard.userId)
      if (!access.canUseCustomBranding) {
        return NextResponse.json({
          error: "充值任意套餐并到账后，即可解锁白标报告",
          code: "VIP_REQUIRED",
          access,
        }, { status: 403 })
      }
      creditCost = access.customReportCredits
    }

    const acquired = await acquireJobRequest({
      namespace: "commercial-report",
      ownerUserId: userGuard.userId,
      requestId,
      existingJobId: jobId,
      loadExisting: id => getCommercialReportJob(id, userGuard.userId),
    })
    if (acquired.status === "existing") {
      return NextResponse.json(acquired.job, { status: 202 })
    }
    if (acquired.status === "pending") {
      return NextResponse.json({ error: "报告任务正在创建，请稍后自动重试" }, { status: 409 })
    }
    requestClaim = acquired.claim

    if (creditCost > 0) {
      const featureKey = "reportCustomBranding"
      const creditGuard = await reserveCreditsForUser(userGuard.userId, creditCost, {
        featureKey,
        source: "api:reports:jobs",
        sourceId: jobId,
        description: getFeaturePrice(featureKey).label,
        metadata: {
          clientId: input.client.id,
          reportKind: input.kind,
          reportDetail: input.detail,
          requestId,
        },
      })
      if (!creditGuard.ok) {
        await releaseJobRequestClaim(requestClaim)
        requestClaim = null
        return creditGuard.response
      }
      reservation = creditGuard.reservation
      refundOperationId = `rrefund_${randomUUID().replace(/-/g, "")}`
    }

    const job = await createCommercialReportJob({
      id: jobId,
      input,
      ownerUserId: userGuard.userId,
      requestId,
      creditCost,
      reservation: reservation || undefined,
      refundOperationId: refundOperationId || undefined,
    })
    reservation = null
    refundOperationId = null
    await releaseJobRequestClaim(requestClaim)
    requestClaim = null
    return NextResponse.json(job, { status: 202 })
  } catch (error) {
    await releaseJobRequestClaim(requestClaim)
    if (reservation && refundOperationId) {
      try {
        await refundReservedCreditsOnce(reservation, refundOperationId)
      } catch (refundError) {
        console.error("[reports] failed to refund report reservation", refundError)
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建专业报告任务失败" },
      { status: 400 },
    )
  }
}
