import { NextRequest, NextResponse } from "next/server"
import {
  feedbackHistoryDate,
  listClientFeedbackHistory,
  metricOption,
  selectFeedbackMetricRecords,
  usableFeedbackMetricRecord,
} from "@/lib/client-feedback/metrics"
import {
  feedbackPeriodForDate,
  getClientExecutionProfile,
  shanghaiDateOnly,
} from "@/lib/client-feedback/store"
import { requireOperationAccess } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import type {
  ClientFeedbackReportOptions,
  ClientFeedbackReportType,
} from "@/types/client-feedback"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const type: ClientFeedbackReportType = request.nextUrl.searchParams.get("type") === "monthly"
      ? "monthly"
      : "weekly"
    const targetDate = String(request.nextUrl.searchParams.get("targetDate") || shanghaiDateOnly())
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "feedback",
      action: "edit",
    })
    const profile = await getClientExecutionProfile(access.dataOwnerUserId, access.clientId)
    const period = feedbackPeriodForDate(profile, type, targetDate)
    if (period.end !== targetDate) throw new Error("报告截止日期不能早于正式执行日期")
    if (period.end > shanghaiDateOnly()) throw new Error("报告截止日期不能晚于今天")

    const history = await listClientFeedbackHistory(access.dataOwnerUserId, access.clientId)
    const metricHistory = history.items
      .filter(usableFeedbackMetricRecord)
      .filter(record => feedbackHistoryDate(record) <= period.end)
    const selected = selectFeedbackMetricRecords({ history: metricHistory, period })
    const response: ClientFeedbackReportOptions = {
      period,
      metrics: metricHistory.map(metricOption).reverse(),
      suggestedBaselineHistoryRecordId: selected.baseline?.id,
      suggestedCurrentHistoryRecordId: selected.current?.id,
      truncated: history.truncated,
    }
    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "反馈报告配置读取失败",
    }, { status: 403 })
  }
}
