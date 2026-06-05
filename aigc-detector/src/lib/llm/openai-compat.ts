// OpenAI-Compatible chat 通用封装。所有国产模型（豆包 / DeepSeek / 千问 / Kimi）
// 均走 OpenAI 标准 /chat/completions 协议。

import type { LlmMode } from "@/types"
import { withBeijingTime } from "./time-context"

interface ChatArgs {
  system: string
  user: string
  temperature?: number
  maxTokens?: number
  seed?: number
  jsonMode?: boolean
  mode?: LlmMode
}

export interface RawChatCompletionMessage {
  role: string
  content: string | null
  tool_calls?: Array<{
    id: string
    type: string
    function: { name: string; arguments: string }
  }>
}

export interface RawChatCompletion {
  choices: Array<{
    finish_reason?: string
    message: RawChatCompletionMessage
  }>
}

export interface OpenAICompatRawArgs {
  url: string
  apiKey: string
  model: string
  label: string
  messages: Array<Record<string, unknown>>
  temperature?: number
  maxTokens?: number
  seed?: number
  jsonMode?: boolean
  tools?: Array<Record<string, unknown>>
  extraBody?: Record<string, unknown>
  timeoutMs?: number
}

export async function openaiCompatRaw({
  url,
  apiKey,
  model,
  label,
  messages,
  temperature = 0.6,
  maxTokens = 4096,
  seed,
  jsonMode = false,
  tools,
  extraBody,
  timeoutMs,
}: OpenAICompatRawArgs): Promise<RawChatCompletion> {
  if (!apiKey) {
    console.warn(`[${label}] API Key is undefined（请检查环境变量）`)
    throw new Error(`${label} API Key 未配置（缺少对应环境变量），后端已阻断该模型调用。`)
  }

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  }
  if (typeof seed === "number") payload.seed = seed
  if (jsonMode) payload.response_format = { type: "json_object" }
  if (tools && tools.length > 0) payload.tools = tools
  if (extraBody) Object.assign(payload, extraBody)

  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined
  const timeout = timeoutMs && timeoutMs > 0 ? setTimeout(() => controller?.abort(), timeoutMs) : undefined

  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: controller?.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (fetchErr) {
    if (timeout) clearTimeout(timeout)
    if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") {
      throw new Error(`${label} 请求超时 (${(timeoutMs || 300000) / 1000}s)，请在 API 设置中增加超时时间`)
    }
    throw new Error(`${label} API 连接失败：${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`)
  }
  if (timeout) clearTimeout(timeout)

  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    if (jsonMode && (res.status === 400 || res.status === 422)) {
      const fallback = { ...payload }
      delete (fallback as Record<string, unknown>).response_format
      const retry = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(fallback),
      })
      if (retry.ok) return (await retry.json()) as RawChatCompletion
    }

    let upstreamCode = ""
    let upstreamMsg = ""
    try {
      const parsed = JSON.parse(txt) as {
        error?: { code?: string; message?: string; type?: string }
        code?: string
        message?: string
      }
      upstreamCode = parsed?.error?.code || parsed?.code || ""
      upstreamMsg = parsed?.error?.message || parsed?.message || ""
    } catch (parseErr) {
      const parseErrorMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      console.error(
        `[${label}·raw-parse-fail] JSON.parse 解析错误响应体失败：${parseErrorMsg}\n--- 原始未解析 raw text 开始 ---\n${txt}\n--- 原始未解析 raw text 结束 ---`
      )
    }
    console.error(
      `[${label}·HTTP ${res.status} ${res.statusText || ""}] model=${model} | code=${upstreamCode || "-"} | message=${upstreamMsg || txt.slice(0, 500) || "(empty body)"}`
    )
    throw new Error(
      `${label} 接口调用失败 HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}${upstreamCode ? ` [${upstreamCode}]` : ""}：${upstreamMsg || txt.slice(0, 200) || "(无响应体)"}`
    )
  }

  const okText = await res.text()
  try {
    return JSON.parse(okText) as RawChatCompletion
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
    console.error(
      `[${label}·success-parse-fail] HTTP 200 但响应体不是合法 JSON：${msg}\n--- 原始未解析 raw text 开始 ---\n${okText}\n--- 原始未解析 raw text 结束 ---`
    )
    throw new Error(`${label} 返回体解析失败：${msg}（原始内容已打印到服务端控制台）`)
  }
}

interface OpenAICompatArgs extends ChatArgs {
  url: string
  apiKey: string
  model: string
  label: string
  extraBody?: Record<string, unknown>
  images?: string[]
  timeoutSec?: number
}

function trimDataUrl(dataUrl: string, maxBytes: number): { url: string; trimmed: boolean } {
  if (dataUrl.length <= maxBytes) return { url: dataUrl, trimmed: false }
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
  temperature,
  maxTokens,
  seed,
  jsonMode,
  mode,
  label,
  extraBody,
  images,
  timeoutSec,
}: OpenAICompatArgs): Promise<string> {
  if (!apiKey) {
    console.warn(`[${label}] API Key is undefined`)
    throw new Error(`${label} API Key 未配置`)
  }

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024
  const trimmedImages: string[] = []
  if (images && images.length > 0) {
    for (const img of images) {
      const { url: trimmed, trimmed: wasTrimmed } = trimDataUrl(img, MAX_IMAGE_BYTES)
      if (wasTrimmed) {
        console.warn(`[${label}] 图片过大 (${(img.length / 1024 / 1024).toFixed(1)}MB)，已截断至 ~5MB，可能导致识别质量下降`)
      }
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

  const timeoutMs = (timeoutSec && timeoutSec > 0 ? timeoutSec : 300) * 1000

  try {
    const data = await openaiCompatRaw({
      url,
      apiKey,
      model,
      label,
      messages: [
        { role: "system", content: withBeijingTime(system) },
        { role: "user", content: userContent },
      ],
      temperature,
      maxTokens,
      seed,
      jsonMode: mode === "consumer" ? false : jsonMode,
      extraBody,
      timeoutMs,
    })
    return data.choices?.[0]?.message?.content ?? ""
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : ""
    const isVisionRejection = images && images.length > 0 && (
      msg.includes("does not support image") ||
      msg.includes("does not support vision") ||
      msg.includes("don't support image") ||
      msg.includes("not a vision model") ||
      msg.includes("not support multimodal") ||
      msg.includes("not a multimodal model") ||
      msg.includes("image understanding is not supported") ||
      msg.includes("does not support multimodal") ||
      msg.includes("is not a vision model") ||
      msg.includes("images are not supported") ||
      msg.includes("can only process text") ||
      msg.includes("cannot process image")
    )
    if (isVisionRejection) {
      throw new Error(`${label} 当前模型不支持图片/PDF识别，请切换到视觉模型（如 qwen3-vl-plus、gpt-4o、glm-4v）。原始错误：${err instanceof Error ? err.message : String(err)}`)
    }
    throw err
  }
}

export type { ChatArgs }
