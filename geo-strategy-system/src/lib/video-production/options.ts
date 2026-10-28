import type {
  VideoImageModel,
  VideoProductionSettings,
  VideoProductionType,
  VideoVisualStyle,
} from "@/types/video-production"

export const VIDEO_VISUAL_STYLES: Array<{
  value: VideoVisualStyle
  label: string
  /** Appended to every image prompt of a video that uses this style. */
  suffix: string
}> = [
  { value: "photo", label: "写实摄影", suffix: "真实摄影质感，自然光，浅景深，干净背景，商业摄影色调" },
  { value: "illustration", label: "简约插画", suffix: "扁平矢量插画，柔和配色，大面积留白，线条简洁" },
  { value: "render3d", label: "3D 质感", suffix: "C4D 渲染风格，柔和体积光，哑光材质，干净的浅色背景" },
  { value: "infographic", label: "商务信息图底板", suffix: "浅色渐变背景，抽象几何元素，适合叠加大字与图表" },
]

export const VIDEO_PRODUCTION_TYPES: Array<{
  value: VideoProductionType
  label: string
  description: string
}> = [
  {
    value: "avatar",
    label: "数字人口播",
    description: "真人边走边讲的移动场景口播稿，含动作提示和插入画面建议，配一张封面",
  },
  {
    value: "slides",
    label: "图文视频",
    description: "6–10 页竖版画面加旁白，每页自动配图，适合知识讲解",
  },
]

export function videoVisualStyleSuffix(style: VideoVisualStyle): string {
  return VIDEO_VISUAL_STYLES.find(item => item.value === style)?.suffix || VIDEO_VISUAL_STYLES[0].suffix
}

export const VIDEO_IMAGE_MODELS: Array<{ value: VideoImageModel; label: string; note: string }> = [
  { value: "z-image-turbo", label: "Z-Image Turbo", note: "0.1 元/张" },
  { value: "qwen-image-2.1-turbo", label: "千问图像 2.1 Turbo", note: "0.1 元/张，更贴合提示词" },
]

export function isVideoImageModel(value: unknown): value is VideoImageModel {
  return VIDEO_IMAGE_MODELS.some(model => model.value === value)
}

export const DEFAULT_VIDEO_PRODUCTION_SETTINGS: VideoProductionSettings = {
  type: "slides",
  platform: "douyin",
  targetSeconds: 60,
  tagCount: 10,
  style: "photo",
  imageModel: "z-image-turbo",
  extraRequirements: "",
}

const VIDEO_PLATFORMS = new Set(["douyin", "wechatChannels", "xiaohongshu", "kuaishou", "reels", "tiktok", "other"])

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

export function normalizeVideoProductionSettings(value: unknown): VideoProductionSettings {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const defaults = DEFAULT_VIDEO_PRODUCTION_SETTINGS
  const model = String(input.model || "").trim().slice(0, 200)
  const modelProvider = String(input.modelProvider || "").trim().slice(0, 120)
  return {
    type: input.type === "avatar" ? "avatar" : "slides",
    platform: VIDEO_PLATFORMS.has(String(input.platform))
      ? input.platform as VideoProductionSettings["platform"]
      : defaults.platform,
    targetSeconds: boundedInteger(input.targetSeconds, defaults.targetSeconds, 15, 180),
    tagCount: boundedInteger(input.tagCount, defaults.tagCount, 3, 20),
    style: VIDEO_VISUAL_STYLES.some(style => style.value === input.style)
      ? input.style as VideoVisualStyle
      : defaults.style,
    imageModel: isVideoImageModel(input.imageModel) ? input.imageModel : defaults.imageModel,
    extraRequirements: String(input.extraRequirements || "").trim().slice(0, 2_000),
    ...(modelProvider ? { modelProvider: modelProvider as VideoProductionSettings["modelProvider"] } : {}),
    ...(model ? { model } : {}),
  }
}
