// OpenAI-Compatible chat 通用封装。所有国产模型（豆包 / DeepSeek / 千问 / Kimi）
// 均走 OpenAI 标准 /chat/completions 协议。
//
// 设计要点：
// 1. 不静默吞错：任何非 2xx 一律抛出可读 Error，由上层 route 透传给前端。
// 2. 不返回任何 Mock / 假数据。
// 3. 支持透传 tools（用于 Kimi 的 $web_search 联网工具）。
// 4. 单轮入口 openaiCompatChat 会自动在 system prompt 头部注入"当前北京时间"，
//    工具循环类（如 deepseek/kimi）自行拼装 messages 时也应使用 withBeijingTime。

import { withBeijingTime } from "./time-context"

interface ChatArgs {
  system: string
  user: string
  temperature?: number
  maxTokens?: number
  seed?: number
  jsonMode?: boolean
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
  // 透传给厂商的非标准字段（如阿里千问 enable_search、火山方舟联网插件参数等）
  extraBody?: Record<string, unknown>
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
  extraBody,
}: OpenAICompatRawArgs): Promise<RawChatCompletion> {
  if (!apiKey) {
    // 请求前显式校验：把缺失的 Key 用 console.warn 打印出来，便于在终端立刻定位
    console.warn(`[${label}] API Key is undefined（请检查 .env.local 中对应环境变量是否已加载）`)
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

  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    // 部分供应商不支持 response_format=json_object，遇到 400/422 时去掉重试一次
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

interface OpenAICompatArgs extends ChatArgs {
  url: string
  apiKey: string
  model: string
  label: string
  extraBody?: Record<string, unknown>
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
  label,
  extraBody,
}: OpenAICompatArgs): Promise<string> {
  const data = await openaiCompatRaw({
    url,
    apiKey,
    model,
    label,
    messages: [
      // ★ 头部强制注入"当前北京时间"，覆盖所有走单轮入口的模型（豆包/千问/裁判路径）
      { role: "system", content: withBeijingTime(system) },
      { role: "user", content: user },
    ],
    temperature,
    maxTokens,
    seed,
    jsonMode,
    extraBody,
  })
  return data.choices?.[0]?.message?.content ?? ""
}

export type { ChatArgs }
