import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import {
  getActionReminderSettings,
  saveActionReminderSettings,
} from "@/lib/action-reminders/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "登录状态已失效" }, { status: 401 })
  return NextResponse.json({ settings: await getActionReminderSettings(user.id) }, {
    headers: { "Cache-Control": "private, no-store" },
  })
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "登录状态已失效" }, { status: 401 })
  let body: { emailEnabled?: unknown; inAppEnabled?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 })
  }
  if (
    body.emailEnabled !== undefined && typeof body.emailEnabled !== "boolean"
    || body.inAppEnabled !== undefined && typeof body.inAppEnabled !== "boolean"
  ) {
    return NextResponse.json({ error: "提醒设置无效" }, { status: 400 })
  }
  const settings = await saveActionReminderSettings(user.id, {
    emailEnabled: body.emailEnabled as boolean | undefined,
    inAppEnabled: body.inAppEnabled as boolean | undefined,
  })
  return NextResponse.json({ settings })
}
