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
  if (url.includes("/download")) {
    return new Response(new TextEncoder().encode("agent-binary-test"), {
      headers: { "Content-Type": url.includes("articles/batches") ? "application/zip" : "application/pdf" },
    })
  }
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
  for (const name of [
    "shitu_get_task_result",
    "shitu_restore_task_result",
    "shitu_run_research",
    "shitu_compare_competitors",
    "shitu_run_ai_diagnosis",
    "shitu_extract_keyword_profile",
    "shitu_generate_advantages",
    "shitu_generate_keyword_strategy",
    "shitu_generate_website_prompt",
    "shitu_generate_questions",
    "shitu_generate_article",
    "shitu_rewrite_article",
    "shitu_generate_article_batch",
    "shitu_import_knowledge",
    "shitu_commit_knowledge",
    "shitu_create_feedback_action",
    "shitu_import_feedback_actions",
    "shitu_create_feedback_report",
    "shitu_create_professional_report",
    "shitu_list_article_batches",
    "shitu_get_article_batch_zip",
    "shitu_get_feedback",
    "shitu_list_knowledge_imports",
  ]) assert.ok(names.has(name), `${name} should be registered`)

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

  const questions = await client.callTool({
    name: "shitu_generate_questions",
    arguments: {
      clientId: "client-mcp",
      requestId: "agent_mcp_questions_0001",
      strategy: { project_name: "MCP 客户" },
      totalCount: 120,
      dryRun: true,
    },
  })
  assert.equal(questions.isError, undefined)
  const questionRequest = requests.find(item => item.url.endsWith("/actions/keyword.questions.run"))
  assert.equal((questionRequest?.body as { categoryConfig?: { allocationMode?: string } })
    .categoryConfig?.allocationMode, "ratio")

  const websitePrompt = await client.callTool({
    name: "shitu_generate_website_prompt",
    arguments: {
      clientId: "client-mcp",
      requestId: "agent_mcp_website_prompt_0001",
      kind: "official",
      plan: { official_site_strategy: [{ module: "首页", action: "优化", goal: "可引用" }] },
      dryRun: true,
    },
  })
  assert.equal(websitePrompt.isError, undefined)
  assert.ok(requests.some(item => item.url.endsWith("/actions/keyword.website-prompt.run")))

  const taskResult = await client.callTool({
    name: "shitu_get_task_result",
    arguments: { taskId: "task-mcp" },
  })
  assert.equal(taskResult.isError, undefined)
  assert.ok(requests.some(item => item.url.endsWith("/tasks/task-mcp/result")))

  const templates = await client.listResourceTemplates()
  assert.ok(templates.resourceTemplates.some(item => item.uriTemplate.includes("reports/{jobId}")))
  assert.ok(templates.resourceTemplates.some(item => item.uriTemplate.includes("article-batches/{batchId}")))
  const pdf = await client.readResource({ uri: "shitu://reports/report-mcp/download.pdf" })
  assert.equal(pdf.contents[0]?.mimeType, "application/pdf")
  assert.ok("blob" in (pdf.contents[0] || {}))
  console.log("Agent MCP contract tests passed.")
} finally {
  globalThis.fetch = originalFetch
  await Promise.allSettled([client.close(), server.close()])
}
