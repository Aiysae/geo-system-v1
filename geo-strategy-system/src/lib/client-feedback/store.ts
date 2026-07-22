import "server-only"

import { createHash, randomBytes, randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import type {
  ClientExecutionAction,
  ClientExecutionActionCategory,
  ClientExecutionActionStatus,
  ClientExecutionActionVisibility,
  ClientExecutionProfile,
  ClientExecutionStage,
  ClientFeedbackPeriod,
  ClientFeedbackReport,
  ClientFeedbackReportType,
} from "@/types/client-feedback"

const profileKey = (ownerUserId: string, clientId: string) => (
  `geo:client-feedback:profile:${ownerUserId}:${clientId}`
)
const actionKey = (id: string) => `geo:client-feedback:action:${id}`
const actionIndexKey = (ownerUserId: string, clientId: string) => (
  `geo:client-feedback:actions:${ownerUserId}:${clientId}`
)
const reportKey = (id: string) => `geo:client-feedback:report:${id}`
const reportIndexKey = (ownerUserId: string, clientId: string) => (
  `geo:client-feedback:reports:${ownerUserId}:${clientId}`
)
const shareKey = (tokenHash: string) => `geo:client-feedback:share:${tokenHash}`

const STAGES = new Set<ClientExecutionStage>([
  "baseline",
  "foundation",
  "initial_mention",
  "coverage_growth",
  "stable_mention",
  "continuous_optimization",
])
const CATEGORIES = new Set<ClientExecutionActionCategory>([
  "penetration_check",
  "content_production",
  "self_media_publish",
  "authority_media_publish",
  "video_publish",
  "website_optimization",
  "strategy_adjustment",
  "client_communication",
  "other",
])
const ACTION_STATUSES = new Set<ClientExecutionActionStatus>(["planned", "completed"])
const VISIBILITIES = new Set<ClientExecutionActionVisibility>(["client", "internal"])

function cleanId(value: unknown, label: string): string {
  const result = String(value || "").trim()
  if (!result || result.length > 200) throw new Error(`${label}无效`)
  return result
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength)
}

function validDateOnly(value: unknown): string {
  const result = String(value || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error("正式执行日期无效")
  const date = dateOnlyToUtc(result)
  if (dateOnlyFromUtc(date) !== result) throw new Error("正式执行日期无效")
  return result
}

function validIso(value: unknown, fallback = new Date().toISOString()): string {
  const parsed = new Date(String(value || ""))
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString()
}

export function shanghaiDateOnly(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (type: string) => parts.find(part => part.type === type)?.value || ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

function dateOnlyToUtc(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function dateOnlyFromUtc(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function addDays(value: string, days: number): string {
  const date = dateOnlyToUtc(value)
  date.setUTCDate(date.getUTCDate() + days)
  return dateOnlyFromUtc(date)
}

function addAnchoredMonths(value: string, months: number): string {
  const source = dateOnlyToUtc(value)
  const targetYear = source.getUTCFullYear()
  const targetMonth = source.getUTCMonth() + months
  const first = new Date(Date.UTC(targetYear, targetMonth, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(source.getUTCDate(), last))
  return dateOnlyFromUtc(first)
}

function daysBetween(start: string, end: string): number {
  return Math.floor((dateOnlyToUtc(end).getTime() - dateOnlyToUtc(start).getTime()) / 86_400_000)
}

function mondayOf(value: string): string {
  const date = dateOnlyToUtc(value)
  const weekday = date.getUTCDay() || 7
  return addDays(value, 1 - weekday)
}

function defaultProfile(ownerUserId: string, clientId: string): ClientExecutionProfile {
  const now = new Date().toISOString()
  return {
    version: 1,
    ownerUserId,
    clientId,
    startDate: shanghaiDateOnly(),
    timezone: "Asia/Shanghai",
    periodMode: "service",
    currentStage: "baseline",
    stageProgress: 0,
    projectOwner: "",
    nextPlan: [],
    updatedAt: now,
    updatedByUserId: ownerUserId,
  }
}

function normalizeProfile(
  ownerUserId: string,
  clientId: string,
  value: Partial<ClientExecutionProfile> | null | undefined,
): ClientExecutionProfile {
  const fallback = defaultProfile(ownerUserId, clientId)
  if (!value) return fallback
  return {
    version: 1,
    ownerUserId,
    clientId,
    startDate: validDateOnly(value.startDate || fallback.startDate),
    timezone: "Asia/Shanghai",
    periodMode: value.periodMode === "calendar" ? "calendar" : "service",
    currentStage: STAGES.has(value.currentStage as ClientExecutionStage)
      ? value.currentStage as ClientExecutionStage
      : "baseline",
    stageProgress: Math.max(0, Math.min(100, Math.floor(Number(value.stageProgress) || 0))),
    projectOwner: cleanText(value.projectOwner, 80),
    expectedDurationDays: Number.isFinite(Number(value.expectedDurationDays))
      ? Math.max(1, Math.min(3_650, Math.floor(Number(value.expectedDurationDays))))
      : undefined,
    nextPlan: Array.isArray(value.nextPlan)
      ? value.nextPlan.map(item => cleanText(item, 240)).filter(Boolean).slice(0, 20)
      : [],
    updatedAt: validIso(value.updatedAt, fallback.updatedAt),
    updatedByUserId: cleanText(value.updatedByUserId, 200) || ownerUserId,
  }
}

export async function getClientExecutionProfile(
  ownerUserId: string,
  clientId: string,
): Promise<ClientExecutionProfile> {
  const owner = cleanId(ownerUserId, "客户所有者")
  const client = cleanId(clientId, "客户")
  const stored = await kv.get<ClientExecutionProfile>(profileKey(owner, client))
  return normalizeProfile(owner, client, stored)
}

export async function saveClientExecutionProfile(input: {
  ownerUserId: string
  clientId: string
  updatedByUserId: string
  patch: Partial<ClientExecutionProfile>
}): Promise<ClientExecutionProfile> {
  const current = await getClientExecutionProfile(input.ownerUserId, input.clientId)
  const next = normalizeProfile(input.ownerUserId, input.clientId, {
    ...current,
    ...input.patch,
    updatedAt: new Date().toISOString(),
    updatedByUserId: input.updatedByUserId,
  })
  await kv.set(profileKey(input.ownerUserId, input.clientId), next)
  return next
}

export function executionCounters(profile: ClientExecutionProfile, targetDate = shanghaiDateOnly()) {
  const diff = Math.max(0, daysBetween(profile.startDate, targetDate))
  let serviceMonth = 1
  for (let index = 1; index < 1_200; index += 1) {
    if (addAnchoredMonths(profile.startDate, index) > targetDate) break
    serviceMonth = index + 1
  }
  return {
    executionDay: diff + 1,
    serviceWeek: Math.floor(diff / 7) + 1,
    serviceMonth,
  }
}

export function feedbackPeriodForDate(
  profile: ClientExecutionProfile,
  type: ClientFeedbackReportType,
  targetDate = shanghaiDateOnly(),
): ClientFeedbackPeriod {
  const normalizedTarget = validDateOnly(targetDate)
  const safeTarget = normalizedTarget < profile.startDate ? profile.startDate : normalizedTarget
  if (profile.periodMode === "calendar") {
    if (type === "weekly") {
      const naturalStart = mondayOf(safeTarget)
      const start = naturalStart < profile.startDate ? profile.startDate : naturalStart
      const end = addDays(naturalStart, 6)
      const index = Math.max(1, Math.floor(daysBetween(mondayOf(profile.startDate), naturalStart) / 7) + 1)
      return { type, index, start, end, label: `第 ${index} 周` }
    }
    const [year, month] = safeTarget.split("-").map(Number)
    const naturalStart = `${year}-${String(month).padStart(2, "0")}-01`
    const start = naturalStart < profile.startDate ? profile.startDate : naturalStart
    const end = addDays(addAnchoredMonths(naturalStart, 1), -1)
    const startMonth = dateOnlyToUtc(profile.startDate)
    const index = (year - startMonth.getUTCFullYear()) * 12 + month - startMonth.getUTCMonth()
    return { type, index: Math.max(1, index), start, end, label: `第 ${Math.max(1, index)} 月` }
  }

  if (type === "weekly") {
    const index = Math.floor(Math.max(0, daysBetween(profile.startDate, safeTarget)) / 7) + 1
    const start = addDays(profile.startDate, (index - 1) * 7)
    return { type, index, start, end: addDays(start, 6), label: `服务第 ${index} 周` }
  }

  let index = 1
  for (let cursor = 1; cursor < 1_200; cursor += 1) {
    if (addAnchoredMonths(profile.startDate, cursor) > safeTarget) break
    index = cursor + 1
  }
  const start = addAnchoredMonths(profile.startDate, index - 1)
  const end = addDays(addAnchoredMonths(profile.startDate, index), -1)
  return { type, index, start, end, label: `服务第 ${index} 月` }
}

export async function listClientExecutionActions(
  ownerUserId: string,
  clientId: string,
): Promise<ClientExecutionAction[]> {
  const ids = await kv.smembers<string[]>(actionIndexKey(ownerUserId, clientId))
  const actions = await Promise.all(ids.map(id => kv.get<ClientExecutionAction>(actionKey(id))))
  return actions
    .filter((action): action is ClientExecutionAction => Boolean(action))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
}

export async function saveClientExecutionAction(input: {
  ownerUserId: string
  clientId: string
  actorUserId: string
  value: Partial<ClientExecutionAction>
}): Promise<ClientExecutionAction> {
  const now = new Date().toISOString()
  const category = CATEGORIES.has(input.value.category as ClientExecutionActionCategory)
    ? input.value.category as ClientExecutionActionCategory
    : "other"
  const status = ACTION_STATUSES.has(input.value.status as ClientExecutionActionStatus)
    ? input.value.status as ClientExecutionActionStatus
    : "completed"
  const visibility = VISIBILITIES.has(input.value.visibility as ClientExecutionActionVisibility)
    ? input.value.visibility as ClientExecutionActionVisibility
    : "client"
  const title = cleanText(input.value.title, 160)
  if (!title) throw new Error("请填写动作名称")
  const action: ClientExecutionAction = {
    id: input.value.id?.trim() || `cact_${randomUUID().replace(/-/g, "")}`,
    ownerUserId: cleanId(input.ownerUserId, "客户所有者"),
    clientId: cleanId(input.clientId, "客户"),
    category,
    source: input.value.source === "system" ? "system" : "manual",
    status,
    visibility,
    title,
    description: cleanText(input.value.description, 2_000),
    occurredAt: validIso(input.value.occurredAt, now),
    quantity: Number.isFinite(Number(input.value.quantity))
      ? Math.max(0, Number(input.value.quantity))
      : undefined,
    unit: cleanText(input.value.unit, 40) || undefined,
    platform: cleanText(input.value.platform, 120) || undefined,
    evidence: Array.isArray(input.value.evidence)
      ? input.value.evidence.map(item => ({
          label: cleanText(item?.label, 120) || "查看证据",
          url: cleanText(item?.url, 1_000),
        })).filter(item => /^https?:\/\//i.test(item.url)).slice(0, 20)
      : [],
    sourceRecordId: cleanText(input.value.sourceRecordId, 240) || undefined,
    createdByUserId: input.actorUserId,
    createdAt: validIso(input.value.createdAt, now),
    updatedAt: now,
  }
  await kv.set(actionKey(action.id), action)
  await kv.sadd(actionIndexKey(action.ownerUserId, action.clientId), action.id)
  return action
}

export async function deleteClientExecutionAction(
  ownerUserId: string,
  clientId: string,
  actionId: string,
): Promise<boolean> {
  const stored = await kv.get<ClientExecutionAction>(actionKey(actionId))
  if (!stored || stored.ownerUserId !== ownerUserId || stored.clientId !== clientId) return false
  await kv.del(actionKey(actionId))
  await kv.srem(actionIndexKey(ownerUserId, clientId), actionId)
  return true
}

export async function listClientFeedbackReports(
  ownerUserId: string,
  clientId: string,
): Promise<ClientFeedbackReport[]> {
  const ids = await kv.smembers<string[]>(reportIndexKey(ownerUserId, clientId))
  const reports = await Promise.all(ids.map(id => kv.get<ClientFeedbackReport>(reportKey(id))))
  return reports
    .filter((report): report is ClientFeedbackReport => Boolean(report))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function getClientFeedbackReport(
  ownerUserId: string,
  reportId: string,
): Promise<ClientFeedbackReport | null> {
  const report = await kv.get<ClientFeedbackReport>(reportKey(reportId))
  return report?.ownerUserId === ownerUserId ? report : null
}

export async function saveClientFeedbackReport(
  report: ClientFeedbackReport,
): Promise<ClientFeedbackReport> {
  await kv.set(reportKey(report.id), report)
  await kv.sadd(reportIndexKey(report.ownerUserId, report.clientId), report.id)
  return report
}

export async function deleteClientFeedbackReport(input: {
  ownerUserId: string
  clientId: string
  reportId: string
}): Promise<"deleted" | "not_found" | "published"> {
  const report = await getClientFeedbackReport(input.ownerUserId, input.reportId)
  if (!report || report.clientId !== input.clientId) return "not_found"
  if (report.status !== "draft") return "published"

  if (report.shareTokenHash) {
    await kv.del(shareKey(report.shareTokenHash))
  }
  await Promise.all([
    kv.del(reportKey(report.id)),
    kv.srem(reportIndexKey(report.ownerUserId, report.clientId), report.id),
  ])
  return "deleted"
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url")
}

export async function publishClientFeedbackReport(input: {
  ownerUserId: string
  clientId: string
  reportId: string
  actorUserId: string
}): Promise<{ report: ClientFeedbackReport; shareToken: string }> {
  const report = await getClientFeedbackReport(input.ownerUserId, input.reportId)
  if (!report || report.clientId !== input.clientId) throw new Error("反馈报告不存在")
  const rawToken = randomBytes(32).toString("base64url")
  const hash = tokenHash(rawToken)
  const now = new Date().toISOString()
  const next: ClientFeedbackReport = {
    ...report,
    status: "published",
    shareEnabled: true,
    shareTokenHash: hash,
    publishedAt: report.publishedAt || now,
    publishedByUserId: report.publishedByUserId || input.actorUserId,
    updatedAt: now,
  }
  if (report.shareTokenHash) await kv.del(shareKey(report.shareTokenHash))
  await kv.set(shareKey(hash), {
    ownerUserId: report.ownerUserId,
    clientId: report.clientId,
    reportId: report.id,
  })
  await saveClientFeedbackReport(next)
  return { report: next, shareToken: rawToken }
}

export async function revokeClientFeedbackShare(input: {
  ownerUserId: string
  clientId: string
  reportId: string
}): Promise<ClientFeedbackReport> {
  const report = await getClientFeedbackReport(input.ownerUserId, input.reportId)
  if (!report || report.clientId !== input.clientId) throw new Error("反馈报告不存在")
  if (report.shareTokenHash) await kv.del(shareKey(report.shareTokenHash))
  const next: ClientFeedbackReport = {
    ...report,
    shareEnabled: false,
    shareTokenHash: undefined,
    updatedAt: new Date().toISOString(),
  }
  return saveClientFeedbackReport(next)
}

export async function getSharedClientFeedbackReport(token: string): Promise<ClientFeedbackReport | null> {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) return null
  const ref = await kv.get<{ ownerUserId: string; clientId: string; reportId: string }>(
    shareKey(tokenHash(token)),
  )
  if (!ref) return null
  const report = await getClientFeedbackReport(ref.ownerUserId, ref.reportId)
  if (!report || report.clientId !== ref.clientId || report.status !== "published" || !report.shareEnabled) {
    return null
  }
  return report
}
