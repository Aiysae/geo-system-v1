import type { ExtractedItem, ExtractedProfile } from "@/types/geo-strategy"

function normalizeItem(item: unknown, id: string): ExtractedItem {
  if (typeof item === "string") {
    return { id, text: item, enabled: true, confidence: "medium" }
  }
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const value = item as Partial<ExtractedItem>
    return {
      id: String(value.id || id),
      text: String(value.text || ""),
      enabled: value.enabled !== false,
      confidence: value.confidence === "high" || value.confidence === "low"
        ? value.confidence
        : "medium",
    }
  }
  return { id, text: String(item || ""), enabled: true, confidence: "medium" }
}

export function normalizeExtractedProfileForJob(
  profile: ExtractedProfile,
  jobId: string,
): ExtractedProfile {
  const normalizeList = (field: string, values: unknown): ExtractedItem[] => (
    Array.isArray(values)
      ? values.map((item, index) => normalizeItem(item, `${field}_${jobId}_${index + 1}`))
      : []
  )
  return {
    ...profile,
    pain_points: normalizeList("pain", profile.pain_points),
    advantages: normalizeList("advantage", profile.advantages),
    weaknesses: normalizeList("weakness", profile.weaknesses),
    competitors: normalizeList("competitor", profile.competitors),
    scenes: normalizeList("scene", profile.scenes),
  }
}
