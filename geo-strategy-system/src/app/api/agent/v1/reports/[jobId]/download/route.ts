import { NextRequest } from "next/server"
import { AgentApiError, agentError, assertAgentClientGrant, requireAgentAuth } from "@/lib/agent/api"
import { getCommercialReportFile, getCommercialReportJobScope } from "@/lib/reports/report-jobs"
import { requireReportJobAccess } from "@/lib/reports/access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["report.export"])
    traceId = auth.traceId
    const { jobId } = await context.params
    const scope = await getCommercialReportJobScope(jobId)
    if (!scope) throw new AgentApiError({ code: "NOT_FOUND", message: "报告不存在或已过期", status: 404 })
    assertAgentClientGrant(auth, scope.clientId, scope.teamId)
    const authorized = await requireReportJobAccess({ jobId, userId: auth.userId, action: "export" })
    if (!authorized) throw new AgentApiError({ code: "NOT_FOUND", message: "报告不存在或无权下载", status: 404 })
    const report = await getCommercialReportFile(jobId, authorized.scope.ownerUserId)
    if (!report) throw new AgentApiError({ code: "NOT_FOUND", message: "报告尚未生成或已过期", status: 404 })
    const encodedName = encodeURIComponent(report.fileName).replace(
      /[!'()*]/g,
      character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    return new Response(new Uint8Array(report.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(report.fileSize),
        "Content-Disposition": `attachment; filename="geo-report.pdf"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Trace-Id": auth.traceId,
      },
    })
  } catch (error) {
    return agentError(error, traceId)
  }
}
