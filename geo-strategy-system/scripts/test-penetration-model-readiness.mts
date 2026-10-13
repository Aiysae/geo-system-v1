import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDir = mkdtempSync(join(tmpdir(), "geo-penetration-readiness-"))
delete process.env.DATABASE_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-penetration-readiness-key"
delete process.env.ARK_API_KEY
delete process.env.TENCENT_HUNYUAN_API_KEY

const { saveAiCredential, setAiCredentialEnabled, updateAiCredentialHealth, getAiCredentialRuntime } =
  await import("../src/lib/ai-credential-store")
const {
  buildAiCredentialRouteIdentity,
  listDueAiCredentialRouteProbes,
  recordAiCredentialRouteSuccess,
  recordAiCredentialRouteFailure,
} = await import("../src/lib/ai-credential-route-health")
const { classifyAiCredentialFailure } = await import("../src/lib/ai-credential-failure-classifier")
const { runAiCredentialHealthSweep } = await import("../src/lib/ai-credential-health-monitor")
const { getPenetrationModelReadiness } = await import("../src/lib/penetration/model-readiness")

const originalFetch = globalThis.fetch
try {
  // No account at all.
  assert.match((await getPenetrationModelReadiness("hunyuan")).reason || "", /后台没有已启用的腾讯元宝\/混元账号|后台没有已启用的.*混元账号/)

  // A Doubao account that writes articles (so it has chat routes) but whose
  // web verification was lost. The sweep used to skip it forever because any
  // existing route counted; it must now recheck web search and recover.
  const doubao = await saveAiCredential({
    vendor: "doubao", name: "豆包联网", accountLabel: "豆包联网", apiKey: "doubao-secret",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3", chatPath: "/chat/completions", enabled: false,
    allowedModels: ["doubao-seed-test"], allowedModules: [],
    declaredCapabilities: ["chat", "native_web", "auditable_sources"],
  }, "test")
  await updateAiCredentialHealth(doubao.id, { status: "healthy", verifiedCapabilities: ["chat"], verifiedWebModels: [] })
  await setAiCredentialEnabled(doubao.id, true, "test")
  await recordAiCredentialRouteSuccess(buildAiCredentialRouteIdentity(await getAiCredentialRuntime(doubao.id), {
    module: "article", model: "doubao-seed-test", requiredCapabilities: ["chat"],
  }), 100)
  assert.equal((await getPenetrationModelReadiness("doubao")).ready, false)
  assert.match((await getPenetrationModelReadiness("doubao")).reason || "", /尚未通过检测/)

  let webCalls = 0
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    assert.match(url, /\/responses$/, "the recheck must use Ark's official web search")
    const body = JSON.parse(String(init?.body || "{}"))
    assert.deepEqual(body.tools, [{ type: "web_search" }])
    webCalls++
    return Response.json({
      id: "resp_test_1",
      output: [
        { type: "web_search_call", status: "completed" },
        { type: "message", content: [{ type: "output_text", text: "今天是 2026 年 10 月 13 日。",
          annotations: [{ type: "url_citation", url: "https://www.gov.cn/test.htm", title: "中国政府网" }] }] },
      ],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    })
  }
  await runAiCredentialHealthSweep({ credentialId: doubao.id })
  assert.equal(webCalls, 1, "a lost web verification is rechecked automatically")
  assert.deepEqual((await getAiCredentialRuntime(doubao.id)).verifiedWebModels, ["doubao-seed-test"])
  assert.equal((await getPenetrationModelReadiness("doubao")).ready, true)

  // One model returning an empty web answer must not block the account's other
  // verified web model; previously the failure blocked the whole account.
  await setAiCredentialEnabled(doubao.id, false, "test")
  const twoModels = await saveAiCredential({
    vendor: "doubao", name: "豆包双型号", accountLabel: "豆包双型号", apiKey: "doubao-two-secret",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3", chatPath: "/chat/completions", enabled: false,
    allowedModels: ["doubao-lite-test", "doubao-pro-test"], allowedModules: ["penetration"],
    declaredCapabilities: ["chat", "native_web", "auditable_sources"],
  }, "test")
  await updateAiCredentialHealth(twoModels.id, {
    status: "healthy", verifiedCapabilities: ["chat", "native_web", "auditable_sources"],
    verifiedWebModels: ["doubao-lite-test", "doubao-pro-test"],
  })
  await setAiCredentialEnabled(twoModels.id, true, "test")
  const proRoute = buildAiCredentialRouteIdentity(await getAiCredentialRuntime(twoModels.id), {
    module: "penetration", model: "doubao-pro-test", requiredCapabilities: ["native_web", "auditable_sources"],
  })
  for (let attempt = 0; attempt < 3; attempt++) {
    await recordAiCredentialRouteFailure(proRoute, classifyAiCredentialFailure(new Error("豆包 Responses 联网返回空内容。")), true)
  }
  assert.equal((await getPenetrationModelReadiness("doubao")).ready, true,
    "an empty answer from one model leaves the other verified model available")

  // Stale routes of disabled accounts must not crowd probeable routes out of the queue.
  const disabled = await saveAiCredential({
    vendor: "deepseek", name: "停用", accountLabel: "停用", apiKey: "disabled-secret",
    baseUrl: "https://api.deepseek.com", chatPath: "/chat/completions", enabled: false,
    allowedModels: ["deepseek-chat"], allowedModules: [], declaredCapabilities: ["chat"],
  }, "test")
  const realNow = Date.now
  try {
    // These failures happened long ago, so they sort ahead of every live route.
    Date.now = () => realNow() - 30 * 24 * 60 * 60_000
    for (const routeModule of ["article", "research", "question", "difficulty"] as const) {
      await recordAiCredentialRouteFailure(buildAiCredentialRouteIdentity(await getAiCredentialRuntime(disabled.id), {
        module: routeModule, model: "deepseek-chat", requiredCapabilities: ["chat"],
      }), classifyAiCredentialFailure(new Error("HTTP 402 insufficient balance")), true)
    }
    Date.now = () => realNow() + 24 * 60 * 60_000
    const due = await listDueAiCredentialRouteProbes(1, [twoModels.id])
    assert.equal(due[0]?.credentialId, twoModels.id, "probeable routes are not starved by disabled accounts")
  } finally {
    Date.now = realNow
  }

  // Hunyuan: exhausted trial quota surfaces as an actionable billing reason.
  const hunyuan = await saveAiCredential({
    vendor: "hunyuan", name: "混元", accountLabel: "混元", apiKey: "hunyuan-secret",
    baseUrl: "https://tokenhub.tencentmaas.com", chatPath: "/v1/chat/completions", enabled: false,
    allowedModels: ["hy3"], allowedModules: ["penetration"],
    declaredCapabilities: ["chat", "native_web", "auditable_sources"],
  }, "test")
  await setAiCredentialEnabled(hunyuan.id, true, "test")
  await recordAiCredentialRouteFailure(buildAiCredentialRouteIdentity(await getAiCredentialRuntime(hunyuan.id), {
    module: "penetration", model: "hy3", requiredCapabilities: ["native_web", "auditable_sources"],
  }), classifyAiCredentialFailure(new Error(
    "HTTP 402：The free trial quota for the service has been exhausted and postpaid billing is not enabled",
  )), true)
  assert.match((await getPenetrationModelReadiness("hunyuan")).reason || "", /免费额度已用完/)

  // A wrong endpoint is a configuration problem for an admin, not a retry loop.
  const wrongEndpoint = classifyAiCredentialFailure(new Error("腾讯元宝/混元 严格联网需要切换到腾讯 TokenHub · HY3。"))
  assert.equal(wrongEndpoint.actionRequired, true)
  assert.equal(wrongEndpoint.retryable, false)

  // An account that never declared web search capability says so.
  const qwen = await saveAiCredential({
    vendor: "qwen", name: "千问", accountLabel: "千问", apiKey: "qwen-secret",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode", chatPath: "/v1/chat/completions", enabled: false,
    allowedModels: ["qwen-plus"], allowedModules: ["penetration"], declaredCapabilities: ["chat"],
  }, "test")
  await setAiCredentialEnabled(qwen.id, true, "test")
  assert.match((await getPenetrationModelReadiness("qwen")).reason || "", /未声明“官方联网”/)
} finally {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
}

console.log("penetration model readiness: automatic web recheck and actionable reasons passed")
