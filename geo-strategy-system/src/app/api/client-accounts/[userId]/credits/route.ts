import { NextRequest, NextResponse } from "next/server"
import { getUserById } from "@/lib/auth"
import {
  getClientAccountLink,
  getClientAccountManagerAccess,
} from "@/lib/client-accounts"
import { transferCreditsToManagedAccount } from "@/lib/client-credit-transfer"
import { getMembershipWithPaymentRepair, hasMembershipTier } from "@/lib/membership"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { userId } = await context.params
    const [link, child] = await Promise.all([
      getClientAccountLink(userId),
      getUserById(userId),
    ])
    if (!link || link.provisioning !== "owner") {
      return NextResponse.json({ error: "该客户账号不属于当前主账号" }, { status: 403 })
    }
    const manager = await getClientAccountManagerAccess({
      actorUserId: auth.userId,
      link,
    })
    if (!manager.canTransferCredits) {
      return NextResponse.json({ error: "只有客户子账号所属主账号可以分配积分" }, { status: 403 })
    }
    const membership = await getMembershipWithPaymentRepair(manager.parentUserId)
    if (!child || child.managedByUserId !== manager.parentUserId) {
      return NextResponse.json({ error: "客户账号归属校验失败" }, { status: 403 })
    }
    if (!hasMembershipTier(membership, "vip2")) {
      return NextResponse.json({ error: "VIP2 起可向客户账号分配积分" }, { status: 403 })
    }
    const body = await request.json() as { operationId?: unknown; amount?: unknown }
    const transfer = await transferCreditsToManagedAccount({
      operationId: String(body.operationId || ""),
      ownerUserId: manager.parentUserId,
      childUserId: userId,
      amount: Number(body.amount),
    })
    return NextResponse.json({ transfer })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "积分分配失败",
    }, { status: 400 })
  }
}
