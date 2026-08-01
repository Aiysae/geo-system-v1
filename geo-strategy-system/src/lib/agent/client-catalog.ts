import "server-only"

import {
  getClientAccountLink,
  getClientAccountSourceState,
} from "@/lib/client-accounts"
import {
  encodeClientAccessRef,
  listClientCatalog,
  type ClientCatalogEntry,
} from "@/lib/client-access-catalog"
import { hasTeamPermission } from "@/lib/team-permissions"
import { listWorkspaceClientSummaries } from "@/lib/workspace-store"

export async function listAgentClientCatalog(userId: string): Promise<ClientCatalogEntry[]> {
  const link = await getClientAccountLink(userId)
  if (!link) return listClientCatalog(userId)
  if (link.status !== "active") return []

  const source = await getClientAccountSourceState(link)
  if (!source.ok) return []
  const client = (await listWorkspaceClientSummaries(link.dataOwnerUserId))
    .find(item => item.id === link.clientId)
  if (!client) return []

  return [{
    ...client,
    accessRef: encodeClientAccessRef({
      sourceType: link.sourceType,
      dataOwnerUserId: link.dataOwnerUserId,
      clientId: link.clientId,
      teamId: link.teamId,
    }),
    sourceType: link.sourceType,
    teamId: link.teamId,
    dataOwnerUserId: link.dataOwnerUserId,
    parentUserId: link.parentUserId,
    canEdit: hasTeamPermission(link.permissionKeys, "client", "edit"),
    canDelete: false,
    canManageClientAccount: false,
    clientAccount: {
      userId: link.userId,
      status: link.status,
      sourceStatus: "active",
    },
  }]
}
