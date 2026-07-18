import type {
  AnalysisSubjectType,
  Client,
  PersonSubjectProfile,
} from "@/types"

export const EMPTY_PERSON_SUBJECT_PROFILE: PersonSubjectProfile = {
  profession: "",
  specialties: [],
  organization: "",
  region: "",
  title: "",
  credentials: [],
  profileUrls: [],
}

export function createEmptyPersonSubjectProfile(): PersonSubjectProfile {
  return {
    profession: "",
    specialties: [],
    organization: "",
    region: "",
    title: "",
    credentials: [],
    profileUrls: [],
  }
}

export function normalizeAnalysisSubjectType(value: unknown): AnalysisSubjectType {
  return value === "person" ? "person" : "brand"
}

export function normalizePersonSubjectProfile(value: unknown): PersonSubjectProfile {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    profession: cleanText(input.profession, 200),
    specialties: cleanTextArray(input.specialties, 100, 300),
    organization: cleanText(input.organization, 300),
    region: cleanText(input.region, 200),
    title: cleanText(input.title, 200),
    credentials: cleanTextArray(input.credentials, 100, 500),
    profileUrls: cleanTextArray(input.profileUrls, 30, 2_000),
  }
}

export function getClientSubjectType(
  client: Pick<Client, "subjectType"> | { subjectType?: AnalysisSubjectType },
): AnalysisSubjectType {
  return normalizeAnalysisSubjectType(client.subjectType)
}

export function getSubjectCopy(subjectType: AnalysisSubjectType) {
  if (subjectType === "person") {
    return {
      modeLabel: "个人 IP 模式",
      subjectLabel: "目标人物姓名",
      subjectShortLabel: "人物姓名",
      aliasesLabel: "姓名别名",
      competitorsLabel: "已知同行人物",
      industryLabel: "所在行业 / 专业领域",
      rankingLabel: "同行人物可见度",
      mentionLabel: "人物提及",
    } as const
  }

  return {
    modeLabel: "品牌模式",
    subjectLabel: "我方品牌名",
    subjectShortLabel: "品牌名",
    aliasesLabel: "品牌别名",
    competitorsLabel: "已知主要竞品",
    industryLabel: "所属行业",
    rankingLabel: "品牌渗透率",
    mentionLabel: "品牌提及",
  } as const
}

export function formatPersonSubjectContext(
  value: unknown,
  emptyText = "未提供",
): string {
  const profile = normalizePersonSubjectProfile(value)
  return [
    `职业：${profile.profession || emptyText}`,
    `专业方向：${profile.specialties.join("、") || emptyText}`,
    `所在机构：${profile.organization || emptyText}`,
    `主要地区：${profile.region || emptyText}`,
    `职称/身份：${profile.title || emptyText}`,
    `资质与公开背书：${profile.credentials.join("；") || emptyText}`,
    `公开资料页：${profile.profileUrls.join("、") || emptyText}`,
  ].join("\n")
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength)
}

function cleanTextArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .map(item => cleanText(item, maxLength))
    .filter(Boolean)
}
