import { NextRequest, NextResponse } from "next/server"
import { getCommercialReportFile } from "@/lib/reports/report-jobs"
import { requireUserId } from "@/lib/with-credits"

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
  const report = await getCommercialReportFile(jobId, userGuard.userId)
  if (!report) {
    return NextResponse.json({ error: "报告尚未生成、已过期或无权访问" }, { status: 404 })
  }

  const encodedName = encodeURIComponent(report.fileName).replace(
    /[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return new NextResponse(new Uint8Array(report.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(report.fileSize),
      "Content-Disposition": `inline; filename="geo-report.pdf"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    },
  })
}
