import { NextRequest, NextResponse } from "next/server"
import { cancelBackgroundJob, getBackgroundJob } from "@/lib/background-jobs"
import { requireUserId } from "@/lib/with-credits"
import { requireStandardAccountMode } from "@/lib/client-accounts"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  const { jobId } = await context.params
  const job = await getBackgroundJob(jobId, userGuard.userId)
  if (!job) {
    return NextResponse.json({ error: "后台任务不存在或已过期" }, { status: 404 })
  }
  return NextResponse.json(job, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  })
}

export async function PATCH(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  const accountAccess = await requireStandardAccountMode(userGuard.userId)
  if (!accountAccess.ok) {
    return NextResponse.json(
      { error: accountAccess.message, code: "CLIENT_ACCOUNT_READ_ONLY" },
      { status: 403 },
    )
  }
  const { jobId } = await context.params
  const job = await cancelBackgroundJob(jobId, userGuard.userId)
  if (!job) {
    return NextResponse.json({ error: "后台任务不存在或已过期" }, { status: 404 })
  }
  return NextResponse.json(job)
}
