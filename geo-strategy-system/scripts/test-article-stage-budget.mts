import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { ResolvedArticleModel } from "../src/lib/article-models"
import type { AiGatewayProtocol } from "../src/types/ai-gateway"

process.env.ALLOW_UNSAFE_AI_BASE_URLS = "true"
const { runArticleModelChat } = await import("../src/lib/article-model-runtime")

let requests = 0
const server = createServer(request => {
  requests += 1
  request.resume()
})

await new Promise<void>((resolve, reject) => {
  server.once("error", reject)
  server.listen(0, "127.0.0.1", resolve)
})

const serverAddress = server.address()
assert(serverAddress && typeof serverAddress === "object")
const port = serverAddress.port

function slowModel(protocol: AiGatewayProtocol): ResolvedArticleModel {
  return {
    providerKey: "article",
    label: `慢线路-${protocol}`,
    baseUrl: `http://127.0.0.1:${port}`,
    chatPath: "/chat/completions",
    apiKey: "test-key",
    model: "test-model",
    timeout: 30,
    authType: "bearer",
    protocol,
  }
}

try {
  for (const protocol of ["openai_chat", "anthropic_messages"] as const) {
    const startedAt = Date.now()
    await assert.rejects(
      runArticleModelChat(slowModel(protocol), {
        system: "你是测试助手。",
        user: "请回答。",
        label: `阶段总时限-${protocol}`,
        totalTimeoutMs: 180,
      }),
      /处理超时（超过 1 秒），已停止当前阶段/,
    )
    assert(
      Date.now() - startedAt < 2_000,
      `${protocol} should honor the whole-stage deadline`,
    )
  }
  assert.equal(requests, 2)
} finally {
  server.closeAllConnections?.()
  await new Promise<void>(resolve => server.close(() => resolve()))
}

console.log("Article generation whole-stage timeout budget passed")
