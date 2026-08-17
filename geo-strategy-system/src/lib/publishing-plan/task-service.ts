import "server-only"

import { saveClientExecutionAction } from "@/lib/client-feedback/store"
import {
  completePublishingTask,
  failPublishingTask,
  getPublishingPlan,
  getPublishingTask,
} from "@/lib/publishing-plan/store"
import type {
  PublishingPlan,
  PublishingTask,
  PublishingTaskPackage,
} from "@/types/publishing-plan"

export function buildPublishingTaskPackages(
  plan: PublishingPlan,
  tasks: PublishingTask[],
): PublishingTaskPackage[] {
  const assets = new Map(plan.calculation.assets.map(asset => [asset.id, asset]))
  const platforms = new Map(plan.input.platformConfigs.map(platform => [platform.platformKey, platform]))
  return tasks.flatMap(task => {
    const asset = assets.get(task.assetId)
    const platform = platforms.get(task.platformKey)
    return asset && platform ? [{ task, asset, platform }] : []
  })
}

export async function completePublishingTaskWithFeedback(input: {
  ownerUserId: string
  clientId: string
  planId: string
  taskId: string
  actorUserId: string
  claimToken?: string
  publishedUrl: string
  publishedAt?: string
  title?: string
}): Promise<{
  task: PublishingTask
  action: Awaited<ReturnType<typeof saveClientExecutionAction>>
}> {
  const [plan, currentTask] = await Promise.all([
    getPublishingPlan(input.ownerUserId, input.planId, false),
    getPublishingTask(input.ownerUserId, input.taskId),
  ])
  if (!plan || plan.clientId !== input.clientId || !currentTask || currentTask.planId !== input.planId) {
    throw new Error("发布任务不存在")
  }
  if (input.claimToken && currentTask.claimToken !== input.claimToken) {
    throw new Error("发布任务已被其他执行者领取或领取凭证已失效")
  }
  const publishedUrl = normalizeHttpUrl(input.publishedUrl)
  const publishedAt = validIso(input.publishedAt) || new Date().toISOString()
  const title = String(input.title || currentTask.title || `${currentTask.platformName}发布`).trim()
  const action = await saveClientExecutionAction({
    ownerUserId: input.ownerUserId,
    clientId: input.clientId,
    actorUserId: input.actorUserId,
    value: {
      id: `cact_${input.taskId}`.slice(0, 220),
      category: contentActionCategory(plan, currentTask.platformKey),
      source: "system",
      status: "completed",
      visibility: "client",
      publication: "summary",
      title,
      description: `按发布规划第 ${plan.version} 版完成任务`,
      occurredAt: publishedAt,
      quantity: 1,
      unit: contentActionCategory(plan, currentTask.platformKey) === "video_publish" ? "条" : "篇",
      platform: currentTask.platformName,
      evidence: [{ label: "发布页面", url: publishedUrl }],
      sourceRecordId: input.taskId,
    },
  })
  const task = await completePublishingTask({
    ownerUserId: input.ownerUserId,
    taskId: input.taskId,
    actorUserId: input.actorUserId,
    claimToken: input.claimToken,
    publishedUrl,
    publishedAt,
    title,
    executionActionId: action.id,
  })
  return { task, action }
}

export async function failPublishingTaskForPlan(input: {
  ownerUserId: string
  clientId: string
  planId: string
  taskId: string
  claimToken?: string
  reason: string
}): Promise<PublishingTask> {
  const [plan, task] = await Promise.all([
    getPublishingPlan(input.ownerUserId, input.planId, false),
    getPublishingTask(input.ownerUserId, input.taskId),
  ])
  if (!plan || plan.clientId !== input.clientId || !task || task.planId !== input.planId) {
    throw new Error("发布任务不存在")
  }
  return failPublishingTask({
    ownerUserId: input.ownerUserId,
    taskId: input.taskId,
    claimToken: input.claimToken,
    reason: input.reason,
  })
}

function contentActionCategory(
  plan: PublishingPlan,
  platformKey: string,
): "self_media_publish" | "authority_media_publish" | "video_publish" {
  const platform = plan.input.platformConfigs.find(item => item.platformKey === platformKey)
  if (platform?.contentType === "video") return "video_publish"
  if (platform?.contentType === "authority_article") return "authority_media_publish"
  return "self_media_publish"
}

function validIso(value: unknown): string | undefined {
  const text = String(value || "").trim()
  if (!text) return undefined
  const date = new Date(text)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function normalizeHttpUrl(value: unknown): string {
  try {
    const url = new URL(String(value || "").trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error()
    return url.toString()
  } catch {
    throw new Error("发布证据必须是可访问的 http 或 https 网址")
  }
}
