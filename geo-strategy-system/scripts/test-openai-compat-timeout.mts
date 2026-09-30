import assert from "node:assert/strict"
import { createServer } from "node:http"

type OpenAiCompatModule = typeof import("../src/lib/llm/openai-compat")

const loadedModule = await import("../src/lib/llm/openai-compat")
const openAiCompat = (
  loadedModule as unknown as { default?: OpenAiCompatModule }
).default || loadedModule
const { openaiCompatRaw } = openAiCompat

let requests = 0
let slowBody = false
let bodyStatus = 200
let ordinaryError = false
const server = createServer((_request, response) => {
  requests += 1
  if (ordinaryError) {
    response.writeHead(400, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ error: { message: "invalid request parameter" } }))
  } else if (slowBody) {
    response.writeHead(bodyStatus, { "Content-Type": "application/json" })
    response.flushHeaders()
    const timer = setTimeout(() => response.end(JSON.stringify({ choices: [] })), 600)
    response.on("close", () => clearTimeout(timer))
  } else if (requests === 1) {
    response.writeHead(400, { "Content-Type": "application/json" })
    response.end(JSON.stringify({
      error: {
        message: "response_format is not supported",
      },
    }))
  }
})

await new Promise<void>((resolve, reject) => {
  server.once("error", reject)
  server.listen(0, "127.0.0.1", resolve)
})

const address = server.address()
assert(address && typeof address === "object")

const startedAt = Date.now()
await assert.rejects(
  openaiCompatRaw({
    url: `http://127.0.0.1:${address.port}/chat/completions`,
    apiKey: "test-key",
    model: "test-model",
    label: "兼容重试超时测试",
    messages: [{ role: "user", content: "ping" }],
    jsonMode: true,
    timeoutMs: 150,
  }),
  /请求超时/,
)

assert.equal(requests, 2)
assert(
  Date.now() - startedAt < 1500,
  "JSON compatibility retry should preserve the configured hard timeout",
)

ordinaryError = true
const beforeOrdinaryError = requests
await assert.rejects(openaiCompatRaw({
  url: `http://127.0.0.1:${address.port}/chat/completions`,
  apiKey: "test-key", model: "test-model", label: "普通参数错误",
  messages: [], jsonMode: true, timeoutMs: 150,
}), /HTTP 400/)
assert.equal(requests, beforeOrdinaryError + 1, "unrelated 400 must not trigger a JSON-mode retry")
ordinaryError = false
slowBody = true
try {
  for (const [status, cancel] of [[200, false], [200, true], [503, false]] as const) {
    bodyStatus = status
    const controller = new AbortController()
    const timer = cancel ? setTimeout(() => controller.abort(), 100) : undefined
    const start = Date.now()
    try {
      await assert.rejects(openaiCompatRaw({
        url: `http://127.0.0.1:${address.port}/chat/completions`,
        apiKey: "test-key", model: "test-model", label: "响应体保护",
        messages: [], timeoutMs: cancel ? 2000 : 150,
        signal: controller.signal,
      }), cancel ? { name: "AbortError" } : /请求超时/)
      assert(Date.now() - start < 500, "must stop while the response body is pending")
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
} finally {
  server.closeAllConnections?.()
  await new Promise<void>(resolve => server.close(() => resolve()))
}

console.log("OpenAI-compatible retry and response-body timeout tests passed")
