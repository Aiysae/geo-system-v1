import assert from "node:assert/strict"

process.env.AUTH_SECRET = "test-only-auth-secret-with-enough-entropy"

const { nativeModelChat } = await import("../src/lib/llm/native-chat")
const originalFetch = globalThis.fetch

globalThis.fetch = (async (input, init) => {
  assert.equal(String(input), "https://api.openai.com/v1/responses")
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer openai-test-key")
  const body = JSON.parse(String(init?.body))
  assert.equal(body.model, "gpt-5.6-terra")
  return new Response(JSON.stringify({
    output_text: "OpenAI 官方回答",
    usage: { input_tokens: 6, output_tokens: 9, total_tokens: 15 },
  }), { status: 200 })
}) as typeof fetch

const openai = await nativeModelChat({
  protocol: "openai_responses",
  baseUrl: "https://api.openai.com",
  chatPath: "/v1/responses",
  apiKey: "openai-test-key",
  model: "gpt-5.6-terra",
  system: "system",
  user: "user",
  label: "OpenAI",
})
assert.equal(openai, "OpenAI 官方回答")

let anthropicUsage = 0
globalThis.fetch = (async (input, init) => {
  assert.equal(String(input), "https://api.anthropic.com/v1/messages")
  assert.equal(new Headers(init?.headers).get("x-api-key"), "anthropic-test-key")
  assert.equal(new Headers(init?.headers).get("anthropic-version"), "2023-06-01")
  const body = JSON.parse(String(init?.body))
  assert.equal(body.model, "claude-sonnet-5")
  assert.equal(body.temperature, undefined)
  return new Response(JSON.stringify({
    content: [{ type: "text", text: "Claude 官方回答" }],
    usage: { input_tokens: 12, output_tokens: 8 },
  }), { status: 200 })
}) as typeof fetch

const anthropic = await nativeModelChat({
  protocol: "anthropic_messages",
  baseUrl: "https://api.anthropic.com",
  chatPath: "/v1/messages",
  apiKey: "anthropic-test-key",
  model: "claude-sonnet-5",
  system: "system",
  user: "user",
  label: "Claude",
  onUsage: usage => { anthropicUsage = usage.totalTokens },
})
assert.equal(anthropic, "Claude 官方回答")
assert.equal(anthropicUsage, 20)

globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input))
  assert.equal(url.pathname, "/v1beta/models/gemini-3.6-flash:generateContent")
  assert.equal(url.searchParams.get("key"), "gemini-test-key")
  const body = JSON.parse(String(init?.body))
  assert.equal(body.contents[0].parts[0].text, "user")
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: "Gemini 官方回答" }] } }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
  }), { status: 200 })
}) as typeof fetch

const gemini = await nativeModelChat({
  protocol: "gemini_generate",
  baseUrl: "https://generativelanguage.googleapis.com",
  chatPath: "/v1beta/models/{model}:generateContent",
  apiKey: "gemini-test-key",
  model: "gemini-3.6-flash",
  system: "system",
  user: "user",
  label: "Gemini",
})
assert.equal(gemini, "Gemini 官方回答")

globalThis.fetch = originalFetch
console.log("OpenAI, Anthropic, and Gemini native article adapters passed")
