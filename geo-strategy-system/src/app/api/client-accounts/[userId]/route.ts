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
  setClientAccountStatus,
} from "@/lib/client-accounts"
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
    const link = await ownedLink(auth.userId, userId)
    const body = await request.json() as { action?: unknown; status?: unknown }
    const action = String(body.action || "status")
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
