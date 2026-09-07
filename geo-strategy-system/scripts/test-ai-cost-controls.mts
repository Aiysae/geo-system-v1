import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NextRequest } from "next/server"
import type { ResolvedArticleModel } from "../src/lib/article-models"

const dir = mkdtempSync(join(tmpdir(), "geo-cost-controls-"))
delete process.env.DATABASE_URL
delete process.env.REDIS_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(dir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-cost-controls-key"
process.env.ARK_API_KEY = "test-writer"
process.env.ARK_DOUBAO_ENDPOINT_ID = "doubao-test-writer"
process.env.DASHSCOPE_API_KEY = "test-judge"
process.env.DASHSCOPE_MODEL = "qwen-plus"
process.env.ARTICLE_AI_PLANNER_ENABLED = "false"
process.env.ARTICLE_WEB_SEARCH_ATTEMPTS = "1"
process.env.ARTICLE_AUXILIARY_MODEL_PROVIDER = "qwen"
process.env.ARTICLE_AUXILIARY_MODEL = "qwen-plus"

const { classifyAiCredentialFailure } = await import("../src/lib/ai-credential-failure-classifier")
const { saveAiCredential, updateAiCredentialHealth, setAiCredentialEnabled, getAiCredentialRuntime } =
  await import("../src/lib/ai-credential-store")
const { runArticleModelChat } = await import("../src/lib/article-model-runtime")
const { runAiCredentialHealthSweep } = await import("../src/lib/ai-credential-health-monitor")
const { recordAiCredentialFailure } = await import("../src/lib/ai-credential-router")
const { emitTokenUsage } = await import("../src/lib/llm/openai-compat")
const { chatDoubao } = await import("../src/lib/llm/doubao")
const { addTokenUsage } = await import("../src/lib/ai-usage")
const { createInternalApiHeaders, INTERNAL_API_USER_HEADER } = await import("../src/lib/internal-api")
const { POST } = await import("../src/app/api/article-generation/route")
const originalFetch = globalThis.fetch
const originalNow = Date.now
const overdue = new Error("HTTP 403 Forbidden [AccountOverdueError]: overdue balance")

function completion(content: string) {
  return Response.json({
    choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  })
}

try {
  assert.equal(classifyAiCredentialFailure(overdue).failureClass, "billing")
  assert.equal(classifyAiCredentialFailure(overdue).scope, "credential")
  const credential = await saveAiCredential({
    vendor: "doubao", name: "Cost test", accountLabel: "Cost test",
    quotaGroup: "cost-test", baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    chatPath: "/chat/completions", apiKey: "test-pooled", enabled: false,
    allowedModels: ["doubao-test-pro", "doubao-test-lite", "doubao-test-writer"],
    allowedModules: ["article"], declaredCapabilities: ["chat", "json"],
  }, "cost-test")
  await updateAiCredentialHealth(credential.id, {
    status: "healthy", verifiedCapabilities: ["chat", "json"], consecutiveFailures: 0,
  })
  await setAiCredentialEnabled(credential.id, true, "cost-test")
  const writer: ResolvedArticleModel = {
    providerKey: "doubao", label: "test", baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    chatPath: "/chat/completions", apiKey: "old-key-must-not-bypass-pool",
    model: "doubao-test-lite", timeout: 1, authType: "bearer", protocol: "openai_chat",
  }
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    assert.equal(JSON.parse(String(init?.body)).model, writer.model)
    return new Response(JSON.stringify({ error: { code: "AccountOverdueError", message: "overdue balance" } }), { status: 403 })
  }
  const input = { system: "test", user: "test", label: "test", totalTimeoutMs: 1_000 }
  await assert.rejects(runArticleModelChat(writer, input), /403/)
  await assert.rejects(runArticleModelChat(writer, input), /暂无可用账号/)
  assert.equal(calls, 1, "cooldown must not switch to Pro or bypass the pool")
  assert.equal((await getAiCredentialRuntime(credential.id)).enabled, true)
  assert.equal((await runAiCredentialHealthSweep()).inspected, 0)
  Date.now = () => originalNow() + 61 * 60_000
  globalThis.fetch = async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, writer.model)
    assert.ok(body.max_tokens <= 64)
    return completion('{"ok":true}')
  }
  assert.equal((await runAiCredentialHealthSweep()).recovered, 1)
  Date.now = originalNow
  const recovered = await getAiCredentialRuntime(credential.id)
  assert.equal(recovered.healthStatus, "healthy")
  assert.equal(recovered.allowedModels[0], "doubao-test-pro", "probe cannot reorder model defaults")
  assert.equal((await runAiCredentialHealthSweep()).inspected, 0)
  // A failing independent capability must not reopen a healthy chat route.
  await recordAiCredentialFailure(recovered, new Error("HTTP 403 ToolNotOpen"), {
    module: "article", model: writer.model, requiredCapabilities: ["json"],
  })
  assert.equal((await runAiCredentialHealthSweep()).inspected, 0)
  assert.equal(calls, 2)
  assert.equal((await runAiCredentialHealthSweep({
    credentialId: credential.id, force: true, limit: 1,
  })).recovered, 1, "manual check must prioritize the broken route, not a healthy route")

  let usage: Parameters<NonNullable<import("../src/lib/llm/openai-compat").ChatArgs["onUsage"]>>[0] | undefined
  emitTokenUsage({ usage: {
    input_tokens: 100, output_tokens: 80, total_tokens: 180,
    input_tokens_details: { cached_tokens: 60 },
    output_tokens_details: { reasoning_tokens: 50 },
  } }, value => { usage = value })
  assert.deepEqual(usage, {
    promptTokens: 100, completionTokens: 80, totalTokens: 180,
    cachedPromptTokens: 60, reasoningTokens: 50,
  })
  assert.equal(addTokenUsage(usage, usage!).totalTokens, 360, "reasoning is already part of output usage")
  let webUsage = 0
  globalThis.fetch = async () => Response.json({
    id: "response-test", output_text: "回答已生成但缺少可审计信源",
    usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 },
  })
  await assert.rejects(chatDoubao({
    system: "", user: "测试问题", rawQuestionOnly: true, forceWebSearch: true,
    requireWebEvidence: true, onUsage: value => { webUsage += value.totalTokens },
  }), /未返回可审计网页来源/)
  assert.equal(webUsage, 180, "rejected web evidence must not discard upstream usage")

  const paragraph = "企业内容服务选择时应逐项核验交付资料、服务范围和验收清单。示例主体甲提供项目记录，客户应根据实际场景核对资料证据，并明确适用边界。"
  const good = "# 企业内容服务怎么选择？\n\n" + paragraph + "\n\n" +
    ["结论与适用范围", "判断依据和风险核验", "执行方法与步骤清单", "适用边界和注意事项"]
      .map(title => "## " + title + "\n\n" + paragraph.repeat(7)).join("\n\n")
  let scenario: "normal" | "local-fail" | "judge-fail" | "repair-fail" = "normal"
  const stages: string[] = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"))
    if (!body.model || !body.messages) return Response.json({ results: [] })
    const system = body.messages.find((message: { role: string }) => message.role === "system")?.content || ""
    if (body.model === "qwen-plus") {
      assert.equal(body.enable_thinking, false)
      stages.push("judge")
      assert.match(system, /质量裁判/)
      if (scenario === "judge-fail") return completion("invalid json")
      return completion(JSON.stringify({
        score: 90, passed: true, issues: [],
        dimensions: { questionAnswer: 90, evidenceGrounding: 90, articleTypeFit: 90, depth: 90, naturalness: 90, differentiation: 90 },
      }))
    }
    assert.equal(body.model, "doubao-test-writer")
    const repair = system.includes("质量校对器")
    stages.push(repair ? "repair" : "draft")
    if (repair && scenario === "repair-fail") return completion("")
    return completion(!repair && ["local-fail", "repair-fail"].includes(scenario)
      ? "# 企业内容服务怎么选择？\n示例主体甲的待复核草稿。"
      : good)
  }
  for (scenario of ["normal", "local-fail", "judge-fail", "repair-fail"] as const) {
    stages.length = 0
    const response = await POST(new NextRequest("http://localhost/api/article-generation", {
      method: "POST", headers: {
        "Content-Type": "application/json", ...createInternalApiHeaders("background-job"),
        [INTERNAL_API_USER_HEADER]: "cost-test",
      },
      body: JSON.stringify({
        promptKey: "selectionPitfallGuide", modelProvider: "doubao", model: "doubao-test-writer",
        brandName: "示例主体甲", clientName: "示例主体甲", industry: "企业内容服务",
        coreQuestion: "企业内容服务怎么选择？", region: "杭州",
        business: "企业内容服务与项目交付", advantages: "可提供项目交付资料供客户核验。",
      }),
    }))
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    assert.ok(result.article)
    assert.equal(result.model, "doubao-test-writer", "judge must never change writer identity")
    if (scenario === "normal" || scenario === "local-fail") assert.equal(result.qualityAudit.finalPassed, true)
    if (scenario === "normal") assert.deepEqual(stages, ["draft", "judge"])
    if (scenario === "local-fail") assert.deepEqual(stages, ["draft", "repair", "judge"])
    if (scenario === "judge-fail") {
      assert.deepEqual(stages, ["draft", "judge"])
      assert.equal(result.qualityAudit.finalPassed, false)
    }
    if (scenario === "repair-fail") {
      assert.equal(stages.filter(stage => stage === "judge").length, 0)
      assert.match(result.article, /待复核草稿/)
      assert.equal(result.qualityAudit.finalPassed, false)
    }
  }
  console.log("Cost controls: exact model, cooldown, auto recovery, usage and article pipeline passed")
} finally {
  globalThis.fetch = originalFetch
  Date.now = originalNow
  rmSync(dir, { recursive: true, force: true })
}
