import { NextRequest, NextResponse } from "next/server"
import {
  cancelArticleMediaJob,
  getOwnedArticleMediaJob,
} from "@/lib/article-media/jobs"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" }

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const { jobId } = await context.params
  const job = await getOwnedArticleMediaJob(jobId, auth.userId)
  if (!job) return NextResponse.json({ error: "配图任务不存在" }, { status: 404 })
  return NextResponse.json({ job }, { headers: NO_STORE_HEADERS })
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const { jobId } = await context.params
  const job = await cancelArticleMediaJob(jobId, auth.userId)
  if (!job) return NextResponse.json({ error: "配图任务不存在" }, { status: 404 })
  return NextResponse.json({ ok: true, job }, { headers: NO_STORE_HEADERS })
}
