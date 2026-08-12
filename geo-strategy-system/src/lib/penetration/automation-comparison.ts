import "server-only"

import { createHash } from "crypto"
import type {
  PenetrationHistoryRecord,
  PenetrationHistoryRequestSnapshot,
} from "@/types"

export type PenetrationAutomationComparison = {
  comparable: boolean
  reason: string
  baselineHistoryRecordId?: string
  baselineRate?: number
  currentRate?: number
  absoluteDropPoints?: number
  relativeDropPct?: number
  alertTriggered: boolean
}

function normalizedText(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, " ")
}

function normalizedList(values: unknown): string[] {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map(normalizedText)
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right, "zh-CN"))
}

function normalizedMultiset(values: unknown): string[] {
  return (Array.isArray(values) ? values : [])
    .map(normalizedText)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
}

export function buildPenetrationComparisonSignature(
  request: Pick<
    PenetrationHistoryRequestSnapshot,
    | "subjectType"
    | "personProfile"
    | "ourBrand"
    | "brandAliases"
    | "industry"
    | "questions"
    | "questionIntents"
    | "competitors"
    | "activeModels"
  >,
): string {
  const intents = (request.questionIntents || [])
    .map(item => ({
      question: normalizedText(item.question),
      category: normalizedText(item.category),
    }))
    .sort((left, right) => (
      `${left.question}\u0000${left.category}`
        .localeCompare(`${right.question}\u0000${right.category}`, "zh-CN")
    ))
  const canonical = JSON.stringify({
    version: 1,
    subjectType: request.subjectType || "brand",
    personProfile: request.personProfile ? {
      profession: normalizedText(request.personProfile.profession),
      specialties: normalizedList(request.personProfile.specialties),
      organization: normalizedText(request.personProfile.organization),
      region: normalizedText(request.personProfile.region),
      title: normalizedText(request.personProfile.title),
      credentials: normalizedList(request.personProfile.credentials),
      profileUrls: normalizedList(request.personProfile.profileUrls),
    } : undefined,
    ourBrand: normalizedText(request.ourBrand),
    brandAliases: normalizedList(request.brandAliases),
    industry: normalizedText(request.industry),
    questions: normalizedMultiset(request.questions),
    intents,
    competitors: normalizedList(request.competitors),
    activeModels: normalizedList(request.activeModels),
  })
  return createHash("sha256").update(canonical).digest("hex")
}

function completionRate(record: PenetrationHistoryRecord): number {
  if (Number.isFinite(record.summary.completionRate)) {
    return Number(record.summary.completionRate)
  }
  return record.summary.totalSlots > 0
    ? record.summary.completedSlots / record.summary.totalSlots
    : 0
}

function validComparableRecord(record: PenetrationHistoryRecord): boolean {
  return record.status === "succeeded"
    && typeof record.summary.penetrationRate === "number"
    && Number.isFinite(record.summary.penetrationRate)
    && completionRate(record) >= 0.9
    && record.request.activeModels.length > 0
}

export function comparePenetrationAutomationResult(input: {
  current: PenetrationHistoryRecord
  candidates: PenetrationHistoryRecord[]
  relativeDropThresholdPct: number
  minimumAbsoluteDropPoints: number
}): PenetrationAutomationComparison {
  const currentRate = input.current.summary.penetrationRate
  if (!validComparableRecord(input.current) || typeof currentRate !== "number") {
    return {
      comparable: false,
      reason: "本次检测未达到完整性门槛，不触发下降提醒",
      currentRate: typeof currentRate === "number" ? currentRate : undefined,
      alertTriggered: false,
    }
  }

  const signature = buildPenetrationComparisonSignature(input.current.request)
  const baseline = input.candidates.find(record => (
    record.id !== input.current.id
    && validComparableRecord(record)
    && buildPenetrationComparisonSignature(record.request) === signature
    && Date.parse(record.completedAt || record.createdAt)
      < Date.parse(input.current.completedAt || input.current.createdAt)
  ))
  if (!baseline || typeof baseline.summary.penetrationRate !== "number") {
    return {
      comparable: false,
      reason: "暂无同口径历史结果，本次结果已建立为比较基线",
      currentRate,
      alertTriggered: false,
    }
  }

  const baselineRate = baseline.summary.penetrationRate
  const absoluteDropPoints = Math.max(0, (baselineRate - currentRate) * 100)
  if (baselineRate <= 0) {
    return {
      comparable: true,
      reason: "历史基线为 0%，本次不计算相对下降幅度",
      baselineHistoryRecordId: baseline.id,
      baselineRate,
      currentRate,
      absoluteDropPoints,
      relativeDropPct: 0,
      alertTriggered: false,
    }
  }
  const relativeDropPct = Math.max(0, (baselineRate - currentRate) / baselineRate * 100)
  const alertTriggered = relativeDropPct >= input.relativeDropThresholdPct
    && absoluteDropPoints >= input.minimumAbsoluteDropPoints
  return {
    comparable: true,
    reason: alertTriggered
      ? "渗透率下降达到提醒阈值"
      : currentRate >= baselineRate
        ? "渗透率未下降"
        : "渗透率有所下降，但未达到提醒阈值",
    baselineHistoryRecordId: baseline.id,
    baselineRate,
    currentRate,
    absoluteDropPoints: Math.round(absoluteDropPoints * 100) / 100,
    relativeDropPct: Math.round(relativeDropPct * 100) / 100,
    alertTriggered,
  }
}
