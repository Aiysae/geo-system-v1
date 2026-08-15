import "server-only"

import { createHash } from "node:crypto"
import {
  buildClientFeedbackReport,
  collectClientFeedbackPeriodActions,
} from "@/lib/client-feedback/builder"
import {
  listClientExecutionActions,
  publishClientFeedbackReport,
} from "@/lib/client-feedback/store"
import { listClientFeedbackHistory } from "@/lib/client-feedback/metrics"
import { getClientExecutionPublicationPolicy } from "@/lib/client-feedback/publication"
import { buildFeedbackReportSystemOutputRecord } from "@/lib/system-output/builders"
import { saveSystemOutputRecord } from "@/lib/system-output/store"
import type { Client } from "@/types"
import type {
  ClientExecutionProfile,
  ClientFeedbackPeriod,
  ClientFeedbackReport,
} from "@/types/client-feedback"

function reportIdFromRequest(input: {
  ownerUserId: string
  clientId: string
  requestId?: string
}): string | undefined {
  const requestId = String(input.requestId || "").trim()
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(requestId)) return undefined
  return `cfr_req_${createHash("sha256")
    .update(`${input.ownerUserId}:${input.clientId}:${requestId}`)
    .digest("hex")
    .slice(0, 32)}`
}

export async function clientFeedbackPeriodActionCount(input: {
  ownerUserId: string
  clientId: string
  period: ClientFeedbackPeriod
}): Promise<number> {
  const [history, actions, publicationPolicy] = await Promise.all([
    listClientFeedbackHistory(input.ownerUserId, input.clientId),
    listClientExecutionActions(input.ownerUserId, input.clientId),
    getClientExecutionPublicationPolicy(input.ownerUserId, input.clientId),
  ])
  return collectClientFeedbackPeriodActions({
    manualActions: actions,
    history: history.items,
    publicationPolicy,
    period: input.period,
  }).length
}

export async function createClientFeedbackReport(input: {
  ownerUserId: string
  actorUserId: string
  client: Client
  profile: ClientExecutionProfile
  period: ClientFeedbackPeriod
  baselineHistoryRecordId?: string
  currentHistoryRecordId?: string
  publish?: boolean
  requestId?: string
}): Promise<{
  report: ClientFeedbackReport
  sharePath?: string
}> {
  const draft = await buildClientFeedbackReport({
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    client: input.client,
    profile: input.profile,
    period: input.period,
    baselineHistoryRecordId: input.baselineHistoryRecordId,
    currentHistoryRecordId: input.currentHistoryRecordId,
    reportId: reportIdFromRequest({
      ownerUserId: input.ownerUserId,
      clientId: input.client.id,
      requestId: input.requestId,
    }),
  })
  const published = input.publish
    ? await publishClientFeedbackReport({
        ownerUserId: input.ownerUserId,
        clientId: input.client.id,
        reportId: draft.id,
        actorUserId: input.actorUserId,
      })
    : null
  const report = published?.report || draft
  await saveSystemOutputRecord(
    input.ownerUserId,
    buildFeedbackReportSystemOutputRecord({
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      clientName: input.client.name,
      report,
    }),
  ).catch(error => {
    console.warn(
      "[client-feedback] system output save failed",
      report.id,
      error instanceof Error ? error.message : error,
    )
  })
  return { report, sharePath: published?.sharePath }
}
