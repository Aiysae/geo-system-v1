import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { listManagedServiceOrdersForUser } from "@/lib/managed-services"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "登录状态已失效" }, { status: 401 })
  const orders = await listManagedServiceOrdersForUser(user.id)
  return NextResponse.json({ orders }, { headers: { "Cache-Control": "private, no-store" } })
}
