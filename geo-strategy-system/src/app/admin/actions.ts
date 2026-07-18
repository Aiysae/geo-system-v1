"use server"

import { revalidatePath } from "next/cache"
import { assertAdmin, isAdminUser } from "@/lib/admin"
import { getUserById, updateUserStatus } from "@/lib/auth"
import {
  deleteClientAccountLink,
  getClientAccountLink,
  listClientAccountLinks,
  saveClientAccountLink,
  setClientAccountStatus,
} from "@/lib/client-accounts"
import { syncClientMonthlyAllowance } from "@/lib/credits"
import { listWorkspaceClients } from "@/lib/workspace-store"

export type UpdateUserStatusState = {
  ok?: boolean
  message?: string
}

export type ClientAccountActionState = {
  ok?: boolean
  message?: string
}

function refreshUserAdminPages(userId: string): void {
  revalidatePath("/admin")
  revalidatePath(`/admin/users/${userId}`)
}

export async function updateUserStatusAction(
  _prevState: UpdateUserStatusState,
  formData: FormData,
): Promise<UpdateUserStatusState> {
  try {
    const adminId = await assertAdmin()
    const userId = String(formData.get("userId") || "")
    const status = String(formData.get("status") || "")

    if (!userId) return { ok: false, message: "缺少用户 ID" }
    if (status !== "active" && status !== "disabled") {
      return { ok: false, message: "无效的账号状态" }
    }
    if (userId === adminId && status === "disabled") {
      return { ok: false, message: "不能停用当前登录管理员" }
    }

    const user = await updateUserStatus(userId, status)
    refreshUserAdminPages(userId)

    return {
      ok: true,
      message: `${user.email} 已${status === "active" ? "启用" : "停用"}`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "操作失败",
    }
  }
}

function parseClientSelection(value: FormDataEntryValue | null): {
  ownerUserId: string
  clientId: string
} {
  const selection = String(value || "").trim()
  const separatorIndex = selection.indexOf("::")
  if (separatorIndex <= 0 || separatorIndex >= selection.length - 2) {
    throw new Error("请选择要关联的客户面板")
  }
  return {
    ownerUserId: selection.slice(0, separatorIndex),
    clientId: selection.slice(separatorIndex + 2),
  }
}

export async function saveClientAccountLinkAction(
  _prevState: ClientAccountActionState,
  formData: FormData,
): Promise<ClientAccountActionState> {
  try {
    const adminId = await assertAdmin()
    const userId = String(formData.get("userId") || "").trim()
    if (!userId) return { ok: false, message: "缺少用户 ID" }

    const targetUser = await getUserById(userId)
    if (!targetUser) return { ok: false, message: "目标用户不存在" }
    if (isAdminUser(targetUser)) {
      return { ok: false, message: "管理员账号不能设为客户专属账号" }
    }

    const { ownerUserId, clientId } = parseClientSelection(formData.get("clientSelection"))
    if (ownerUserId === userId) {
      return { ok: false, message: "不能把用户自己的客户面板授权给该用户" }
    }
    const ownerUser = await getUserById(ownerUserId)
    if (!ownerUser) return { ok: false, message: "客户面板所有者不存在" }

    const [ownerClients, targetClients, existingLink, allLinks] = await Promise.all([
      listWorkspaceClients(ownerUserId),
      listWorkspaceClients(userId),
      getClientAccountLink(userId),
      listClientAccountLinks(),
    ])
    const selectedClient = ownerClients.find(record => record.client.id === clientId)?.client
    if (!selectedClient) {
      return { ok: false, message: "所选客户面板不存在或已被删除" }
    }
    if (targetClients.length > 0) {
      return {
        ok: false,
        message: "该用户账号下已有自己的客户数据。为避免数据混淆，请新建一个空账号作为客户专属账号。",
      }
    }
    const duplicate = allLinks.find(link =>
      link.userId !== userId
      && link.ownerUserId === ownerUserId
      && link.clientId === clientId
    )
    if (duplicate) {
      const linkedUser = await getUserById(duplicate.userId)
      return {
        ok: false,
        message: `该客户面板已授权给 ${linkedUser?.email || duplicate.userId}，请先解除原授权。`,
      }
    }

    const monthlyCredits = Math.floor(Number(formData.get("monthlyCredits") || 1000))
    const link = await saveClientAccountLink({
      userId,
      ownerUserId,
      clientId,
      clientName: selectedClient.name,
      monthlyCredits,
      status: existingLink?.status || "active",
      operatorUserId: adminId,
    })
    await syncClientMonthlyAllowance({
      userId,
      amount: link.monthlyCredits,
      operatorUserId: adminId,
      previousAllowance: existingLink?.monthlyCredits,
    })
    refreshUserAdminPages(userId)
    return {
      ok: true,
      message: `已授权「${selectedClient.name}」，本月专属额度 ${link.monthlyCredits} 积分。`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "客户专属账号授权失败",
    }
  }
}

export async function updateClientAccountStatusAction(
  _prevState: ClientAccountActionState,
  formData: FormData,
): Promise<ClientAccountActionState> {
  try {
    const adminId = await assertAdmin()
    const userId = String(formData.get("userId") || "").trim()
    const status = String(formData.get("status") || "")
    if (!userId) return { ok: false, message: "缺少用户 ID" }
    if (status !== "active" && status !== "suspended") {
      return { ok: false, message: "客户账号状态无效" }
    }
    const link = await setClientAccountStatus({
      userId,
      status,
      operatorUserId: adminId,
    })
    refreshUserAdminPages(userId)
    return {
      ok: true,
      message: status === "active"
        ? `已恢复「${link.clientName}」客户账号`
        : `已暂停「${link.clientName}」客户账号`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "客户账号状态更新失败",
    }
  }
}

export async function unlinkClientAccountAction(
  _prevState: ClientAccountActionState,
  formData: FormData,
): Promise<ClientAccountActionState> {
  try {
    const adminId = await assertAdmin()
    const userId = String(formData.get("userId") || "").trim()
    if (!userId) return { ok: false, message: "缺少用户 ID" }
    const removed = await deleteClientAccountLink({
      userId,
      operatorUserId: adminId,
    })
    refreshUserAdminPages(userId)
    return {
      ok: true,
      message: removed ? "客户专属授权已解除" : "该用户当前没有客户专属授权",
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "解除客户专属授权失败",
    }
  }
}
