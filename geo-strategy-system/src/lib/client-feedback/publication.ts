import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import type {
  ClientExecutionAction,
  ClientExecutionActionPublication,
  ClientExecutionPublicationPolicy,
  ClientFeedbackReport,
} from "@/types/client-feedback"

type PublicationAuditEntry = {
  id: string
  ownerUserId: string
  clientId: string
  actionIds: string[]
  publication: ClientExecutionActionPublication
  operatorUserId: string
  createdAt: string
}

const policyKey = (ownerUserId: string, clientId: string) => (
  `geo:client-feedback:publication-policy:${ownerUserId}:${clientId}`
)
const auditKey = (id: string) => `geo:client-feedback:publication-audit:${id}`
const auditIndexKey = (ownerUserId: string, clientId: string) => (
  `geo:client-feedback:publication-audits:${ownerUserId}:${clientId}`
)

const PUBLICATIONS = new Set<ClientExecutionActionPublication>([
  "internal",
  "summary",
  "full",
])

function cleanId(value: unknown, label: string): string {
  const result = String(value || "").trim()
  if (!result || result.length > 240) throw new Error(`${label}无效`)
  return result
}

export function normalizeActionPublication(
  value: unknown,
  fallback: ClientExecutionActionPublication = "internal",
): ClientExecutionActionPublication {
  return PUBLICATIONS.has(value as ClientExecutionActionPublication)
    ? value as ClientExecutionActionPublication
    : fallback
}

function defaultPolicy(
  ownerUserId: string,
  clientId: string,
): ClientExecutionPublicationPolicy {
  const now = new Date().toISOString()
  return {
    version: 1,
    ownerUserId,
    clientId,
    defaultPenetration: "full",
    overrides: {},
    updatedAt: now,
    updatedByUserId: ownerUserId,
  }
}

function normalizePolicy(
  ownerUserId: string,
  clientId: string,
  value: Partial<ClientExecutionPublicationPolicy> | null | undefined,
): ClientExecutionPublicationPolicy {
  const fallback = defaultPolicy(ownerUserId, clientId)
  const overrides = Object.fromEntries(
    Object.entries(value?.overrides || {})
      .filter(([actionId]) => actionId && actionId.length <= 240)
      .map(([actionId, entry]) => [actionId, {
        publication: normalizeActionPublication(entry?.publication, "internal"),
        updatedAt: String(entry?.updatedAt || fallback.updatedAt),
        updatedByUserId: String(entry?.updatedByUserId || ownerUserId),
      }]),
  )

  return {
    version: 1,
    ownerUserId,
    clientId,
    defaultPenetration: normalizeActionPublication(
      value?.defaultPenetration,
      "full",
    ),
    overrides,
    updatedAt: String(value?.updatedAt || fallback.updatedAt),
    updatedByUserId: String(value?.updatedByUserId || ownerUserId),
  }
}

export async function getClientExecutionPublicationPolicy(
  ownerUserId: string,
  clientId: string,
): Promise<ClientExecutionPublicationPolicy> {
  const owner = cleanId(ownerUserId, "客户所有者")
  const client = cleanId(clientId, "客户")
  const stored = await kv.get<Partial<ClientExecutionPublicationPolicy>>(
    policyKey(owner, client),
  )
  return normalizePolicy(owner, client, stored)
}

export async function setDefaultPenetrationPublication(input: {
  ownerUserId: string
  clientId: string
  publication: ClientExecutionActionPublication
  operatorUserId: string
}): Promise<ClientExecutionPublicationPolicy> {
  const current = await getClientExecutionPublicationPolicy(
    input.ownerUserId,
    input.clientId,
  )
  const now = new Date().toISOString()
  const next = normalizePolicy(input.ownerUserId, input.clientId, {
    ...current,
    defaultPenetration: normalizeActionPublication(input.publication, "full"),
    updatedAt: now,
    updatedByUserId: cleanId(input.operatorUserId, "操作人"),
  })
  await kv.set(policyKey(next.ownerUserId, next.clientId), next)
  return next
}

export async function setActionPublications(input: {
  ownerUserId: string
  clientId: string
  actionIds: string[]
  publication: ClientExecutionActionPublication
  operatorUserId: string
}): Promise<ClientExecutionPublicationPolicy> {
  const actionIds = Array.from(new Set(
    input.actionIds.map(actionId => cleanId(actionId, "动作")),
  )).slice(0, 200)
  if (actionIds.length === 0) throw new Error("请选择要调整的动作")

  const current = await getClientExecutionPublicationPolicy(
    input.ownerUserId,
    input.clientId,
  )
  const publication = normalizeActionPublication(input.publication)
  const operatorUserId = cleanId(input.operatorUserId, "操作人")
  const now = new Date().toISOString()
  const overrides = { ...current.overrides }
  for (const actionId of actionIds) {
    overrides[actionId] = {
      publication,
      updatedAt: now,
      updatedByUserId: operatorUserId,
    }
  }
  const next = normalizePolicy(input.ownerUserId, input.clientId, {
    ...current,
    overrides,
    updatedAt: now,
    updatedByUserId: operatorUserId,
  })
  const audit: PublicationAuditEntry = {
    id: `cfpa_${randomUUID().replace(/-/g, "")}`,
    ownerUserId: next.ownerUserId,
    clientId: next.clientId,
    actionIds,
    publication,
    operatorUserId,
    createdAt: now,
  }
  await Promise.all([
    kv.set(policyKey(next.ownerUserId, next.clientId), next),
    kv.set(auditKey(audit.id), audit),
    kv.sadd(auditIndexKey(next.ownerUserId, next.clientId), audit.id),
  ])
  return next
}

export function resolveActionPublication(
  action: ClientExecutionAction,
  policy: ClientExecutionPublicationPolicy,
): ClientExecutionActionPublication {
  const override = policy.overrides[action.id]?.publication
  if (override) return override
  if (action.source === "system" && action.category === "penetration_check") {
    return policy.defaultPenetration
  }
  if (action.publication) {
    return normalizeActionPublication(
      action.publication,
      action.visibility === "client" ? "summary" : "internal",
    )
  }
  return action.visibility === "client" ? "summary" : "internal"
}

export function applyActionPublication(
  action: ClientExecutionAction,
  policy: ClientExecutionPublicationPolicy,
): ClientExecutionAction {
  const publication = resolveActionPublication(action, policy)
  return {
    ...action,
    publication,
    visibility: publication === "internal" ? "internal" : "client",
  }
}

export function publicationForClientViewer(
  action: ClientExecutionAction,
  viewerUserId: string,
  policy?: ClientExecutionPublicationPolicy,
): ClientExecutionActionPublication {
  const explicitOverride = policy?.overrides[action.id]?.publication
  if (explicitOverride) return explicitOverride
  if (
    action.source === "system"
    && action.category === "penetration_check"
    && action.createdByUserId === viewerUserId
  ) {
    return "full"
  }
  return normalizeActionPublication(
    action.publication,
    action.visibility === "client" ? "summary" : "internal",
  )
}

export function penetrationHistoryActionId(historyId: string): string {
  return `system_${historyId}`
}

export function penetrationHistoryPublication(
  policy: ClientExecutionPublicationPolicy,
  input: {
    historyId: string
    actorUserId?: string
    viewerUserId?: string
  },
): ClientExecutionActionPublication {
  const explicitOverride = policy.overrides[
    penetrationHistoryActionId(input.historyId)
  ]?.publication
  if (explicitOverride) return explicitOverride
  if (
    input.viewerUserId
    && input.actorUserId
    && input.actorUserId === input.viewerUserId
  ) {
    return "full"
  }
  return policy.defaultPenetration
}

export function sanitizeFeedbackReportForClient(
  report: ClientFeedbackReport,
  policy: ClientExecutionPublicationPolicy,
  options: {
    allowPenetrationResults?: boolean
  } = {},
): ClientFeedbackReport {
  const actions = report.snapshot.actions
    .map(action => applyActionPublication(action, policy))
    .filter(action => action.publication !== "internal")
    .map(action => (
      action.publication === "full"
      && (
        action.resultRef?.module !== "penetration"
        || options.allowPenetrationResults !== false
      )
    )
      ? action
      : {
          ...action,
          resultRef: undefined,
          sourceRecordId: undefined,
        })
  return {
    ...report,
    snapshot: {
      ...report.snapshot,
      actions,
      evidenceRecordCount: actions.reduce((sum, action) => (
        sum + action.evidence.length + (action.resultRef ? 1 : 0)
      ), 0),
    },
  }
}
