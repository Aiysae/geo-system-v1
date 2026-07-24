import { NextRequest, NextResponse } from "next/server"
import { getCommercialReportFile } from "@/lib/reports/report-jobs"
import {
  isReportAccessError,
  requireReportJobAccess,
} from "@/lib/reports/access"
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
  try {
    const { jobId } = await context.params
    const authorized = await requireReportJobAccess({
      jobId,
      userId: userGuard.userId,
      action: "export",
    })
    if (!authorized) {
      return NextResponse.json({ error: "报告尚未生成、已过期或无权访问" }, { status: 404 })
    }
    const report = await getCommercialReportFile(jobId, authorized.scope.ownerUserId)
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
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "下载报告失败" },
      { status: isReportAccessError(error) ? 403 : 500 },
    )
  }
}
