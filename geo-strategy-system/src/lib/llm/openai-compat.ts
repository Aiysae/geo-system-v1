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
}

export async function openaiCompatChat({
  url,
  apiKey,
  model,
  system,
  user,
  temperature = 0.6,
  maxTokens = 1024,
  seed,
  jsonMode = false,
  label,
}: OpenAICompatArgs): Promise<string> {
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  }
  if (typeof seed === "number") payload.seed = seed
  if (jsonMode) payload.response_format = { type: "json_object" }

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
    // 当 jsonMode 被某些供应商拒绝时，回退到普通模式重试一次
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
      if (retry.ok) {
        const data = await retry.json()
        return data.choices?.[0]?.message?.content ?? ""
      }
    }
    throw new Error(`${label} ${res.status} ${txt.slice(0, 200)}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ""
}

export type { ChatArgs }
