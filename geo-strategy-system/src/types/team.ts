import type {
  TeamMemberStatus,
  TeamPermissionKey,
  TeamRole,
  TeamShareScope,
  TeamStatus,
} from "@/lib/team-permissions"

export type TeamRecord = {
  id: string
  ownerUserId: string
  name: string
  status: TeamStatus
  createdAt: string
  updatedAt: string
}

export type TeamMemberRecord = {
  teamId: string
  userId: string
  role: TeamRole
  status: TeamMemberStatus
  permissionKeys: TeamPermissionKey[]
  invitedByUserId: string
  joinedAt: string
  updatedAt: string
}

export type TeamMemberView = TeamMemberRecord & {
  name: string
  email: string
}

export type TeamInviteRecord = {
  id: string
  teamId: string
  email: string
  role: Exclude<TeamRole, "owner">
  permissionKeys: TeamPermissionKey[]
  status: "pending" | "accepted" | "revoked" | "expired"
  tokenHash: string
  invitedByUserId: string
  createdAt: string
  expiresAt: string
  acceptedAt?: string
  acceptedByUserId?: string
}

export type TeamInviteView = Omit<TeamInviteRecord, "tokenHash"> & {
  inviteUrl?: string
}

export type TeamClientShareRecord = {
  teamId: string
  clientOwnerUserId: string
  clientId: string
  clientName: string
  scope: TeamShareScope
  memberUserIds: string[]
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export type TeamAuditAction =
  | "team_created"
  | "team_updated"
  | "team_archived"
  | "member_invited"
  | "member_joined"
  | "member_updated"
  | "member_suspended"
  | "member_removed"
  | "client_shared"
  | "client_share_updated"
  | "client_unshared"

export type TeamAuditRecord = {
  id: string
  teamId: string
  actorUserId: string
  action: TeamAuditAction
  targetUserId?: string
  clientOwnerUserId?: string
  clientId?: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type TeamSummary = {
  team: TeamRecord
  membership: TeamMemberRecord
  memberCount: number
  sharedClientCount: number
  canManageTeam: boolean
}

export type TeamClientAccess = {
  team: TeamRecord
  membership: TeamMemberRecord
  share: TeamClientShareRecord
  permissionKeys: TeamPermissionKey[]
  billingUserId: string
}
