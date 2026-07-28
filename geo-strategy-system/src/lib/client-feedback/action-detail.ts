import "server-only"

import {
  applyActionPublication,
  getClientExecutionPublicationPolicy,
  publicationForClientViewer,
} from "@/lib/client-feedback/publication"
import {
  getClientExecutionAction,
  listClientExecutionActions,
} from "@/lib/client-feedback/store"
import {
  requireOperationAccess,
  type OperationAccessContext,
} from "@/lib/team-access"
import { listWorkspaceClientSummaries } from "@/lib/workspace-store"
import type {
  ClientExecutionAction,
  ClientExecutionActionCategory,
  ClientExecutionActionDetail,
  ClientExecutionActionDetailEvidence,
  ClientExecutionActionDetailPlatform,
  ClientExecutionPublicationPolicy,
} from "@/types/client-feedback"

const PUBLICATION_CATEGORIES = new Set<ClientExecutionActionCategory>([
  "self_media_publish",
  "authority_media_publish",
  "video_publish",
])

export class ClientExecutionActionDetailError extends Error {
  code: "NOT_FOUND" | "DETAIL_NOT_PUBLISHED"

  constructor(
    code: ClientExecutionActionDetailError["code"],
    message: string,
  ) {
    super(message)
    this.name = "ClientExecutionActionDetailError"
    this.code = code
  }
}

function publicationForViewer(
  action: ClientExecutionAction,
  access: OperationAccessContext,
  viewerUserId: string,
  policy: ClientExecutionPublicationPolicy,
): ClientExecutionAction {
  const applied = applyActionPublication(action, policy)
  if (access.mode !== "client") return applied
  const publication = publicationForClientViewer(
    applied,
    viewerUserId,
    policy,
  )
  return {
    ...applied,
    publication,
    visibility: publication === "internal" ? "internal" : "client",
  }
}

function platformFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, "")
  } catch {
    return ""
  }
}

function detailEvidence(
  actions: ClientExecutionAction[],
): ClientExecutionActionDetailEvidence[] {
  const seen = new Set<string>()
  const evidence: ClientExecutionActionDetailEvidence[] = []
  for (const action of actions) {
    for (const item of action.evidence) {
      const key = item.url.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      evidence.push({
        ...item,
        label: /^(查看)?执行证据$|^查看证据$/.test(item.label.trim())
          ? action.title
          : item.label,
        actionId: action.id,
        platform: action.platform || platformFromUrl(item.url) || undefined,
        occurredAt: action.occurredAt,
      })
    }
  }
  return evidence
}

function platformSummary(
  actions: ClientExecutionAction[],
  evidence: ClientExecutionActionDetailEvidence[],
): ClientExecutionActionDetailPlatform[] {
  const counts = new Map<string, number>()
  if (evidence.length > 0) {
    for (const item of evidence) {
      const name = String(item.platform || "其他平台").trim() || "其他平台"
      counts.set(name, (counts.get(name) || 0) + 1)
    }
  } else {
    for (const action of actions) {
      const name = String(action.platform || "未填写平台").trim() || "未填写平台"
      counts.set(name, (counts.get(name) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
}

function actionQuantity(
  actions: ClientExecutionAction[],
  fallback: number,
): number {
  const quantity = actions.reduce((sum, action) => (
    sum + (
      typeof action.quantity === "number" && Number.isFinite(action.quantity)
        ? Math.max(0, action.quantity)
        : 0
    )
  ), 0)
  return quantity > 0 ? quantity : fallback
}

export async function getClientExecutionActionDetail(input: {
  userId: string
  clientId: string
  actionId: string
}): Promise<ClientExecutionActionDetail> {
  const access = await requireOperationAccess({
    userId: input.userId,
    clientId: input.clientId,
    module: "feedback",
    action: "view",
  })
  const [storedAction, policy, clientRecords] = await Promise.all([
    getClientExecutionAction(
      access.dataOwnerUserId,
      access.clientId,
      input.actionId,
    ),
    getClientExecutionPublicationPolicy(
      access.dataOwnerUserId,
      access.clientId,
    ),
    listWorkspaceClientSummaries(access.dataOwnerUserId),
  ])
  if (!storedAction) {
    throw new ClientExecutionActionDetailError(
      "NOT_FOUND",
      "动作记录不存在或已被删除",
    )
  }

  const action = publicationForViewer(
    storedAction,
    access,
    input.userId,
    policy,
  )
  if (access.mode === "client" && action.publication !== "full") {
    throw new ClientExecutionActionDetailError(
      "DETAIL_NOT_PUBLISHED",
      "该动作的详细内容尚未向当前客户开放",
    )
  }

  let relatedActions = [action]
  if (action.importBatchId) {
    const allActions = await listClientExecutionActions(
      access.dataOwnerUserId,
      access.clientId,
    )
    relatedActions = allActions
      .filter(candidate => (
        candidate.importBatchId === action.importBatchId
        && candidate.category === action.category
      ))
      .map(candidate => publicationForViewer(
        candidate,
        access,
        input.userId,
        policy,
      ))
      .filter(candidate => (
        access.mode !== "client" || candidate.publication === "full"
      ))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
  }

  const evidence = detailEvidence(relatedActions)
  const itemCount = evidence.length || relatedActions.length
  const clientName = clientRecords.find(record => (
    record.id === access.clientId
  ))?.name || "客户项目"

  return {
    kind: PUBLICATION_CATEGORIES.has(action.category)
      ? "publication"
      : "general",
    clientId: access.clientId,
    clientName,
    teamId: access.teamId,
    accessMode: access.mode === "client" ? "client" : "standard",
    action,
    relatedActions,
    evidence,
    platforms: platformSummary(relatedActions, evidence),
    itemCount,
    totalQuantity: actionQuantity(relatedActions, itemCount),
    unit: action.unit || (action.category === "video_publish" ? "条" : "篇"),
  }
}
