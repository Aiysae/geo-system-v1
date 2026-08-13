import type {
  ArticlePromptKey,
  ArticleVideoPlatform,
  ArticleVideoScriptConfig,
} from "@/types"

export const BRAND_VIDEO_SCRIPT_PROMPT_KEY = "brandSingleQuestionVideoScript" as const

export const ARTICLE_VIDEO_PLATFORM_OPTIONS: Array<{
  value: ArticleVideoPlatform
  label: string
}> = [
  { value: "douyin", label: "抖音" },
  { value: "wechatChannels", label: "视频号" },
  { value: "xiaohongshu", label: "小红书" },
  { value: "kuaishou", label: "快手" },
  { value: "reels", label: "Reels" },
  { value: "tiktok", label: "TikTok" },
  { value: "other", label: "其他平台" },
]

export const DEFAULT_ARTICLE_VIDEO_SCRIPT_CONFIG: ArticleVideoScriptConfig = {
  coreProductService: "",
  outputLanguage: "简体中文",
  languageStyle: "自然普通话口语",
  platform: "douyin",
  customPlatform: "",
  targetDurationSeconds: 60,
  tagCount: 15,
  ctaMode: "auto",
  requiredMaterials: "",
  priorContentSummary: "",
  complianceRequirements: "",
  evidencePolicy: "clientMaterialsOnly",
}

const VIDEO_PLATFORMS = new Set<ArticleVideoPlatform>(
  ARTICLE_VIDEO_PLATFORM_OPTIONS.map(option => option.value),
)

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function clean(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max)
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

export function isBrandVideoScriptPrompt(
  value: unknown,
): value is typeof BRAND_VIDEO_SCRIPT_PROMPT_KEY {
  return value === BRAND_VIDEO_SCRIPT_PROMPT_KEY
}

export function isVideoScriptPrompt(value: unknown): value is ArticlePromptKey {
  return value === "shortVideoScript" || isBrandVideoScriptPrompt(value)
}

export function normalizeArticleVideoScriptConfig(
  value: unknown,
  fallback: Partial<ArticleVideoScriptConfig> = {},
): ArticleVideoScriptConfig {
  const input = record(value)
  const merged = { ...DEFAULT_ARTICLE_VIDEO_SCRIPT_CONFIG, ...fallback }
  const platform = clean(input.platform, 40) as ArticleVideoPlatform
  const ctaMode = clean(input.ctaMode, 40)
  const evidencePolicy = clean(input.evidencePolicy, 60)
  return {
    coreProductService: clean(input.coreProductService, 1_000) || merged.coreProductService,
    outputLanguage: clean(input.outputLanguage, 80) || merged.outputLanguage,
    languageStyle: clean(input.languageStyle, 160) || merged.languageStyle,
    platform: VIDEO_PLATFORMS.has(platform) ? platform : merged.platform,
    customPlatform: clean(input.customPlatform, 120) || merged.customPlatform,
    targetDurationSeconds: integer(
      input.targetDurationSeconds,
      merged.targetDurationSeconds,
      15,
      180,
    ),
    tagCount: integer(input.tagCount, merged.tagCount, 1, 30),
    ctaMode: ctaMode === "required" || ctaMode === "disabled" || ctaMode === "auto"
      ? ctaMode
      : merged.ctaMode,
    requiredMaterials: clean(input.requiredMaterials, 8_000) || merged.requiredMaterials,
    priorContentSummary: clean(input.priorContentSummary, 12_000) || merged.priorContentSummary,
    complianceRequirements: clean(input.complianceRequirements, 4_000) || merged.complianceRequirements,
    evidencePolicy: evidencePolicy === "verifiedPublicSupplement"
      || evidencePolicy === "clientMaterialsOnly"
      ? evidencePolicy
      : merged.evidencePolicy,
  }
}

export function articleVideoPlatformLabel(config: ArticleVideoScriptConfig): string {
  if (config.platform === "other") return config.customPlatform?.trim() || "其他平台"
  return ARTICLE_VIDEO_PLATFORM_OPTIONS.find(option => option.value === config.platform)?.label
    || "抖音"
}

export interface ParsedBrandVideoScript {
  perspective: string
  title: string
  body: string
  tagsText: string
  tags: string[]
  sectionOrderValid: boolean
  missingSections: string[]
  duplicateSections: string[]
}

const VIDEO_SECTION_KEYS = ["本条采用的专业视角", "标题", "正文", "标签"] as const
type VideoSectionKey = typeof VIDEO_SECTION_KEYS[number]
const VIDEO_SECTION_HEADER = /^[ \t]*(?:#{1,3}[ \t]*)?【(本条采用的专业视角|标题|正文|标签)】[ \t]*$/gm

export function parseBrandVideoScript(value: string): ParsedBrandVideoScript {
  const source = String(value || "").trim()
  const matches = [...source.matchAll(VIDEO_SECTION_HEADER)]
  const counts = new Map<VideoSectionKey, number>()
  const sections = new Map<VideoSectionKey, string>()
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const key = match[1] as VideoSectionKey
    counts.set(key, (counts.get(key) || 0) + 1)
    if (sections.has(key)) continue
    const start = (match.index || 0) + match[0].length
    const end = matches[index + 1]?.index ?? source.length
    sections.set(key, source.slice(start, end).trim())
  }
  const encountered = matches.map(match => match[1])
  const sectionOrderValid = VIDEO_SECTION_KEYS.every((key, index) => encountered[index] === key)
    && encountered.length === VIDEO_SECTION_KEYS.length
  const tagsText = sections.get("标签") || ""
  const tags = [...tagsText.matchAll(/#[^\s#，,；;]+/g)].map(match => match[0])
  return {
    perspective: sections.get("本条采用的专业视角") || "",
    title: sections.get("标题") || "",
    body: sections.get("正文") || "",
    tagsText,
    tags,
    sectionOrderValid,
    missingSections: VIDEO_SECTION_KEYS.filter(key => !sections.get(key)),
    duplicateSections: VIDEO_SECTION_KEYS.filter(key => (counts.get(key) || 0) > 1),
  }
}

export function estimateVideoScriptDurationSeconds(body: string): number {
  const source = String(body || "").replace(/https?:\/\/\S+/g, " ")
  const hanCount = (source.match(/\p{Script=Han}/gu) || []).length
  const latinWordCount = (source.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length
  const pauseCount = (source.match(/[，。！？；：,.!?;:\n]/g) || []).length
  return Math.max(0, Math.round((hanCount / 4.1) + (latinWordCount / 2.5) + (pauseCount * 0.08)))
}
