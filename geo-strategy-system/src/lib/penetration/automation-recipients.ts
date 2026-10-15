import "server-only"

import { getUserById } from "@/lib/auth"
import { hasTeamPermission } from "@/lib/team-permissions"
import {
  listTeamClientShares,
  listTeamMembers,
  listTeamsForUser,
} from "@/lib/team-store"
import type { PenetrationAutomationSchedule } from "@/lib/penetration/automation-types"

export type PenetrationAutomationRecipient = {
  userId: string
  name: string
  email?: string
  emailVerified: boolean
}

export async function resolvePenetrationAutomationRecipientIds(
  schedule: PenetrationAutomationSchedule,
): Promise<string[]> {
  const recipientIds = new Set<string>([schedule.actorUserId])
  const teams = await listTeamsForUser(schedule.ownerUserId).catch(() => [])

  await Promise.all(teams.map(async summary => {
    const [shares, members] = await Promise.all([
      listTeamClientShares(summary.team.id).catch(() => []),
      listTeamMembers(summary.team.id).catch(() => []),
    ])
    const share = shares.find(item => (
      item.clientOwnerUserId === schedule.ownerUserId
      && item.clientId === schedule.clientId
    ))
    if (!share) return
    for (const member of members) {
      if (member.status !== "active") continue
      const visible = member.role === "owner"
        || share.scope === "all"
        || share.memberUserIds.includes(member.userId)
      if (!visible) continue
      if (
        member.role !== "owner"
        && !hasTeamPermission(member.permissionKeys, "penetration", "view")
      ) continue
      recipientIds.add(member.userId)
    }
  }))

  return [...recipientIds].sort()
}

export async function resolvePenetrationAutomationRecipients(
  schedule: PenetrationAutomationSchedule,
): Promise<PenetrationAutomationRecipient[]> {
  const recipientIds = await resolvePenetrationAutomationRecipientIds(schedule)
  const users = await Promise.all(recipientIds.map(getUserById))
  return users
    .filter(user => user?.status === "active")
    .map(user => ({
      userId: user!.id,
      name: user!.name,
      email: user!.email || undefined,
      emailVerified: Boolean(user!.emailVerifiedAt),
    }))
    .sort((left, right) => left.userId.localeCompare(right.userId))
}
