import type { ArticleModelProviderKey, ArticleVideoPlatform } from "@/types"

/** avatar: 数字人移动场景口播；slides: 图文视频。 */
export type VideoProductionType = "avatar" | "slides"

export type VideoImageModel = "z-image-turbo" | "qwen-image-2.1-turbo"

export type VideoVisualStyle = "photo" | "illustration" | "render3d" | "infographic"

export type VideoProductionStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

export interface VideoProductionSettings {
  type: VideoProductionType
  platform: ArticleVideoPlatform
  targetSeconds: number
  tagCount: number
  style: VideoVisualStyle
  imageModel: VideoImageModel
  extraRequirements: string
  modelProvider?: ArticleModelProviderKey
  model?: string
}

export interface VideoGeneratedImage {
  assetId?: string
  prompt: string
  model: VideoImageModel
  status: "succeeded" | "failed"
  error?: string
  width?: number
  height?: number
  generatedAt: string
}

export interface VideoScriptSegment {
  id: string
  voiceover: string
  subtitleKeywords: string[]
  /** 图文：这一页的大字。 */
  screenText?: string
  /** 图文：这一页的配图描述。 */
  imageBrief?: string
  /** 数字人：动作提示。 */
  action?: string
  /** 数字人：可选的插入画面建议。 */
  broll?: string
  seconds: number
  image?: VideoGeneratedImage
}

export interface VideoScript {
  perspective: string
  title: string
  coverTitle: string
  coverImageBrief: string
  description: string
  tags: string[]
  estimatedSeconds: number
  segments: VideoScriptSegment[]
}

export interface VideoProductionItem {
  id: string
  batchId: string
  clientId: string
  teamId?: string
  question: string
  advantage: string
  settings: VideoProductionSettings
  status: VideoProductionStatus
  stage?: string
  error?: string
  script?: VideoScript
  cover?: VideoGeneratedImage
  modelLabel?: string
  createdAt: string
  updatedAt: string
}

export interface VideoProductionQuestionInput {
  question: string
  advantage?: string
}
