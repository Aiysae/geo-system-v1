// OpenAI-Compatible chat 通用封装。所有国产模型（豆包 / DeepSeek / 千问 / Kimi）
// 均走 OpenAI 标准 /chat/completions 协议。
//
// 设计要点：
// 1. 不静默吞错：任何非 2xx 一律抛出可读 Error，由上层 route 透传给前端。
// 2. 不返回任何 Mock / 假数据。
// 3. 支持透传 tools（用于 Kimi 的 $web_search 联网工具）。
// 4. 单轮入口 openaiCompatChat 会自动在 system prompt 头部注入"当前北京时间"，
//    工具循环类（如 deepseek/kimi）自行拼装 messages 时也应使用 withBeijingTime。

import type { LlmMode, PenetrationSearchMode, PenetrationSource } from "@/types"
import type { AiCredentialVendor } from "@/types/ai-credentials"
import { extractSourcesFromUnknown, normalizeSourceDomain } from "./source-extract"
import { withBeijingTime } from "./time-context"
import { formatHitsForLLM, webSearch, type SearchHit } from "./web-search"

export interface SearchSourceEvent {
  query: string
  sources: PenetrationSource[]
  mode?: PenetrationSearchMode
  failureReason?: string
  /** Provider-native web tool/search was observed, even when the provider exposes no URLs. */
  searchExecuted?: boolean
  /** Safe request identifier for support and audit; never contains credentials. */
  providerRequestId?: string
}

export interface ChatRuntimeOverride {
  vendor: AiCredentialVendor
  baseUrl: string
  chatPath: string
  apiKey: string
  model: string
  timeout?: number
  extra?: Record<string, string | boolean>
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
  /** Disable default web-search tools for internal JSON/judging calls. */
  allowWebSearch?: boolean
  /** Send only the user's question as conversation context; do not inject time/system hints. */
  rawQuestionOnly?: boolean
  /** Reject consumer answers that cannot be tied to at least one auditable public web source. */
  requireWebEvidence?: boolean
  /** Do not fall back to local search when provider-native web search returns no auditable sources. */
  officialWebOnly?: boolean
  /** Per-provider request timeout in seconds. */
  timeoutSec?: number
  /** Allow a parent background task to stop the active upstream request. */
  signal?: AbortSignal
  /** Observe the public web sources used by local search adapters. */
  onSearchSources?: (event: SearchSourceEvent) => void
  /** Observe token usage returned by the upstream provider. */
  onUsage?: (usage: LlmTokenUsage) => void
  /** Server-selected account override. Never accept this field from a client request. */
  runtimeOverride?: ChatRuntimeOverride
  /** Server-selected auditable search account used by dual-provider adapters. */
  searchRuntimeOverride?: ChatRuntimeOverride
}

export interface LlmTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

const WEB_EVIDENCE_RESULTS_PER_CALL = 12
const WEB_EVIDENCE_STYLE_DIRECTIVE =
  "Final answer style: answer the user's question directly. Do not mention search tools, search results, retrieved pages, or whether the results directly contain the answer."

function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._\-]{16,}/gi, "Bearer ***")
}

function safeErrorSnippet(text: string, max = 500): string {
  return redactSecrets(text)
    .replace(/\s+/g, " ")
    .slice(0, max)
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
  authType?: "bearer" | "x-api-key"
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
      ...(args.authType === "x-api-key"
        ? { "x-api-key": args.apiKey }
        : { Authorization: `Bearer ${args.apiKey}` }),
      ...args.extraHeaders,
    },
    body: JSON.stringify(args.payload),
  })
}

async function postChatCompletionWithTimeout(args: {
  url: string
  apiKey: string
  authType?: "bearer" | "x-api-key"
  payload: Record<string, unknown>
  extraHeaders?: Record<string, string>
  timeoutMs: number
  label: string
  signal?: AbortSignal
}): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs)
  const abortFromParent = () => controller.abort()
  if (args.signal?.aborted) controller.abort()
  else args.signal?.addEventListener("abort", abortFromParent, { once: true })

  try {
    return await postChatCompletion({
      url: args.url,
      apiKey: args.apiKey,
      authType: args.authType,
      payload: args.payload,
      extraHeaders: args.extraHeaders,
      signal: controller.signal,
    })
  } catch (fetchErr) {
    if (
      (fetchErr instanceof DOMException && fetchErr.name === "AbortError")
      || (fetchErr instanceof Error && fetchErr.name === "AbortError")
    ) {
      if (args.signal?.aborted) {
        const cancelled = new Error("AI 请求已停止")
        cancelled.name = "AbortError"
        throw cancelled
      }
      throw new Error(
        `${args.label} 请求超时 (${args.timeoutMs / 1000}s)，请稍后重试或切换其他可用模型账号`,
      )
    }
    throw new Error(
      `${args.label} API 连接失败：${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
    )
  } finally {
    clearTimeout(timeout)
    args.signal?.removeEventListener("abort", abortFromParent)
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    const cancelled = new Error("AI 请求已停止")
    cancelled.name = "AbortError"
    return Promise.reject(cancelled)
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      const cancelled = new Error("AI 请求已停止")
      cancelled.name = "AbortError"
      reject(cancelled)
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function retryDelayMs(headers: Headers, body: string, attempt: number): number {
  const headerValue = headers.get("retry-after")
  const headerSeconds = headerValue ? Number(headerValue) : NaN
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
    return Math.min(15000, Math.ceil(headerSeconds * 1000))
  }
  const bodyMatch = body.match(/try again after\s+([0-9]+(?:\.[0-9]+)?)\s*seconds?/i)
  if (bodyMatch) {
    const seconds = Number(bodyMatch[1])
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(15000, Math.ceil(seconds * 1000))
  }
  return Math.min(15000, 1200 * Math.pow(2, attempt))
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
  id?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    input_tokens?: number
    output_tokens?: number
  }
  choices: Array<{
    finish_reason?: string
    message: RawChatCompletionMessage
  }>
}

export interface OpenAICompatRawArgs {
  url: string
  apiKey: string
  authType?: "bearer" | "x-api-key"
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
  signal?: AbortSignal
}

// 底层：发请求并返回原始 ChatCompletion（供需要工具循环的场景使用，如 Kimi 联网）
export async function openaiCompatRaw({
  url,
  apiKey,
  authType,
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
  signal,
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

  const requestTimeoutMs = timeoutMs && timeoutMs > 0 ? timeoutMs : 300000

  let res: Response
  res = await postChatCompletionWithTimeout({
    url,
    apiKey,
    authType,
    payload,
    extraHeaders,
    timeoutMs: requestTimeoutMs,
    label,
    signal,
  })
  const retryableStatuses = new Set([429, 500, 502, 503, 504])
  for (let retry = 0; retry < 3 && retryableStatuses.has(res.status); retry++) {
    const status = res.status
    const rawTxt = await res.text().catch(() => "")
    const txt = redactSecrets(rawTxt)
    const delay = retryDelayMs(res.headers, txt, retry)
    console.warn(
      `[${label}·${status}] 上游暂时不可用，${Math.round(delay / 1000)}s 后重试 (${retry + 1}/3)。`,
    )
    await sleep(delay, signal)
    res = await postChatCompletionWithTimeout({
      url,
      apiKey,
      authType,
      payload,
      extraHeaders,
      timeoutMs: requestTimeoutMs,
      label,
      signal,
    })
  }

  if (!res.ok) {
    const rawTxt = await res.text().catch(() => "")
    const txt = redactSecrets(rawTxt)
    const allowedTemperature = parseOnlyAllowedTemperature(txt)
    if (res.status === 400 && allowedTemperature !== null && payload.temperature !== allowedTemperature) {
      const retryPayload = { ...payload, temperature: allowedTemperature }
      const retry = await postChatCompletionWithTimeout({
        url,
        apiKey,
        authType,
        payload: retryPayload,
        extraHeaders,
        timeoutMs: requestTimeoutMs,
        label,
        signal,
      })
      if (retry.ok) return (await retry.json()) as RawChatCompletion
    }
    // 部分供应商不支持 response_format=json_object，遇到 400/422 时去掉重试一次
    if (jsonMode && (res.status === 400 || res.status === 422)) {
      const fallback = { ...payload }
      delete (fallback as Record<string, unknown>).response_format
      const retry = await postChatCompletionWithTimeout({
        url,
        apiKey,
        authType,
        payload: fallback,
        extraHeaders,
        timeoutMs: requestTimeoutMs,
        label,
        signal,
      })
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
      const parseErrorMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      console.error(
        `[${label}·raw-parse-fail] JSON.parse 解析错误响应体失败：${parseErrorMsg} | bodyLength=${txt.length} | bodyPreview=${safeErrorSnippet(txt, 240)}`
      )
    }
    console.error(
      `[${label}·HTTP ${res.status} ${res.statusText || ""}] model=${model} | code=${upstreamCode || "-"} | message=${safeErrorSnippet(upstreamMsg || txt, 300) || "(empty body)"}`
    )
    throw new Error(
      `${label} 接口调用失败 HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}${upstreamCode ? ` [${upstreamCode}]` : ""}：${safeErrorSnippet(upstreamMsg || txt, 200) || "(无响应体)"}`
    )
  }

  // 成功路径也加一层防御：响应体若不是合法 JSON，打印 raw text 便于排查"只返回 1 token"等怪象
  const okText = await res.text()
  try {
    return JSON.parse(okText) as RawChatCompletion
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
    console.error(
      `[${label}·success-parse-fail] HTTP 200 但响应体不是合法 JSON：${msg} | bodyLength=${okText.length} | bodyPreview=${safeErrorSnippet(okText, 240)}`
    )
    throw new Error(`${label} 返回体解析失败：${msg}（服务端已记录响应长度和脱敏摘要）`)
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

function emitTokenUsage(
  data: RawChatCompletion,
  onUsage?: (usage: LlmTokenUsage) => void,
): void {
  if (!onUsage || !data.usage) return
  const promptTokens = Math.max(0, Number(data.usage.prompt_tokens ?? data.usage.input_tokens) || 0)
  const completionTokens = Math.max(0, Number(data.usage.completion_tokens ?? data.usage.output_tokens) || 0)
  const totalTokens = Math.max(
    0,
    Number(data.usage.total_tokens) || promptTokens + completionTokens,
  )
  onUsage({ promptTokens, completionTokens, totalTokens })
}

function toPenetrationSources(query: string, hits: SearchHit[]): PenetrationSource[] {
  return hits.map(hit => ({
    title: hit.title,
    snippet: hit.snippet,
    url: hit.url,
    domain: normalizeSourceDomain(hit.url),
    query,
  }))
}

interface OpenAICompatArgs extends ChatArgs {
  url: string
  apiKey: string
  authType?: "bearer" | "x-api-key"
  model: string
  label: string
  extraBody?: Record<string, unknown>
  extraHeaders?: Record<string, string>
  /** data URLs for vision (image/jpeg, image/png, application/pdf) */
  images?: string[]
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
  authType,
  model,
  system,
  user,
  temperature,
  maxTokens,
  seed,
  jsonMode,
  mode,
  forceWebSearch,
  rawQuestionOnly,
  requireWebEvidence,
  officialWebOnly,
  label,
  extraBody,
  extraHeaders,
  images,
  timeoutSec,
  signal,
  onSearchSources,
  onUsage,
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
      authType,
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
      signal,
    })
    emitTokenUsage(data, onUsage)
    const nativeSources = onSearchSources ? extractSourcesFromUnknown(data, String(user)) : []
    if (nativeSources.length > 0) {
      onSearchSources?.({
        query: String(user),
        sources: nativeSources,
        mode: "native_web",
        searchExecuted: true,
        providerRequestId: data.id,
      })
    }
    const choice = data.choices?.[0]
    const content = extractMessageContent(choice?.message, label)
    if (!content.trim()) {
      const finish = choice?.finish_reason || "unknown"
      console.warn(`[${label}] 返回空内容 | finish_reason=${finish}`)
      throw new Error(`${label} 返回空内容（finish_reason=${finish}），请检查模型名、联网参数或上游额度。`)
    }
    const needsAuditableFallback =
      forceWebSearch === true &&
      requireWebEvidence === true &&
      mode === "consumer" &&
      nativeSources.length === 0

    if (needsAuditableFallback) {
      if (officialWebOnly) {
        throw new Error(`${label} 官方联网未返回可审计来源，已阻断本地检索兜底。`)
      }
      const fallbackQuery = String(user)
      const t0 = Date.now()
      const hits = await webSearch(fallbackQuery, WEB_EVIDENCE_RESULTS_PER_CALL)
      const sources = toPenetrationSources(fallbackQuery, hits)
      onSearchSources?.({
        query: fallbackQuery,
        sources,
        mode: "presearch_context",
        failureReason:
          sources.length === 0
            ? "模型原生联网未返回引用，且本地公开网页搜索也没有返回可审计来源。"
            : undefined,
      })
      console.log(
        `[${label}·web-evidence-fallback] q="${fallbackQuery.slice(0, 80)}" hits=${sources.length} ${Date.now() - t0}ms`
      )
      if (sources.length === 0) {
        throw new Error("联网搜索未返回可审计来源，已阻断模型自答。请稍后重试或换一个更具体的问题。")
      }

      const fallbackMessages: Array<Record<string, unknown>> = []
      const fallbackSystem = rawQuestionOnly ? system : withBeijingTime(system)
      if (!rawQuestionOnly || fallbackSystem.trim()) {
        fallbackMessages.push({ role: "system", content: fallbackSystem })
      }
      fallbackMessages.push({
        role: "user",
        content: `${String(user)}\n\n${formatHitsForLLM(fallbackQuery, hits)}\n\n${WEB_EVIDENCE_STYLE_DIRECTIVE}`,
      })

      const fallbackData = await openaiCompatRaw({
        url,
        apiKey,
        authType,
        model,
        label,
        messages: fallbackMessages,
        temperature,
        maxTokens,
        seed,
        jsonMode: false,
        extraBody,
        extraHeaders,
        timeoutMs,
        signal,
      })
      emitTokenUsage(fallbackData, onUsage)
      const fallbackChoice = fallbackData.choices?.[0]
      const fallbackContent = extractMessageContent(fallbackChoice?.message, label)
      if (!fallbackContent.trim()) {
        const finish = fallbackChoice?.finish_reason || "unknown"
        throw new Error(`${label} 预检索联网后返回空内容（finish_reason=${finish}）。`)
      }
      return fallbackContent
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
