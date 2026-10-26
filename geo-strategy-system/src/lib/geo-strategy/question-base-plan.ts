import type { Client } from "@/types"
import type { ExtractedProfile, GeoStrategyPlan } from "@/types/geo-strategy"

/** What the keyword page holds that a question brief can be drawn from. */
export interface QuestionBriefSource {
  extractedProfile: ExtractedProfile | null
  projectName: string
  industry: string
  audience: string
  productDesc: string
  geoGoals: string
  competitorsRaw: string
  locationTerms: string
  painPointsRaw: string
  coreAdvantages: string
}

function splitBriefLines(value: string | undefined): string[] {
  return String(value || "")
    .split(/[\n；;]+/)
    .map(item => item.replace(/^[-•·\d.、\s]+/, "").trim())
    .filter(Boolean)
}

/**
 * A strategy-shaped brief for question generation when there is no strategy
 * report yet: the confirmed profile if there is one, else the client's basic
 * details and whatever was typed in. The keyword groups stay empty, so the
 * keywords come from the brand, the region terms or the custom keywords.
 */
export function questionBasePlan(
  brand: QuestionBriefSource,
  client: Pick<Client, "name" | "ourBrand" | "industry">,
  subjectType: "brand" | "person",
): GeoStrategyPlan {
  const profile = brand.extractedProfile
  const enabled = (items?: { text: string; enabled?: boolean }[]) => (items || [])
    .filter(item => item.enabled !== false)
    .map(item => item.text.trim())
    .filter(Boolean)
  const name = profile?.project_name || brand.projectName || client.ourBrand || client.name
  return {
    project_name: name,
    summary: "",
    profile: {
      subject_type: subjectType,
      ...(profile?.person_profile ? { person_profile: profile.person_profile } : {}),
      brand_or_product: name,
      industry: profile?.industry || brand.industry || client.industry || "",
      audience: profile?.audience || brand.audience || "",
      product_description: profile?.product_description || brand.productDesc || "",
      business_goals: profile?.geo_goals || brand.geoGoals || "",
      competitors: profile ? enabled(profile.competitors) : splitBriefLines(brand.competitorsRaw),
      terms: splitBriefLines(brand.locationTerms),
      pain_points: profile ? enabled(profile.pain_points) : splitBriefLines(brand.painPointsRaw),
      advantages: profile ? enabled(profile.advantages) : splitBriefLines(brand.coreAdvantages),
      weaknesses: profile ? enabled(profile.weaknesses) : [],
      scenes: profile ? enabled(profile.scenes) : [],
    },
    keyword_strategy: {
      core_keywords: [],
      pain_advantage_keywords: [],
      weakness_conversion_keywords: [],
      scenario_keywords: [],
    },
    official_site_strategy: [],
    third_party_site_strategy: [],
    media_plan: [],
    geo_monitoring_plan: [],
    execution_roadmap: [],
  }
}
