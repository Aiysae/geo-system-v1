import { NextRequest, NextResponse } from "next/server"
import { getCommercialReportFile, getCommercialReportJob } from "@/lib/reports/report-jobs"
import { requireUserId } from "@/lib/with-credits"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"

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
  const access = await resolveWorkspaceAccess(userGuard.userId)
  if (!access.ok) {
    return NextResponse.json({ error: access.message, code: access.code }, { status: 403 })
  }
  const job = await getCommercialReportJob(jobId, access.ownerUserId)
  if (!job || (access.mode === "client" && job.clientId !== access.clientId)) {
    return NextResponse.json({ error: "报告尚未生成、已过期或无权访问" }, { status: 404 })
  }
  const report = await getCommercialReportFile(jobId, access.ownerUserId)
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
      "Content-Disposition": `attachment; filename="geo-report.pdf"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
