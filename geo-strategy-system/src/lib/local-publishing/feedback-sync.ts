import "server-only"

import { saveClientExecutionAction } from "@/lib/client-feedback/store"
import {
  isPublicationExecutionAction,
  reconcilePublishingEvidenceActions,
} from "@/lib/publishing-plan/evidence-reconciliation"
import { isOperationAccessError, requireOperationAccess } from "@/lib/team-access"
import { localPublishingEnabled, publishingService } from "@/lib/local-publishing/service"
import type { PublishingContentType, PublishingFeedbackState } from "@/lib/local-publishing/types"

// Writes articles the publisher has published into the linked client's execution
// feedback, where the existing reconciliation completes the matching publishing-plan task.

type PendingTask = {
  id: string
  owner: string
  client_id: string
  team_id: string | null
  remote_url: string
  published_at: number | null
  updated_at: number
  title: string | null
  content_type: PublishingContentType
  platform: string
  platform_name: string
  account_name: string
}
type Outcome = { state: Exclude<PublishingFeedbackState, "retry"> | "error"; message: string }

// The executor scopes every command to an owner; this one only reads the cross-owner pending list.
const SYNC_OWNER = "geo-feedback-sync"
const SYNC_INTERVAL_MS = 60_000
const REQUEST_MIN_GAP_MS = 10_000
const OUTCOME_MESSAGES: Record<Exclude<Outcome["state"], "denied" | "error">, string> = {
  matched: "已计入发布计划",
  unplanned: "计划外发布，已记入执行反馈",
  over_quota: "超出当天计划数，已记入执行反馈",
  needs_review: "平台无法识别，已记入执行反馈待核对",
}

const state = globalThis as typeof globalThis & {
  __geoPublishingFeedbackRun?: Promise<number>
  __geoPublishingFeedbackTimer?: ReturnType<typeof setInterval>
  __geoPublishingFeedbackLastRun?: number
}

export function feedbackActionId(taskId: string): string {
  return `cact_lp_${taskId}`.slice(0, 220)
}

/** Runs one pass; concurrent callers share the pass already in flight. */
export function syncPublishingFeedback(): Promise<number> {
  if (state.__geoPublishingFeedbackRun) return state.__geoPublishingFeedbackRun
  state.__geoPublishingFeedbackLastRun = Date.now()
  state.__geoPublishingFeedbackRun = runPass().finally(() => {
    state.__geoPublishingFeedbackRun = undefined
  })
  return state.__geoPublishingFeedbackRun
}

/** Called when the console reads state, so a fresh publish shows up without waiting for the timer. */
export function requestPublishingFeedbackSync(): void {
  if (Date.now() - (state.__geoPublishingFeedbackLastRun || 0) < REQUEST_MIN_GAP_MS) return
  void syncPublishingFeedback().catch(error => {
    console.error("[publishing-feedback] sync failed", error)
  })
}

/** Keeps writing back while no console is open. */
export function startPublishingFeedbackSync(): void {
  if (!localPublishingEnabled() || state.__geoPublishingFeedbackTimer) return
  state.__geoPublishingFeedbackTimer = setInterval(requestPublishingFeedbackSync, SYNC_INTERVAL_MS)
  state.__geoPublishingFeedbackTimer.unref?.()
}

async function runPass(): Promise<number> {
  const pending = await publishingService().request(SYNC_OWNER, "feedback.pending", { limit: 20 }) as PendingTask[]
  for (const task of pending) {
    let outcome: Outcome
    try {
      outcome = await writeFeedback(task)
    } catch (error) {
      outcome = { state: "error", message: error instanceof Error ? error.message : "执行反馈暂时无法写入" }
    }
    await publishingService()
      .request(task.owner, "feedback.mark", { id: task.id, state: outcome.state, message: outcome.message })
      .catch(error => console.error("[publishing-feedback] failed to record outcome", task.id, error))
  }
  return pending.length
}

export async function writeFeedback(task: PendingTask): Promise<Outcome> {
  let access: Awaited<ReturnType<typeof requireOperationAccess>>
  try {
    access = await requireOperationAccess({
      userId: task.owner,
      clientId: task.client_id,
      teamId: task.team_id || undefined,
      module: "feedback",
      action: "edit",
    })
  } catch (error) {
    if (isOperationAccessError(error)) {
      return { state: "denied", message: error instanceof Error ? error.message : "无权写入该客户的执行反馈" }
    }
    throw error
  }
  const video = task.content_type === "video"
  const action = await saveClientExecutionAction({
    ownerUserId: access.dataOwnerUserId,
    clientId: access.clientId,
    actorUserId: task.owner,
    value: {
      // Fixed per task, so a retried pass updates the same action instead of counting twice.
      id: feedbackActionId(task.id),
      category: video ? "video_publish" : "self_media_publish",
      source: "system",
      status: "completed",
      visibility: "client",
      publication: "summary",
      title: task.title || `${task.platform_name}发布`,
      description: `由内容分发自动登记 · ${task.account_name}`,
      occurredAt: new Date(task.published_at || task.updated_at).toISOString(),
      quantity: 1,
      unit: video ? "条" : "篇",
      platform: task.platform_name,
      evidence: [{ label: "发布页面", url: task.remote_url }],
      sourceRecordId: `local-publishing:${task.id}`,
    },
  })
  if (!isPublicationExecutionAction(action)) {
    return { state: "needs_review", message: OUTCOME_MESSAGES.needs_review }
  }
  const { actions } = await reconcilePublishingEvidenceActions({
    ownerUserId: access.dataOwnerUserId,
    clientId: access.clientId,
    actorUserId: task.owner,
    actions: [action],
  })
  const status = actions[0]?.publicationReconciliation?.status || "needs_review"
  return { state: status, message: OUTCOME_MESSAGES[status] }
}
