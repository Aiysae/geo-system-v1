import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The strategy report's web research picks its Doubao model as question
// detection does: a web-verified flagship on an account that need not have
// the module ticked. The turbo model in the global setting answered it with
// empty text and no search five times in six. An empty answer is asked again.

const tempDir = mkdtempSync(join(tmpdir(), "geo-keyword-research-"))
delete process.env.DATABASE_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-keyword-research-encryption-key"

const TURBO = "doubao-seed-2-1-turbo-260628"
const PRO = "doubao-seed-2-1-pro-260628"
const asked: string[] = []
let emptyAnswersLeft = 0

const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = String(input)
  if (!url.endsWith("/api/v3/responses")) throw new Error(`unexpected request ${url}`)
  const body = JSON.parse(String(init?.body || "{}")) as { model: string }
  asked.push(body.model)
  const empty = body.model === TURBO || emptyAnswersLeft-- > 0
  const output = empty
    ? [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "" }] }]
    : [
        { type: "web_search_call", status: "completed" },
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{
            type: "output_text",
            text: JSON.stringify({ brief: "工程监理用户常问资质和业绩", user_language_patterns: ["监理公司哪家好"], decision_signals: ["资质"], regional_expressions: ["浙江"] }),
            annotations: [{ type: "url_citation", url: "https://example.com/jianli", title: "监理行业报道" }],
          }],
        },
      ]
  return new Response(JSON.stringify({ id: `resp-${asked.length}`, status: "completed", output }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

const { saveAiProviderSetting } = await import("../src/lib/ai-settings")
const { saveAiCredential, setAiCredentialEnabled, updateAiCredentialHealth } = await import("../src/lib/ai-credential-store")
const { researchKeywordStrategyContext } = await import("../src/lib/geo-strategy/keyword-strategy-research")

try {
  await saveAiProviderSetting("doubao", {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    chatPath: "/chat/completions",
    apiKey: "test-global-doubao-key",
    model: TURBO,
    timeout: 300,
    extra: {},
  }, "research-test")
  const credential = await saveAiCredential({
    vendor: "doubao",
    name: "豆包 1号",
    accountLabel: "1号",
    quotaGroup: "doubao-1",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    chatPath: "/chat/completions",
    apiKey: "test-pool-doubao-key",
    enabled: false,
    priority: 1,
    maxConcurrency: 2,
    quotaGroupMaxConcurrency: 2,
    allowedModels: [TURBO, PRO],
    // The strategy module is not ticked, as on the live accounts.
    allowedModules: ["article", "question", "research"],
    declaredCapabilities: ["chat", "json", "native_web", "auditable_sources"],
  }, "research-test")
  await updateAiCredentialHealth(credential.id, {
    status: "healthy",
    verifiedCapabilities: ["chat", "json", "native_web", "auditable_sources"],
    verifiedWebModels: [PRO],
    consecutiveFailures: 0,
  })
  await setAiCredentialEnabled(credential.id, true, "research-test")

  const input = {
    profile: { project_name: "浙江明康工程咨询有限公司", industry: "工程监理" },
    settings: { target_region: "浙江", language_style: "mainland_simplified", custom_language_style: "", custom_keywords: [] } as Parameters<typeof researchKeywordStrategyContext>[0]["settings"],
  }

  const audit = await researchKeywordStrategyContext(input)
  assert.deepEqual(asked, [PRO], "the web-verified flagship, not the global turbo model")
  assert.equal(audit.model, PRO, "the audit names the model that searched")
  assert.equal(audit.search_executed, true)
  assert.equal(audit.sources.length, 1)

  // An empty answer is asked once more.
  asked.length = 0
  emptyAnswersLeft = 1
  const retried = await researchKeywordStrategyContext(input)
  assert.deepEqual(asked, [PRO, PRO])
  assert.equal(retried.sources.length, 1)

  console.log("Keyword strategy web research: flagship model and one retry on an empty answer passed.")
} finally {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
}
