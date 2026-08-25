import assert from "node:assert/strict"

const contractModule = await import("../src/lib/publishing-plan/recommendation-contract") as
  typeof import("../src/lib/publishing-plan/recommendation-contract") & {
    default?: typeof import("../src/lib/publishing-plan/recommendation-contract")
  }
const {
  getMissingPublishingPlatformKeys,
  parsePublishingPlatformRecommendations,
} = contractModule.default || contractModule

const allowed = ["sohu", "zhihu", "wechat"]

const strict = parsePublishingPlatformRecommendations(JSON.stringify({
  platforms: [
    {
      platform_key: "sohu",
      industry_fit: 82,
      stage_value: 76,
      recommended: true,
      reason: "行业问答内容与平台用户决策场景匹配。",
    },
  ],
}), allowed)
assert.equal(strict[0]?.platform_key, "sohu")
assert.equal(strict[0]?.industry_fit, 82)

const fenced = parsePublishingPlatformRecommendations(`
分析完成，结果如下：
\`\`\`json
{"platforms":[{"platform_key":"zhihu","industry_fit":"91","stage_value":88,"recommended":true,"reason":"适合承接长决策问题。"}]}
\`\`\`
`, allowed)
assert.equal(fenced[0]?.platform_key, "zhihu")
assert.equal(fenced[0]?.industry_fit, 91)

const array = parsePublishingPlatformRecommendations(JSON.stringify([
  {
    platform_key: "wechat",
    industry_fit: 74,
    stage_value: 68,
    recommended: "true",
    reason: "适合私域承接。",
  },
]), allowed)
assert.equal(array[0]?.recommended, true)

const aliases = parsePublishingPlatformRecommendations(JSON.stringify({
  platforms: [{
    platformKey: "SOHU",
    industryFit: "86%",
    stageScore: "79",
    isRecommended: "是",
    rationale: "字段别名也应被稳定解析。",
  }],
}), allowed)
assert.equal(aliases[0]?.platform_key, "sohu")
assert.equal(aliases[0]?.industry_fit, 86)
assert.equal(aliases[0]?.recommended, true)

const filtered = parsePublishingPlatformRecommendations(JSON.stringify({
  platforms: [
    { platform_key: "unknown", industry_fit: 100, stage_value: 100, recommended: true, reason: "不在候选列表。" },
    { platform_key: "sohu", industry_fit: 70, stage_value: 65, recommended: true, reason: "保留信息更完整的推荐依据。" },
    { platform_key: "sohu", industry_fit: 10, stage_value: 10, recommended: false, reason: "短" },
  ],
}), allowed)
assert.equal(filtered.length, 1)
assert.equal(filtered[0]?.reason, "保留信息更完整的推荐依据。")
assert.deepEqual(getMissingPublishingPlatformKeys(filtered, allowed), ["zhihu", "wechat"])

assert.throws(
  () => parsePublishingPlatformRecommendations("这是一段没有结构化数据的普通说明。", allowed),
  /没有返回可解析的平台建议/,
)

assert.throws(
  () => parsePublishingPlatformRecommendations('{"platforms":[]}', allowed),
  /没有返回有效的候选平台/,
)

const aiModule = await import("../src/lib/publishing-plan/recommendation-ai") as
  typeof import("../src/lib/publishing-plan/recommendation-ai") & {
    default?: typeof import("../src/lib/publishing-plan/recommendation-ai")
  }
const { recommendPublishingPlatformsWithAi } = aiModule.default || aiModule
const calls: Array<{ model: string; module: string; args: Record<string, unknown> }> = []
let callIndex = 0
const aiResult = await recommendPublishingPlatformsWithAi({
  clientId: "client-contract-test",
  clientName: "测试客户",
  subject: "测试品牌",
  industry: "企业服务",
  website: "https://example.com",
  customerStage: "new_launch",
  candidates: [{
    platformKey: "sohu",
    platformName: "搜狐",
    category: "self_media",
    citationShare: 35,
    adoptionRate: 28,
    modelCoverage: 3,
    questionCoverage: 5,
    strategyRole: "建立行业问答覆盖",
    strategyCadence: "每周",
  }],
}, {
  chat: async (model, module, args) => {
    calls.push({ model, module, args: args as unknown as Record<string, unknown> })
    callIndex += 1
    if (callIndex === 1) {
      args.onSearchSources?.({
        query: "测试",
        mode: "native_web",
        searchExecuted: true,
        providerRequestId: "resp-test",
        sources: [{
          title: "行业资料",
          snippet: "搜狐适合承接企业服务问答内容。",
          url: "https://www.sohu.com/a/test",
          domain: "sohu.com",
          query: "测试",
        }],
      })
      return "联网证据表明搜狐具有行业内容承接价值。"
    }
    if (callIndex === 2) return "评估完成，但本次返回了普通文字。"
    return JSON.stringify({
      platforms: [{
        platform_key: "sohu",
        industry_fit: 88,
        stage_value: 79,
        recommended: true,
        reason: "适合承接新客户阶段的行业问答。",
      }],
    })
  },
  configured: async model => model === "doubao",
  runtimeSetting: async () => ({ model: "doubao-test" }),
})

assert.equal(aiResult.mode, "ai_repaired")
assert.equal(aiResult.rows[0]?.platform_key, "sohu")
assert.equal(aiResult.webEvidenceUsed, true)
assert.equal(aiResult.webSourceCount, 1)
assert.deepEqual(aiResult.missingPlatformKeys, [])
assert.equal(calls.length, 3)
assert.equal(calls[0]?.module, "research")
assert.equal(calls[0]?.args.forceWebSearch, true)
assert.equal(calls[0]?.args.jsonMode, false)
assert.equal(calls[1]?.module, "judge")
assert.equal(calls[1]?.args.allowWebSearch, false)
assert.equal(calls[1]?.args.forceWebSearch, undefined)
assert.equal(calls[2]?.module, "judge")

const cachedResult = await recommendPublishingPlatformsWithAi({
  clientId: "client-contract-test",
  clientName: "测试客户",
  subject: "测试品牌",
  industry: "企业服务",
  website: "https://example.com",
  customerStage: "new_launch",
  candidates: [{
    platformKey: "sohu",
    platformName: "搜狐",
    category: "self_media",
    citationShare: 35,
    adoptionRate: 28,
    modelCoverage: 3,
    questionCoverage: 5,
    strategyRole: "建立行业问答覆盖",
    strategyCadence: "每周",
  }],
}, {
  chat: async () => { throw new Error("命中缓存时不应再调用模型") },
  configured: async model => model === "doubao",
  runtimeSetting: async () => ({ model: "unused" }),
})
assert.equal(cachedResult.cacheHit, true)
assert.equal(calls.length, 3)

let fallbackCall = 0
const qwenFallback = await recommendPublishingPlatformsWithAi({
  clientId: "client-qwen-fallback-test",
  clientName: "备用通道客户",
  subject: "备用通道品牌",
  industry: "企业服务",
  website: "https://example.org",
  customerStage: "maintenance",
  candidates: [{
    platformKey: "zhihu",
    platformName: "知乎",
    category: "self_media",
    citationShare: 20,
    adoptionRate: 18,
    modelCoverage: 2,
    questionCoverage: 3,
    strategyRole: "专业问答",
    strategyCadence: "每周",
  }],
}, {
  chat: async (model, module) => {
    fallbackCall += 1
    if (module === "research") throw new Error("联网通道暂时繁忙")
    if (model === "doubao") throw new Error("豆包结构化通道暂时繁忙")
    return JSON.stringify({
      platforms: [{
        platform_key: "zhihu",
        industry_fit: 80,
        stage_value: 72,
        recommended: true,
        reason: "适合专业问答内容。",
      }],
    })
  },
  configured: async model => model === "doubao" || model === "qwen",
  runtimeSetting: async provider => ({ model: `${provider}-test` }),
})
assert.equal(qwenFallback.provider, "qwen")
assert.equal(qwenFallback.mode, "ai_repaired")
assert.equal(qwenFallback.webEvidenceUsed, false)
assert.ok(qwenFallback.notes.some(note => note.includes("现有报告")))
assert.equal(fallbackCall, 3)

let partialCalls = 0
const partialResult = await recommendPublishingPlatformsWithAi({
  clientId: "client-partial-coverage-test",
  clientName: "部分覆盖客户",
  subject: "测试品牌",
  industry: "企业服务",
  website: "https://partial.example.com",
  customerStage: "new_launch",
  candidates: [
    {
      platformKey: "sohu",
      platformName: "搜狐",
      category: "self_media",
      citationShare: 30,
      adoptionRate: 24,
      modelCoverage: 3,
      questionCoverage: 4,
      strategyRole: "行业内容",
      strategyCadence: "每周",
    },
    {
      platformKey: "zhihu",
      platformName: "知乎",
      category: "self_media",
      citationShare: 18,
      adoptionRate: 15,
      modelCoverage: 2,
      questionCoverage: 3,
      strategyRole: "问答内容",
      strategyCadence: "每周",
    },
  ],
}, {
  chat: async (_model, module) => {
    partialCalls += 1
    assert.equal(module, "judge")
    return JSON.stringify({
      platforms: [{
        platform_key: "sohu",
        industry_fit: 84,
        stage_value: 77,
        recommended: true,
        reason: "搜狐适合当前阶段。",
      }],
    })
  },
  configured: async (model, module) => model === "doubao" && module === "judge",
  runtimeSetting: async () => ({ model: "doubao-partial-test" }),
})
assert.equal(partialCalls, 1)
assert.equal(partialResult.mode, "ai_repaired")
assert.deepEqual(partialResult.missingPlatformKeys, ["zhihu"])

let unavailableCalls = 0
await assert.rejects(
  () => recommendPublishingPlatformsWithAi({
    clientId: "client-no-provider-test",
    clientName: "无通道客户",
    subject: "测试品牌",
    industry: "企业服务",
    website: "",
    customerStage: "maintenance",
    candidates: [{
      platformKey: "wechat",
      platformName: "微信公众号",
      category: "self_media",
      citationShare: 0,
      adoptionRate: 0,
      modelCoverage: 0,
      questionCoverage: 0,
      strategyRole: "",
      strategyCadence: "",
    }],
  }, {
    chat: async () => {
      unavailableCalls += 1
      throw new Error("不应调用")
    },
    configured: async () => false,
    runtimeSetting: async () => ({ model: "unused" }),
  }),
  /平台建议模型当前不可用/,
)
assert.equal(unavailableCalls, 0)

const recommendationModule = await import("../src/lib/publishing-plan/recommendation") as
  typeof import("../src/lib/publishing-plan/recommendation") & {
    default?: typeof import("../src/lib/publishing-plan/recommendation")
  }
const { recommendPublishingPlanPlatforms } = recommendationModule.default || recommendationModule
const evidenceOnly = await recommendPublishingPlanPlatforms({
  client: {
    id: "client-evidence-only-test",
    name: "证据兜底客户",
    subjectType: "brand",
    ourBrand: "测试品牌",
    industry: "企业服务",
    website: "",
    questions: [],
    competitors: [],
    selectedModels: [],
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  },
  customerStage: "new_launch",
  useAi: false,
})
assert.equal(evidenceOnly.usedFallback, true)
assert.equal(evidenceOnly.recommendationMode, "evidence_only")
assert.equal(evidenceOnly.platformConfigs.length, 4)
assert.equal(evidenceOnly.evidenceFilledPlatformCount, 4)
assert.equal(
  evidenceOnly.platformConfigs.reduce((sum, platform) => sum + platform.weightBps, 0),
  10_000,
)

console.log("Publishing recommendation contract, coverage, routing, and recovery passed")
