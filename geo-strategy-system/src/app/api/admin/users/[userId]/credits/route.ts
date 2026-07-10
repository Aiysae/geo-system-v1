import { revalidatePath } from "next/cache"
import { NextRequest, NextResponse } from "next/server"
import { assertAdmin } from "@/lib/admin"
import { getUserById } from "@/lib/auth"
import { adjustCreditsByAdmin } from "@/lib/credits"
import { hasUnlimitedCreditAccess } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return true
  try {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    const requestHost = forwardedHost || request.headers.get("host")?.trim() || request.nextUrl.host
    return new URL(origin).host === requestHost
  } catch {
    return false
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const operatorUserId = await assertAdmin()
    const { userId } = await context.params
    const user = await getUserById(userId)
    if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 })
    if (hasUnlimitedCreditAccess(user)) {
      return NextResponse.json(
        { error: "该管理员账号拥有无限积分权限，不参与余额加减" },
        { status: 409 },
      )
    }

    const body = await request.json()
    const direction = body?.direction === "subtract" ? "subtract" : "add"
    const amount = Math.floor(Number(body?.amount))
    const operationId = String(body?.operationId || "").trim()
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
      return NextResponse.json({ error: "请输入有效的积分数量" }, { status: 400 })
    }

    const result = await adjustCreditsByAdmin({
      operationId,
      userId,
      delta: direction === "subtract" ? -amount : amount,
      operatorUserId,
    })
    revalidatePath("/admin")
    revalidatePath(`/admin/users/${userId}`)
    revalidatePath("/admin/ledger")

    return NextResponse.json({
      ok: true,
      operationId: result.operationId,
      ledgerEntryId: result.ledgerEntryId,
      delta: result.delta,
      balance: result.balance,
      message: `已${result.delta > 0 ? "增加" : "扣除"} ${Math.abs(result.delta)} 积分，当前余额 ${result.balance}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "积分调整失败"
    const status = /Forbidden/.test(message) ? 403 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
