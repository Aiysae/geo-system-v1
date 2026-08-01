import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-agent-api-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(directory, "kv.json")
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE = path.join(directory, "workspaces.json")
process.env.AGENT_STORE = "file"
process.env.AGENT_FILE = path.join(directory, "agents.json")
process.env.AUTH_SECRET = "agent-test-secret-with-at-least-thirty-two-characters"
process.env.ADMIN_EMAILS = "agent-admin@example.com"
process.env.AGENT_API_ENABLED = "true"
process.env.AGENT_TOKEN_MANAGEMENT_ENABLED = "true"
process.env.AGENT_ACCESS_MIN_TIER = "admin"
process.env.AGENT_INTERNAL_BASE_URL = "http://127.0.0.1:3000"
delete process.env.DATABASE_URL

try {
  const { createUser } = await import("../src/lib/auth")
  const { createWorkspaceClient } = await import("../src/lib/workspace-store")
  const {
    appendAgentAudit,
    authenticateAgentToken,
    agentTokenAllowsClient,
    createAgentToken,
    listAgentAudits,
    revokeAgentToken,
  } = await import("../src/lib/agent/store")
  const { AGENT_SCOPE_PRESETS } = await import("../src/lib/agent/scopes")
  const { reserveAgentCreditBudget } = await import("../src/lib/agent/api")
  const { dispatchAgentAction } = await import("../src/lib/agent/action-dispatch")

  const user = await createUser({
    email: "agent-admin@example.com",
    password: "AgentPassword123",
    name: "Agent 管理员",
  })
  const now = new Date().toISOString()
  await createWorkspaceClient(user.id, {
    id: "client-agent-test",
    name: "Agent 测试客户",
    subjectType: "brand",
    ourBrand: "测试品牌",
    industry: "企业服务",
    website: "https://example.com",
    questions: [],
    competitors: [],
    selectedModels: ["doubao"],
    createdAt: now,
    updatedAt: now,
  })

  const created = await createAgentToken({
    ownerUserId: user.id,
    name: "自动化测试",
    scopes: [...AGENT_SCOPE_PRESETS.operator],
    clientMode: "selected",
    clientGrants: [{ clientId: "client-agent-test" }],
    dailyCreditLimit: 500,
    maxTaskCredits: 500,
  })
  assert.match(created.token, /^stgeo_agt_[a-f0-9]{32}_/)
  assert.equal((await authenticateAgentToken(created.token))?.id, created.record.id)
  assert.equal(await authenticateAgentToken(`${created.token}broken`), null)
  assert.equal(agentTokenAllowsClient(created.record, "client-agent-test"), true)
  assert.equal(agentTokenAllowsClient(created.record, "client-agent-test", "team-x"), false)

  const budgetAuth = {
    token: created.record,
    userId: user.id,
    traceId: "trace_budget_test",
    ip: "127.0.0.1",
  }
  const concurrentFirst = await reserveAgentCreditBudget(budgetAuth, 100, "same-request")
  const concurrentSecond = await reserveAgentCreditBudget(budgetAuth, 100, "same-request")
  assert.equal(concurrentFirst.reused, false)
  assert.equal(concurrentSecond.reused, false)
  await concurrentFirst.commit()
  await concurrentSecond.commit()
  const remainingCapacity = await reserveAgentCreditBudget(budgetAuth, 400, "capacity-check")
  await remainingCapacity.release()
  const completedRetry = await reserveAgentCreditBudget(budgetAuth, 100, "same-request")
  assert.equal(completedRetry.reused, true)

  await assert.rejects(
    dispatchAgentAction({
      action: "background.run",
      payload: {
        clientId: "client-agent-test",
        requestId: "agent_dispatch_test_0001",
        kind: "not-a-real-job",
        payload: {},
      },
      auth: budgetAuth,
      origin: "http://localhost/api/agent/v1/actions/background.run",
    }),
    error => Boolean(error && typeof error === "object" && "code" in error && error.code === "INVALID_ARGUMENT"),
  )

  await appendAgentAudit({
    tokenId: created.record.id,
    ownerUserId: user.id,
    action: "test.action",
    method: "POST",
    path: "/test",
    traceId: "trace_agent_test",
    status: "succeeded",
    httpStatus: 200,
    estimatedCredits: 1,
    metadata: { apiKey: "must-not-be-stored", nested: { password: "secret" } },
  })
  const audits = await listAgentAudits(user.id)
  assert.equal(audits.length, 1)
  assert.equal(audits[0]?.metadata.apiKey, "[redacted]")
  assert.deepEqual(audits[0]?.metadata.nested, { password: "[redacted]" })

  const capabilitiesRoute = await import("../src/app/api/agent/v1/capabilities/route")
  const capabilities = await capabilitiesRoute.GET(new Request("http://localhost/api/agent/v1/capabilities", {
    headers: { Authorization: `Bearer ${created.token}` },
  }))
  assert.equal(capabilities.status, 200)
  const capabilitiesBody = await capabilities.json()
  assert.equal(capabilitiesBody.ok, true)
  assert.equal(capabilitiesBody.data.apiVersion, "v1")

  const clientsRoute = await import("../src/app/api/agent/v1/clients/route")
  const clients = await clientsRoute.GET(new Request("http://localhost/api/agent/v1/clients", {
    headers: { Authorization: `Bearer ${created.token}` },
  }))
  assert.equal(clients.status, 200)
  assert.equal((await clients.json()).data.clients[0].id, "client-agent-test")

  const mcpRoute = await import("../src/app/api/agent/mcp/route")
  const mcpInitialize = await mcpRoute.POST(new Request("https://untrusted-host.example/api/agent/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${created.token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "agent-http-test", version: "1.0.0" },
      },
    }),
  }))
  assert.equal(mcpInitialize.status, 200)
  const mcpInitializeBody = await mcpInitialize.json()
  assert.equal(mcpInitializeBody.result.serverInfo.name, "shitu-geo")

  const actionRoute = await import("../src/app/api/agent/v1/actions/[action]/route")
  const dryRunRequest = new NextRequest("http://localhost/api/agent/v1/actions/difficulty.run", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${created.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientId: "client-agent-test",
      requestId: "agent_difficulty_test_0001",
      mode: "brand",
      industry: "企业服务",
      targetBrand: "测试品牌",
      region: "全国",
      scope: "national",
      dryRun: true,
    }),
  })
  const dryRun = await actionRoute.POST(dryRunRequest, {
    params: Promise.resolve({ action: "difficulty.run" }),
  })
  const dryRunBody = await dryRun.json()
  assert.equal(dryRun.status, 200)
  assert.equal(dryRunBody.ok, true)
  assert.equal(dryRunBody.data.dryRun, true)
  assert.equal(dryRunBody.data.estimate.scope, "difficulty.execute")

  const deniedRequest = new NextRequest("http://localhost/api/agent/v1/actions/difficulty.run", {
    method: "POST",
    headers: { Authorization: `Bearer ${created.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: "client-not-authorized",
      requestId: "agent_difficulty_test_0002",
      mode: "industry",
      industry: "企业服务",
      dryRun: true,
    }),
  })
  const denied = await actionRoute.POST(deniedRequest, {
    params: Promise.resolve({ action: "difficulty.run" }),
  })
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error.code, "AGENT_CLIENT_DENIED")

  const { agentOpenApiDocument } = await import("../src/lib/agent/openapi")
  const openapi = agentOpenApiDocument("https://shitugeo.top") as { paths: Record<string, unknown> }
  assert.ok(openapi.paths["/actions/{action}"])
  assert.ok(openapi.paths["/tasks/{taskId}/cancel"])

  await revokeAgentToken({ ownerUserId: user.id, tokenId: created.record.id })
  assert.equal(await authenticateAgentToken(created.token), null)
  console.log("Agent store and REST contract tests passed.")
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
