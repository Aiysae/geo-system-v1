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

console.log("Penetration brand merging, share denominator and stalled-search contracts passed.")
