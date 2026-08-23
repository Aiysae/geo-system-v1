import { z } from "zod"

const booleanValue = z.preprocess(value => {
  if (typeof value !== "string") return value
  if (value.trim().toLowerCase() === "true") return true
  if (value.trim().toLowerCase() === "false") return false
  return value
}, z.boolean())

const recommendationRowSchema = z.object({
  platform_key: z.string().trim().min(1).max(100),
  industry_fit: z.coerce.number().finite().min(0).max(100),
  stage_value: z.coerce.number().finite().min(0).max(100),
  recommended: booleanValue,
  reason: z.string().trim().max(300).optional().default(""),
})

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
  const allowed = new Set(allowedPlatformKeys.map(key => key.trim()).filter(Boolean))
  const parsedPayload = parsePayload(raw)
  const rows = Array.isArray(parsedPayload)
    ? parsedPayload
    : isRecord(parsedPayload) && Array.isArray(parsedPayload.platforms)
      ? parsedPayload.platforms
      : []
  const result: PublishingPlatformAiRecommendation[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const parsed = recommendationRowSchema.safeParse(row)
    if (!parsed.success) continue
    if (!allowed.has(parsed.data.platform_key) || seen.has(parsed.data.platform_key)) continue
    seen.add(parsed.data.platform_key)
    result.push(parsed.data)
  }

  if (result.length === 0) {
    throw new Error("AI 没有返回有效的候选平台")
  }
  return result
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
