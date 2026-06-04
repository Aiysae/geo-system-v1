import { withBeijingTime } from "./time-context"

interface ChatArgs {
  system: string
  user: string
  temperature?: number
  maxTokens?: number
  seed?: number
  jsonMode?: boolean
}

interface OpenAICompatArgs extends ChatArgs {
  url: string
  apiKey: string
  model: string
  label: string
  extraBody?: Record<string, unknown>
  /** data URLs for vision (image/jpeg, image/png, application/pdf) */
  images?: string[]
  /** timeout in seconds (default 300) */
  timeoutSec?: number
}

/** compress a data URL if it exceeds maxBytes by stripping it (API will reject oversized payloads) */
function trimDataUrl(dataUrl: string, maxBytes: number): { url: string; trimmed: boolean } {
  // rough byte length of the data URL string ≈ byte size
  if (dataUrl.length <= maxBytes) return { url: dataUrl, trimmed: false }
  // For data URLs, we can't really compress — just truncate to maxBytes
  // Keep the header intact
  const headerEnd = dataUrl.indexOf(",")
  if (headerEnd === -1) return { url: dataUrl.slice(0, maxBytes), trimmed: true }
  const header = dataUrl.slice(0, headerEnd + 1)
  const data = dataUrl.slice(headerEnd + 1)
  const availableForData = maxBytes - header.length
  if (availableForData <= 0) return { url: dataUrl.slice(0, maxBytes), trimmed: true }
  return { url: header + data.slice(0, availableForData), trimmed: true }
}

export async function openaiCompatChat({
  url,
  apiKey,
  model,
  system,
  user,
  temperature = 0.6,
  maxTokens = 4096,
  seed,
  jsonMode = false,
  label,
  extraBody,
  images,
  timeoutSec,
}: OpenAICompatArgs): Promise<string> {
  if (!apiKey) {
    console.warn(`[${label}] API Key is undefined`)
    throw new Error(`${label} API Key 未配置`)
  }

  // Trim oversized images (each capped at ~5MB to avoid payload issues)
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB per image
  const trimmedImages: string[] = []
  if (images && images.length > 0) {
    for (const img of images) {
      const { url: trimmed, trimmed: wasTrimmed } = trimDataUrl(img, MAX_IMAGE_BYTES)
      if (wasTrimmed) {
        console.warn(`[${label}] 图片过大 (${(img.length / 1024 / 1024).toFixed(1)}MB)，已截断至 ~5MB，可能导致识别质量下降`)
      }
      // Skip empty/invalid images
      if (trimmed.length > 100) {
        trimmedImages.push(trimmed)
      }
    }
  }

  const userContent = trimmedImages.length > 0
    ? [
        { type: "text" as const, text: user },
        ...trimmedImages.map(url => ({
          type: "image_url" as const,
          image_url: { url, detail: "auto" as const },
        })),
      ]
    : user

  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: withBeijingTime(system) },
      { role: "user", content: userContent },
    ],
    temperature,
    max_tokens: maxTokens,
  }
  if (typeof seed === "number") payload.seed = seed
  if (jsonMode) payload.response_format = { type: "json_object" }
  if (extraBody) Object.assign(payload, extraBody)

  const timeoutMs = (timeoutSec && timeoutSec > 0 ? timeoutSec : 300) * 1000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  console.log(`[${label}] → ${model} @ ${url} | images: ${trimmedImages.length} | timeout: ${timeoutSec || 300}s`)

  let res: Response
  try {
    const body = JSON.stringify(payload)
    console.log(`[${label}] 请求体大小: ${(body.length / 1024).toFixed(0)} KB`)
    res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    })
  } catch (error) {
    clearTimeout(timeout)
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("abort") || message.includes("timeout")) {
      throw new Error(`${label} 请求超时 (${timeoutSec || 300}s)，图片/PDF 识别耗时较长，请在 API 设置中增加超时时间`)
    }
    throw new Error(`${label} API 连接失败：${message}`)
  }

  clearTimeout(timeout)

  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    // Retry without json_mode on 400/422/404
    if (jsonMode && (res.status === 400 || res.status === 422 || res.status === 404)) {
      const fallback = { ...payload }
      delete (fallback as Record<string, unknown>).response_format
      try {
        const retry = await fetch(url, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(fallback),
        })
        if (retry.ok) {
          const data = await retry.json()
          return data.choices?.[0]?.message?.content ?? ""
        }
      } catch {
        // fall through to original error
      }
    }

    let upstreamMsg = ""
    try {
      const parsed = JSON.parse(txt) as { error?: { message?: string; code?: string }; message?: string }
      upstreamMsg = parsed?.error?.message || parsed?.message || ""
    } catch {
      upstreamMsg = txt.slice(0, 200)
    }
    // Check if the error is due to model not supporting vision
    // Only trigger on very specific vision-rejection signals, don't replace the original error
    const upstreamLower = upstreamMsg.toLowerCase()
    const isVisionRejection = images && images.length > 0 && (
      upstreamLower.includes("does not support image") ||
      upstreamLower.includes("does not support vision") ||
      upstreamLower.includes("don't support image") ||
      upstreamLower.includes("not a vision model") ||
      upstreamLower.includes("not support multimodal") ||
      upstreamLower.includes("not a multimodal model") ||
      upstreamLower.includes("image understanding is not supported") ||
      upstreamLower.includes("does not support multimodal") ||
      upstreamLower.includes("is not a vision model") ||
      upstreamLower.includes("images are not supported") ||
      upstreamLower.includes("can only process text") ||
      upstreamLower.includes("cannot process image")
    )
    if (isVisionRejection) {
      throw new Error(`${label} 当前模型不支持图片/PDF识别，请切换到视觉模型（如 qwen3-vl-plus、gpt-4o、glm-4v）。原始错误：${upstreamMsg}`)
    }
    throw new Error(`${label} 接口调用失败 HTTP ${res.status} [${model}]：${upstreamMsg || "(无详情)"}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ""
}
