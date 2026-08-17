import type { GeoContentPlatform } from "@/types"
import type {
  PublishingContentType,
  PublishingPlatformConfig,
} from "@/types/publishing-plan"

export type PublishingPlatformFamily =
  | "general_article"
  | "knowledge_article"
  | "lifestyle_article"
  | "official_article"
  | "short_video"

export interface PublishingPlatformProfile {
  key: string
  label: string
  family: PublishingPlatformFamily
  geoPlatform: GeoContentPlatform
  supportsMarkdown: boolean
  supportsTables: boolean
  defaultReuseMode: "master_reuse" | "platform_specific"
  titleMaxLength?: number
  generationHint: string
}

const PROFILES: Array<PublishingPlatformProfile & { aliases: RegExp }> = [
  {
    key: "sohu",
    label: "搜狐",
    aliases: /搜狐|sohu/i,
    family: "general_article",
    geoPlatform: "sohu",
    supportsMarkdown: false,
    supportsTables: true,
    defaultReuseMode: "master_reuse",
    titleMaxLength: 30,
    generationHint: "标题直接回答搜索问题，正文使用清晰小标题并保留可核验信息。",
  },
  {
    key: "toutiao",
    label: "今日头条",
    aliases: /今日头条|头条|toutiao/i,
    family: "general_article",
    geoPlatform: "toutiao",
    supportsMarkdown: false,
    supportsTables: false,
    defaultReuseMode: "master_reuse",
    titleMaxLength: 30,
    generationHint: "开头先给结论，段落简洁，避免只有宣传语而缺少判断依据。",
  },
  {
    key: "netease",
    label: "网易",
    aliases: /网易|netease/i,
    family: "general_article",
    geoPlatform: "netease",
    supportsMarkdown: false,
    supportsTables: true,
    defaultReuseMode: "master_reuse",
    titleMaxLength: 30,
    generationHint: "采用资讯或行业观察表达，明确事实、观点和适用边界。",
  },
  {
    key: "baijiahao",
    label: "百家号",
    aliases: /百家号|baijiahao|百度百家/i,
    family: "general_article",
    geoPlatform: "baijiahao",
    supportsMarkdown: false,
    supportsTables: true,
    defaultReuseMode: "master_reuse",
    titleMaxLength: 30,
    generationHint: "围绕用户问题形成完整信息增量，避免重复堆叠关键词。",
  },
  {
    key: "zhihu",
    label: "知乎",
    aliases: /知乎|zhihu/i,
    family: "knowledge_article",
    geoPlatform: "zhihu",
    supportsMarkdown: true,
    supportsTables: true,
    defaultReuseMode: "platform_specific",
    titleMaxLength: 50,
    generationHint: "以问答方式展开，先给判断，再解释依据、方法和限制条件。",
  },
  {
    key: "xiaohongshu",
    label: "小红书",
    aliases: /小红书|xiaohongshu|rednote/i,
    family: "lifestyle_article",
    geoPlatform: "xiaohongshu",
    supportsMarkdown: false,
    supportsTables: false,
    defaultReuseMode: "platform_specific",
    titleMaxLength: 20,
    generationHint: "表达紧凑、场景清楚，减少长段落和复杂表格，不虚构体验。",
  },
  {
    key: "douyin",
    label: "抖音",
    aliases: /抖音|douyin|短视频/i,
    family: "short_video",
    geoPlatform: "douyin",
    supportsMarkdown: false,
    supportsTables: false,
    defaultReuseMode: "platform_specific",
    titleMaxLength: 30,
    generationHint: "使用适合口播的短句，只回答一个核心问题并给出明确判断。",
  },
  {
    key: "official-site",
    label: "官方网站",
    aliases: /官网|官方网站|official\s*site/i,
    family: "official_article",
    geoPlatform: "officialSite",
    supportsMarkdown: true,
    supportsTables: true,
    defaultReuseMode: "platform_specific",
    generationHint: "突出实体信息、服务边界和证据来源，使用可被检索的稳定结构。",
  },
  {
    key: "csdn",
    label: "CSDN",
    aliases: /csdn/i,
    family: "knowledge_article",
    geoPlatform: "universal",
    supportsMarkdown: true,
    supportsTables: true,
    defaultReuseMode: "platform_specific",
    titleMaxLength: 50,
    generationHint: "保持技术或方法论表达，代码、步骤和表格必须能独立理解。",
  },
]

const FALLBACK_PROFILE: PublishingPlatformProfile = {
  key: "universal",
  label: "通用内容平台",
  family: "general_article",
  geoPlatform: "universal",
  supportsMarkdown: true,
  supportsTables: true,
  defaultReuseMode: "master_reuse",
  generationHint: "使用平台通用的清晰标题、直接答案、分层论证和可核验依据。",
}

function sourceText(config: Pick<PublishingPlatformConfig, "platformKey" | "platformName">): string {
  return `${config.platformKey} ${config.platformName}`.normalize("NFKC")
}

export function resolvePublishingPlatformProfile(
  config: Pick<PublishingPlatformConfig, "platformKey" | "platformName" | "contentType">,
): PublishingPlatformProfile {
  const matched = PROFILES.find(profile => profile.aliases.test(sourceText(config)))
  if (matched) {
    const profile = { ...matched } as PublishingPlatformProfile & { aliases?: RegExp }
    delete profile.aliases
    return profile
  }
  if (config.contentType === "video") {
    return {
      ...FALLBACK_PROFILE,
      key: config.platformKey,
      label: config.platformName,
      family: "short_video",
      geoPlatform: "douyin",
      supportsMarkdown: false,
      supportsTables: false,
      defaultReuseMode: "platform_specific",
      generationHint: "按短视频口播结构输出，保留单问题、单优势和明确结论。",
    }
  }
  if (config.contentType === "authority_article") {
    return {
      ...FALLBACK_PROFILE,
      key: config.platformKey,
      label: config.platformName,
      family: "official_article",
      defaultReuseMode: "platform_specific",
      generationHint: "采用权威媒体或行业稿件结构，事实与结论必须有清晰边界。",
    }
  }
  return {
    ...FALLBACK_PROFILE,
    key: config.platformKey,
    label: config.platformName,
  }
}

export function resolveAssetTargetPlatform(
  configs: Array<Pick<PublishingPlatformConfig, "platformKey" | "platformName" | "contentType">>,
  contentType: PublishingContentType,
): GeoContentPlatform {
  const platforms = [...new Set(configs.map(config => resolvePublishingPlatformProfile(config).geoPlatform))]
  if (contentType === "video") return platforms.includes("douyin") ? "douyin" : "universal"
  return platforms.length === 1 ? platforms[0] : "universal"
}

export function publishingPlatformProfiles(): PublishingPlatformProfile[] {
  return PROFILES.map(matched => {
    const profile = { ...matched } as PublishingPlatformProfile & { aliases?: RegExp }
    delete profile.aliases
    return profile
  })
}
