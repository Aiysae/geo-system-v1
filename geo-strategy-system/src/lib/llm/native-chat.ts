import "server-only"

import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
import { validateAiBaseUrl } from "@/lib/ai-settings"
import type { LlmTokenUsage } from "@/lib/llm/openai-compat"
import type { AiGatewayProtocol } from "@/types/ai-gateway"

interface NativeChatArgs {
  protocol: Exclude<AiGatewayProtocol, "openai_chat">
  baseUrl: string
  chatPath: string
  apiKey: string
  model: string
  system: string
  user: string
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  timeoutSec?: number
  label: string
  onUsage?: (usage: LlmTokenUsage) => void
  signal?: AbortSignal
}

function requestUrl(args: NativeChatArgs): string {
  const baseUrl = validateAiBaseUrl(args.baseUrl)
  if (args.protocol === "gemini_generate") {
    const path = args.chatPath.replace("{model}", encodeURIComponent(args.model))
    const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`)
    url.searchParams.set("key", args.apiKey)
    return url.toString()
  }
  return `${baseUrl}${args.chatPath.startsWith("/") ? args.chatPath : `/${args.chatPath}`}`
}

function requestBody(args: NativeChatArgs): Record<string, unknown> {
  if (args.protocol === "openai_responses") {
    return {
      model: args.model,
      instructions: args.system,
      input: args.user,
      max_output_tokens: args.maxTokens || 8192,
    }
  }
  if (args.protocol === "anthropic_messages") {
    return {
      model: args.model,
      max_tokens: args.maxTokens || 8192,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
    }
  }
  return {
    systemInstruction: { parts: [{ text: args.system }] },
    contents: [{ role: "user", parts: [{ text: args.user }] }],
    generationConfig: {
      temperature: args.temperature ?? 0.6,
      maxOutputTokens: args.maxTokens || 8192,
      ...(args.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  }
}

function requestHeaders(args: NativeChatArgs): Record<string, string> {
  if (args.protocol === "anthropic_messages") {
    return {
        "Content-Type": "application/json",
        "x-api-key": args.apiKey,
        "anthropic-version": "2023-06-01",
    }
  }
  if (args.protocol === "openai_responses") {
    return { "Content-Type": "application/json", Authorization: `Bearer ${args.apiKey}` }
  }
  return { "Content-Type": "application/json" }
}

function extractResult(
  args: NativeChatArgs,
  parsed: Record<string, unknown>,
): { content: string; usage?: LlmTokenUsage } {
  if (args.protocol === "openai_responses") {
    const output = Array.isArray(parsed.output) ? parsed.output : []
    const content = typeof parsed.output_text === "string"
      ? parsed.output_text
      : output
          .flatMap(item => item && typeof item === "object" && Array.isArray((item as { content?: unknown }).content)
            ? (item as { content: unknown[] }).content
            : [])
          .flatMap(item => item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
            ? [(item as { text: string }).text]
            : [])
          .join("\n")
    const rawUsage = parsed.usage && typeof parsed.usage === "object"
      ? parsed.usage as Record<string, unknown>
      : undefined
    const promptTokens = Number(rawUsage?.input_tokens) || 0
    const completionTokens = Number(rawUsage?.output_tokens) || 0
    return {
      content,
      usage: rawUsage ? {
        promptTokens,
        completionTokens,
        totalTokens: Number(rawUsage.total_tokens) || promptTokens + completionTokens,
      } : undefined,
    }
  }
  if (args.protocol === "anthropic_messages") {
    const blocks = Array.isArray(parsed.content) ? parsed.content : []
    const content = blocks
      .flatMap(block => block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
        ? [(block as { text: string }).text]
        : [])
      .join("\n")
    const rawUsage = parsed.usage && typeof parsed.usage === "object"
      ? parsed.usage as Record<string, unknown>
      : undefined
    const promptTokens = Number(rawUsage?.input_tokens) || 0
    const completionTokens = Number(rawUsage?.output_tokens) || 0
    return {
      content,
      usage: rawUsage ? {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      } : undefined,
    }
  }

  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : []
  const first = candidates[0] && typeof candidates[0] === "object"
    ? candidates[0] as Record<string, unknown>
    : undefined
  const candidateContent = first?.content && typeof first.content === "object"
    ? first.content as Record<string, unknown>
    : undefined
  const parts = Array.isArray(candidateContent?.parts) ? candidateContent.parts : []
  const content = parts
    .flatMap(part => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
      ? [(part as { text: string }).text]
      : [])
    .join("\n")
  const rawUsage = parsed.usageMetadata && typeof parsed.usageMetadata === "object"
    ? parsed.usageMetadata as Record<string, unknown>
    : undefined
  const promptTokens = Number(rawUsage?.promptTokenCount) || 0
  const completionTokens = Number(rawUsage?.candidatesTokenCount) || 0
  return {
    content,
    usage: rawUsage ? {
      promptTokens,
      completionTokens,
      totalTokens: Number(rawUsage.totalTokenCount) || promptTokens + completionTokens,
    } : undefined,
  }
}

function abortedError(): Error {
  const error = new Error("AI 请求已停止")
  error.name = "AbortError"
  return error
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortedError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortedError())
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

export async function nativeModelChat(args: NativeChatArgs): Promise<string> {
  if (!args.apiKey) throw new Error(`${args.label} API Key 未配置，请在 AI 模型中心补全后重试。`)
  if (!args.model) throw new Error(`${args.label} 尚未选择模型`)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1, args.timeoutSec || 300) * 1000)
  const abortFromParent = () => controller.abort()
  if (args.signal?.aborted) controller.abort()
  else args.signal?.addEventListener("abort", abortFromParent, { once: true })
  try {
    let response: Response | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(requestUrl(args), {
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
          headers: requestHeaders(args),
          body: JSON.stringify(requestBody(args)),
        })
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error
        if (attempt === 2) throw error
        await sleep(800 * (attempt + 1), controller.signal)
        continue
      }
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break
      await response.text().catch(() => "")
      await sleep(1000 * (attempt + 1), controller.signal)
    }
    if (!response) throw new Error("没有收到上游响应")
    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`${args.label} 接口调用失败 HTTP ${response.status}：${sanitizeAiUpstreamMessage(raw, 220) || "无响应内容"}`)
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      throw new Error(`${args.label} 返回体不是有效 JSON`)
    }
    const result = extractResult(args, parsed)
    if (!result.content.trim()) throw new Error(`${args.label} 返回空内容，请检查模型权限或上游额度`)
    if (result.usage) args.onUsage?.(result.usage)
    return result.content
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (args.signal?.aborted) throw abortedError()
      throw new Error(`${args.label} 请求超时，请稍后重试`)
    }
    if (error instanceof TypeError) throw new Error(`${args.label} API 连接失败：${error.message}`)
    throw error
  } finally {
    clearTimeout(timeout)
    args.signal?.removeEventListener("abort", abortFromParent)
  }
}
