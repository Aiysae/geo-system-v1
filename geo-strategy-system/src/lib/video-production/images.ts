import "server-only"

import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { createArticleMediaAsset } from "@/lib/article-media/assets"
import { VIDEO_IMAGE_NEGATIVE } from "@/lib/video-production/prompts"
import type { VideoGeneratedImage, VideoImageModel } from "@/types/video-production"

const DASHSCOPE_IMAGE_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
const IMAGE_SIZE = "1080*1920"
const REQUEST_TIMEOUT_MS = 90_000

async function dashScopeApiKey(): Promise<string> {
  const config = await getAiProviderRuntimeSetting("qwen")
  const key = config.apiKey || String(process.env.DASHSCOPE_API_KEY || "").trim()
  if (!key) throw new Error("后台未配置通义千问（百炼）API Key，无法生成图片")
  return key
}

function imageUrlFrom(data: unknown): string {
  const choices = (data as { output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> } })
    ?.output?.choices
  return choices?.[0]?.message?.content?.find(part => part.image)?.image || ""
}

function dashScopeError(status: number, data: unknown): Error {
  const body = data as { code?: string; message?: string }
  if (status === 401 || status === 403) return new Error("百炼 API Key 无效或未开通该生图模型")
  if (status === 429) return new Error("生图请求过于频繁，请稍后重试")
  if (body?.code === "DataInspectionFailed") return new Error("画面描述未通过平台内容审核，请修改后重试")
  return new Error(body?.message ? `生图失败：${body.message}` : `生图失败（HTTP ${status}）`)
}

async function requestImage(model: VideoImageModel, prompt: string, signal?: AbortSignal): Promise<Buffer> {
  const apiKey = await dashScopeApiKey()
  let lastError: unknown
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(abort, REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(DASHSCOPE_IMAGE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          input: { messages: [{ role: "user", content: [{ text: `${prompt}。${VIDEO_IMAGE_NEGATIVE}` }] }] },
          // Our own rewrite step already wrote the prompt; the model's rewrite doubles z-image's price.
          parameters: { prompt_extend: false, size: IMAGE_SIZE },
        }),
        signal: controller.signal,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const error = dashScopeError(response.status, data)
        if (response.status !== 429 && response.status < 500) throw error
        lastError = error
      } else {
        const url = imageUrlFrom(data)
        if (!url) throw new Error("生图模型没有返回图片")
        const image = await fetch(url, { signal: controller.signal })
        if (!image.ok) throw new Error(`下载生成的图片失败（HTTP ${image.status}）`)
        return Buffer.from(await image.arrayBuffer())
      }
    } catch (error) {
      if (signal?.aborted) throw error
      lastError = controller.signal.aborted ? new Error("生图请求超时") : error
      if (!/超时|HTTP 5|频繁|fetch failed|network/i.test(String((lastError as Error)?.message))) throw lastError
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
    }
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
  throw lastError instanceof Error ? lastError : new Error("生图失败")
}

/** Generates one image and stores it with the article media assets. Never throws. */
export async function generateVideoImage(input: {
  prompt: string
  model: VideoImageModel
  ownerUserId: string
  clientId: string
  itemId: string
  name: string
  signal?: AbortSignal
}): Promise<VideoGeneratedImage> {
  const generatedAt = new Date().toISOString()
  try {
    const buffer = await requestImage(input.model, input.prompt, input.signal)
    const asset = await createArticleMediaAsset({
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      batchId: input.itemId,
      originalName: `${input.name}.png`,
      buffer,
    })
    return {
      assetId: asset.id,
      prompt: input.prompt,
      model: input.model,
      status: "succeeded",
      width: asset.width,
      height: asset.height,
      generatedAt,
    }
  } catch (error) {
    return {
      prompt: input.prompt,
      model: input.model,
      status: "failed",
      error: error instanceof Error ? error.message : "生图失败",
      generatedAt,
    }
  }
}
