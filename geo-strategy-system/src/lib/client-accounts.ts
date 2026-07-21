import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import type {
  ClientAccountStatus,
  WorkspaceAccountAccess,
} from "@/types"

export type ClientAccountLink = {
  version: 1
  userId: string
  ownerUserId: string
  clientId: string
  clientName: string
  status: ClientAccountStatus
  monthlyCredits: number
  provisioning: "admin" | "owner"
  billingMode: "monthly_grant" | "self_funded"
  grantedByUserId: string
  createdAt: string
  updatedAt: string
}

export type ClientAccountAuditAction =
  | "linked"
  | "updated"
  | "activated"
  | "suspended"
  | "unlinked"

export type ClientAccountAuditEntry = {
  id: string
  userId: string
  action: ClientAccountAuditAction
  operatorUserId: string
  createdAt: string
  before?: ClientAccountLink
  after?: ClientAccountLink
}

export type WorkspaceAccessScope =
  | {
      ok: true
      mode: "standard"
      actorUserId: string
      ownerUserId: string
      clientId?: string
      link: null
    }
  | {
      ok: true
      mode: "client"
      actorUserId: string
      ownerUserId: string
      clientId: string
      link: ClientAccountLink
    }
  | {
      ok: false
      code: "CLIENT_ACCOUNT_SUSPENDED" | "CLIENT_ACCESS_DENIED"
      message: string
      link: ClientAccountLink
    }

const KEY_LINK = (userId: string) => `client_account:link:${userId}`
const KEY_LINK_INDEX = "client_account:links"
const KEY_AUDIT = (id: string) => `client_account:audit:${id}`
const KEY_AUDIT_INDEX = (userId: string) => `client_account:audit_index:${userId}`

function cleanId(value: unknown, label: string): string {
  const result = String(value || "").trim()
  if (!result || result.length > 200) throw new Error(`${label}无效`)
  return result
}

function cleanMonthlyCredits(value: unknown): number {
  const credits = Math.floor(Number(value))
  if (!Number.isFinite(credits) || credits < 0 || credits > 1_000_000) {
    throw new Error("每月专属额度必须是 0 到 1000000 之间的整数")
  }
  return credits
}

function normalizeLink(value: unknown): ClientAccountLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Partial<ClientAccountLink>
  if (
    input.version !== 1
    || !input.userId
    || !input.ownerUserId
    || !input.clientId
    || !input.clientName
    || (input.status !== "active" && input.status !== "suspended")
  ) return null

  return {
    version: 1,
    userId: String(input.userId),
    ownerUserId: String(input.ownerUserId),
    clientId: String(input.clientId),
    clientName: String(input.clientName),
    status: input.status,
    monthlyCredits: cleanMonthlyCredits(input.monthlyCredits),
    provisioning: input.provisioning === "owner" ? "owner" : "admin",
    billingMode: input.billingMode === "self_funded" ? "self_funded" : "monthly_grant",
    grantedByUserId: String(input.grantedByUserId || ""),
    createdAt: String(input.createdAt || ""),
    updatedAt: String(input.updatedAt || ""),
  }
}

async function writeAudit(input: {
  userId: string
  action: ClientAccountAuditAction
  operatorUserId: string
  before?: ClientAccountLink | null
  after?: ClientAccountLink | null
}): Promise<ClientAccountAuditEntry> {
  const entry: ClientAccountAuditEntry = {
    id: `client_audit_${randomUUID().replace(/-/g, "")}`,
    userId: input.userId,
    action: input.action,
    operatorUserId: input.operatorUserId,
    createdAt: new Date().toISOString(),
    before: input.before || undefined,
    after: input.after || undefined,
  }
  await kv.set(KEY_AUDIT(entry.id), entry)
  await kv.sadd(KEY_AUDIT_INDEX(entry.userId), entry.id)
  return entry
}

export async function getClientAccountLink(userId: string): Promise<ClientAccountLink | null> {
  const stored = await kv.get<ClientAccountLink>(KEY_LINK(userId))
  if (stored === null || stored === undefined) return null
  const link = normalizeLink(stored)
  if (!link) {
    throw new Error("客户专属授权数据异常，请联系管理员检查")
  }
  return link
}

export async function listClientAccountLinks(): Promise<ClientAccountLink[]> {
  const userIds = await kv.smembers<string[]>(KEY_LINK_INDEX)
  const links = await Promise.all(userIds.map(getClientAccountLink))
  return links
    .filter((link): link is ClientAccountLink => Boolean(link))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function listClientAccountLinksForOwner(
  ownerUserId: string,
): Promise<ClientAccountLink[]> {
  return (await listClientAccountLinks())
    .filter(link => link.ownerUserId === ownerUserId)
}

export async function listClientAccountAudit(
  userId: string,
  limit = 30,
): Promise<ClientAccountAuditEntry[]> {
  const ids = await kv.smembers<string[]>(KEY_AUDIT_INDEX(userId))
  const entries = await Promise.all(ids.map(id => kv.get<ClientAccountAuditEntry>(KEY_AUDIT(id))))
  return entries
    .filter((entry): entry is ClientAccountAuditEntry => Boolean(entry))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(1, Math.min(100, Math.floor(limit))))
}

export async function saveClientAccountLink(input: {
  userId: string
  ownerUserId: string
  clientId: string
  clientName: string
  monthlyCredits?: number
  status?: ClientAccountStatus
  provisioning?: ClientAccountLink["provisioning"]
  billingMode?: ClientAccountLink["billingMode"]
  operatorUserId: string
}): Promise<ClientAccountLink> {
  const userId = cleanId(input.userId, "用户")
  const ownerUserId = cleanId(input.ownerUserId, "客户所有者")
  const clientId = cleanId(input.clientId, "客户")
  if (userId === ownerUserId) throw new Error("客户专属账号不能关联自己名下的客户")

  const existing = await getClientAccountLink(userId)
  const now = new Date().toISOString()
  const link: ClientAccountLink = {
    version: 1,
    userId,
    ownerUserId,
    clientId,
    clientName: String(input.clientName || "").trim().slice(0, 160) || "客户面板",
    status: input.status || existing?.status || "active",
    monthlyCredits: cleanMonthlyCredits(input.monthlyCredits ?? existing?.monthlyCredits ?? 1000),
    provisioning: input.provisioning || existing?.provisioning || "admin",
    billingMode: input.billingMode || existing?.billingMode || "monthly_grant",
    grantedByUserId: cleanId(input.operatorUserId, "授权人"),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  await kv.set(KEY_LINK(userId), link)
  await kv.sadd(KEY_LINK_INDEX, userId)
  await writeAudit({
    userId,
    action: existing ? "updated" : "linked",
    operatorUserId: input.operatorUserId,
    before: existing,
    after: link,
  })
  return link
}

export async function setClientAccountStatus(input: {
  userId: string
  status: ClientAccountStatus
  operatorUserId: string
}): Promise<ClientAccountLink> {
  const existing = await getClientAccountLink(input.userId)
  if (!existing) throw new Error("该用户还没有客户专属授权")
  const link: ClientAccountLink = {
    ...existing,
    status: input.status,
    updatedAt: new Date().toISOString(),
  }
  await kv.set(KEY_LINK(link.userId), link)
  await writeAudit({
    userId: link.userId,
    action: input.status === "active" ? "activated" : "suspended",
    operatorUserId: input.operatorUserId,
    before: existing,
    after: link,
  })
  return link
}

export async function deleteClientAccountLink(input: {
  userId: string
  operatorUserId: string
}): Promise<boolean> {
  const existing = await getClientAccountLink(input.userId)
  if (!existing) return false
  await kv.del(KEY_LINK(input.userId))
  await kv.srem(KEY_LINK_INDEX, input.userId)
  await writeAudit({
    userId: input.userId,
    action: "unlinked",
    operatorUserId: input.operatorUserId,
    before: existing,
  })
  return true
}

export async function getWorkspaceAccountAccess(userId: string): Promise<WorkspaceAccountAccess> {
  const link = await getClientAccountLink(userId)
  if (!link) {
    return {
      mode: "standard",
      status: "active",
      canCreateClients: true,
      canManageClientIdentity: true,
      canRunPenetration: true,
      canRunOtherModules: true,
      canCreateReports: true,
      canViewFeedbackReports: true,
      canManageFeedbackReports: true,
    }
  }
  return {
    mode: "client",
    status: link.status,
    clientId: link.clientId,
    clientName: link.clientName,
    monthlyCredits: link.monthlyCredits,
    canCreateClients: false,
    canManageClientIdentity: false,
    canRunPenetration: link.status === "active",
    canRunOtherModules: false,
    canCreateReports: false,
    canViewFeedbackReports: true,
    canManageFeedbackReports: false,
  }
}

export async function resolveWorkspaceAccess(
  userId: string,
  requestedClientId?: string,
): Promise<WorkspaceAccessScope> {
  const link = await getClientAccountLink(userId)
  if (!link) {
    return {
      ok: true,
      mode: "standard",
      actorUserId: userId,
      ownerUserId: userId,
      clientId: requestedClientId,
      link: null,
    }
  }
  if (link.status !== "active") {
    return {
      ok: false,
      code: "CLIENT_ACCOUNT_SUSPENDED",
      message: "客户专属账号已暂停，请联系管理员恢复授权",
      link,
    }
  }
  if (requestedClientId && requestedClientId !== link.clientId) {
    return {
      ok: false,
      code: "CLIENT_ACCESS_DENIED",
      message: "该账号只能访问已授权的客户面板",
      link,
    }
  }
  return {
    ok: true,
    mode: "client",
    actorUserId: userId,
    ownerUserId: link.ownerUserId,
    clientId: link.clientId,
    link,
  }
}

export async function canRunBillableFeature(
  userId: string,
  featureKey?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const link = await getClientAccountLink(userId)
  if (!link) return { ok: true }
  if (link.status !== "active") {
    return { ok: false, message: "客户专属账号已暂停，请联系管理员恢复授权" }
  }
  if (featureKey === "penetrationSlot") return { ok: true }
  return {
    ok: false,
    message: "客户专属账号仅可运行疑问句检测，当前模块仅支持查看",
  }
}

export async function requireStandardAccountMode(
  userId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const link = await getClientAccountLink(userId)
  if (!link) return { ok: true }
  if (link.status !== "active") {
    return { ok: false, message: "客户专属账号已暂停，请联系管理员恢复授权" }
  }
  return {
    ok: false,
    message: "客户专属账号在当前模块仅支持查看",
  }
}

export const CLIENT_ACCOUNT_ALLOWED_PATCH_FIELDS = new Set([
  "questions",
  "selectedModels",
  "penetration",
  "penetrationJobId",
])
