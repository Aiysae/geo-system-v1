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
  getClientAccountManagerAccess,
  getClientAccountSourceState,
  getClientAccountLinkForSource,
  listClientAccountLinksForOwner,
  restoreClientAccountLink,
  setClientAccountPermissions,
  setClientAccountStatus,
} from "@/lib/client-accounts"
import type { ClientPenetrationResultDetail } from "@/lib/client-account-policy"
import type { TeamPermissionKey } from "@/lib/team-permissions"
import { syncClientMonthlyAllowance } from "@/lib/credits"
import { getMembershipWithPaymentRepair, hasMembershipTier } from "@/lib/membership"
import { listWorkspaceClientSummaries } from "@/lib/workspace-store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

async function managedLink(actorUserId: string, childUserId: string) {
  const link = await getClientAccountLink(childUserId)
  if (!link) {
    throw new Error("客户子账号不存在或无权管理")
  }
  const manager = await getClientAccountManagerAccess({ actorUserId, link })
  if (!manager.canManage) throw new Error("客户子账号不存在或无权管理")
  return { link, manager }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { userId } = await context.params
    const body = await request.json() as {
      action?: unknown
      status?: unknown
      permissionKeys?: unknown
      penetrationResultDetail?: unknown
    }
    const action = String(body.action || "status")
    if (action === "restore") {
      const user = await getUserById(userId)
      const previous = await getRecoverableClientAccountLink(userId)
      if (!previous) throw new Error("该账号没有可恢复的客户授权记录")
      const manager = await getClientAccountManagerAccess({
        actorUserId: auth.userId,
        link: previous,
      })
      if (!manager.canManage || !user || user.managedByUserId !== previous.parentUserId) {
        throw new Error("该客户子账号不存在或不属于当前主账号")
      }
      const [membership, links, duplicate, clients] = await Promise.all([
        getMembershipWithPaymentRepair(previous.parentUserId),
        listClientAccountLinksForOwner(previous.parentUserId),
        getClientAccountLinkForSource({
          parentUserId: previous.parentUserId,
          dataOwnerUserId: previous.dataOwnerUserId,
          clientId: previous.clientId,
          sourceType: previous.sourceType,
          teamId: previous.teamId,
        }),
        listWorkspaceClientSummaries(previous.dataOwnerUserId),
      ])
      if (!hasMembershipTier(membership, "vip2")) {
        throw new Error("VIP2 起可恢复客户子账号")
      }
      const sourceState = await getClientAccountSourceState(previous)
      if (!sourceState.ok) throw new Error(sourceState.message)
      if (links.length >= membership.clientAccountLimit) {
        throw new Error(`当前 ${membership.tier.toUpperCase()} 的客户子账号名额已满`)
      }
      const client = clients.find(record => record.id === previous.clientId)
      if (!client) throw new Error("原客户面板已不存在，无法直接恢复")
      if (duplicate && duplicate.userId !== userId) {
        throw new Error("该客户面板已关联其他客户账号，请先解除现有授权")
      }

      const restored = await restoreClientAccountLink({
        userId,
        parentUserId: previous.parentUserId,
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

    const { link, manager } = await managedLink(auth.userId, userId)
    if (action === "permissions") {
      const permissionKeys = Array.isArray(body.permissionKeys)
        ? body.permissionKeys.map(value => String(value)) as TeamPermissionKey[]
        : []
      const penetrationResultDetail = String(
        body.penetrationResultDetail || "full",
      ) as ClientPenetrationResultDetail
      const updated = await setClientAccountPermissions({
        userId,
        permissionKeys,
        penetrationResultDetail,
        operatorUserId: auth.userId,
      })
      return noStore(NextResponse.json({
        ok: true,
        permissionKeys: updated.permissionKeys,
        penetrationResultDetail: updated.penetrationResultDetail,
      }))
    }
    if (action === "reset-password") {
      const password = `ST-${randomBytes(9).toString("base64url")}7`
      const user = await setManagedUserTemporaryPassword({
        parentUserId: manager.parentUserId,
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
    const { manager } = await managedLink(auth.userId, userId)
    await deleteClientAccountLink({ userId, operatorUserId: auth.userId })
    const user = await getUserById(userId)
    if (user?.managedByUserId === manager.parentUserId) await updateUserStatus(userId, "disabled")
    return noStore(NextResponse.json({ ok: true }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "客户子账号解除失败",
    }, { status: 400 }))
  }
}
