import { z } from "zod"

const booleanValue = z.preprocess(value => {
  if (typeof value === "number") {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value !== "string") return value
  const normalized = value.trim().toLowerCase()
  if (["true", "yes", "y", "1", "是", "推荐"].includes(normalized)) return true
  if (["false", "no", "n", "0", "否", "不推荐"].includes(normalized)) return false
  return value
}, z.boolean())

const scoreValue = z.preprocess(value => {
  if (typeof value !== "string") return value
  const normalized = value.trim().replace(/%$/, "")
  return normalized ? Number(normalized) : value
}, z.number().finite().min(0).max(100))

const recommendationRowSchema = z.preprocess(value => {
  if (!isRecord(value)) return value
  return {
    platform_key: firstDefined(value, ["platform_key", "platformKey", "key"]),
    industry_fit: firstDefined(value, ["industry_fit", "industryFit", "fit_score", "fitScore"]),
    stage_value: firstDefined(value, ["stage_value", "stageValue", "stage_score", "stageScore"]),
    recommended: firstDefined(value, ["recommended", "is_recommended", "isRecommended"]),
    reason: firstDefined(value, ["reason", "recommendation_reason", "recommendationReason", "rationale"]),
  }
}, z.object({
  platform_key: z.string().trim().min(1).max(100),
  industry_fit: scoreValue,
  stage_value: scoreValue,
  recommended: booleanValue,
  reason: z.string().trim().max(300).optional().default(""),
}))

export type PublishingPlatformAiRecommendation = z.infer<typeof recommendationRowSchema>

export const PUBLISHING_RECOMMENDATION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["platforms"],
  properties: {
    platforms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "platform_key",
          "industry_fit",
          "stage_value",
          "recommended",
          "reason",
        ],
        properties: {
          platform_key: { type: "string" },
          industry_fit: { type: "integer", minimum: 0, maximum: 100 },
          stage_value: { type: "integer", minimum: 0, maximum: 100 },
          recommended: { type: "boolean" },
          reason: { type: "string", maxLength: 300 },
        },
      },
    },
  },
} as const

export function parsePublishingPlatformRecommendations(
  raw: string,
  allowedPlatformKeys: string[],
): PublishingPlatformAiRecommendation[] {
  const allowed = new Map(
    allowedPlatformKeys
      .map(key => key.trim())
      .filter(Boolean)
      .map(key => [normalizePlatformKey(key), key] as const),
  )
  const parsedPayload = parsePayload(raw)
  const rows = Array.isArray(parsedPayload)
    ? parsedPayload
    : isRecord(parsedPayload) && Array.isArray(parsedPayload.platforms)
      ? parsedPayload.platforms
      : []
  const result: PublishingPlatformAiRecommendation[] = []
  const indexes = new Map<string, number>()

  for (const row of rows) {
    const parsed = recommendationRowSchema.safeParse(row)
    if (!parsed.success) continue
    const normalizedKey = normalizePlatformKey(parsed.data.platform_key)
    const platformKey = allowed.get(normalizedKey)
    if (!platformKey) continue
    const normalizedRow = { ...parsed.data, platform_key: platformKey }
    const existingIndex = indexes.get(normalizedKey)
    if (existingIndex === undefined) {
      indexes.set(normalizedKey, result.length)
      result.push(normalizedRow)
      continue
    }
    if (rowQuality(normalizedRow) > rowQuality(result[existingIndex])) {
      result[existingIndex] = normalizedRow
    }
  }

  if (result.length === 0) {
    throw new Error("AI 没有返回有效的候选平台")
  }
  return result
}

export function getMissingPublishingPlatformKeys(
  rows: PublishingPlatformAiRecommendation[],
  allowedPlatformKeys: string[],
): string[] {
  const present = new Set(rows.map(row => normalizePlatformKey(row.platform_key)))
  return allowedPlatformKeys
    .map(key => key.trim())
    .filter(Boolean)
    .filter(key => !present.has(normalizePlatformKey(key)))
}

function parsePayload(raw: string): unknown {
  const text = String(raw || "").trim()
  const candidates = new Set<string>()
  if (text) candidates.add(text)

  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const fenced = match[1]?.trim()
    if (fenced) candidates.add(fenced)
  }

  const objectStart = text.indexOf("{")
  const objectEnd = text.lastIndexOf("}")
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.add(text.slice(objectStart, objectEnd + 1))
  }

  const arrayStart = text.indexOf("[")
  const arrayEnd = text.lastIndexOf("]")
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.add(text.slice(arrayStart, arrayEnd + 1))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown
    } catch {
      // Try the next bounded JSON candidate.
    }
  }
  throw new Error("AI 没有返回可解析的平台建议")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function firstDefined(
  record: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  return undefined
}

function normalizePlatformKey(value: string): string {
  return value.trim().toLowerCase()
}

function rowQuality(row: PublishingPlatformAiRecommendation): number {
  return row.reason.trim().length
}
