import { NextRequest, NextResponse } from "next/server"
import { cancelDifficultyJob, getDifficultyJob } from "@/lib/difficulty/jobs"
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
  const job = await getDifficultyJob(jobId, userGuard.userId)
  if (!job) {
    return NextResponse.json({ error: "难度测评任务不存在或已过期" }, { status: 404 })
  }
  return NextResponse.json(job, { headers: { "Cache-Control": "private, no-store" } })
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
  const job = await cancelDifficultyJob(jobId, userGuard.userId)
  if (!job) {
    return NextResponse.json({ error: "难度测评任务不存在或已过期" }, { status: 404 })
  }
  return NextResponse.json(job, { headers: { "Cache-Control": "private, no-store" } })
}
