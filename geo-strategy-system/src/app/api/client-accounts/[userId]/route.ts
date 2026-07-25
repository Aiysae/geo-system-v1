import { randomBytes } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import {
  getUserById,
  setManagedUserTemporaryPassword,
  updateUserStatus,
} from "@/lib/auth"
import {
  deleteClientAccountLink,
  getClientAccountLink,
  getRecoverableClientAccountLink,
  listClientAccountLinks,
  listClientAccountLinksForOwner,
  restoreClientAccountLink,
  setClientAccountStatus,
} from "@/lib/client-accounts"
import { syncClientMonthlyAllowance } from "@/lib/credits"
import { getMembershipWithPaymentRepair, hasMembershipTier } from "@/lib/membership"
import { listWorkspaceClients } from "@/lib/workspace-store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

async function ownedLink(ownerUserId: string, childUserId: string) {
  const link = await getClientAccountLink(childUserId)
  if (!link || link.ownerUserId !== ownerUserId) {
    throw new Error("客户子账号不存在或无权管理")
  }
  return link
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { userId } = await context.params
    const body = await request.json() as { action?: unknown; status?: unknown }
    const action = String(body.action || "status")
    if (action === "restore") {
      const user = await getUserById(userId)
      if (!user || user.managedByUserId !== auth.userId) {
        throw new Error("该客户子账号不存在或不属于当前主账号")
      }
      const [membership, links, allLinks, clients, previous] = await Promise.all([
        getMembershipWithPaymentRepair(auth.userId),
        listClientAccountLinksForOwner(auth.userId),
        listClientAccountLinks(),
        listWorkspaceClients(auth.userId),
        getRecoverableClientAccountLink(userId, auth.userId),
      ])
      if (!hasMembershipTier(membership, "vip2")) {
        throw new Error("VIP2 起可恢复客户子账号")
      }
      if (links.length >= membership.clientAccountLimit) {
        throw new Error(`当前 ${membership.tier.toUpperCase()} 的客户子账号名额已满`)
      }
      if (!previous) throw new Error("该账号没有可恢复的客户授权记录")
      const client = clients.find(record => record.client.id === previous.clientId)?.client
      if (!client) throw new Error("原客户面板已不存在，无法直接恢复")
      const duplicate = allLinks.find(link =>
        link.userId !== userId
        && link.ownerUserId === auth.userId
        && link.clientId === previous.clientId
      )
      if (duplicate) throw new Error("该客户面板已关联其他客户账号，请先解除现有授权")

      const restored = await restoreClientAccountLink({
        userId,
        ownerUserId: auth.userId,
        clientName: client.name,
        operatorUserId: auth.userId,
      })
      await syncClientMonthlyAllowance({
        userId,
        amount: restored.monthlyCredits,
        previousAllowance: restored.monthlyCredits,
        operatorUserId: auth.userId,
      })
      await updateUserStatus(userId, "active")
      return noStore(NextResponse.json({
        ok: true,
        status: restored.status,
        clientName: restored.clientName,
      }))
    }

    const link = await ownedLink(auth.userId, userId)
    if (action === "reset-password") {
      const password = `ST-${randomBytes(9).toString("base64url")}7`
      const user = await setManagedUserTemporaryPassword({
        parentUserId: auth.userId,
        childUserId: userId,
        temporaryPassword: password,
      })
      return noStore(NextResponse.json({
        ok: true,
        email: user.email,
        temporaryPassword: password,
      }))
    }

    const status = String(body.status || "")
    if (status !== "active" && status !== "suspended") throw new Error("账号状态无效")
    const updated = await setClientAccountStatus({
      userId,
      status,
      operatorUserId: auth.userId,
    })
    await updateUserStatus(userId, status === "active" ? "active" : "disabled")
    return noStore(NextResponse.json({ ok: true, status: updated.status, clientName: link.clientName }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "客户子账号更新失败",
    }, { status: 400 }))
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { userId } = await context.params
    await ownedLink(auth.userId, userId)
    await deleteClientAccountLink({ userId, operatorUserId: auth.userId })
    const user = await getUserById(userId)
    if (user?.managedByUserId === auth.userId) await updateUserStatus(userId, "disabled")
    return noStore(NextResponse.json({ ok: true }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "客户子账号解除失败",
    }, { status: 400 }))
  }
}
