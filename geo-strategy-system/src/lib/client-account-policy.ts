import {
  normalizeTeamPermissions,
  type TeamPermissionKey,
} from "@/lib/team-permissions"

export type ClientPenetrationResultDetail = "summary" | "full"

export type ClientAccountPermissionPolicy = {
  permissionKeys: TeamPermissionKey[]
  penetrationResultDetail: ClientPenetrationResultDetail
}

const ALLOWED_CLIENT_PERMISSION_KEYS = new Set<TeamPermissionKey>([
  "client.view",
  "penetration.view",
  "penetration.execute",
  "penetration.edit",
  "feedback.view",
])

export const DEFAULT_CLIENT_ACCOUNT_PERMISSION_POLICY: ClientAccountPermissionPolicy = {
  permissionKeys: [
    "client.view",
    "penetration.edit",
    "penetration.execute",
    "penetration.view",
    "feedback.view",
  ],
  penetrationResultDetail: "full",
}

export function normalizeClientAccountPermissionPolicy(value: {
  permissionKeys?: unknown
  penetrationResultDetail?: unknown
} | null | undefined): ClientAccountPermissionPolicy {
  const requested = value?.permissionKeys === undefined
    ? DEFAULT_CLIENT_ACCOUNT_PERMISSION_POLICY.permissionKeys
    : normalizeTeamPermissions(value.permissionKeys)
  const permissionKeys = requested.filter(permission => (
    ALLOWED_CLIENT_PERMISSION_KEYS.has(permission)
  ))
  if (
    (
      permissionKeys.includes("penetration.execute")
      || permissionKeys.includes("penetration.edit")
    )
    && !permissionKeys.includes("penetration.view")
  ) {
    permissionKeys.push("penetration.view")
  }

  return {
    permissionKeys,
    penetrationResultDetail: value?.penetrationResultDetail === "summary"
      ? "summary"
      : "full",
  }
}

export function canClientAccountViewModule(
  policy: Pick<ClientAccountPermissionPolicy, "permissionKeys">,
  module: "penetration" | "feedback",
): boolean {
  return policy.permissionKeys.includes(`${module}.view`)
}
