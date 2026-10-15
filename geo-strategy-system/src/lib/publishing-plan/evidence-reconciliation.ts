import "server-only"

import { normalizeExecutionEvidenceUrl } from "@/lib/client-feedback/evidence-import"
import {
  updateClientExecutionActionPublication,
} from "@/lib/client-feedback/store"
import {
  completeNextPublishingTask,
  getActivePublishingPlan,
  listPublishingTasks,
} from "@/lib/publishing-plan/store"
import {
  normalizeSourcePlatformName,
  resolveSourcePlatformByName,
  resolveSourcePlatformByUrl,
} from "@/lib/source-platform-registry"
import type {
  ClientEvidenceImportPreview,
  ClientEvidenceImportPreviewRow,
  ClientEvidenceImportRowInput,
  ClientEvidenceReconciliationSummary,
  ClientExecutionAction,
  ClientPublicationProgress,
  ClientPublicationProgressPlatform,
  ClientPublicationReconciliation,
} from "@/types/client-feedback"
import type {
  PublishingPlan,
  PublishingPlatformConfig,
  PublishingTask,
} from "@/types/publishing-plan"

const PUBLICATION_CATEGORIES = new Set<ClientExecutionAction["category"]>([
  "self_media_publish",
  "authority_media_publish",
  "video_publish",
])

type PlatformMatch = {
  platformKey: string
  platformName: string
  confidence: ClientPublicationReconciliation["confidence"]
  detectionMethod: ClientPublicationReconciliation["detectionMethod"]
  config?: PublishingPlatformConfig
  known: boolean
}

type PreviewTaskInventory = Map<string, {
  planned: PublishingTask[]
  completedCount: number
  plannedCount: number
}>

export function isPublicationExecutionAction(action: ClientExecutionAction): boolean {
  return PUBLICATION_CATEGORIES.has(action.category)
    && action.status === "completed"
    && action.evidence.some(item => Boolean(normalizeExecutionEvidenceUrl(item.url)))
}

export async function previewPublishingEvidenceImport(input: {
  ownerUserId: string
  clientId: string
  occurredDate: string
  rows: ClientEvidenceImportRowInput[]
}): Promise<ClientEvidenceImportPreview> {
  const plan = await activePlanWithTasksForDates(
    input.ownerUserId,
    input.clientId,
    [input.occurredDate],
  )
  const inventory = previewTaskInventory(plan, input.occurredDate)
  const rows: ClientEvidenceImportPreviewRow[] = []

  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index]
    const normalizedUrl = normalizeExecutionEvidenceUrl(row.url) || ""
    const platform = resolvePlatform({
      normalizedUrl,
      requestedPlatform: row.platform,
      requestedPlatformKey: row.platformKey,
      plan,
    })
    const key = inventoryKey(input.occurredDate, platform.platformKey)
    const available = inventory.get(key)
    let status: ClientPublicationReconciliation["status"]
    let taskId: string | undefined
    if (!platform.known && !platform.config) {
      status = "needs_review"
    } else if (!plan || !platform.config || !available?.plannedCount) {
      status = "unplanned"
    } else {
      const task = available.planned.shift()
      if (task) {
        status = "matched"
        taskId = task.id
      } else {
        status = "over_quota"
      }
    }
    rows.push({
      rowNumber: index + 1,
      normalizedUrl,
      platformKey: platform.platformKey,
      platformName: platform.platformName,
      confidence: platform.confidence,
      status,
      plannedCount: available?.plannedCount || 0,
      completedCount: available?.completedCount || 0,
      availableCount: available?.planned.length || 0,
      taskId,
    })
  }

  return {
    rows,
    summary: reconciliationSummary(rows),
    planId: plan?.id,
    planVersion: plan?.version,
  }
}

export async function reconcilePublishingEvidenceActions(input: {
  ownerUserId: string
  clientId: string
  actorUserId: string
  actions: ClientExecutionAction[]
}): Promise<{
  actions: ClientExecutionAction[]
  summary: ClientEvidenceReconciliationSummary
}> {
  const plan = await activePlanWithTasksForDates(
    input.ownerUserId,
    input.clientId,
    input.actions.map(action => shanghaiDateOnly(action.occurredAt)),
  )
  const reconciled: ClientExecutionAction[] = []
  const concurrency = 8
  for (let offset = 0; offset < input.actions.length; offset += concurrency) {
    const chunk = input.actions.slice(offset, offset + concurrency)
    const values = await Promise.all(chunk.map(action => reconcileAction({
      ...input,
      action,
      plan,
    })))
    reconciled.push(...values)
  }
  return {
    actions: reconciled,
    summary: reconciliationSummary(reconciled.map((action, index) => ({
      rowNumber: index + 1,
      normalizedUrl: action.publicationReconciliation?.normalizedUrl || "",
      platformKey: action.publicationReconciliation?.platformKey || "",
      platformName: action.publicationReconciliation?.platformName || action.platform || "",
      confidence: action.publicationReconciliation?.confidence || "low",
      status: action.publicationReconciliation?.status || "needs_review",
      plannedCount: 0,
      completedCount: 0,
      availableCount: 0,
      taskId: action.publicationReconciliation?.taskId,
    }))),
  }
}

async function reconcileAction(input: {
  ownerUserId: string
  clientId: string
  actorUserId: string
  action: ClientExecutionAction
  plan: PublishingPlan | null
}): Promise<ClientExecutionAction> {
  if (!isPublicationExecutionAction(input.action)) return input.action
  const normalizedUrl = normalizeExecutionEvidenceUrl(input.action.evidence[0]?.url || "")
  if (!normalizedUrl) return input.action
  const quotaDate = shanghaiDateOnly(input.action.occurredAt)
  const platform = resolvePlatform({
    normalizedUrl,
    requestedPlatform: input.action.platform,
    requestedPlatformKey: input.action.platformKey,
    plan: input.plan,
  })
  let task: PublishingTask | null = null
  let status: ClientPublicationReconciliation["status"]
  if (!platform.known && !platform.config) {
    status = "needs_review"
  } else if (!input.plan || !platform.config) {
    status = "unplanned"
  } else {
    task = await completeNextPublishingTask({
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      planId: input.plan.id,
      plannedDate: quotaDate,
      platformKey: platform.config.platformKey,
      actorUserId: input.actorUserId,
      publishedUrl: normalizedUrl,
      publishedAt: input.action.occurredAt,
      title: input.action.title,
      evidence: input.action.evidence,
      executionActionId: input.action.id,
    })
    if (task) {
      status = "matched"
    } else {
      const plannedCount = input.plan.calculation.tasks.filter(candidate => (
        candidate.plannedDate === quotaDate
        && candidate.platformKey === platform.config?.platformKey
      )).length
      status = plannedCount > 0 ? "over_quota" : "unplanned"
    }
  }
  const now = new Date().toISOString()
  const reconciliation: ClientPublicationReconciliation = {
    normalizedUrl,
    platformKey: platform.config?.platformKey || platform.platformKey,
    platformName: platform.config?.platformName || platform.platformName,
    quotaDate,
    status,
    detectionMethod: platform.detectionMethod,
    confidence: platform.confidence,
    planId: input.plan?.id,
    planVersion: input.plan?.version,
    taskId: task?.id,
    reconciledAt: now,
  }
  return updateClientExecutionActionPublication({
    ownerUserId: input.ownerUserId,
    clientId: input.clientId,
    actionId: input.action.id,
    platform: reconciliation.platformName,
    platformKey: reconciliation.platformKey,
    sourceRecordId: task?.id,
    reconciliation,
  })
}

export function buildClientPublicationProgress(input: {
  date: string
  plan: PublishingPlan | null
  tasks?: PublishingTask[]
  actions: ClientExecutionAction[]
}): ClientPublicationProgress {
  const plannedTasks = (input.tasks || input.plan?.calculation.tasks || [])
    .filter(task => task.plannedDate === input.date)
  const platformMap = new Map<string, ClientPublicationProgressPlatform>()
  for (const task of plannedTasks) {
    const row = platformMap.get(task.platformKey) || emptyProgressRow(task.platformKey, task.platformName)
    row.plannedCount += 1
    if (task.status === "completed") row.matchedCount += 1
    platformMap.set(task.platformKey, row)
  }

  const seenUrls = new Set<string>()
  let needsReviewCount = 0
  for (const action of input.actions) {
    if (!isPublicationExecutionAction(action) || shanghaiDateOnly(action.occurredAt) !== input.date) continue
    const normalizedUrl = normalizeExecutionEvidenceUrl(action.evidence[0]?.url || "")
    if (!normalizedUrl || seenUrls.has(normalizedUrl)) continue
    seenUrls.add(normalizedUrl)
    const receipt = action.publicationReconciliation
    const resolved = resolveSourcePlatformByUrl(normalizedUrl)
    const platformKey = receipt?.platformKey || action.platformKey || resolved?.key || `domain:${new URL(normalizedUrl).hostname}`
    const platformName = receipt?.platformName || action.platform || resolved?.name || platformKey
    const row = platformMap.get(platformKey) || emptyProgressRow(platformKey, platformName)
    row.actualCount += 1
    platformMap.set(platformKey, row)
    if (receipt?.status === "needs_review") needsReviewCount += 1
  }

  const platforms = [...platformMap.values()].map(row => ({
    ...row,
    remainingCount: Math.max(0, row.plannedCount - row.matchedCount),
    overageCount: Math.max(0, row.actualCount - row.plannedCount),
  })).sort((left, right) => (
    right.plannedCount - left.plannedCount
    || right.actualCount - left.actualCount
    || left.platformName.localeCompare(right.platformName, "zh-CN")
  ))
  const plannedCount = platforms.reduce((sum, row) => sum + row.plannedCount, 0)
  const actualCount = platforms.reduce((sum, row) => sum + row.actualCount, 0)
  const matchedCount = platforms.reduce((sum, row) => sum + row.matchedCount, 0)
  return {
    date: input.date,
    planId: input.plan?.id,
    planVersion: input.plan?.version,
    plannedCount,
    actualCount,
    matchedCount,
    remainingCount: Math.max(0, plannedCount - matchedCount),
    overageCount: platforms.reduce((sum, row) => sum + row.overageCount, 0),
    needsReviewCount,
    completionRate: plannedCount > 0 ? matchedCount / plannedCount : 0,
    platforms,
  }
}

async function activePlanWithTasksForDates(
  ownerUserId: string,
  clientId: string,
  dates: string[],
): Promise<PublishingPlan | null> {
  const plan = await getActivePublishingPlan(ownerUserId, clientId, false)
  if (!plan) return null
  const uniqueDates = Array.from(new Set(
    dates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)),
  ))
  const tasks = (await Promise.all(uniqueDates.map(date => (
    listPublishingTasks(ownerUserId, plan.id, { date, limit: 10_000 })
  )))).flat()
  return {
    ...plan,
    calculation: {
      ...plan.calculation,
      tasks,
    },
  }
}

function resolvePlatform(input: {
  normalizedUrl: string
  requestedPlatform?: string
  requestedPlatformKey?: string
  plan: PublishingPlan | null
}): PlatformMatch {
  const urlResolution = resolveSourcePlatformByUrl(input.normalizedUrl)
  const requestedDefinition = resolveSourcePlatformByName(input.requestedPlatform || "")
  const requestedKey = String(input.requestedPlatformKey || requestedDefinition?.key || "").trim()
  const hostname = urlResolution?.hostname || ""
  const configs = input.plan?.input.platformConfigs || []
  const config = configs.find(candidate => candidate.platformKey === requestedKey)
    || configs.find(candidate => candidate.platformKey === urlResolution?.key)
    || configs.find(candidate => (
      normalizeSourcePlatformName(candidate.platformName)
      === normalizeSourcePlatformName(input.requestedPlatform || urlResolution?.name || "")
    ))
    || configs.find(candidate => candidate.sourceEvidence?.domains.some(domain => (
      hostname === domain || hostname.endsWith(`.${domain}`)
    )))
  if (config) {
    const manual = Boolean(requestedKey || input.requestedPlatform)
    return {
      platformKey: config.platformKey,
      platformName: config.platformName,
      confidence: manual || urlResolution?.known ? "high" : "medium",
      detectionMethod: manual ? "manual" : "domain",
      config,
      known: Boolean(urlResolution?.known || requestedDefinition),
    }
  }
  if (requestedDefinition || requestedKey) {
    return {
      platformKey: requestedKey || requestedDefinition?.key || urlResolution?.key || "",
      platformName: requestedDefinition?.name || input.requestedPlatform || urlResolution?.name || "未知平台",
      confidence: requestedDefinition ? "high" : "medium",
      detectionMethod: "manual",
      known: Boolean(requestedDefinition),
    }
  }
  if (urlResolution) {
    return {
      platformKey: urlResolution.key,
      platformName: urlResolution.name,
      confidence: urlResolution.known ? "high" : "low",
      detectionMethod: urlResolution.known ? "domain" : "hostname",
      known: urlResolution.known,
    }
  }
  return {
    platformKey: "unknown",
    platformName: "未知平台",
    confidence: "low",
    detectionMethod: "hostname",
    known: false,
  }
}

function previewTaskInventory(plan: PublishingPlan | null, date: string): PreviewTaskInventory {
  const inventory: PreviewTaskInventory = new Map()
  const now = new Date().toISOString()
  for (const task of plan?.calculation.tasks || []) {
    if (task.plannedDate !== date) continue
    const key = inventoryKey(date, task.platformKey)
    const row = inventory.get(key) || { planned: [], completedCount: 0, plannedCount: 0 }
    row.plannedCount += 1
    if (task.status === "completed") row.completedCount += 1
    else if (
      task.status === "planned"
      || task.status === "failed"
      || (task.status === "claimed" && String(task.claimExpiresAt || "") <= now)
    ) row.planned.push(task)
    inventory.set(key, row)
  }
  return inventory
}

function inventoryKey(date: string, platformKey: string): string {
  return `${date}\u0000${platformKey}`
}

function reconciliationSummary(
  rows: Array<Pick<ClientEvidenceImportPreviewRow, "status">>,
): ClientEvidenceReconciliationSummary {
  return {
    matchedCount: rows.filter(row => row.status === "matched").length,
    overQuotaCount: rows.filter(row => row.status === "over_quota").length,
    unplannedCount: rows.filter(row => row.status === "unplanned").length,
    needsReviewCount: rows.filter(row => row.status === "needs_review").length,
  }
}

function emptyProgressRow(
  platformKey: string,
  platformName: string,
): ClientPublicationProgressPlatform {
  return {
    platformKey,
    platformName,
    plannedCount: 0,
    actualCount: 0,
    matchedCount: 0,
    remainingCount: 0,
    overageCount: 0,
  }
}

function shanghaiDateOnly(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || "").slice(0, 10)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}
