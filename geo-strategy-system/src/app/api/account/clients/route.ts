import { NextResponse } from "next/server"
import {
  encodeClientAccessRef,
  listClientCatalog,
  type ClientCatalogEntry,
} from "@/lib/client-access-catalog"
import {
  getClientAccountLink,
  getWorkspaceAccountAccess,
} from "@/lib/client-accounts"
import { listWorkspaceClientSummaries } from "@/lib/workspace-store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const access = await getWorkspaceAccountAccess(auth.userId)
    let clients: ClientCatalogEntry[]
    if (access.mode === "client") {
      const link = await getClientAccountLink(auth.userId)
      const summary = link
        ? (await listWorkspaceClientSummaries(link.dataOwnerUserId))
            .find(client => client.id === link.clientId)
        : null
      clients = summary && link ? [{
        ...summary,
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
        canEdit: false,
        canDelete: false,
        canManageClientAccount: false,
        clientAccount: {
          userId: link.userId,
          status: link.status,
          sourceStatus: access.status === "active" ? "active" : "revoked",
        },
      }] : []
    } else {
      clients = await listClientCatalog(auth.userId)
    }
    return noStore(NextResponse.json({ clients }))
  } catch (error) {
    console.error("[account-clients] list failed", error)
    return noStore(NextResponse.json({ error: "客户目录读取失败" }, { status: 503 }))
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}
