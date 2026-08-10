import "server-only"

import { requireOperationAccess } from "@/lib/team-access"

export async function requireKnowledgeImportAccess(input: {
  userId: string
  clientId: string
  teamId?: string
  action: "view" | "edit"
}) {
  return requireOperationAccess({
    userId: input.userId,
    clientId: input.clientId,
    teamId: input.teamId,
    module: "client",
    action: input.action,
  })
}

export function isKnowledgeImportAccessError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name.startsWith("TEAM_")
    || error.name.startsWith("CLIENT_")
    || /权限|无权|只读|客户不存在/.test(error.message)
}
