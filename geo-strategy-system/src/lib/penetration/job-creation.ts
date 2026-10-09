import "server-only"

import { createHash, randomUUID } from "crypto"
import { ADAPTERS } from "@/lib/llm"
import { kv } from "@/lib/kv"
import { jobIdFromRequest, normalizeJobRequestId } from "@/lib/job-request-idempotency"
import {
  createPenetrationJob,
  getPenetrationJob,
  type PenetrationJobRequest,
} from "@/lib/penetration/jobs"
import { getPenetrationModelReadiness } from "@/lib/penetration/model-readiness"
import { normalizePenetrationQuestionIntentHints } from "@/lib/penetration/sample-design"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"
import { hasTeamPermission } from "@/lib/team-permissions"
import { requireOperationAccess, type OperationAccessContext } from "@/lib/team-access"
import {
  normalizeAnalysisSubjectType,
  normalizePersonSubjectProfile,
} from "@/lib/analysis-subject"
import {
  refundReservedCreditsQuietly,
  reserveCreditsForUser,
  type CreditReservation,
} from "@/lib/with-credits"
import { listWorkspaceClients, mutateWorkspaceClientLatest } from "@/lib/workspace-store"
import type {
  AnalysisSubjectType,
  Client,
  ModelKey,
  PenetrationJobOperation,
  PenetrationJobRecord,
  PersonSubjectProfile,
} from "@/types"

export const MAX_PENETRATION_QUESTIONS = 600

const CLIENT_CREATION_LOCK_SECONDS = 180

export class PenetrationJobSubmissionError extends Error {
  readonly status: number
  readonly details?: Record<string, unknown>

  constructor(message: string, status = 400, code?: string, details?: Record<string, unknown>) {
    super(message)
    this.name = code || "PENETRATION_JOB_SUBMISSION_ERROR"
    this.status = status
    this.details = details
  }
}

export type PenetrationJobSubmissionInput = {
  actorUserId: string
  clientId: string
  teamId?: string
  requestId: string
  operation?: PenetrationJobOperation
  questions?: unknown
  questionIntents?: unknown
  models?: unknown
  slotSelection?: unknown
  subjectType?: unknown
  personProfile?: unknown
  ourBrand?: unknown
  brandAliases?: unknown
  industry?: unknown
  competitors?: unknown
  useSavedInputs?: boolean
  requireAllModelsReady?: boolean
  origin?: "manual" | "automation"
  automationScheduleId?: string
  automationExecutionId?: string
  automationTrigger?: "scheduled" | "manual"
}

export type PenetrationJobSubmissionResult = {
  job: PenetrationJobRecord
  access: OperationAccessContext
  client: Client
  request: PenetrationJobRequest
  requestedModels: ModelKey[]
  activeModels: ModelKey[]
  skipped: string[]
  slotCount: number
  estimatedCredits: number
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : []
}

function uniqueModels(value: unknown): ModelKey[] {
  return Array.from(new Set(
    stringList(value).filter((model): model is ModelKey => model in ADAPTERS),
  ))
}

function clientLockKey(ownerUserId: string, clientId: string): string {
  const digest = createHash("sha256")
    .update(`${ownerUserId}\u0000${clientId}`)
    .digest("hex")
    .slice(0, 32)
  return `geo:penetration-client-create-lock:${digest}`
}

async function acquireClientLock(ownerUserId: string, clientId: string): Promise<{
  key: string
  token: string
}> {
  const key = clientLockKey(ownerUserId, clientId)
  const token = randomUUID()
  const acquired = await kv.set(key, token, { nx: true, ex: CLIENT_CREATION_LOCK_SECONDS })
  if (!acquired) {
    throw new PenetrationJobSubmissionError(
      "当前客户的检测任务正在创建，请稍后查看任务中心",
      409,
      "PENETRATION_CLIENT_BUSY",
    )
  }
  return { key, token }
}

async function releaseClientLock(lock: { key: string; token: string } | null): Promise<void> {
  if (!lock) return
  try {
    if (await kv.get<string>(lock.key) === lock.token) await kv.del(lock.key)
  } catch (error) {
    console.warn("[penetration-job-creation] failed to release client lock", error)
  }
}

async function creditError(response: Response): Promise<PenetrationJobSubmissionError> {
  let payload: Record<string, unknown> = {}
  try {
    payload = await response.clone().json() as Record<string, unknown>
  } catch {
    // Keep the status and a stable user-facing fallback when the response is not JSON.
  }
  const message = String(payload.error || "积分不足，自动检测本次未执行")
  const code = String(payload.code || (response.status === 403 ? "INSUFFICIENT_CREDITS" : "CREDIT_RESERVATION_FAILED"))
  return new PenetrationJobSubmissionError(message, response.status || 403, code, payload)
}

function parseSlotSelection(input: {
  raw: unknown
  questions: string[]
  requestedModels: ModelKey[]
  operation: PenetrationJobOperation
}): Array<{ model: ModelKey; questionIndex: number }> | undefined {
  if (!Array.isArray(input.raw)) return undefined
  if (input.operation !== "append") {
    throw new PenetrationJobSubmissionError(
      "未完成项重试必须追加到原报告，不能覆盖已有检测结果",
    )
  }
  const parsed = input.raw.map(value => {
    const entry = value && typeof value === "object"
      ? value as { model?: unknown; questionIndex?: unknown }
      : {}
    return {
      model: String(entry.model || "") as ModelKey,
      questionIndex: Number(entry.questionIndex),
    }
  })
  if (
    parsed.length === 0
    || parsed.some(slot => (
      !input.requestedModels.includes(slot.model)
      || !Number.isInteger(slot.questionIndex)
      || slot.questionIndex < 0
      || slot.questionIndex >= input.questions.length
    ))
  ) {
    throw new PenetrationJobSubmissionError("未完成检测项参数无效，请刷新后重试")
  }
  return parsed
}

async function clearWorkspaceJobMarker(input: {
  ownerUserId: string
  clientId: string
  jobId: string
}): Promise<void> {
  try {
    await mutateWorkspaceClientLatest({
      userId: input.ownerUserId,
      clientId: input.clientId,
      mutate: current => current.penetrationJobId === input.jobId
        ? { patch: {}, unsetFields: ["penetrationJobId"] }
        : null,
    })
  } catch (error) {
    console.warn("[penetration-job-creation] failed to clear workspace marker", error)
  }
}

function activeJob(status: PenetrationJobRecord["status"]): boolean {
  return status === "queued" || status === "running"
}

export async function submitPenetrationJob(
  input: PenetrationJobSubmissionInput,
): Promise<PenetrationJobSubmissionResult> {
  const actorUserId = String(input.actorUserId || "").trim()
  const clientId = String(input.clientId || "").trim()
  if (!actorUserId) throw new PenetrationJobSubmissionError("用户身份缺失", 401)
  if (!clientId) {
    throw new PenetrationJobSubmissionError("客户标识缺失，请刷新页面后重试")
  }

  const access = await requireOperationAccess({
    userId: actorUserId,
    clientId,
    module: "penetration",
    action: "execute",
    teamId: String(input.teamId || "").trim() || undefined,
  })
  const requestId = normalizeJobRequestId(input.requestId)
  const jobId = jobIdFromRequest("pjob", actorUserId, requestId)
  const existing = await getPenetrationJob(jobId, actorUserId)
    || await getPenetrationJob(jobId, access.dataOwnerUserId)
  if (existing) {
    const currentClient = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(item => item.client.id === clientId)?.client
    if (!currentClient) {
      throw new PenetrationJobSubmissionError("当前客户不存在或已被删除，请刷新页面后重试", 404)
    }
    return {
      job: existing,
      access,
      client: currentClient,
      request: {} as PenetrationJobRequest,
      requestedModels: [],
      activeModels: [],
      skipped: existing.skipped || [],
      slotCount: existing.totalSlots,
      estimatedCredits: estimateFeatureCredits("penetrationSlot", existing.totalSlots),
    }
  }

  let lock: { key: string; token: string } | null = null
  let reservation: CreditReservation | null = null
  let markerSet = false
  try {
    lock = await acquireClientLock(access.dataOwnerUserId, clientId)
    const currentClient = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(item => item.client.id === clientId)?.client
    if (!currentClient) {
      throw new PenetrationJobSubmissionError("当前客户不存在或已被删除，请刷新页面后重试", 404)
    }

    let replaceableWorkspaceJobId: string | undefined
    if (currentClient.penetrationJobId && currentClient.penetrationJobId !== jobId) {
      const currentJob = await getPenetrationJob(
        currentClient.penetrationJobId,
        access.dataOwnerUserId,
      )
      if (currentJob && activeJob(currentJob.status)) {
        throw new PenetrationJobSubmissionError(
          "当前客户已有检测任务在运行，可在任务中心查看进度",
          409,
          "PENETRATION_CLIENT_BUSY",
          { jobId: currentJob.id },
        )
      }
      replaceableWorkspaceJobId = currentClient.penetrationJobId
    }

    const operation: PenetrationJobOperation = input.operation === "append" ? "append" : "replace"
    const useSaved = Boolean(input.useSavedInputs)
    const questions = useSaved ? stringList(currentClient.questions) : stringList(input.questions)
    const requestedModels = useSaved
      ? uniqueModels(currentClient.selectedModels)
      : uniqueModels(input.models)
    if (questions.length === 0) {
      throw new PenetrationJobSubmissionError(
        "请先保存至少一个疑问句",
        400,
        "PENETRATION_NO_SAVED_QUESTIONS",
      )
    }
    if (questions.length > MAX_PENETRATION_QUESTIONS) {
      throw new PenetrationJobSubmissionError(`单次最多检测 ${MAX_PENETRATION_QUESTIONS} 条疑问句`)
    }
    if (requestedModels.length === 0) {
      throw new PenetrationJobSubmissionError(
        "请先选择至少一个检测模型",
        400,
        "PENETRATION_NO_SAVED_MODELS",
      )
    }

    const identityLocked = useSaved
      || access.mode === "client"
      || (access.mode === "team" && !hasTeamPermission(access.permissionKeys, "client", "edit"))
    const requestedSubjectType = normalizeAnalysisSubjectType(input.subjectType)
    const subjectType: AnalysisSubjectType = identityLocked
      ? normalizeAnalysisSubjectType(currentClient.subjectType)
      : requestedSubjectType
    const requestedPersonProfile = normalizePersonSubjectProfile(input.personProfile)
    const personProfile: PersonSubjectProfile = identityLocked
      ? normalizePersonSubjectProfile(currentClient.personProfile)
      : requestedPersonProfile
    const ourBrand = identityLocked
      ? currentClient.ourBrand.trim()
      : String(input.ourBrand || "").trim()
    if (!ourBrand) {
      throw new PenetrationJobSubmissionError(
        subjectType === "person" ? "请填写目标人物姓名" : "请填写我方品牌名",
      )
    }
    const brandAliases = identityLocked
      ? stringList(currentClient.brandAliases)
      : stringList(input.brandAliases)
    const competitors = identityLocked
      ? stringList(currentClient.competitors)
      : stringList(input.competitors)
    const industry = identityLocked
      ? String(currentClient.industry || "").trim()
      : String(input.industry || "").trim()
    const questionIntents = normalizePenetrationQuestionIntentHints(
      useSaved ? currentClient.questionIntentHints : input.questionIntents,
      questions,
    )
    const parsedSlotSelection = parseSlotSelection({
      raw: input.slotSelection,
      questions,
      requestedModels,
      operation,
    })

    const readiness = await Promise.all(requestedModels.map(getPenetrationModelReadiness))
    let activeModels = readiness.filter(item => item.ready).map(item => item.model)
    const skipped = readiness
      .filter(item => !item.ready)
      .map(item => `${ADAPTERS[item.model].label}（${item.reason || "严格联网预检未通过"}）`)
    if (input.requireAllModelsReady && skipped.length > 0) {
      throw new PenetrationJobSubmissionError(
        `固定检测模型暂未全部就绪：${skipped.join("、")}`,
        503,
        "PENETRATION_CONFIGURED_MODELS_UNAVAILABLE",
        { skipped },
      )
    }
    if (activeModels.length === 0) {
      throw new PenetrationJobSubmissionError(
        `所选模型均未通过严格联网预检：${skipped.join("、")}`,
        400,
        "PENETRATION_NO_READY_MODELS",
        { skipped },
      )
    }
    const slotSelection = parsedSlotSelection
      ? Array.from(new Map(
          parsedSlotSelection
            .filter(slot => activeModels.includes(slot.model))
            .map(slot => [`${slot.model}:${slot.questionIndex}`, slot]),
        ).values())
      : undefined
    if (parsedSlotSelection && slotSelection?.length === 0) {
      throw new PenetrationJobSubmissionError(
        `未完成项所需模型均未通过严格联网预检：${skipped.join("、")}`,
      )
    }
    if (slotSelection) {
      const selectedModels = new Set(slotSelection.map(slot => slot.model))
      activeModels = activeModels.filter(model => selectedModels.has(model))
    }

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
      origin: input.origin || "manual",
      automationScheduleId: input.automationScheduleId,
      automationExecutionId: input.automationExecutionId,
      automationTrigger: input.automationTrigger,
    }
    const slotCount = slotSelection?.length || questions.length * activeModels.length
    const estimatedCredits = estimateFeatureCredits("penetrationSlot", slotCount)
    const creditGuard = await reserveCreditsForUser(access.billingUserId, estimatedCredits, {
      featureKey: "penetrationSlot",
      source: input.origin === "automation"
        ? "automation:penetration"
        : "api:penetration:jobs",
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
        origin: request.origin,
        automationScheduleId: input.automationScheduleId,
        automationExecutionId: input.automationExecutionId,
      },
    })
    if (!creditGuard.ok) throw await creditError(creditGuard.response)
    reservation = creditGuard.reservation

    const marked = await mutateWorkspaceClientLatest({
      userId: access.dataOwnerUserId,
      clientId,
      mutate: current => (
        current.penetrationJobId
          && current.penetrationJobId !== jobId
          && current.penetrationJobId !== replaceableWorkspaceJobId
          ? null
          : { patch: { penetrationJobId: jobId } }
      ),
    })
    if (!marked || marked.client.penetrationJobId !== jobId) {
      throw new PenetrationJobSubmissionError(
        "当前客户已有检测任务在运行，可在任务中心查看进度",
        409,
        "PENETRATION_CLIENT_BUSY",
      )
    }
    markerSet = true

    const job = await createPenetrationJob({
      id: jobId,
      request,
      ownerUserId: access.actorUserId,
      workspaceOwnerUserId: access.dataOwnerUserId,
      teamId: access.teamId,
      reservation,
      skipped,
      baseResult: operation === "append" ? currentClient.penetration : undefined,
    })
    reservation = null
    return {
      job,
      access,
      client: currentClient,
      request,
      requestedModels,
      activeModels,
      skipped,
      slotCount,
      estimatedCredits,
    }
  } catch (error) {
    await refundReservedCreditsQuietly(reservation)
    if (markerSet) {
      await clearWorkspaceJobMarker({
        ownerUserId: access.dataOwnerUserId,
        clientId,
        jobId,
      })
    }
    throw error
  } finally {
    await releaseClientLock(lock)
  }
}
