import { NextRequest, NextResponse } from "next/server"
import {
  collectClientFeedbackPeriodActions,
  summarizeClientFeedbackPeriodActions,
} from "@/lib/client-feedback/builder"
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
  listClientExecutionActions,
  shanghaiDateOnly,
} from "@/lib/client-feedback/store"
import { getClientExecutionPublicationPolicy } from "@/lib/client-feedback/publication"
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
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    const type: ClientFeedbackReportType = request.nextUrl.searchParams.get("type") === "monthly"
      ? "monthly"
      : "weekly"
    const targetDate = String(request.nextUrl.searchParams.get("targetDate") || shanghaiDateOnly())
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId,
      module: "feedback",
      action: "edit",
    })
    const profile = await getClientExecutionProfile(access.dataOwnerUserId, access.clientId)
    const period = feedbackPeriodForDate(profile, type, targetDate)
    if (period.end > shanghaiDateOnly()) throw new Error("报告截止日期不能晚于今天")

    const [history, manualActions, publicationPolicy] = await Promise.all([
      listClientFeedbackHistory(access.dataOwnerUserId, access.clientId),
      listClientExecutionActions(access.dataOwnerUserId, access.clientId),
      getClientExecutionPublicationPolicy(access.dataOwnerUserId, access.clientId),
    ])
    const metricHistory = history.items
      .filter(usableFeedbackMetricRecord)
      .filter(record => feedbackHistoryDate(record) <= period.end)
    const selected = selectFeedbackMetricRecords({ history: metricHistory, period })
    const periodActions = collectClientFeedbackPeriodActions({
      manualActions,
      history: history.items,
      publicationPolicy,
      period,
    })
    const response: ClientFeedbackReportOptions = {
      period,
      actionCount: periodActions.length,
      actionDays: summarizeClientFeedbackPeriodActions(periodActions, period),
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
