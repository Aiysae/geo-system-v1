import "server-only"

import {
  getClientAccountLinkForSource,
  getClientAccountSourceState,
  type ClientAccountLink,
} from "@/lib/client-accounts"
import { hasTeamPermission } from "@/lib/team-permissions"
import {
  findTeamClientAccess,
  listAccessibleTeamClientShares,
} from "@/lib/team-store"
import {
  listWorkspaceClientSummaries,
  type WorkspaceClientSummary,
} from "@/lib/workspace-store"

type ClientAccessRefPayload = {
  version: 1
  sourceType: "personal" | "team"
  dataOwnerUserId: string
  clientId: string
  teamId?: string
}

export type ClientCatalogEntry = WorkspaceClientSummary & {
  accessRef: string
  sourceType: "personal" | "team"
  teamId?: string
  teamName?: string
  dataOwnerUserId: string
  parentUserId: string
  canEdit: boolean
  canDelete: boolean
  canManageClientAccount: boolean
  clientAccount: {
    userId: string
    status: ClientAccountLink["status"]
    sourceStatus: "active" | "revoked"
  } | null
}

export type ResolvedClientAccessRef = {
  accessRef: string
  sourceType: "personal" | "team"
  teamId?: string
  teamName?: string
  dataOwnerUserId: string
  parentUserId: string
  client: WorkspaceClientSummary
  canEdit: boolean
  canDelete: boolean
  canManageClientAccount: boolean
}

function cleanRefPart(value: unknown, label: string): string {
  const normalized = String(value || "").trim()
  if (!normalized || normalized.length > 240) throw new Error(`${label}无效`)
  return normalized
}

export function encodeClientAccessRef(input: Omit<ClientAccessRefPayload, "version">): string {
  const payload: ClientAccessRefPayload = {
    version: 1,
    sourceType: input.sourceType,
    dataOwnerUserId: cleanRefPart(input.dataOwnerUserId, "客户资料所有者"),
    clientId: cleanRefPart(input.clientId, "客户"),
    teamId: input.sourceType === "team"
      ? cleanRefPart(input.teamId, "团队")
      : undefined,
  }
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

export function decodeClientAccessRef(value: unknown): ClientAccessRefPayload {
  const encoded = String(value || "").trim()
  if (!encoded || encoded.length > 1_500 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("客户访问标识无效")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
  } catch {
    throw new Error("客户访问标识无效")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("客户访问标识无效")
  }
  const input = parsed as Partial<ClientAccessRefPayload>
  if (
    input.version !== 1
    || (input.sourceType !== "personal" && input.sourceType !== "team")
  ) {
    throw new Error("客户访问标识版本无效")
  }
  return {
    version: 1,
    sourceType: input.sourceType,
    dataOwnerUserId: cleanRefPart(input.dataOwnerUserId, "客户资料所有者"),
    clientId: cleanRefPart(input.clientId, "客户"),
    teamId: input.sourceType === "team"
      ? cleanRefPart(input.teamId, "团队")
      : undefined,
  }
}

async function accountForSource(input: {
  sourceType: "personal" | "team"
  parentUserId: string
  dataOwnerUserId: string
  clientId: string
  teamId?: string
}): Promise<ClientCatalogEntry["clientAccount"]> {
  const link = await getClientAccountLinkForSource(input)
  if (!link) return null
  const source = await getClientAccountSourceState(link)
  return {
    userId: link.userId,
    status: link.status,
    sourceStatus: source.ok ? "active" : "revoked",
  }
}

function findSummary(
  summariesByOwner: Map<string, WorkspaceClientSummary[]>,
  ownerUserId: string,
  clientId: string,
): WorkspaceClientSummary | null {
  return summariesByOwner.get(ownerUserId)?.find(client => client.id === clientId) || null
}

export async function listClientCatalog(userId: string): Promise<ClientCatalogEntry[]> {
  const [personalClients, teamAccesses] = await Promise.all([
    listWorkspaceClientSummaries(userId),
    listAccessibleTeamClientShares(userId),
  ])
  const ownerIds = Array.from(new Set(
    teamAccesses.map(access => access.share.clientOwnerUserId),
  ))
  const ownerSummaryEntries = await Promise.all(ownerIds.map(async ownerUserId => (
    [ownerUserId, await listWorkspaceClientSummaries(ownerUserId)] as const
  )))
  const summariesByOwner = new Map<string, WorkspaceClientSummary[]>([
    [userId, personalClients],
    ...ownerSummaryEntries,
  ])

  const personal = await Promise.all(personalClients.map(async client => {
    const accessRef = encodeClientAccessRef({
      sourceType: "personal",
      dataOwnerUserId: userId,
      clientId: client.id,
    })
    return {
      ...client,
      accessRef,
      sourceType: "personal" as const,
      dataOwnerUserId: userId,
      parentUserId: userId,
      canEdit: true,
      canDelete: true,
      canManageClientAccount: true,
      clientAccount: await accountForSource({
        sourceType: "personal",
        parentUserId: userId,
        dataOwnerUserId: userId,
        clientId: client.id,
      }),
    }
  }))

  const sharedCandidates = await Promise.all(teamAccesses.map(async access => {
    const client = findSummary(
      summariesByOwner,
      access.share.clientOwnerUserId,
      access.share.clientId,
    )
    if (!client) return null
    const canManageClientAccount = access.membership.role === "owner"
      || hasTeamPermission(access.permissionKeys, "client", "manage")
    const accessRef = encodeClientAccessRef({
      sourceType: "team",
      dataOwnerUserId: access.share.clientOwnerUserId,
      clientId: access.share.clientId,
      teamId: access.team.id,
    })
    return {
      ...client,
      accessRef,
      sourceType: "team" as const,
      teamId: access.team.id,
      teamName: access.team.name,
      dataOwnerUserId: access.share.clientOwnerUserId,
      parentUserId: access.team.ownerUserId,
      canEdit: hasTeamPermission(access.permissionKeys, "client", "edit"),
      canDelete: false,
      canManageClientAccount,
      clientAccount: await accountForSource({
        sourceType: "team",
        parentUserId: access.team.ownerUserId,
        dataOwnerUserId: access.share.clientOwnerUserId,
        clientId: access.share.clientId,
        teamId: access.team.id,
      }),
    }
  }))
  const shared = sharedCandidates.filter(
    (entry): entry is Exclude<(typeof sharedCandidates)[number], null> => entry !== null,
  )

  return [...personal, ...shared].sort((left, right) => (
    right.updatedAt.localeCompare(left.updatedAt)
  ))
}

export async function resolveClientAccessRef(
  userId: string,
  value: unknown,
): Promise<ResolvedClientAccessRef> {
  const payload = decodeClientAccessRef(value)
  const accessRef = encodeClientAccessRef(payload)
  if (payload.sourceType === "personal") {
    if (payload.dataOwnerUserId !== userId) throw new Error("该客户不属于当前账号")
    const client = (await listWorkspaceClientSummaries(userId))
      .find(item => item.id === payload.clientId)
    if (!client) throw new Error("客户面板不存在或已删除")
    return {
      accessRef,
      sourceType: "personal",
      dataOwnerUserId: userId,
      parentUserId: userId,
      client,
      canEdit: true,
      canDelete: true,
      canManageClientAccount: true,
    }
  }

  const access = await findTeamClientAccess({
    userId,
    teamId: payload.teamId,
    clientId: payload.clientId,
    dataOwnerUserId: payload.dataOwnerUserId,
  })
  if (!access) throw new Error("团队客户共享已取消或当前账号无权访问")
  const client = (await listWorkspaceClientSummaries(payload.dataOwnerUserId))
    .find(item => item.id === payload.clientId)
  if (!client) throw new Error("共享客户面板不存在或已删除")
  return {
    accessRef,
    sourceType: "team",
    teamId: access.team.id,
    teamName: access.team.name,
    dataOwnerUserId: payload.dataOwnerUserId,
    parentUserId: access.team.ownerUserId,
    client,
    canEdit: hasTeamPermission(access.permissionKeys, "client", "edit"),
    canDelete: false,
    canManageClientAccount: access.membership.role === "owner"
      || hasTeamPermission(access.permissionKeys, "client", "manage"),
  }
}
