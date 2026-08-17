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
process.env.PENETRATION_AUTOMATION_STORE = "file"
process.env.PENETRATION_AUTOMATION_FILE = path.join(directory, "penetration-automations.json")
process.env.CLIENT_FEEDBACK_AUTOMATION_STORE = "file"
process.env.CLIENT_FEEDBACK_AUTOMATION_FILE = path.join(directory, "feedback-automations.json")
process.env.AUTH_SECRET = "agent-test-secret-with-at-least-thirty-two-characters"
process.env.ADMIN_EMAILS = "agent-admin@example.com"
process.env.AGENT_API_ENABLED = "true"
process.env.AGENT_TOKEN_MANAGEMENT_ENABLED = "true"
process.env.AGENT_ACCESS_MIN_TIER = "admin"
process.env.AGENT_INTERNAL_BASE_URL = "http://127.0.0.1:3000"
process.env.PUBLIC_APP_URL = "https://shitugeo.top"
process.env.DASHSCOPE_API_KEY = "agent-test-qwen-key"
process.env.QWEN_MODEL = "qwen3-max"
process.env.ARK_API_KEY = "agent-test-doubao-key"
process.env.ARK_DOUBAO_ENDPOINT_ID = "doubao-seed-2-0-lite-260215"
delete process.env.DATABASE_URL

try {
  const proxyModule = await import("../src/proxy")
  const publicGuide = proxyModule.proxy(new NextRequest("http://localhost/agent"))
  assert.equal(publicGuide.status, 200)
  assert.match(String(publicGuide.headers.get("cache-control")), /s-maxage=3600/)
  const publicCli = proxyModule.proxy(new NextRequest("http://localhost/downloads/shitu-geo.mjs"))
  assert.equal(publicCli.status, 200)
  assert.match(String(publicCli.headers.get("cache-control")), /s-maxage=3600/)
  const privateAgentCenter = proxyModule.proxy(new NextRequest("http://localhost/account/agents"))
  assert.equal(privateAgentCenter.status, 307)
  assert.match(String(privateAgentCenter.headers.get("location")), /sign-in/)

  const { createUser } = await import("../src/lib/auth")
  const { saveClientAccountLink } = await import("../src/lib/client-accounts")
  const { createWorkspaceClient } = await import("../src/lib/workspace-store")
  const { listAgentClientCatalog } = await import("../src/lib/agent/client-catalog")
  const { getAgentAccessEligibility } = await import("../src/lib/agent/eligibility")
  const {
    appendAgentAudit,
    authenticateAgentToken,
    agentTokenAllowsClient,
    createAgentToken,
    listAgentAudits,
    revokeAgentToken,
  } = await import("../src/lib/agent/store")
  const { AGENT_SCOPE_PRESETS } = await import("../src/lib/agent/scopes")
  const { readAgentJson, reserveAgentCreditBudget } = await import("../src/lib/agent/api")
  const { AGENT_ACTIONS } = await import("../src/lib/agent/action-catalog")
  const { buildAgentSubmittedTask, dispatchAgentAction } = await import("../src/lib/agent/action-dispatch")

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

  const clientUser = await createUser({
    email: "agent-client@example.com",
    password: "AgentPassword123",
    name: "Agent 客户账号",
  })
  await saveClientAccountLink({
    userId: clientUser.id,
    parentUserId: user.id,
    dataOwnerUserId: user.id,
    sourceType: "personal",
    clientId: "client-agent-test",
    clientName: "Agent 测试客户",
    operatorUserId: user.id,
  })
  process.env.AGENT_ACCESS_MIN_TIER = "all"
  process.env.AGENT_SELF_SERVICE_ENABLED = "true"
  const clientEligibility = await getAgentAccessEligibility(clientUser.id)
  assert.equal(clientEligibility.eligible, true)
  assert.equal(clientEligibility.canCreateTokens, true)
  assert.equal(clientEligibility.accountMode, "client")
  assert.equal(clientEligibility.maxActiveTokens, 1)
  assert.deepEqual(clientEligibility.allowedPresets, ["observer", "operator"])
  const linkedCatalog = await listAgentClientCatalog(clientUser.id)
  assert.equal(linkedCatalog.length, 1)
  assert.equal(linkedCatalog[0]?.id, "client-agent-test")
  assert.equal(linkedCatalog[0]?.dataOwnerUserId, user.id)

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

  const chunkedOversizedRequest = new Request("http://localhost/api/agent/v1/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"12345'))
        controller.enqueue(new TextEncoder().encode('67890"}'))
        controller.close()
      },
    }),
    duplex: "half",
  } as RequestInit)
  await assert.rejects(
    readAgentJson(chunkedOversizedRequest, 16),
    error => Boolean(error && typeof error === "object" && "code" in error && error.code === "PAYLOAD_TOO_LARGE"),
  )
  const submittedTask = buildAgentSubmittedTask(
    "penetration.run",
    { id: "pjob_agent_contract" },
    "https://shitugeo.top/api/agent/v1/actions/penetration.run",
  )
  assert.deepEqual(submittedTask, {
    taskId: "task_penetration_pjob_agent_contract",
    sourceJobId: "pjob_agent_contract",
    statusUrl: "https://shitugeo.top/api/agent/v1/tasks/task_penetration_pjob_agent_contract",
    resultUrl: "https://shitugeo.top/api/agent/v1/tasks/task_penetration_pjob_agent_contract/result",
  })
  const mediaTask = buildAgentSubmittedTask(
    "article.media.run",
    { job: { id: "amjob_agent_contract" } },
    "https://shitugeo.top/api/agent/v1/actions/article.media.run",
  )
  assert.equal(mediaTask?.taskId, "task_articleMedia_amjob_agent_contract")
  const productionTask = buildAgentSubmittedTask(
    "article.production.run",
    { run: { id: "cprod_agent_contract" } },
    "https://shitugeo.top/api/agent/v1/actions/article.production.run",
  )
  assert.equal(productionTask?.taskId, "task_contentProduction_cprod_agent_contract")

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
  assert.equal(capabilitiesBody.data.apiVersion, "v1.7")
  assert.ok(capabilitiesBody.data.actions.every((action: { inputSchema?: unknown }) => action.inputSchema))
  assert.ok(capabilitiesBody.data.actions.some((action: { name?: string }) => action.name === "keyword.questions.run"))
  assert.ok(capabilitiesBody.data.actions.some((action: { name?: string }) => action.name === "feedback.action.create"))
  for (const actionName of [
    "penetration.questions.generate",
    "penetration.automation.get",
    "penetration.automation.save",
    "penetration.automation.set-status",
    "penetration.automation.run",
    "penetration.automation.delete",
    "article.strategy.plan",
    "article.source.extract",
    "article.brands.analyze",
    "article.materials.list",
    "article.materials.import",
    "article.materials.delete",
    "article.media.upload",
    "article.media.run",
    "article.production.list",
    "article.production.run",
    "article.production.get",
    "article.production.cancel",
    "feedback.report.options",
    "feedback.report.manage",
    "feedback.profile.update",
    "feedback.visibility.update",
    "feedback.automation.get",
    "feedback.automation.save",
    "feedback.automation.set-status",
    "feedback.automation.run",
    "feedback.automation.retry",
    "feedback.automation.delete",
    "feedback.reminder-settings.get",
    "feedback.reminder-settings.update",
    "publishing.plan.get",
    "publishing.plan.recommend",
    "publishing.plan.create",
    "publishing.plan.activate",
    "publishing.tasks.list",
    "publishing.tasks.claim",
    "publishing.task.complete",
    "publishing.task.fail",
  ]) {
    assert.ok(
      AGENT_ACTIONS.some(action => action.name === actionName),
      `${actionName} should be exposed by Agent capabilities`,
    )
  }
  const articleGenerateAction = capabilitiesBody.data.actions.find(
    (action: { name?: string }) => action.name === "article.generate",
  ) as { inputSchema?: { properties?: Record<string, unknown> } } | undefined
  const articleBatchAction = capabilitiesBody.data.actions.find(
    (action: { name?: string }) => action.name === "article.batch.run",
  ) as { inputSchema?: { properties?: Record<string, { properties?: Record<string, unknown> }> } } | undefined
  const articleStrategyAction = capabilitiesBody.data.actions.find(
    (action: { name?: string }) => action.name === "article.strategy.plan",
  ) as { inputSchema?: { properties?: Record<string, unknown> } } | undefined
  assert.ok(articleGenerateAction?.inputSchema?.properties?.videoScriptConfig)
  assert.ok(articleBatchAction?.inputSchema?.properties?.basePayload?.properties?.videoScriptConfig)
  assert.ok(articleStrategyAction?.inputSchema?.properties?.outputTrack)
  assert.equal(
    capabilitiesBody.data.actions.some((action: { name?: string }) => action.name === "feedback.report.manage"),
    false,
    "operator tokens must not receive feedback.manage actions",
  )

  const articleSettingsRoute = await import("../src/app/api/agent/v1/articles/settings/route")
  const articleSettings = await articleSettingsRoute.GET(new Request(
    "http://localhost/api/agent/v1/articles/settings",
    { headers: { Authorization: `Bearer ${created.token}` } },
  ))
  assert.equal(articleSettings.status, 200)
  const articleSettingsBody = await articleSettings.json()
  assert.ok(Array.isArray(articleSettingsBody.data.prompts))
  assert.doesNotMatch(JSON.stringify(articleSettingsBody), /agent-test-doubao-key/)

  const clientsRoute = await import("../src/app/api/agent/v1/clients/route")
  const clients = await clientsRoute.GET(new Request("http://localhost/api/agent/v1/clients", {
    headers: { Authorization: `Bearer ${created.token}` },
  }))
  assert.equal(clients.status, 200)
  assert.equal((await clients.json()).data.clients[0].id, "client-agent-test")

  const linkedToken = await createAgentToken({
    ownerUserId: clientUser.id,
    name: "客户专属 Agent",
    scopes: [...AGENT_SCOPE_PRESETS.observer],
    clientMode: "selected",
    clientGrants: [{ clientId: "client-agent-test" }],
    dailyCreditLimit: 100,
    maxTaskCredits: 100,
  })
  const linkedClients = await clientsRoute.GET(new Request("http://localhost/api/agent/v1/clients", {
    headers: { Authorization: `Bearer ${linkedToken.token}` },
  }))
  assert.equal(linkedClients.status, 200)
  assert.equal((await linkedClients.json()).data.clients[0].id, "client-agent-test")

  const clientDetailRoute = await import("../src/app/api/agent/v1/clients/[clientId]/route")
  const deniedKnowledge = await clientDetailRoute.GET(new NextRequest(
    "http://localhost/api/agent/v1/clients/client-agent-test?sections=knowledgeBase",
    { headers: { Authorization: `Bearer ${created.token}` } },
  ), { params: Promise.resolve({ clientId: "client-agent-test" }) })
  assert.equal(deniedKnowledge.status, 403)
  assert.equal((await deniedKnowledge.json()).error.code, "AGENT_SCOPE_DENIED")

  const mcpRoute = await import("../src/app/api/agent/mcp/route")
  const deniedMcpOrigin = await mcpRoute.OPTIONS(new Request("https://shitugeo.top/api/agent/mcp", {
    method: "OPTIONS",
    headers: { Origin: "https://malicious-agent.example" },
  }))
  assert.equal(deniedMcpOrigin.status, 403)
  assert.equal(deniedMcpOrigin.headers.get("access-control-allow-origin"), "https://malicious-agent.example")
  assert.equal((await deniedMcpOrigin.json()).error.code, "MCP_ORIGIN_DENIED")

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
  const callAgentAction = (
    action: string,
    payload: Record<string, unknown>,
    token = created.token,
  ) => actionRoute.POST(new NextRequest(
    `http://localhost/api/agent/v1/actions/${action}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  ), { params: Promise.resolve({ action }) })
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

  const keywordDryRun = await actionRoute.POST(new NextRequest(
    "http://localhost/api/agent/v1/actions/keyword.questions.run",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${created.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "client-agent-test",
        requestId: "agent_keyword_test_0001",
        strategy: { project_name: "Agent 测试客户" },
        totalCount: 120,
        dryRun: true,
      }),
    },
  ), { params: Promise.resolve({ action: "keyword.questions.run" }) })
  assert.equal(keywordDryRun.status, 200)
  assert.equal((await keywordDryRun.json()).data.estimate.units, 120)

  const feedbackDryRun = await actionRoute.POST(new NextRequest(
    "http://localhost/api/agent/v1/actions/feedback.action.create",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${created.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "client-agent-test",
        requestId: "agent_feedback_test_0001",
        action: {
          category: "strategy_adjustment",
          status: "completed",
          visibility: "client",
          title: "完成 Agent 接口检查",
          occurredAt: new Date().toISOString(),
        },
        dryRun: true,
      }),
    },
  ), { params: Promise.resolve({ action: "feedback.action.create" }) })
  assert.equal(feedbackDryRun.status, 200)
  assert.equal((await feedbackDryRun.json()).data.estimate.scope, "feedback.edit")

  const generatedQuestionDryRun = await callAgentAction("penetration.questions.generate", {
    clientId: "client-agent-test",
    requestId: "agent_penetration_questions_0001",
    industry: "企业服务",
    brand: "测试品牌",
    count: 14,
    categories: ["recommendation", "comparison"],
    dryRun: true,
  })
  assert.equal(generatedQuestionDryRun.status, 200)
  assert.equal((await generatedQuestionDryRun.json()).data.estimate.units, 14)

  const automationSave = await callAgentAction("penetration.automation.save", {
    clientId: "client-agent-test",
    requestId: "agent_automation_save_0001",
    intervalDays: 3,
    timeLocal: "22:00",
    startDate: "2026-08-13",
    relativeDropThresholdPct: 15,
    minimumAbsoluteDropPoints: 3,
  })
  assert.equal(automationSave.status, 201)
  const automationSchedule = (await automationSave.json()).data.result.schedule
  assert.equal(automationSchedule.intervalDays, 3)
  const automationGet = await callAgentAction("penetration.automation.get", {
    clientId: "client-agent-test",
    requestId: "agent_automation_get_0001",
  })
  assert.equal(automationGet.status, 200)
  assert.equal((await automationGet.json()).data.result.schedule.id, automationSchedule.id)
  const automationPause = await callAgentAction("penetration.automation.set-status", {
    clientId: "client-agent-test",
    requestId: "agent_automation_pause_0001",
    scheduleId: automationSchedule.id,
    status: "paused",
  })
  assert.equal(automationPause.status, 200)
  assert.equal((await automationPause.json()).data.result.schedule.status, "paused")

  const feedbackRequestId = "agent_feedback_idempotency_0001"
  const feedbackPayload = {
    clientId: "client-agent-test",
    requestId: feedbackRequestId,
    action: {
      category: "strategy_adjustment",
      status: "completed",
      visibility: "client",
      title: "验证 Agent 幂等写入",
      occurredAt: new Date().toISOString(),
    },
  }
  const createFeedback = () => actionRoute.POST(new NextRequest(
    "http://localhost/api/agent/v1/actions/feedback.action.create",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${created.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(feedbackPayload),
    },
  ), { params: Promise.resolve({ action: "feedback.action.create" }) })
  const firstFeedback = await createFeedback()
  const secondFeedback = await createFeedback()
  assert.equal(firstFeedback.status, 201)
  assert.equal(secondFeedback.status, 201)
  const firstFeedbackBody = await firstFeedback.json()
  const secondFeedbackBody = await secondFeedback.json()
  assert.equal(
    firstFeedbackBody.data.result.action.id,
    secondFeedbackBody.data.result.action.id,
    "同一 requestId 重放时必须复用同一条执行反馈记录",
  )
  assert.equal(secondFeedbackBody.data.replayed, true)
  const conflictingFeedback = await actionRoute.POST(new NextRequest(
    "http://localhost/api/agent/v1/actions/feedback.action.create",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${created.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...feedbackPayload,
        action: { ...feedbackPayload.action, title: "错误复用相同 requestId" },
      }),
    },
  ), { params: Promise.resolve({ action: "feedback.action.create" }) })
  assert.equal(conflictingFeedback.status, 409)
  assert.equal((await conflictingFeedback.json()).error.code, "IDEMPOTENCY_CONFLICT")
  const { listClientExecutionActions } = await import("../src/lib/client-feedback/store")
  const storedFeedback = (await listClientExecutionActions(user.id, "client-agent-test"))
    .filter(action => action.title === "验证 Agent 幂等写入")
  assert.equal(storedFeedback.length, 1)

  const materialImport = await callAgentAction("article.materials.import", {
    clientId: "client-agent-test",
    requestId: "agent_material_import_0001",
    sourceFileName: "agent-materials.xlsx",
    rows: [
      { rowNumber: 1, question: "测试品牌适合哪些企业？", matchedAdvantage: "优势甲" },
      { rowNumber: 2, question: "测试品牌适合哪些企业？", matchedAdvantage: "优势乙" },
    ],
  })
  const materialImportBody = await materialImport.json()
  assert.equal(materialImport.status, 201, JSON.stringify(materialImportBody))
  const materialList = await callAgentAction("article.materials.list", {
    clientId: "client-agent-test",
    requestId: "agent_material_list_0001",
  })
  assert.equal(materialList.status, 200)
  const materials = (await materialList.json()).data.result.materials as Array<{ id: string }>
  assert.equal(materials.length, 2, "一问多优势必须保留为两条素材")
  const materialDelete = await callAgentAction("article.materials.delete", {
    clientId: "client-agent-test",
    requestId: "agent_material_delete_0001",
    ids: materials.map(item => item.id),
  })
  assert.equal(materialDelete.status, 200)
  assert.equal((await materialDelete.json()).data.result.deletedCount, 2)

  const reportOptions = await callAgentAction("feedback.report.options", {
    clientId: "client-agent-test",
    requestId: "agent_feedback_options_0001",
    type: "weekly",
    targetDate: new Date().toISOString().slice(0, 10),
  })
  assert.equal(reportOptions.status, 200)
  assert.ok(Array.isArray((await reportOptions.json()).data.result.actionDays))
  const profileUpdate = await callAgentAction("feedback.profile.update", {
    clientId: "client-agent-test",
    requestId: "agent_feedback_profile_0001",
    patch: {
      startDate: "2026-08-01",
      currentStage: "coverage_growth",
      stageProgress: 45,
      projectOwner: "Agent 项目负责人",
      nextPlan: ["继续扩大稳定提及"],
    },
  })
  assert.equal(profileUpdate.status, 200)
  assert.equal((await profileUpdate.json()).data.result.profile.stageProgress, 45)

  const reminderSettingsUpdate = await callAgentAction("feedback.reminder-settings.update", {
    clientId: "client-agent-test",
    requestId: "agent_feedback_reminder_update_0001",
    emailEnabled: false,
    inAppEnabled: true,
  })
  assert.equal(reminderSettingsUpdate.status, 200)
  assert.deepEqual((await reminderSettingsUpdate.json()).data.result.settings, {
    version: 1,
    emailEnabled: false,
    inAppEnabled: true,
  })
  const reminderSettingsGet = await callAgentAction("feedback.reminder-settings.get", {
    clientId: "client-agent-test",
    requestId: "agent_feedback_reminder_get_0001",
  })
  assert.equal(reminderSettingsGet.status, 200)
  assert.deepEqual((await reminderSettingsGet.json()).data.result.settings, {
    version: 1,
    emailEnabled: false,
    inAppEnabled: true,
  })

  const fullToken = await createAgentToken({
    ownerUserId: user.id,
    name: "完整 Agent 测试",
    scopes: [...AGENT_SCOPE_PRESETS.full],
    clientMode: "selected",
    clientGrants: [{ clientId: "client-agent-test" }],
    dailyCreditLimit: 500,
    maxTaskCredits: 500,
  })
  const visibilityUpdate = await callAgentAction("feedback.visibility.update", {
    clientId: "client-agent-test",
    requestId: "agent_feedback_visibility_0001",
    mode: "actions",
    actionIds: [storedFeedback[0]!.id],
    publication: "full",
  }, fullToken.token)
  assert.equal(visibilityUpdate.status, 200)
  const feedbackAutomationSave = await callAgentAction("feedback.automation.save", {
    clientId: "client-agent-test",
    requestId: "agent_feedback_automation_save_0001",
    weeklyEnabled: true,
    monthlyEnabled: true,
    timeLocal: "10:00",
    startDate: "2026-08-01",
    endDate: "2026-12-31",
    periodMode: "service",
    recipientEmails: ["agent-customer@example.com"],
    sendEmptyReports: true,
    finalReportEnabled: true,
  }, fullToken.token)
  assert.equal(feedbackAutomationSave.status, 201)
  const feedbackScheduleId = (await feedbackAutomationSave.json()).data.result.schedule.id as string
  const feedbackAutomationGet = await callAgentAction("feedback.automation.get", {
    clientId: "client-agent-test",
    requestId: "agent_feedback_automation_get_0001",
  }, fullToken.token)
  assert.equal(feedbackAutomationGet.status, 200)
  assert.equal((await feedbackAutomationGet.json()).data.result.schedule.id, feedbackScheduleId)
  const feedbackAutomationPause = await callAgentAction("feedback.automation.set-status", {
    clientId: "client-agent-test",
    requestId: "agent_feedback_automation_pause_0001",
    scheduleId: feedbackScheduleId,
    operation: "pause",
  }, fullToken.token)
  assert.equal(feedbackAutomationPause.status, 200)
  assert.equal((await feedbackAutomationPause.json()).data.result.schedule.status, "paused")
  const draftReport = await callAgentAction("feedback.report.create", {
    clientId: "client-agent-test",
    requestId: "agent_feedback_report_0001",
    type: "weekly",
    targetDate: new Date().toISOString().slice(0, 10),
  }, fullToken.token)
  assert.equal(draftReport.status, 201)
  const reportId = (await draftReport.json()).data.result.report.id as string
  const reportPublish = await callAgentAction("feedback.report.manage", {
    clientId: "client-agent-test",
    requestId: "agent_feedback_publish_0001",
    reportId,
    operation: "publish",
  }, fullToken.token)
  assert.equal(reportPublish.status, 200)
  assert.ok((await reportPublish.json()).data.result.sharePath)
  const reportRevoke = await callAgentAction("feedback.report.manage", {
    clientId: "client-agent-test",
    requestId: "agent_feedback_revoke_0001",
    reportId,
    operation: "revoke-share",
  }, fullToken.token)
  assert.equal(reportRevoke.status, 200)

  const feedbackAutomationDelete = await callAgentAction("feedback.automation.delete", {
    clientId: "client-agent-test",
    requestId: "agent_feedback_automation_delete_0001",
    scheduleId: feedbackScheduleId,
  }, fullToken.token)
  assert.equal(feedbackAutomationDelete.status, 200)

  const automationDelete = await callAgentAction("penetration.automation.delete", {
    clientId: "client-agent-test",
    requestId: "agent_automation_delete_0001",
    scheduleId: automationSchedule.id,
  })
  assert.equal(automationDelete.status, 200)

  const { estimateAgentAction, parseAgentActionInput } = await import("../src/lib/agent/action-catalog")
  assert.equal(estimateAgentAction("background.run", {
    clientId: "client-agent-test",
    requestId: "agent_knowledge_test_0001",
    kind: "knowledgeImport",
    payload: {},
  }).scope, "keyword.execute")
  const parsedQuestions = parseAgentActionInput("keyword.questions.run", {
    clientId: "client-agent-test",
    requestId: "agent_question_schema_0001",
    strategy: { project_name: "Agent 测试客户" },
    totalCount: 600,
  })
  assert.equal((parsedQuestions.categoryConfig as { allocationMode: string }).allocationMode, "ratio")
  assert.throws(() => parseAgentActionInput("keyword.questions.run", {
    clientId: "client-agent-test",
    requestId: "agent_question_schema_0002",
    strategy: { project_name: "Agent 测试客户" },
    totalCount: 601,
  }))
  const parsedWebsitePrompt = parseAgentActionInput("keyword.website-prompt.run", {
    clientId: "client-agent-test",
    requestId: "agent_website_schema_0001",
    plan: { official_site_strategy: [] },
  })
  assert.equal(parsedWebsitePrompt.kind, "official")
  const parsedRewrite = parseAgentActionInput("article.rewrite", {
    clientId: "client-agent-test",
    requestId: "agent_rewrite_schema_0001",
    promptKey: "rewrite",
    sourceMarkdown: "# 原文\n\n这是需要改写的品牌文章。",
    rewriteAnalysis: {
      sourceFingerprint: "fingerprint",
      brands: [],
    },
    rewriteMappings: [{
      sourceBrand: "原品牌",
      targetBrand: "测试品牌",
      materials: "真实品牌资料",
    }],
  })
  assert.equal(parsedRewrite.coreQuestion, "")
  assert.equal(parsedRewrite.modelProvider, "doubao")
  assert.throws(() => estimateAgentAction("report.create", {
    clientId: "client-agent-test",
    requestId: "agent_report_scope_0001",
    input: {
      kind: "penetration",
      detail: "concise",
      client: {
        id: "client-outside-token-grant",
        name: "越权客户",
        ourBrand: "越权品牌",
        brandAliases: [],
        industry: "企业服务",
        website: "https://example.com",
      },
    },
  }), /必须与已授权的 clientId 一致/)

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
  const openapi = agentOpenApiDocument("https://shitugeo.top") as {
    info: { version: string }
    paths: Record<string, unknown>
    externalDocs: { url: string }
    components: { schemas: { AgentScope: { enum: string[] } } }
  }
  assert.equal(openapi.info.version, "1.7.0")
  assert.ok(openapi.paths["/actions/{action}"])
  assert.ok(openapi.paths["/actions/penetration.run"])
  assert.ok(openapi.paths["/actions/penetration.automation.save"])
  assert.ok(openapi.paths["/actions/article.batch.run"])
  assert.ok(openapi.paths["/actions/article.strategy.plan"])
  assert.ok(openapi.paths["/actions/article.media.run"])
  assert.ok(openapi.paths["/actions/feedback.report.manage"])
  assert.ok(openapi.paths["/actions/feedback.automation.save"])
  assert.ok(openapi.paths["/actions/feedback.automation.retry"])
  assert.ok(openapi.paths["/actions/publishing.plan.create"])
  assert.ok(openapi.paths["/actions/publishing.tasks.claim"])
  assert.ok(openapi.paths["/actions/publishing.task.complete"])
  assert.ok(openapi.paths["/actions/keyword.questions.run"])
  assert.ok(openapi.paths["/tasks/{taskId}/result"])
  assert.ok(openapi.paths["/tasks/{taskId}/cancel"])
  assert.ok(openapi.paths["/articles/batches/{batchId}/download"])
  assert.ok(openapi.paths["/articles/settings"])
  assert.ok(openapi.paths["/feedback/{clientId}"])
  assert.ok(openapi.paths["/knowledge/imports/{importId}"])
  assert.equal(openapi.externalDocs.url, "https://shitugeo.top/agent")
  assert.ok(openapi.components.schemas.AgentScope.enum.includes("knowledge.view"))
  assert.ok(openapi.components.schemas.AgentScope.enum.includes("feedback.manage"))
  const openapiRoute = await import("../src/app/api/agent/v1/openapi.json/route")
  const trustedOpenapi = await openapiRoute.GET(new Request("https://malicious-host.example/api/agent/v1/openapi.json"))
  assert.equal((await trustedOpenapi.json()).externalDocs.url, "https://shitugeo.top/agent")

  await revokeAgentToken({ ownerUserId: user.id, tokenId: created.record.id })
  await revokeAgentToken({ ownerUserId: user.id, tokenId: fullToken.record.id })
  await revokeAgentToken({ ownerUserId: clientUser.id, tokenId: linkedToken.record.id })
  assert.equal(await authenticateAgentToken(created.token), null)
  console.log("Agent store and REST contract tests passed.")
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
