import { NextRequest, NextResponse } from "next/server"
import { assertAdmin } from "@/lib/admin"
import { requireUserId } from "@/lib/with-credits"
import {
  getGlobalExcludedSubjects,
  setGlobalExcludedSubjects,
} from "@/lib/penetration/excluded-subjects"

// The names every client's rankings leave out. Any signed-in page reads it to
// work out its rankings; only an admin changes it.

export async function GET() {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  return NextResponse.json({ global: await getGlobalExcludedSubjects() })
}

export async function PUT(req: NextRequest) {
  try {
    await assertAdmin()
  } catch {
    return NextResponse.json({ error: "仅管理员可以修改全局排除名单" }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { global?: unknown }
  if (!Array.isArray(body.global)) {
    return NextResponse.json({ error: "名单格式不正确" }, { status: 400 })
  }
  return NextResponse.json({ global: await setGlobalExcludedSubjects(body.global) })
}
