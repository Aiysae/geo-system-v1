import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import { hasTeamPermission } from "@/lib/team-permissions"
import {
  normalizeClientAccountPermissionPolicy,
  type ClientPenetrationResultDetail,
} from "@/lib/client-account-policy"
import type { TeamPermissionKey } from "@/lib/team-permissions"
import {
  getTeam,
  getTeamClientShare,
  getTeamMember,
} from "@/lib/team-store"
import type {
  ClientAccountStatus,
  WorkspaceAccountAccess,
} from "@/types"

export type ClientAccountLink = {
  version: 3
  userId: string
  parentUserId: string
  dataOwnerUserId: string
  sourceType: "personal" | "team"
  teamId?: string
  /**
   * @deprecated Compatibility alias for dataOwnerUserId. New code must choose
   * parentUserId for account management or dataOwnerUserId for workspace data.
   */
  ownerUserId: string
  clientId: string
  clientName: string
  status: ClientAccountStatus
  monthlyCredits: number
  provisioning: "admin" | "owner"
  billingMode: "monthly_grant" | "self_funded"
  permissionKeys: TeamPermissionKey[]
  penetrationResultDetail: ClientPenetrationResultDetail
  grantedByUserId: string
  createdAt: string
  updatedAt: string
}

export type ClientAccountAuditAction =
  | "linked"
  | "updated"
  | "activated"
  | "suspended"
  | "source_revoked"
  | "unlinked"
  | "permissions_updated"

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
      code:
        | "CLIENT_ACCOUNT_SUSPENDED"
        | "CLIENT_ACCESS_DENIED"
        | "CLIENT_SOURCE_REVOKED"
      message: string
      link: ClientAccountLink
    }

const KEY_LINK = (userId: string) => `client_account:link:${userId}`
const KEY_LINK_INDEX = "client_account:links"
const KEY_PARENT_INDEX = (parentUserId: string) => (
  `client_account:parent_links:${encodeURIComponent(parentUserId)}`
)
const KEY_SOURCE_LINK = (
  sourceType: ClientAccountLink["sourceType"],
  parentUserId: string,
  dataOwnerUserId: string,
  clientId: string,
  teamId?: string,
) => [
  "client_account:source",
  sourceType,
  encodeURIComponent(parentUserId),
  encodeURIComponent(dataOwnerUserId),
  encodeURIComponent(teamId || "-"),
  encodeURIComponent(clientId),
].join(":")
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
  const input = value as Partial<Omit<ClientAccountLink, "version">> & {
    version?: 1 | 2 | 3
    ownerUserId?: string
  }
  if (
    (input.version !== 1 && input.version !== 2 && input.version !== 3)
    || !input.userId
    || !input.ownerUserId
    || !input.clientId
    || !input.clientName
    || (input.status !== "active" && input.status !== "suspended")
  ) return null

  const dataOwnerUserId = String(input.dataOwnerUserId || input.ownerUserId)
  const parentUserId = String(input.parentUserId || input.ownerUserId)
  const sourceType = input.sourceType === "team" ? "team" : "personal"
  const teamId = sourceType === "team" ? String(input.teamId || "").trim() : ""
  if (sourceType === "team" && !teamId) return null
  const permissionPolicy = normalizeClientAccountPermissionPolicy(input)

  return {
    version: 3,
    userId: String(input.userId),
    parentUserId,
    dataOwnerUserId,
    sourceType,
    teamId: teamId || undefined,
    ownerUserId: dataOwnerUserId,
    clientId: String(input.clientId),
    clientName: String(input.clientName),
    status: input.status,
    monthlyCredits: cleanMonthlyCredits(input.monthlyCredits),
    provisioning: input.provisioning === "owner" ? "owner" : "admin",
    billingMode: input.billingMode === "self_funded" ? "self_funded" : "monthly_grant",
    permissionKeys: permissionPolicy.permissionKeys,
    penetrationResultDetail: permissionPolicy.penetrationResultDetail,
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
  const stored = await kv.get<unknown>(KEY_LINK(userId))
  if (stored === null || stored === undefined) return null
  const link = normalizeLink(stored)
  if (!link) {
    throw new Error("客户专属授权数据异常，请联系管理员检查")
  }
  if ((stored as { version?: number }).version !== 3) {
    await Promise.all([
      kv.set(KEY_LINK(userId), link),
      kv.sadd(KEY_PARENT_INDEX(link.parentUserId), userId),
      kv.set(sourceLinkKey(link), userId),
    ])
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
  parentUserId: string,
): Promise<ClientAccountLink[]> {
  const indexedUserIds = await kv.smembers<string[]>(KEY_PARENT_INDEX(parentUserId))
  if (indexedUserIds.length > 0) {
    const links = await Promise.all(indexedUserIds.map(getClientAccountLink))
    return links
      .filter((link): link is ClientAccountLink => Boolean(
        link && link.parentUserId === parentUserId,
      ))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  const links = (await listClientAccountLinks())
    .filter(link => link.parentUserId === parentUserId)
  if (links.length > 0) {
    await kv.sadd(KEY_PARENT_INDEX(parentUserId), ...links.map(link => link.userId))
  }
  return links
}

function sourceLinkKey(link: Pick<
  ClientAccountLink,
  "sourceType" | "parentUserId" | "dataOwnerUserId" | "clientId" | "teamId"
>): string {
  return KEY_SOURCE_LINK(
    link.sourceType,
    link.parentUserId,
    link.dataOwnerUserId,
    link.clientId,
    link.teamId,
  )
}

export async function getClientAccountLinkForSource(input: {
  parentUserId: string
  dataOwnerUserId: string
  clientId: string
  sourceType?: ClientAccountLink["sourceType"]
  teamId?: string
}): Promise<ClientAccountLink | null> {
  const sourceType = input.sourceType === "team" ? "team" : "personal"
  const key = KEY_SOURCE_LINK(
    sourceType,
    input.parentUserId,
    input.dataOwnerUserId,
    input.clientId,
    input.teamId,
  )
  const indexedUserId = await kv.get<string>(key)
  if (indexedUserId) {
    const indexed = await getClientAccountLink(indexedUserId)
    if (indexed && sourceLinkKey(indexed) === key) return indexed
    await kv.del(key)
  }
  const match = (await listClientAccountLinksForOwner(input.parentUserId)).find(link => (
    link.sourceType === sourceType
    && link.dataOwnerUserId === input.dataOwnerUserId
    && link.clientId === input.clientId
    && (link.teamId || "") === (input.teamId || "")
  )) || null
  if (match) await kv.set(key, match.userId)
  return match
}

export async function getClientAccountSourceState(
  link: ClientAccountLink,
): Promise<
  | { ok: true }
  | { ok: false; code: "CLIENT_SOURCE_REVOKED"; message: string }
> {
  if (link.sourceType !== "team") return { ok: true }
  if (!link.teamId) {
    return {
      ok: false,
      code: "CLIENT_SOURCE_REVOKED",
      message: "客户来源授权信息不完整，请联系主账号重新授权",
    }
  }
  const [team, share] = await Promise.all([
    getTeam(link.teamId),
    getTeamClientShare(link.teamId, link.dataOwnerUserId, link.clientId),
  ])
  if (!team || team.status !== "active" || !share) {
    return {
      ok: false,
      code: "CLIENT_SOURCE_REVOKED",
      message: "该客户的团队共享已取消，请联系主账号重新授权",
    }
  }
  return { ok: true }
}

export async function getClientAccountManagerAccess(input: {
  actorUserId: string
  link: ClientAccountLink
}): Promise<{
  canManage: boolean
  canTransferCredits: boolean
  parentUserId: string
}> {
  if (input.actorUserId === input.link.parentUserId) {
    return {
      canManage: true,
      canTransferCredits: true,
      parentUserId: input.link.parentUserId,
    }
  }
  if (input.link.sourceType !== "team" || !input.link.teamId) {
    return {
      canManage: false,
      canTransferCredits: false,
      parentUserId: input.link.parentUserId,
    }
  }
  const [team, member] = await Promise.all([
    getTeam(input.link.teamId),
    getTeamMember(input.link.teamId, input.actorUserId),
  ])
  const canManage = Boolean(
    team?.status === "active"
    && team.ownerUserId === input.link.parentUserId
    && member?.status === "active"
    && (
      member.role === "owner"
      || hasTeamPermission(member.permissionKeys, "client", "manage")
    ),
  )
  return {
    canManage,
    canTransferCredits: false,
    parentUserId: input.link.parentUserId,
  }
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
  ownerUserId?: string
  parentUserId?: string
  dataOwnerUserId?: string
  sourceType?: ClientAccountLink["sourceType"]
  teamId?: string
  clientId: string
  clientName: string
  monthlyCredits?: number
  status?: ClientAccountStatus
  provisioning?: ClientAccountLink["provisioning"]
  billingMode?: ClientAccountLink["billingMode"]
  permissionKeys?: TeamPermissionKey[]
  penetrationResultDetail?: ClientPenetrationResultDetail
  operatorUserId: string
}): Promise<ClientAccountLink> {
  const userId = cleanId(input.userId, "用户")
  const parentUserId = cleanId(
    input.parentUserId || input.ownerUserId,
    "客户账号管理者",
  )
  const dataOwnerUserId = cleanId(
    input.dataOwnerUserId || input.ownerUserId || parentUserId,
    "客户资料所有者",
  )
  const sourceType = input.sourceType === "team" ? "team" : "personal"
  const teamId = sourceType === "team"
    ? cleanId(input.teamId, "客户来源团队")
    : undefined
  const clientId = cleanId(input.clientId, "客户")
  if (userId === parentUserId) throw new Error("客户专属账号不能由自己管理")

  const existing = await getClientAccountLink(userId)
  const duplicate = await getClientAccountLinkForSource({
    parentUserId,
    dataOwnerUserId,
    clientId,
    sourceType,
    teamId,
  })
  if (duplicate && duplicate.userId !== userId) {
    throw new Error("该客户面板已经关联了一个客户专属账号")
  }
  const now = new Date().toISOString()
  const permissionPolicy = normalizeClientAccountPermissionPolicy({
    permissionKeys: input.permissionKeys ?? existing?.permissionKeys,
    penetrationResultDetail: input.penetrationResultDetail
      ?? existing?.penetrationResultDetail,
  })
  const link: ClientAccountLink = {
    version: 3,
    userId,
    parentUserId,
    dataOwnerUserId,
    sourceType,
    teamId,
    ownerUserId: dataOwnerUserId,
    clientId,
    clientName: String(input.clientName || "").trim().slice(0, 160) || "客户面板",
    status: input.status || existing?.status || "active",
    monthlyCredits: cleanMonthlyCredits(input.monthlyCredits ?? existing?.monthlyCredits ?? 1000),
    provisioning: input.provisioning || existing?.provisioning || "admin",
    billingMode: input.billingMode || existing?.billingMode || "monthly_grant",
    permissionKeys: permissionPolicy.permissionKeys,
    penetrationResultDetail: permissionPolicy.penetrationResultDetail,
    grantedByUserId: cleanId(input.operatorUserId, "授权人"),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  await kv.set(KEY_LINK(userId), link)
  await kv.sadd(KEY_LINK_INDEX, userId)
  await kv.sadd(KEY_PARENT_INDEX(parentUserId), userId)
  await kv.set(sourceLinkKey(link), userId)
  if (existing) {
    if (existing.parentUserId !== parentUserId) {
      await kv.srem(KEY_PARENT_INDEX(existing.parentUserId), userId)
    }
    if (sourceLinkKey(existing) !== sourceLinkKey(link)) {
      await kv.del(sourceLinkKey(existing))
    }
  }
  await writeAudit({
    userId,
    action: existing ? "updated" : "linked",
    operatorUserId: input.operatorUserId,
    before: existing,
    after: link,
  })
  return link
}

export async function setClientAccountPermissions(input: {
  userId: string
  permissionKeys: TeamPermissionKey[]
  penetrationResultDetail: ClientPenetrationResultDetail
  operatorUserId: string
}): Promise<ClientAccountLink> {
  const existing = await getClientAccountLink(input.userId)
  if (!existing) throw new Error("该用户还没有客户专属授权")
  const policy = normalizeClientAccountPermissionPolicy(input)
  const link: ClientAccountLink = {
    ...existing,
    permissionKeys: policy.permissionKeys,
    penetrationResultDetail: policy.penetrationResultDetail,
    updatedAt: new Date().toISOString(),
  }
  await kv.set(KEY_LINK(link.userId), link)
  await writeAudit({
    userId: link.userId,
    action: "permissions_updated",
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
  await kv.srem(KEY_PARENT_INDEX(existing.parentUserId), input.userId)
  await kv.del(sourceLinkKey(existing))
  await writeAudit({
    userId: input.userId,
    action: "unlinked",
    operatorUserId: input.operatorUserId,
    before: existing,
  })
  return true
}

export async function getRecoverableClientAccountLink(
  userId: string,
  parentUserId?: string,
): Promise<ClientAccountLink | null> {
  if (await getClientAccountLink(userId)) return null
  const audit = await listClientAccountAudit(userId, 100)
  const previous = audit.find(entry =>
    entry.action === "unlinked"
    && entry.before
    && (!parentUserId || entry.before.parentUserId === parentUserId)
  )?.before
  return previous ? normalizeLink(previous) : null
}

export async function restoreClientAccountLink(input: {
  userId: string
  operatorUserId: string
  parentUserId?: string
  ownerUserId?: string
  clientName?: string
}): Promise<ClientAccountLink> {
  const expectedParentUserId = input.parentUserId || input.ownerUserId
  const previous = await getRecoverableClientAccountLink(input.userId, expectedParentUserId)
  if (!previous) throw new Error("该账号没有可恢复的客户授权记录")
  return saveClientAccountLink({
    userId: previous.userId,
    parentUserId: previous.parentUserId,
    dataOwnerUserId: previous.dataOwnerUserId,
    sourceType: previous.sourceType,
    teamId: previous.teamId,
    clientId: previous.clientId,
    clientName: input.clientName || previous.clientName,
    monthlyCredits: previous.monthlyCredits,
    status: "active",
    provisioning: previous.provisioning,
    billingMode: previous.billingMode,
    permissionKeys: previous.permissionKeys,
    penetrationResultDetail: previous.penetrationResultDetail,
    operatorUserId: input.operatorUserId,
  })
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
  const source = await getClientAccountSourceState(link)
  const permissionPolicy = normalizeClientAccountPermissionPolicy(link)
  const active = link.status === "active" && source.ok
  return {
    mode: "client",
    status: link.status === "active" && source.ok ? "active" : "suspended",
    clientId: link.clientId,
    clientName: link.clientName,
    dataOwnerUserId: link.dataOwnerUserId,
    billingUserId: link.userId,
    monthlyCredits: link.monthlyCredits,
    canCreateClients: false,
    canManageClientIdentity: false,
    permissionKeys: permissionPolicy.permissionKeys,
    penetrationResultDetail: permissionPolicy.penetrationResultDetail,
    canRunPenetration: active
      && hasTeamPermission(permissionPolicy.permissionKeys, "penetration", "execute"),
    canRunOtherModules: false,
    canCreateReports: false,
    canViewFeedbackReports: active
      && hasTeamPermission(permissionPolicy.permissionKeys, "feedback", "view"),
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
  const source = await getClientAccountSourceState(link)
  if (!source.ok) {
    return {
      ok: false,
      code: source.code,
      message: source.message,
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
    ownerUserId: link.dataOwnerUserId,
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
  const source = await getClientAccountSourceState(link)
  if (!source.ok) return { ok: false, message: source.message }
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
  const source = await getClientAccountSourceState(link)
  if (!source.ok) return { ok: false, message: source.message }
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
