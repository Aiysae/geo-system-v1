import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

const importedMcpModule = await import("../src/agent/mcp-server")
const mcpModule = (
  "default" in importedMcpModule
    ? importedMcpModule.default
    : importedMcpModule
) as typeof import("../src/agent/mcp-server")
const { createShituGeoMcpServer } = mcpModule

const originalFetch = globalThis.fetch
const requests: Array<{ url: string; method: string; body?: unknown }> = []
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  requests.push({
    url,
    method: String(init?.method || "GET"),
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  })
  const data = url.endsWith("/clients")
    ? { clients: [{ id: "client-mcp", name: "MCP 客户" }], total: 1 }
    : { task: { id: "task-mcp", status: "queued" } }
  return Response.json({ ok: true, data, meta: { traceId: "trace_mcp", serverTime: new Date().toISOString() } })
}) as typeof fetch

const server = createShituGeoMcpServer({ baseUrl: "https://example.test", token: "test-token" })
const client = new Client({ name: "agent-mcp-test", version: "1.0.0" })
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

try {
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  const tools = await client.listTools()
  const names = new Set(tools.tools.map(tool => tool.name))
  assert.ok(names.has("shitu_list_clients"))
  assert.ok(names.has("shitu_run_penetration"))
  assert.ok(names.has("shitu_run_difficulty"))
  assert.ok(names.has("shitu_cancel_task"))

  const listed = await client.callTool({ name: "shitu_list_clients", arguments: {} })
  assert.equal(listed.isError, undefined)
  assert.equal((listed.structuredContent as { result: { total: number } }).result.total, 1)

  const run = await client.callTool({
    name: "shitu_run_penetration",
    arguments: {
      clientId: "client-mcp",
      requestId: "agent_mcp_penetration_0001",
      ourBrand: "测试品牌",
      industry: "企业服务",
      questions: ["有哪些值得推荐的企业服务品牌？"],
      models: ["doubao"],
      dryRun: true,
    },
  })
  assert.equal(run.isError, undefined)
  const actionRequest = requests.find(item => item.url.endsWith("/actions/penetration.run"))
  assert.equal(actionRequest?.method, "POST")
  assert.equal((actionRequest?.body as { dryRun?: boolean }).dryRun, true)
  console.log("Agent MCP contract tests passed.")
} finally {
  globalThis.fetch = originalFetch
  await Promise.allSettled([client.close(), server.close()])
}
