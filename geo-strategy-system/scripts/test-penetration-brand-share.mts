import assert from "node:assert/strict"
import type { PenetrationByModel, PenetrationItem } from "../src/types"

const { createBrandResolver, isBrandAbbreviation } = await import("../src/lib/brand-canonicalization")
const { aggregatePenetration } = await import("../src/lib/score-utils")
const { isUnfinishedSearchAnswer } = await import("../src/lib/llm/auditable-external-search")

// Abbreviations join the company they name.
assert.equal(isBrandAbbreviation("江南管理", "浙江江南工程管理"), true)
assert.equal(isBrandAbbreviation("中咨管理", "中咨工程管理咨询"), true)
// 建工 never appears unbroken in 上海建科工程, so these are two companies.
assert.equal(isBrandAbbreviation("上海建工", "上海建科工程咨询"), false)
// A generic head cannot anchor an abbreviation.
assert.equal(isBrandAbbreviation("工程管理", "浙江江南工程管理"), false)

function repeat(name: string, times: number): string[] {
  return Array.from({ length: times }, () => name)
}

const resolver = createBrandResolver({
  ourBrand: "浙江明康工程咨询有限公司",
  observedBrands: [
    ...repeat("上海建科工程咨询有限公司", 20),
    ...repeat("江苏建科工程咨询有限公司", 3),
    "建科工程",
    ...repeat("浙江江南工程管理股份有限公司", 15),
    "江苏江南工程管理咨询有限公司",
    ...repeat("江南管理", 4),
    ...repeat("中咨工程管理咨询有限公司", 10),
    ...repeat("中咨公路工程监理咨询有限公司", 6),
    "明康",
  ],
})
const display = (name: string) => resolver.canonicalize(name)?.display
assert.equal(display("江南管理"), "浙江江南工程管理股份有限公司", "an abbreviation joins the company the answers name most")
assert.equal(display("江苏江南工程管理咨询有限公司"), "江苏江南工程管理咨询有限公司")
assert.equal(display("建科工程"), "上海建科工程咨询有限公司")
assert.equal(
  display("江苏建科工程咨询有限公司"),
  "江苏建科工程咨询有限公司",
  "a fragment two companies share must not join them to each other",
)
assert.equal(display("中咨公路工程监理咨询有限公司"), "中咨公路工程监理咨询有限公司")
assert.equal(resolver.canonicalize("明康")?.isTarget, true, "variants of the user's brand still count as the brand")

function item(args: {
  model: string
  index: number
  answer: string
  brands: string[]
  extracted?: boolean
}): PenetrationItem {
  return {
    sampleId: `${args.model}-${args.index}`,
    sampledAt: "2026-10-21T00:00:00.000Z",
    question: `有哪些靠谱的监理公司？${args.index}`,
    answer: args.answer,
    mentionedBrands: args.brands,
    topRecommended: args.brands[0] || null,
    hitOur: false,
    extraction: args.extracted === false
      ? { status: "failed", attempts: 1, version: 2, error: "裁判批次执行超时" }
      : { status: "succeeded", attempts: 1, version: 2 },
  }
}

const byModel: PenetrationByModel = {
  doubao: [
    item({ model: "doubao", index: 1, answer: "推荐上海建科工程咨询有限公司和浙江江南工程管理股份有限公司。", brands: ["上海建科工程咨询有限公司", "浙江江南工程管理股份有限公司"] }),
    item({ model: "doubao", index: 2, answer: "推荐上海建科工程咨询有限公司。", brands: ["上海建科工程咨询有限公司"] }),
  ],
  hunyuan: [
    // The judge dropped a name it found elsewhere; the literal text restores it.
    item({ model: "hunyuan", index: 1, answer: "第一梯队：上海建科工程咨询有限公司、浙江江南工程管理股份有限公司。", brands: ["浙江江南工程管理股份有限公司"] }),
    // An answer the judge never read says nothing about competitors.
    item({ model: "hunyuan", index: 2, answer: "上海建科工程咨询有限公司实力很强。", brands: [], extracted: false }),
  ],
}
const aggregated = aggregatePenetration(byModel, "浙江明康工程咨询有限公司", [], [], "brand")
assert.equal(aggregated.totalSlots, 4)
assert.equal(aggregated.shareSlots, 3, "unread answers stay out of the competitor denominator")
const top = aggregated.industryShare[0]
assert.equal(top.brand, "上海建科工程咨询有限公司")
assert.equal(top.count, 3)
assert.equal(top.penetrationRate, 1)
assert.deepEqual(top.perModel?.hunyuan, { mentions: 1, total: 1 })
assert.deepEqual(top.perModel?.doubao, { mentions: 2, total: 2 })

// A turn that only announces more searching is not an answer.
assert.equal(isUnfinishedSearchAnswer("让我再搜索一些关于监理公司结算和回款的具体信息："), true)
assert.equal(isUnfinishedSearchAnswer(`${"候选公司说明。".repeat(60)}搜索4: 监理公司加盟 靠谱 推荐  搜索5: 监理综合甲级 民营企业`), true)
assert.equal(
  isUnfinishedSearchAnswer(`${"推荐上海建科工程咨询有限公司。".repeat(30)}需要我帮您搜索更多关于特定公司的详细信息吗？`),
  false,
  "a full answer that offers to search more is still an answer",
)

// The model may open only pages its own search returned, within budget.
{
  const { chatWithAuditableExternalSearch } = await import("../src/lib/llm/auditable-external-search")
  const modelBodies: Array<Record<string, unknown>> = []
  const originalFetch = globalThis.fetch
  let searches = 0
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>
    modelBodies.push(body)
    const round = modelBodies.length
    const message = round === 1
      ? { role: "assistant", content: "", tool_calls: [
          { id: "s1", type: "function", function: { name: "search_web", arguments: JSON.stringify({ query: "监理公司排名" }) } },
          { id: "s2", type: "function", function: { name: "search_web", arguments: JSON.stringify({ query: "监理公司 百强" }) } },
        ] }
      : round === 2
        ? { role: "assistant", content: "", tool_calls: [
            { id: "o1", type: "function", function: { name: "open_page", arguments: JSON.stringify({ url: "https://elsewhere.example.org/secret" }) } },
          ] }
        : { role: "assistant", content: "上海建科工程咨询有限公司、浙江江南工程管理股份有限公司实力较强。" }
    return new Response(JSON.stringify({
      id: `model-${round}`,
      choices: [{ finish_reason: message.tool_calls ? "tool_calls" : "stop", message }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  try {
    const answer = await chatWithAuditableExternalSearch({
      args: {
        system: "",
        user: "国内实力强的监理公司有哪些？",
        mode: "consumer",
        forceWebSearch: true,
        rawQuestionOnly: true,
        requireWebEvidence: true,
        officialWebOnly: true,
      },
      endpoint: "https://api.deepseek.com/chat/completions",
      apiKey: "test-key",
      model: "deepseek-chat",
      label: "DeepSeek",
      modelProvider: "deepseek",
      requestTimeoutSec: 30,
      maxSearches: 4,
      pageReads: 5,
      search: {
        provider: "moonshot_search",
        run: async query => {
          searches += 1
          return {
            query,
            requestId: `search-${searches}`,
            sources: [{ title: "监理排名", snippet: "榜单", url: "https://example.com/rank", domain: "example.com", query }],
          }
        },
      },
    })
    assert.match(answer, /上海建科/)
    assert.equal(searches, 2, "two different queries in one turn both run")
    const toolNames = (modelBodies[0].tools as Array<{ function: { name: string } }>).map(tool => tool.function.name)
    assert.deepEqual(toolNames, ["search_web", "open_page"])
    const refusal = (modelBodies[2].messages as Array<{ role: string; content: string }>).find(message => message.role === "tool" && message.content.includes("只能打开"))
    assert.ok(refusal, "a page the search never returned is refused")
  } finally {
    globalThis.fetch = originalFetch
  }
}

console.log("Penetration brand merging, share denominator and stalled-search contracts passed.")
