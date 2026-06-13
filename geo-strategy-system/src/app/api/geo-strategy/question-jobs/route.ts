import { NextRequest, NextResponse } from "next/server"
import { createQuestionJob } from "@/lib/geo-strategy/question-jobs"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

function getRequestOrigin(req: NextRequest): string | undefined {
  const host = req.headers.get("host")
  if (!host) return undefined
  const proto = (req.headers.get("x-forwarded-proto") || "http").split(",")[0]?.trim() || "http"
  return `${proto}://${host}`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const job = await createQuestionJob(body, getRequestOrigin(req))
    return NextResponse.json(job, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建疑问句生成任务失败"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
