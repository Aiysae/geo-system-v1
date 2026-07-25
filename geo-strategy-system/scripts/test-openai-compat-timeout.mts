import assert from "node:assert/strict"
import { createServer } from "node:http"

type OpenAiCompatModule = typeof import("../src/lib/llm/openai-compat")

const loadedModule = await import("../src/lib/llm/openai-compat")
const openAiCompat = (
  loadedModule as unknown as { default?: OpenAiCompatModule }
).default || loadedModule
const { openaiCompatRaw } = openAiCompat

let requests = 0
const server = createServer((_request, response) => {
  requests += 1
  if (requests === 1) {
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

server.closeAllConnections?.()
await new Promise<void>(resolve => server.close(() => resolve()))

console.log("OpenAI-compatible retry timeout test passed")
