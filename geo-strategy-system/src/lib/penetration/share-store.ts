import "server-only"

import { randomBytes } from "node:crypto"
import { kv } from "@/lib/kv"
import { aggregatePenetration } from "@/lib/score-utils"
import { getClientSubjectType } from "@/lib/analysis-subject"
import type {
  AnalysisSubjectType,
  Client,
  PenetrationItem,
  PenetrationResult,
  PersonSubjectProfile,
} from "@/types"

// A shared detection result: a copy of the report as it stood when the link
// was made, which later runs and re-runs leave alone. The link stays valid
// until it is turned off. Its token is the only key, unguessable (192 bits).

export interface PenetrationShareSnapshot {
  token: string
  ownerUserId: string
  clientId: string
  createdByUserId: string
  createdAt: string
  clientName: string
  subjectType: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  ourBrand: string
  brandAliases: string[]
  competitors: string[]
  penetration: PenetrationResult
}

/** What the page lists: everything but the copied report. */
export type PenetrationShareSummary = Pick<
  PenetrationShareSnapshot,
  "token" | "createdAt" | "createdByUserId"
> & {
  sharePath: string
  /** When the shared report was generated. */
  generatedAt: string
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/
const snapshotKey = (token: string) => `geo:penetration-share:${token}`
const indexKey = (ownerUserId: string, clientId: string) => `geo:penetration-share-index:${ownerUserId}:${clientId}`

export function penetrationSharePath(token: string): string {
  return `/penetration/share/${token}`
}

// Audit internals and source snippets the page never shows; they were half
// of a seven-model report.
function shareItem(item: PenetrationItem): PenetrationItem {
  const { providerRequestIds: _providerRequestIds, ...rest } = item
  return {
    ...rest,
    requestAudits: item.requestAudits?.slice(-1),
    searchSources: (item.searchSources || []).map(source => ({ ...source, snippet: "" })),
  }
}

export class PenetrationShareError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = "PenetrationShareError"
  }
}

export async function createPenetrationShare(input: {
  ownerUserId: string
  createdByUserId: string
  client: Client
}): Promise<PenetrationShareSummary> {
  const { client } = input
  const report = client.penetration
  if (!report) throw new PenetrationShareError("还没有检测结果，无法生成分享链接")
  const subjectType = getClientSubjectType(client)
  const brandAliases = client.brandAliases ?? []
  const competitors = client.competitors ?? []
  const token = randomBytes(24).toString("base64url")
  const snapshot: PenetrationShareSnapshot = {
    token,
    ownerUserId: input.ownerUserId,
    clientId: client.id,
    createdByUserId: input.createdByUserId,
    createdAt: new Date().toISOString(),
    clientName: client.name,
    subjectType,
    personProfile: subjectType === "person" ? client.personProfile : undefined,
    ourBrand: client.ourBrand,
    brandAliases,
    competitors,
    penetration: {
      ...report,
      // The figures the detection page shows, under today's rules.
      aggregated: aggregatePenetration(report.byModel, client.ourBrand, brandAliases, competitors, subjectType, {
        plannedSlots: report.aggregated.plannedSlots,
        modelCount: Object.keys(report.byModel).length,
      }),
      byModel: Object.fromEntries(
        Object.entries(report.byModel).map(([model, items]) => [model, (items || []).map(shareItem)]),
      ),
    },
  }
  await kv.set(snapshotKey(token), snapshot)
  await kv.sadd(indexKey(input.ownerUserId, client.id), token)
  return summarize(snapshot)
}

function summarize(snapshot: PenetrationShareSnapshot): PenetrationShareSummary {
  return {
    token: snapshot.token,
    createdAt: snapshot.createdAt,
    createdByUserId: snapshot.createdByUserId,
    sharePath: penetrationSharePath(snapshot.token),
    generatedAt: snapshot.penetration.generatedAt,
  }
}

export async function getPenetrationShare(token: string): Promise<PenetrationShareSnapshot | null> {
  if (!TOKEN_PATTERN.test(token)) return null
  return kv.get<PenetrationShareSnapshot>(snapshotKey(token))
}

/**
 * The shared report for viewing. The answers stay as they were when the link
 * was made; the figures are worked out again under today's rules, so a link
 * made before a new view (such as the per-question ranking) shows it too.
 */
export async function viewPenetrationShare(token: string): Promise<PenetrationShareSnapshot | null> {
  const snapshot = await getPenetrationShare(token)
  if (!snapshot) return null
  const report = snapshot.penetration
  return {
    ...snapshot,
    penetration: {
      ...report,
      aggregated: aggregatePenetration(
        report.byModel,
        snapshot.ourBrand,
        snapshot.brandAliases,
        snapshot.competitors,
        snapshot.subjectType,
        {
          plannedSlots: report.aggregated.plannedSlots,
          modelCount: Object.keys(report.byModel).length,
        },
      ),
    },
  }
}

/** The client's links that still work, newest first. */
export async function listPenetrationShares(
  ownerUserId: string,
  clientId: string,
): Promise<PenetrationShareSummary[]> {
  const tokens = await kv.smembers<string[]>(indexKey(ownerUserId, clientId)).catch(() => [] as string[])
  const snapshots = await Promise.all((tokens || []).map(token => getPenetrationShare(token)))
  const gone = (tokens || []).filter((_, index) => !snapshots[index])
  if (gone.length) await kv.srem(indexKey(ownerUserId, clientId), ...gone).catch(() => 0)
  return snapshots
    .filter((snapshot): snapshot is PenetrationShareSnapshot => (
      Boolean(snapshot && snapshot.ownerUserId === ownerUserId && snapshot.clientId === clientId)
    ))
    .map(summarize)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Turns a link off; it stops working at once. */
export async function revokePenetrationShare(input: {
  ownerUserId: string
  clientId: string
  token: string
}): Promise<boolean> {
  const snapshot = await getPenetrationShare(input.token)
  if (!snapshot || snapshot.ownerUserId !== input.ownerUserId || snapshot.clientId !== input.clientId) {
    return false
  }
  await kv.del(snapshotKey(input.token))
  await kv.srem(indexKey(input.ownerUserId, input.clientId), input.token)
  return true
}
