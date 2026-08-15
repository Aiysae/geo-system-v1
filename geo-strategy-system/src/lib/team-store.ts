import "server-only"

import fs from "fs/promises"
import path from "path"
import { createHash, randomBytes, randomUUID } from "crypto"
import { Pool } from "pg"
import {
  ALL_TEAM_PERMISSIONS,
  hasTeamPermission,
  normalizeTeamPermissions,
  type TeamMemberStatus,
  type TeamPermissionKey,
  type TeamRole,
  type TeamShareScope,
  type TeamStatus,
} from "@/lib/team-permissions"
import { TEAM_SCHEMA_SQL } from "@/lib/team-schema"
import type {
  TeamAuditAction,
  TeamAuditRecord,
  TeamActionReminderAccess,
  TeamClientAccess,
  TeamClientShareRecord,
  TeamInviteRecord,
  TeamMemberRecord,
  TeamRecord,
  TeamSummary,
} from "@/types/team"

type FileTeamState = {
  teams: Record<string, TeamRecord>
  members: Record<string, TeamMemberRecord>
  invites: Record<string, TeamInviteRecord>
  shares: Record<string, TeamClientShareRecord>
  audits: Record<string, TeamAuditRecord>
}

type TeamRow = {
  id: string
  owner_user_id: string
  name: string
  status: TeamStatus
  created_at: string | Date
  updated_at: string | Date
}

type TeamMemberRow = {
  team_id: string
  user_id: string
  role: TeamRole
  status: TeamMemberStatus
  permission_keys: unknown
  invited_by_user_id: string
  joined_at: string | Date
  updated_at: string | Date
}

type TeamInviteRow = {
  id: string
  team_id: string
  email: string
  role: Exclude<TeamRole, "owner">
  permission_keys: unknown
  status: TeamInviteRecord["status"]
  token_hash: string
  invited_by_user_id: string
  created_at: string | Date
  expires_at: string | Date
  accepted_at: string | Date | null
  accepted_by_user_id: string | null
}

type TeamShareRow = {
  team_id: string
  client_owner_user_id: string
  client_id: string
  client_name: string
  scope: TeamShareScope
  member_user_ids: unknown
  created_by_user_id: string
  created_at: string | Date
  updated_at: string | Date
}

type TeamAuditRow = {
  id: string
  team_id: string
  actor_user_id: string
  action: TeamAuditAction
  target_user_id: string | null
  client_owner_user_id: string | null
  client_id: string | null
  metadata: unknown
  created_at: string | Date
}

type TeamActionReminderRow = {
  team_id: string
  team_name: string
  team_owner_user_id: string
  user_id: string
  role: TeamRole
  permission_keys: unknown
  client_owner_user_id: string
  client_id: string
  client_name: string
  scope: TeamShareScope
  member_user_ids: unknown
}

const DEFAULT_FILE_PATH = process.env.NODE_ENV === "production"
  ? "/var/lib/geo-system/teams.json"
  : path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "teams.json")

const teamGlobal = globalThis as typeof globalThis & {
  __geoTeamPool?: Pool
  __geoTeamSchemaPromise?: Promise<void>
  __geoTeamFileQueue?: Promise<unknown>
}

function backend(): "postgres" | "file" {
  const configured = String(process.env.TEAM_STORE || "").trim().toLowerCase()
  if (configured === "postgres" || configured === "file") return configured
  if (configured) throw new Error(`Unsupported TEAM_STORE: ${configured}`)
  return process.env.DATABASE_URL ? "postgres" : "file"
}

function pool(): Pool {
  if (teamGlobal.__geoTeamPool) return teamGlobal.__geoTeamPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required when TEAM_STORE=postgres")
  teamGlobal.__geoTeamPool = new Pool({
    connectionString,
    max: Math.max(1, Math.min(6, Number(process.env.TEAM_DB_POOL_MAX) || 3)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  })
  teamGlobal.__geoTeamPool.on("error", error => {
    console.error(`[team-db] ${error.message}`)
  })
  return teamGlobal.__geoTeamPool
}

export async function closeTeamStoreConnection(): Promise<void> {
  const activePool = teamGlobal.__geoTeamPool
  teamGlobal.__geoTeamPool = undefined
  teamGlobal.__geoTeamSchemaPromise = undefined
  if (activePool) await activePool.end()
}

export async function ensureTeamSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!teamGlobal.__geoTeamSchemaPromise) {
    teamGlobal.__geoTeamSchemaPromise = pool().query(TEAM_SCHEMA_SQL)
      .then(() => undefined)
      .catch(error => {
        teamGlobal.__geoTeamSchemaPromise = undefined
        throw error
      })
  }
  await teamGlobal.__geoTeamSchemaPromise
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function cleanName(value: unknown, fallback: string): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 100) || fallback
}

function cleanEmail(value: unknown): string {
  const email = String(value || "").trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("请输入有效邮箱")
  return email
}

function memberKey(teamId: string, userId: string): string {
  return `${teamId}:${userId}`
}

function shareKey(teamId: string, ownerUserId: string, clientId: string): string {
  return `${teamId}:${ownerUserId}:${clientId}`
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url")
}

function rowToTeam(row: TeamRow): TeamRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    status: row.status,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  }
}

function rowToMember(row: TeamMemberRow): TeamMemberRecord {
  return {
    teamId: row.team_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    permissionKeys: row.role === "owner"
      ? [...ALL_TEAM_PERMISSIONS]
      : normalizeTeamPermissions(row.permission_keys),
    invitedByUserId: row.invited_by_user_id,
    joinedAt: asIso(row.joined_at),
    updatedAt: asIso(row.updated_at),
  }
}

function rowToInvite(row: TeamInviteRow): TeamInviteRecord {
  const expired = row.status === "pending" && Date.parse(asIso(row.expires_at)) <= Date.now()
  return {
    id: row.id,
    teamId: row.team_id,
    email: row.email,
    role: row.role,
    permissionKeys: normalizeTeamPermissions(row.permission_keys),
    status: expired ? "expired" : row.status,
    tokenHash: row.token_hash,
    invitedByUserId: row.invited_by_user_id,
    createdAt: asIso(row.created_at),
    expiresAt: asIso(row.expires_at),
    acceptedAt: row.accepted_at ? asIso(row.accepted_at) : undefined,
    acceptedByUserId: row.accepted_by_user_id || undefined,
  }
}

function rowToShare(row: TeamShareRow): TeamClientShareRecord {
  return {
    teamId: row.team_id,
    clientOwnerUserId: row.client_owner_user_id,
    clientId: row.client_id,
    clientName: row.client_name,
    scope: row.scope,
    memberUserIds: Array.isArray(row.member_user_ids)
      ? row.member_user_ids.map(String).filter(Boolean)
      : [],
    createdByUserId: row.created_by_user_id,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  }
}

function rowToAudit(row: TeamAuditRow): TeamAuditRecord {
  return {
    id: row.id,
    teamId: row.team_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetUserId: row.target_user_id || undefined,
    clientOwnerUserId: row.client_owner_user_id || undefined,
    clientId: row.client_id || undefined,
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {},
    createdAt: asIso(row.created_at),
  }
}

function emptyFileState(): FileTeamState {
  return { teams: {}, members: {}, invites: {}, shares: {}, audits: {} }
}

async function readFileState(): Promise<FileTeamState> {
  const filePath = process.env.TEAM_FILE || DEFAULT_FILE_PATH
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(raw) as Partial<FileTeamState>
    return {
      teams: parsed.teams || {},
      members: parsed.members || {},
      invites: parsed.invites || {},
      shares: parsed.shares || {},
      audits: parsed.audits || {},
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFileState()
    throw error
  }
}

async function writeFileState(state: FileTeamState): Promise<void> {
  const filePath = process.env.TEAM_FILE || DEFAULT_FILE_PATH
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), "utf8")
  await fs.rename(tempPath, filePath)
}

async function withFileState<T>(
  operation: (state: FileTeamState) => T | Promise<T>,
  write = false,
): Promise<T> {
  const previous = teamGlobal.__geoTeamFileQueue || Promise.resolve()
  let release: () => void = () => undefined
  teamGlobal.__geoTeamFileQueue = new Promise<void>(resolve => {
    release = resolve
  })
  await previous
  try {
    const state = await readFileState()
    const result = await operation(state)
    if (write) await writeFileState(state)
    return result
  } finally {
    release()
  }
}

async function appendAudit(input: Omit<TeamAuditRecord, "id" | "createdAt">): Promise<void> {
  const record: TeamAuditRecord = {
    ...input,
    id: `taudit_${randomUUID().replace(/-/g, "")}`,
    createdAt: new Date().toISOString(),
  }
  if (backend() === "postgres") {
    await ensureTeamSchema()
    await pool().query(
      `INSERT INTO geo_team_audit_v1 (
        id, team_id, actor_user_id, action, target_user_id,
        client_owner_user_id, client_id, metadata, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        record.id,
        record.teamId,
        record.actorUserId,
        record.action,
        record.targetUserId || null,
        record.clientOwnerUserId || null,
        record.clientId || null,
        JSON.stringify(record.metadata || {}),
        record.createdAt,
      ],
    )
    return
  }
  await withFileState(state => {
    state.audits[record.id] = record
  }, true)
}

export async function createTeam(input: {
  ownerUserId: string
  name: string
}): Promise<TeamRecord> {
  const ownerUserId = String(input.ownerUserId || "").trim()
  if (!ownerUserId) throw new Error("团队所有者无效")
  const now = new Date().toISOString()
  const team: TeamRecord = {
    id: `team_${randomUUID().replace(/-/g, "")}`,
    ownerUserId,
    name: cleanName(input.name, "我的 GEO 团队"),
    status: "active",
    createdAt: now,
    updatedAt: now,
  }
  const owner: TeamMemberRecord = {
    teamId: team.id,
    userId: ownerUserId,
    role: "owner",
    status: "active",
    permissionKeys: [...ALL_TEAM_PERMISSIONS],
    invitedByUserId: ownerUserId,
    joinedAt: now,
    updatedAt: now,
  }

  if (backend() === "postgres") {
    await ensureTeamSchema()
    const client = await pool().connect()
    try {
      await client.query("BEGIN")
      const existing = await client.query(
        "SELECT id FROM geo_teams_v1 WHERE owner_user_id = $1 AND status = 'active' LIMIT 1",
        [ownerUserId],
      )
      if (existing.rows.length > 0) throw new Error("当前账号已经创建过团队")
      await client.query(
        `INSERT INTO geo_teams_v1 (id, owner_user_id, name, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [team.id, team.ownerUserId, team.name, team.status, team.createdAt, team.updatedAt],
      )
      await client.query(
        `INSERT INTO geo_team_members_v1 (
          team_id, user_id, role, status, permission_keys,
          invited_by_user_id, joined_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
        [
          owner.teamId,
          owner.userId,
          owner.role,
          owner.status,
          JSON.stringify(owner.permissionKeys),
          owner.invitedByUserId,
          owner.joinedAt,
          owner.updatedAt,
        ],
      )
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  } else {
    await withFileState(state => {
      if (Object.values(state.teams).some(item => (
        item.ownerUserId === ownerUserId && item.status === "active"
      ))) throw new Error("当前账号已经创建过团队")
      state.teams[team.id] = team
      state.members[memberKey(team.id, ownerUserId)] = owner
    }, true)
  }

  await appendAudit({
    teamId: team.id,
    actorUserId: ownerUserId,
    action: "team_created",
    metadata: { name: team.name },
  })
  return team
}

export async function getTeam(teamId: string): Promise<TeamRecord | null> {
  if (!teamId) return null
  if (backend() === "postgres") {
    await ensureTeamSchema()
    const result = await pool().query<TeamRow>(
      "SELECT * FROM geo_teams_v1 WHERE id = $1 LIMIT 1",
      [teamId],
    )
    return result.rows[0] ? rowToTeam(result.rows[0]) : null
  }
  return withFileState(state => state.teams[teamId] || null)
}

export async function updateTeam(input: {
  teamId: string
  actorUserId: string
  name?: string
  status?: TeamStatus
}): Promise<TeamRecord> {
  const team = await getTeam(input.teamId)
  if (!team) throw new Error("团队不存在")
  if (team.ownerUserId !== input.actorUserId) throw new Error("只有团队所有者可以修改团队")
  const next: TeamRecord = {
    ...team,
    name: input.name === undefined ? team.name : cleanName(input.name, team.name),
    status: input.status || team.status,
    updatedAt: new Date().toISOString(),
  }
  if (backend() === "postgres") {
    await ensureTeamSchema()
    await pool().query(
      `UPDATE geo_teams_v1
       SET name = $2, status = $3, updated_at = $4
       WHERE id = $1`,
      [next.id, next.name, next.status, next.updatedAt],
    )
  } else {
    await withFileState(state => {
      state.teams[next.id] = next
    }, true)
  }
  await appendAudit({
    teamId: next.id,
    actorUserId: input.actorUserId,
    action: next.status === "archived" ? "team_archived" : "team_updated",
    metadata: { name: next.name, status: next.status },
  })
  return next
}

export async function getTeamMember(
  teamId: string,
  userId: string,
): Promise<TeamMemberRecord | null> {
  if (!teamId || !userId) return null
  if (backend() === "postgres") {
    await ensureTeamSchema()
    const result = await pool().query<TeamMemberRow>(
      "SELECT * FROM geo_team_members_v1 WHERE team_id = $1 AND user_id = $2 LIMIT 1",
      [teamId, userId],
    )
    return result.rows[0] ? rowToMember(result.rows[0]) : null
  }
  return withFileState(state => state.members[memberKey(teamId, userId)] || null)
}

export async function listTeamMembers(teamId: string): Promise<TeamMemberRecord[]> {
  if (backend() === "postgres") {
    await ensureTeamSchema()
    const result = await pool().query<TeamMemberRow>(
      `SELECT * FROM geo_team_members_v1
       WHERE team_id = $1
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined_at`,
      [teamId],
    )
    return result.rows.map(rowToMember)
  }
  return withFileState(state => (
    Object.values(state.members)
      .filter(member => member.teamId === teamId)
      .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt))
  ))
}

export async function listTeamsForUser(userId: string): Promise<TeamSummary[]> {
  const memberships = backend() === "postgres"
    ? await (async () => {
        await ensureTeamSchema()
        const result = await pool().query<TeamMemberRow>(
          `SELECT * FROM geo_team_members_v1
           WHERE user_id = $1 AND status = 'active'
           ORDER BY updated_at DESC`,
          [userId],
        )
        return result.rows.map(rowToMember)
      })()
    : await withFileState(state => (
        Object.values(state.members).filter(member => (
          member.userId === userId && member.status === "active"
        ))
      ))

  const summaries = await Promise.all(memberships.map(async membership => {
    const team = await getTeam(membership.teamId)
    if (!team || team.status !== "active") return null
    const [members, shares] = await Promise.all([
      listTeamMembers(team.id),
      listTeamClientShares(team.id),
    ])
    return {
      team,
      membership,
      memberCount: members.filter(member => member.status === "active").length,
      sharedClientCount: shares.length,
      canManageTeam: membership.role === "owner" || membership.role === "admin",
    } satisfies TeamSummary
  }))

  return summaries
    .filter((summary): summary is TeamSummary => Boolean(summary))
    .sort((left, right) => right.team.updatedAt.localeCompare(left.team.updatedAt))
}

export async function saveTeamMember(input: {
  teamId: string
  userId: string
  role: Exclude<TeamRole, "owner">
  status?: TeamMemberStatus
  permissionKeys: readonly TeamPermissionKey[]
  operatorUserId: string
}): Promise<TeamMemberRecord> {
  const team = await getTeam(input.teamId)
  if (!team || team.status !== "active") throw new Error("团队不存在或已归档")
  if (input.userId === team.ownerUserId) throw new Error("不能修改团队所有者权限")
  const existing = await getTeamMember(input.teamId, input.userId)
  const now = new Date().toISOString()
  const member: TeamMemberRecord = {
    teamId: input.teamId,
    userId: input.userId,
    role: input.role,
    status: input.status || existing?.status || "active",
    permissionKeys: normalizeTeamPermissions(input.permissionKeys),
    invitedByUserId: existing?.invitedByUserId || input.operatorUserId,
    joinedAt: existing?.joinedAt || now,
    updatedAt: now,
  }
  if (backend() === "postgres") {
    await ensureTeamSchema()
    await pool().query(
      `INSERT INTO geo_team_members_v1 (
        team_id, user_id, role, status, permission_keys,
        invited_by_user_id, joined_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
      ON CONFLICT (team_id, user_id) DO UPDATE SET
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        permission_keys = EXCLUDED.permission_keys,
        updated_at = EXCLUDED.updated_at`,
      [
        member.teamId,
        member.userId,
        member.role,
        member.status,
        JSON.stringify(member.permissionKeys),
        member.invitedByUserId,
        member.joinedAt,
        member.updatedAt,
      ],
    )
  } else {
    await withFileState(state => {
      state.members[memberKey(member.teamId, member.userId)] = member
    }, true)
  }
  await appendAudit({
    teamId: member.teamId,
    actorUserId: input.operatorUserId,
    action: existing
      ? member.status === "suspended" ? "member_suspended" : "member_updated"
      : "member_joined",
    targetUserId: member.userId,
    metadata: {
      role: member.role,
      status: member.status,
      permissionKeys: member.permissionKeys,
    },
  })
  return member
}

export async function removeTeamMember(input: {
  teamId: string
  userId: string
  operatorUserId: string
}): Promise<boolean> {
  const team = await getTeam(input.teamId)
  if (!team) return false
  if (input.userId === team.ownerUserId) throw new Error("不能移除团队所有者")
  let removed = false
  if (backend() === "postgres") {
    await ensureTeamSchema()
    const result = await pool().query(
      "DELETE FROM geo_team_members_v1 WHERE team_id = $1 AND user_id = $2",
      [input.teamId, input.userId],
    )
    removed = Boolean(result.rowCount)
  } else {
    await withFileState(state => {
      const key = memberKey(input.teamId, input.userId)
      removed = Boolean(state.members[key])
      delete state.members[key]
    }, true)
  }
  if (removed) {
    await appendAudit({
      teamId: input.teamId,
      actorUserId: input.operatorUserId,
      action: "member_removed",
      targetUserId: input.userId,
      metadata: {},
    })
  }
  return removed
}

export async function createTeamInvite(input: {
  teamId: string
  email: string
  role: Exclude<TeamRole, "owner">
  permissionKeys: readonly TeamPermissionKey[]
  operatorUserId: string
  expiresInDays?: number
}): Promise<{ invite: TeamInviteRecord; token: string }> {
  const team = await getTeam(input.teamId)
  if (!team || team.status !== "active") throw new Error("团队不存在或已归档")
  const email = cleanEmail(input.email)
  const now = new Date()
  const token = randomBytes(32).toString("base64url")
  const invite: TeamInviteRecord = {
    id: `tinvite_${randomUUID().replace(/-/g, "")}`,
    teamId: input.teamId,
    email,
    role: input.role,
    permissionKeys: normalizeTeamPermissions(input.permissionKeys),
    status: "pending",
    tokenHash: tokenHash(token),
    invitedByUserId: input.operatorUserId,
    createdAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + Math.max(1, Math.min(30, input.expiresInDays || 7)) * 86_400_000,
    ).toISOString(),
  }
  if (backend() === "postgres") {
    await ensureTeamSchema()
    await pool().query(
      `INSERT INTO geo_team_invites_v1 (
        id, team_id, email, role, permission_keys, status, token_hash,
        invited_by_user_id, created_at, expires_at
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)`,
      [
        invite.id,
        invite.teamId,
        invite.email,
        invite.role,
        JSON.stringify(invite.permissionKeys),
        invite.status,
        invite.tokenHash,
        invite.invitedByUserId,
        invite.createdAt,
        invite.expiresAt,
      ],
    )
  } else {
    await withFileState(state => {
      state.invites[invite.id] = invite
    }, true)
  }
  await appendAudit({
    teamId: invite.teamId,
    actorUserId: input.operatorUserId,
    action: "member_invited",
    metadata: { email: invite.email, role: invite.role },
  })
  return { invite, token }
}

export async function listTeamInvites(teamId: string): Promise<TeamInviteRecord[]> {
  const invites = backend() === "postgres"
    ? await (async () => {
        await ensureTeamSchema()
        const result = await pool().query<TeamInviteRow>(
          "SELECT * FROM geo_team_invites_v1 WHERE team_id = $1 ORDER BY created_at DESC",
          [teamId],
        )
        return result.rows.map(rowToInvite)
      })()
    : await withFileState(state => (
        Object.values(state.invites)
          .filter(invite => invite.teamId === teamId)
          .map(invite => ({
            ...invite,
            status: invite.status === "pending" && Date.parse(invite.expiresAt) <= Date.now()
              ? "expired"
              : invite.status,
          }))
      ))
  return invites.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function getTeamInviteByToken(token: string): Promise<TeamInviteRecord | null> {
  if (!token) return null
  const hash = tokenHash(token)
  if (backend() === "postgres") {
    await ensureTeamSchema()
    const result = await pool().query<TeamInviteRow>(
      "SELECT * FROM geo_team_invites_v1 WHERE token_hash = $1 LIMIT 1",
      [hash],
    )
    return result.rows[0] ? rowToInvite(result.rows[0]) : null
  }
  return withFileState(state => {
    const invite = Object.values(state.invites).find(item => item.tokenHash === hash)
    if (!invite) return null
    return {
      ...invite,
      status: invite.status === "pending" && Date.parse(invite.expiresAt) <= Date.now()
        ? "expired"
        : invite.status,
    }
  })
}

export async function acceptTeamInvite(input: {
  token: string
  userId: string
  userEmail: string
}): Promise<TeamMemberRecord> {
  const invite = await getTeamInviteByToken(input.token)
  if (!invite || invite.status !== "pending") throw new Error("团队邀请无效或已过期")
  if (cleanEmail(input.userEmail) !== invite.email) {
    throw new Error("请使用收到邀请的邮箱登录后加入团队")
  }
  const member = await saveTeamMember({
    teamId: invite.teamId,
    userId: input.userId,
    role: invite.role,
    permissionKeys: invite.permissionKeys,
    operatorUserId: invite.invitedByUserId,
  })
  const acceptedAt = new Date().toISOString()
  if (backend() === "postgres") {
    await ensureTeamSchema()
    await pool().query(
      `UPDATE geo_team_invites_v1
       SET status = 'accepted', accepted_at = $2, accepted_by_user_id = $3
       WHERE id = $1`,
      [invite.id, acceptedAt, input.userId],
    )
  } else {
    await withFileState(state => {
      state.invites[invite.id] = {
        ...invite,
        status: "accepted",
        acceptedAt,
        acceptedByUserId: input.userId,
      }
    }, true)
  }
  return member
}

export async function listTeamClientShares(teamId: string): Promise<TeamClientShareRecord[]> {
  if (backend() === "postgres") {
    await ensureTeamSchema()
    const result = await pool().query<TeamShareRow>(
      `SELECT * FROM geo_team_client_shares_v1
       WHERE team_id = $1
       ORDER BY updated_at DESC`,
      [teamId],
    )
    return result.rows.map(rowToShare)
  }
  return withFileState(state => (
    Object.values(state.shares)
      .filter(share => share.teamId === teamId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  ))
}

export async function getTeamClientShare(
  teamId: string,
  clientOwnerUserId: string,
  clientId: string,
): Promise<TeamClientShareRecord | null> {
  if (backend() === "postgres") {
    await ensureTeamSchema()
    const result = await pool().query<TeamShareRow>(
      `SELECT * FROM geo_team_client_shares_v1
       WHERE team_id = $1 AND client_owner_user_id = $2 AND client_id = $3
       LIMIT 1`,
      [teamId, clientOwnerUserId, clientId],
    )
    return result.rows[0] ? rowToShare(result.rows[0]) : null
  }
  return withFileState(state => (
    state.shares[shareKey(teamId, clientOwnerUserId, clientId)] || null
  ))
}

export async function saveTeamClientShare(input: {
  teamId: string
  clientOwnerUserId: string
  clientId: string
  clientName: string
  scope?: TeamShareScope
  memberUserIds?: readonly string[]
  operatorUserId: string
}): Promise<TeamClientShareRecord> {
  const team = await getTeam(input.teamId)
  if (!team || team.status !== "active") throw new Error("团队不存在或已归档")
  if (input.clientOwnerUserId !== input.operatorUserId) {
    throw new Error("只有客户档案所属账号可以开放该客户")
  }
  const existing = (await listTeamClientShares(input.teamId)).find(share => (
    share.clientOwnerUserId === input.clientOwnerUserId && share.clientId === input.clientId
  ))
  const now = new Date().toISOString()
  const share: TeamClientShareRecord = {
    teamId: input.teamId,
    clientOwnerUserId: input.clientOwnerUserId,
    clientId: String(input.clientId || "").trim().slice(0, 200),
    clientName: cleanName(input.clientName, "客户档案"),
    scope: input.scope === "selected" ? "selected" : "all",
    memberUserIds: Array.from(new Set(
      (input.memberUserIds || []).map(String).map(item => item.trim()).filter(Boolean),
    )),
    createdByUserId: existing?.createdByUserId || input.operatorUserId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  if (!share.clientId) throw new Error("客户标识无效")
  if (share.scope === "selected" && share.memberUserIds.length === 0) {
    throw new Error("请选择至少一名可以查看该客户的团队成员")
  }
  if (backend() === "postgres") {
    await ensureTeamSchema()
    await pool().query(
      `INSERT INTO geo_team_client_shares_v1 (
        team_id, client_owner_user_id, client_id, client_name, scope,
        member_user_ids, created_by_user_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
      ON CONFLICT (team_id, client_owner_user_id, client_id) DO UPDATE SET
        client_name = EXCLUDED.client_name,
        scope = EXCLUDED.scope,
        member_user_ids = EXCLUDED.member_user_ids,
        updated_at = EXCLUDED.updated_at`,
      [
        share.teamId,
        share.clientOwnerUserId,
        share.clientId,
        share.clientName,
        share.scope,
        JSON.stringify(share.memberUserIds),
        share.createdByUserId,
        share.createdAt,
        share.updatedAt,
      ],
    )
  } else {
    await withFileState(state => {
      state.shares[shareKey(share.teamId, share.clientOwnerUserId, share.clientId)] = share
    }, true)
  }
  await appendAudit({
    teamId: share.teamId,
    actorUserId: input.operatorUserId,
    action: existing ? "client_share_updated" : "client_shared",
    clientOwnerUserId: share.clientOwnerUserId,
    clientId: share.clientId,
    metadata: {
      clientName: share.clientName,
      scope: share.scope,
      memberUserIds: share.memberUserIds,
    },
  })
  return share
}

export async function deleteTeamClientShare(input: {
  teamId: string
  clientOwnerUserId: string
  clientId: string
  operatorUserId: string
}): Promise<boolean> {
  if (input.clientOwnerUserId !== input.operatorUserId) {
    throw new Error("只有客户档案所属账号可以取消共享")
  }
  let removed = false
  if (backend() === "postgres") {
    await ensureTeamSchema()
    const result = await pool().query(
      `DELETE FROM geo_team_client_shares_v1
       WHERE team_id = $1 AND client_owner_user_id = $2 AND client_id = $3`,
      [input.teamId, input.clientOwnerUserId, input.clientId],
    )
    removed = Boolean(result.rowCount)
  } else {
    await withFileState(state => {
      const key = shareKey(input.teamId, input.clientOwnerUserId, input.clientId)
      removed = Boolean(state.shares[key])
      delete state.shares[key]
    }, true)
  }
  if (removed) {
    await appendAudit({
      teamId: input.teamId,
      actorUserId: input.operatorUserId,
      action: "client_unshared",
      clientOwnerUserId: input.clientOwnerUserId,
      clientId: input.clientId,
      metadata: {},
    })
  }
  return removed
}

function shareVisibleToMember(
  share: TeamClientShareRecord,
  member: TeamMemberRecord,
): boolean {
  if (member.role === "owner") return true
  return share.scope === "all" || share.memberUserIds.includes(member.userId)
}

function actionReminderAccess(input: {
  teamId: string
  teamName: string
  teamOwnerUserId: string
  userId: string
  role: TeamRole
  permissionKeys: unknown
  clientOwnerUserId: string
  clientId: string
  clientName: string
  scope: TeamShareScope
  memberUserIds: unknown
}): TeamActionReminderAccess | null {
  const memberUserIds = Array.isArray(input.memberUserIds)
    ? input.memberUserIds.map(String).filter(Boolean)
    : []
  if (
    input.role !== "owner"
    && input.scope === "selected"
    && !memberUserIds.includes(input.userId)
  ) return null
  const permissionKeys = input.role === "owner"
    ? [...ALL_TEAM_PERMISSIONS]
    : normalizeTeamPermissions(input.permissionKeys)
  if (!hasTeamPermission(permissionKeys, "feedback", "view")) return null
  return {
    teamId: input.teamId,
    teamName: input.teamName,
    teamOwnerUserId: input.teamOwnerUserId,
    userId: input.userId,
    clientOwnerUserId: input.clientOwnerUserId,
    clientId: input.clientId,
    clientName: input.clientName,
    permissionKeys,
    canEdit: hasTeamPermission(permissionKeys, "feedback", "edit")
      || hasTeamPermission(permissionKeys, "feedback", "manage"),
  }
}

export async function listTeamActionReminderAccesses(
  userId?: string,
): Promise<TeamActionReminderAccess[]> {
  const normalizedUserId = String(userId || "").trim()
  if (backend() === "postgres") {
    await ensureTeamSchema()
    const result = await pool().query<TeamActionReminderRow>(
      `SELECT
         t.id AS team_id,
         t.name AS team_name,
         t.owner_user_id AS team_owner_user_id,
         m.user_id,
         m.role,
         m.permission_keys,
         s.client_owner_user_id,
         s.client_id,
         s.client_name,
         s.scope,
         s.member_user_ids
       FROM geo_teams_v1 t
       INNER JOIN geo_team_members_v1 m ON m.team_id = t.id
       INNER JOIN geo_team_client_shares_v1 s ON s.team_id = t.id
       WHERE t.status = 'active'
         AND m.status = 'active'
         AND ($1::text = '' OR m.user_id = $1)
       ORDER BY m.user_id, t.updated_at DESC, s.updated_at DESC`,
      [normalizedUserId],
    )
    return result.rows
      .map(row => actionReminderAccess({
        teamId: row.team_id,
        teamName: row.team_name,
        teamOwnerUserId: row.team_owner_user_id,
        userId: row.user_id,
        role: row.role,
        permissionKeys: row.permission_keys,
        clientOwnerUserId: row.client_owner_user_id,
        clientId: row.client_id,
        clientName: row.client_name,
        scope: row.scope,
        memberUserIds: row.member_user_ids,
      }))
      .filter((access): access is TeamActionReminderAccess => Boolean(access))
  }

  return withFileState(state => {
    const results: TeamActionReminderAccess[] = []
    for (const member of Object.values(state.members)) {
      if (
        member.status !== "active"
        || (normalizedUserId && member.userId !== normalizedUserId)
      ) continue
      const team = state.teams[member.teamId]
      if (!team || team.status !== "active") continue
      const shares = Object.values(state.shares).filter(share => share.teamId === team.id)
      for (const share of shares) {
        const access = actionReminderAccess({
          teamId: team.id,
          teamName: team.name,
          teamOwnerUserId: team.ownerUserId,
          userId: member.userId,
          role: member.role,
          permissionKeys: member.permissionKeys,
          clientOwnerUserId: share.clientOwnerUserId,
          clientId: share.clientId,
          clientName: share.clientName,
          scope: share.scope,
          memberUserIds: share.memberUserIds,
        })
        if (access) results.push(access)
      }
    }
    return results.sort((left, right) => (
      left.userId.localeCompare(right.userId)
      || left.teamId.localeCompare(right.teamId)
      || left.clientId.localeCompare(right.clientId)
    ))
  })
}

export async function listAccessibleTeamClientShares(
  userId: string,
  teamId?: string,
): Promise<TeamClientAccess[]> {
  const summaries = teamId
    ? (await listTeamsForUser(userId)).filter(summary => summary.team.id === teamId)
    : await listTeamsForUser(userId)
  const results: TeamClientAccess[] = []

  for (const summary of summaries) {
    if (summary.membership.status !== "active" || summary.team.status !== "active") continue
    const shares = await listTeamClientShares(summary.team.id)
    for (const share of shares) {
      if (!shareVisibleToMember(share, summary.membership)) continue
      results.push({
        team: summary.team,
        membership: summary.membership,
        share,
        permissionKeys: summary.membership.role === "owner"
          ? [...ALL_TEAM_PERMISSIONS]
          : summary.membership.permissionKeys,
        billingUserId: summary.team.ownerUserId,
      })
    }
  }
  return results
}

export async function findTeamClientAccess(input: {
  userId: string
  clientId: string
  teamId?: string
  dataOwnerUserId?: string
}): Promise<TeamClientAccess | null> {
  const accesses = await listAccessibleTeamClientShares(input.userId, input.teamId)
  return accesses.find(access => (
    access.share.clientId === input.clientId
    && (
      !input.dataOwnerUserId
      || access.share.clientOwnerUserId === input.dataOwnerUserId
    )
  )) || null
}

export async function listTeamAudit(
  teamId: string,
  limit = 100,
): Promise<TeamAuditRecord[]> {
  const safeLimit = Math.max(1, Math.min(300, Math.floor(limit)))
  if (backend() === "postgres") {
    await ensureTeamSchema()
    const result = await pool().query<TeamAuditRow>(
      `SELECT * FROM geo_team_audit_v1
       WHERE team_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [teamId, safeLimit],
    )
    return result.rows.map(rowToAudit)
  }
  return withFileState(state => (
    Object.values(state.audits)
      .filter(audit => audit.teamId === teamId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, safeLimit)
  ))
}
