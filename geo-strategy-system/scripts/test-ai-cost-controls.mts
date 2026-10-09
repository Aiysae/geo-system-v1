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

const { shouldFailOverAiCredential } = await import("../src/lib/ai-credential-errors")
assert.equal(shouldFailOverAiCredential(new Error("HTTP 400 invalid parameter")), false)
assert.equal(shouldFailOverAiCredential(new Error("HTTP 400 Bad Request")), false)
assert.equal(shouldFailOverAiCredential(new DOMException("cancelled", "AbortError")), false)
assert.equal(shouldFailOverAiCredential(new Error("HTTP 403 AccountOverdueError overdue balance")), true)
assert.equal(shouldFailOverAiCredential(new Error("HTTP 429 rate limit")), true)

const { classifyAiCredentialFailure } = await import("../src/lib/ai-credential-failure-classifier")
const notOpen = classifyAiCredentialFailure(new Error("HTTP 404 [ModelNotOpen]: model service not activated"))
assert.equal(notOpen.failureClass, "model_unavailable")
assert.equal(notOpen.actionRequired, true)
assert.equal(classifyAiCredentialFailure(new Error("HTTP 403 [ModelNotOpen]: model service not activated")).failureClass, "model_unavailable")
const { saveAiCredential, updateAiCredentialHealth, setAiCredentialEnabled, getAiCredentialRuntime } =
  await import("../src/lib/ai-credential-store")
const { runArticleModelChat, articleDoubaoThinkingMode } = await import("../src/lib/article-model-runtime")
// Doubao Seed thinking stays off unless explicitly enabled; unknown values fall back to off.
for (const [value, expected] of [[undefined, "disabled"], ["enabled", "enabled"], ["AUTO", "auto"], ["on", "disabled"]] as const) {
  if (value === undefined) delete process.env.ARTICLE_DOUBAO_THINKING
  else process.env.ARTICLE_DOUBAO_THINKING = value
  assert.equal(articleDoubaoThinkingMode(), expected)
}
delete process.env.ARTICLE_DOUBAO_THINKING
const { runAiCredentialHealthSweep } = await import("../src/lib/ai-credential-health-monitor")
const { recordAiCredentialFailure } = await import("../src/lib/ai-credential-router")
const { emitTokenUsage, openaiCompatChat } = await import("../src/lib/llm/openai-compat")
const { chatDoubao } = await import("../src/lib/llm/doubao")
const { addTokenUsage } = await import("../src/lib/ai-usage")
const { createInternalApiHeaders } = await import("../src/lib/internal-api")
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
  const stableSystem = "Keep the original template and evidence. ".repeat(150)
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    if (body.model === "raw-test") {
      assert.deepEqual(body.messages, [{ role: "user", content: "原始问题" }],
        "blind calls must not receive time or business instructions")
    } else {
      const system = body.messages[0].content as string
      if (body.model === "suffix-test") {
        assert.equal(system, stableSystem, "reusable prompt must precede the changing clock")
        assert.match(body.messages[1].content, /^unchanged input\n\n【当前北京时间】[^\n]+$/)
      } else {
        assert.match(system, /^【当前北京时间】/)
        assert.equal(body.messages[1].content, "unchanged input")
      }
    }
    return completion("ok")
  }
  for (const model of ["suffix-test", "legacy-test", "raw-test"]) {
    await openaiCompatChat({
      url: "https://example.com/chat/completions", apiKey: "test", model, label: "time-test",
      system: model === "raw-test" ? "" : stableSystem,
      user: model === "raw-test" ? "原始问题" : "unchanged input",
      rawQuestionOnly: model === "raw-test",
      timeContextPosition: model === "legacy-test" ? undefined : "end",
    })
  }
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
  await assert.rejects(runArticleModelChat(writer, input), /欠费或余额不足/)
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
  const missingSubject = good.replaceAll("示例主体甲", "其他主体")
  let scenario: "normal" | "local-fail" | "judge-fail" | "repair-fail" | "heading-only" | "repair-worse" | "repair-equal-worse" | "model-not-open" = "normal"
  const stages: string[] = []
  let sourcePlanningCalls = 0
  const searchedQueries: string[] = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body || "{}"))
    if (!body.model || !body.messages) {
      searchedQueries.push(decodeURIComponent(String(url)))
      return Response.json({ results: [] })
    }
    const system = body.messages.find((message: { role: string }) => message.role === "system")?.content || ""
    assert.ok(!system.startsWith("【当前北京时间】"), "article runtime must opt into stable-prefix layout")
    assert.match(body.messages.at(-1).content, /【当前北京时间】[^\n]+$/)
    if (body.model === "qwen-plus" && system.includes("检索助理")) {
      sourcePlanningCalls++
      return completion(JSON.stringify({ laws: ["中华人民共和国民法典"], standards: [] }))
    }
    if (body.model === "qwen-plus") {
      assert.equal(body.enable_thinking, false)
      stages.push("judge")
      assert.match(system, /质量裁判/)
      if (scenario === "judge-fail") return completion("invalid json")
      if (scenario === "repair-worse") return completion(JSON.stringify({
        score: 60, passed: false, issues: [{ code: "unsupported", message: "事实缺少依据", repairInstruction: "删除该断言", blocking: true }],
      }))
      return completion(JSON.stringify({
        score: 90, passed: true, issues: [],
        dimensions: { questionAnswer: 90, evidenceGrounding: 90, articleTypeFit: 90, depth: 90, naturalness: 90, differentiation: 90 },
      }))
    }
    assert.equal(body.model, "doubao-test-writer")
    assert.equal(body.thinking, undefined, "non-Seed Doubao models must not receive the thinking switch")
    const repair = system.includes("质量校对器")
    stages.push(repair ? "repair" : "draft")
    if (scenario === "model-not-open") return Response.json({ error: {
      code: "ModelNotOpen", message: "model service not activated",
    } }, { status: 404 })
    if (repair && scenario === "repair-fail") return completion("")
    if (repair && scenario === "repair-worse") return completion("仅返回了一个片段")
    if (repair && scenario === "repair-equal-worse") return completion(good + "\n\n{{品牌名}}")
    if (!repair && scenario === "heading-only") return completion(good.replace(/^# /, "## "))
    if (!repair && scenario === "repair-equal-worse") return completion(missingSubject)
    return completion(!repair && ["local-fail", "repair-fail"].includes(scenario)
      ? "# 企业内容服务怎么选择？\n示例主体甲的待复核草稿。"
      : good)
  }
  for (scenario of ["normal", "local-fail", "judge-fail", "repair-fail", "heading-only", "repair-worse", "repair-equal-worse", "model-not-open"] as const) {
    stages.length = 0
    const response = await POST(new NextRequest("http://localhost/api/article-generation", {
      method: "POST", headers: {
        "Content-Type": "application/json", ...createInternalApiHeaders("background-job", "cost-test"),
      },
      body: JSON.stringify({
        promptKey: "selectionPitfallGuide", modelProvider: "doubao", model: "doubao-test-writer",
        brandName: "示例主体甲", clientName: "示例主体甲", industry: "企业内容服务",
        coreQuestion: "企业内容服务怎么选择？", region: "杭州",
        business: "企业内容服务与项目交付", advantages: "可提供项目交付资料供客户核验。",
      }),
    }))
    const result = await response.json()
    if (scenario === "model-not-open") {
      assert.equal(response.status, 400)
      assert.match(result.error, /尚未开通/)
      assert.deepEqual(stages, ["draft"])
      continue
    }
    assert.equal(response.status, 200, JSON.stringify(result))
    assert.ok(result.article)
    assert.equal(result.model, "doubao-test-writer", "judge must never change writer identity")
    if (scenario === "normal" || scenario === "local-fail") assert.equal(result.qualityAudit.finalPassed, true)
    if (scenario === "heading-only") {
      assert.equal(result.article, good)
      assert.equal(result.qualityAudit.finalPassed, true)
      assert.deepEqual(stages, ["draft", "judge"], "format-only fix must not call a paid repair")
    }
    if (scenario === "repair-worse") {
      assert.equal(result.article, good, "a worse repair must not replace the original")
      assert.equal(result.qualityAudit.finalPassed, false, "factual concerns still block approval")
      assert.deepEqual(stages, ["draft", "judge", "repair"])
    }
    if (scenario === "repair-equal-worse") {
      assert.equal(result.article, missingSubject, "an equally blocked repair with a new defect must not replace the original")
      assert.equal(result.qualityAudit.finalPassed, false)
      assert.deepEqual(stages, ["draft", "repair"])
    }
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
  // One cheap planning call per new article; the named law is searched on government sites.
  assert.ok(sourcePlanningCalls > 0)
  assert.ok(searchedQueries.some(query => query.includes("中华人民共和国民法典 site:gov.cn")),
    "planned laws must become government-site searches")
  console.log("Cost controls: exact model, cooldown, auto recovery, usage and article pipeline passed")
} finally {
  globalThis.fetch = originalFetch
  Date.now = originalNow
  rmSync(dir, { recursive: true, force: true })
}
