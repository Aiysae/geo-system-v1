import "server-only"

import {
  resolveOperationAccess,
  type OperationAccessContext,
} from "@/lib/team-access"
import {
  hasTeamPermission,
  type TeamPermissionAction,
  type TeamPermissionKey,
} from "@/lib/team-permissions"

export async function requirePublishingPlanAccess(input: {
  userId: string
  clientId: string
  action: TeamPermissionAction
  teamId?: string
}): Promise<OperationAccessContext> {
  const keywordAccess = await resolveOperationAccess({
    ...input,
    module: "keyword",
  })
  if (keywordAccess.ok) return keywordAccess.access

  // Existing teams may have received publishing-plan access while this tool
  // still lived under Execution Feedback. Keep that grant valid during the move.
  const legacyAccess = await resolveOperationAccess({
    ...input,
    module: "feedback",
  })
  if (legacyAccess.ok) return legacyAccess.access

  const error = new Error(keywordAccess.message)
  error.name = keywordAccess.code
  throw error
}

export function hasPublishingPlanPermission(
  permissionKeys: readonly TeamPermissionKey[],
  action: TeamPermissionAction,
): boolean {
  return hasTeamPermission(permissionKeys, "keyword", action)
    || hasTeamPermission(permissionKeys, "feedback", action)
}
