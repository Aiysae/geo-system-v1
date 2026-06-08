// OpenAI-Compatible chat 通用封装。所有国产模型（豆包 / DeepSeek / 千问 / Kimi）
// 均走 OpenAI 标准 /chat/completions 协议。
//
// 设计要点：
// 1. 不静默吞错：任何非 2xx 一律抛出可读 Error，由上层 route 透传给前端。
// 2. 不返回任何 Mock / 假数据。
// 3. 支持透传 tools（用于 Kimi 的 $web_search 联网工具）。
// 4. 单轮入口 openaiCompatChat 会自动在 system prompt 头部注入"当前北京时间"，
//    工具循环类（如 deepseek/kimi）自行拼装 messages 时也应使用 withBeijingTime。

import type { LlmMode, PenetrationSource } from "@/types"
import { withBeijingTime } from "./time-context"

export interface SearchSourceEvent {
  query: string
  sources: PenetrationSource[]
}

export interface ChatArgs {
  system: string
  user: string
  temperature?: number
  maxTokens?: number
  seed?: number
  jsonMode?: boolean
  mode?: LlmMode
  /** Force the provider or adapter to use web search for this answer when supported. */
  forceWebSearch?: boolean
  /** Send only the user's question as conversation context; do not inject time/system hints. */
  rawQuestionOnly?: boolean
  /** Observe the public web sources used by local search adapters. */
  onSearchSources?: (event: SearchSourceEvent) => void
}

function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._\-]{16,}/gi, "Bearer ***")
}

function parseOnlyAllowedTemperature(message: string): number | null {
  if (!/invalid temperature/i.test(message)) return null
  const match = message.match(/only\s+([0-9]+(?:\.[0-9]+)?)\s+is\s+allowed/i)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

async function postChatCompletion(args: {
  url: string
  apiKey: string
  payload: Record<string, unknown>
  extraHeaders?: Record<string, string>
  signal?: AbortSignal
}): Promise<Response> {
  return fetch(args.url, {
    method: "POST",
    cache: "no-store",
    signal: args.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
      ...args.extraHeaders,
    },
    body: JSON.stringify(args.payload),
  })
}

export interface RawChatCompletionMessage {
  role: string
  content:
    | string
    | null
    | Array<{
        type?: string
        text?: string
        [key: string]: unknown
      }>
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
  toolChoice?: Record<string, unknown> | string
  // 透传给厂商的非标准字段（如阿里千问 enable_search、火山方舟联网插件参数等）
  extraBody?: Record<string, unknown>
  extraHeaders?: Record<string, string>
  /** timeout in ms (default 300000) */
  timeoutMs?: number
}

// 底层：发请求并返回原始 ChatCompletion（供需要工具循环的场景使用，如 Kimi 联网）
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
  toolChoice,
  extraBody,
  extraHeaders,
  timeoutMs,
}: OpenAICompatRawArgs): Promise<RawChatCompletion> {
  if (!apiKey) {
    // 请求前显式校验：把缺失的 Key 用 console.warn 打印出来，便于在终端立刻定位
    console.warn(`[${label}] API Key is undefined（请检查后台管理页中的模型配置）`)
    throw new Error(`${label} API Key 未配置，请在后台管理页补全后重试。`)
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
  if (toolChoice !== undefined) payload.tool_choice = toolChoice
  if (extraBody) Object.assign(payload, extraBody)

  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined
  const timeout = timeoutMs && timeoutMs > 0 ? setTimeout(() => controller?.abort(), timeoutMs) : undefined

  let res: Response
  try {
    res = await postChatCompletion({ url, apiKey, payload, extraHeaders, signal: controller?.signal })
  } catch (fetchErr) {
    if (timeout) clearTimeout(timeout)
    if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") {
      throw new Error(`${label} 请求超时 (${(timeoutMs || 300000) / 1000}s)，图片/PDF 识别耗时较长，请在后台管理页增加模型超时时间`)
    }
    throw new Error(`${label} API 连接失败：${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`)
  }
  if (timeout) clearTimeout(timeout)

  if (!res.ok) {
    const rawTxt = await res.text().catch(() => "")
    const txt = redactSecrets(rawTxt)
    const allowedTemperature = parseOnlyAllowedTemperature(txt)
    if (res.status === 400 && allowedTemperature !== null && payload.temperature !== allowedTemperature) {
      const retryPayload = { ...payload, temperature: allowedTemperature }
      const retry = await postChatCompletion({ url, apiKey, payload: retryPayload, extraHeaders })
      if (retry.ok) return (await retry.json()) as RawChatCompletion
    }
    // 部分供应商不支持 response_format=json_object，遇到 400/422 时去掉重试一次
    if (jsonMode && (res.status === 400 || res.status === 422)) {
      const fallback = { ...payload }
      delete (fallback as Record<string, unknown>).response_format
      const retry = await postChatCompletion({ url, apiKey, payload: fallback, extraHeaders })
      if (retry.ok) return (await retry.json()) as RawChatCompletion
    }

    // 详细错误日志：HTTP status + statusText + 上游 code/message + 完整 raw body
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
      // 撕掉假报错的面具：JSON.parse 失败时打印未解析的 raw text，便于定位为什么只输出 1 个 token
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

  // 成功路径也加一层防御：响应体若不是合法 JSON，打印 raw text 便于排查"只返回 1 token"等怪象
  const okText = await res.text()
  try {
    return JSON.parse(okText) as RawChatCompletion
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
    console.error(
      `[${label}·success-parse-fail] HTTP 200 但响应体不是合法 JSON：${msg}\n--- Kimi 原始未解析 raw text 开始 ---\n${okText}\n--- Kimi 原始未解析 raw text 结束 ---`
    )
    throw new Error(`${label} 返回体解析失败：${msg}（原始内容已打印到服务端控制台）`)
  }
}

function extractMessageContent(message: RawChatCompletionMessage | undefined, label: string): string {
  if (!message) return ""
  const { content } = message
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part?.text === "string") return part.text
        if (typeof part === "object" && part && "content" in part) {
          const nested = (part as { content?: unknown }).content
          return typeof nested === "string" ? nested : ""
        }
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }
  if (content == null) return ""
  console.warn(`[${label}] message.content 类型异常：${typeof content}`)
  return String(content)
}

interface OpenAICompatArgs extends ChatArgs {
  url: string
  apiKey: string
  model: string
  label: string
  extraBody?: Record<string, unknown>
  extraHeaders?: Record<string, string>
  /** data URLs for vision (image/jpeg, image/png, application/pdf) */
  images?: string[]
  /** timeout in seconds (default 300) */
  timeoutSec?: number
}

/** compress a data URL if it exceeds maxBytes by stripping it (API will reject oversized payloads) */
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

// 标准对外接口：单轮 system + user，返回 content 文本
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
  rawQuestionOnly,
  label,
  extraBody,
  extraHeaders,
  images,
  timeoutSec,
}: OpenAICompatArgs): Promise<string> {
  if (!apiKey) {
    console.warn(`[${label}] API Key is undefined（请检查后台管理页中的模型配置）`)
    throw new Error(`${label} API Key 未配置，请在后台管理页补全后重试。`)
  }

  // Trim oversized images (each capped at ~5MB to avoid payload issues)
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
    const messages: Array<Record<string, unknown>> = []
    const systemContent = rawQuestionOnly ? system : withBeijingTime(system)
    if (!rawQuestionOnly || systemContent.trim()) {
      messages.push({ role: "system", content: systemContent })
    }
    messages.push({ role: "user", content: userContent })

    const data = await openaiCompatRaw({
      url,
      apiKey,
      model,
      label,
      messages,
      temperature,
      maxTokens,
      seed,
      jsonMode: mode === "consumer" ? false : jsonMode,
      extraBody,
      extraHeaders,
      timeoutMs,
    })
    const choice = data.choices?.[0]
    const content = extractMessageContent(choice?.message, label)
    if (!content.trim()) {
      const finish = choice?.finish_reason || "unknown"
      console.warn(`[${label}] 返回空内容 | finish_reason=${finish}`)
      throw new Error(`${label} 返回空内容（finish_reason=${finish}），请检查模型名、联网参数或上游额度。`)
    }
    return content
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
