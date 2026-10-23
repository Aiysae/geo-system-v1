import assert from "node:assert/strict"
import type { ModelKey, PenetrationItem } from "../src/types"

// Each question gets its own rate and ranking, counted by the same rules as
// the overall list, and brands with the same count share a rank.

const { aggregatePenetration } = await import("../src/lib/score-utils")

let serial = 0
function answer(model: ModelKey, question: string, brands: string[], hitOur: boolean): PenetrationItem {
  serial += 1
  return {
    sampleId: `q_${model}_${serial}`,
    question,
    answer: `推荐${brands.join("、")}${hitOur ? "、测试品牌" : ""}。`,
    mentionedBrands: hitOur ? [...brands, "测试品牌"] : brands,
    topRecommended: brands[0] ?? null,
    searchSources: [],
    extraction: { status: "succeeded", attempts: 1, version: 2 },
    hitOur,
  }
}

const strong = "哪家公司实力强？"
const missed = "哪家公司做资质合作？"
const many = Array.from({ length: 24 }, (_, index) => `长尾${String(index + 1).padStart(2, "0")}`)
const result = aggregatePenetration({
  kimi: [
    answer("kimi", strong, ["华岳工程咨询有限公司", "恒信项目管理有限公司"], true),
    answer("kimi", missed, ["中达建设监理有限公司"], false),
  ],
  qwen: [
    answer("qwen", strong, ["华岳工程咨询有限公司"], true),
    answer("qwen", missed, ["中达建设监理有限公司", "华岳工程咨询有限公司"], false),
    // A crowded answer: we rank far down but stay listed.
    answer("qwen", "长尾问题？", [...many, ...many.slice(0, 22)], true),
  ],
}, "测试品牌")

const stats = result.questionStats!
assert.deepEqual(stats.map(stat => stat.question), [strong, missed, "长尾问题？"], "questions in the order asked")
assert.equal(stats.reduce((sum, stat) => sum + stat.answers, 0), result.totalSlots, "question answers add up to the total")
assert.equal(stats.reduce((sum, stat) => sum + stat.ourMentions, 0), result.ourMentions)

const [first, second] = stats
assert.equal(first.ourRate, 1)
// 甲 and we each appear in 2 of 2 answers: a shared first place.
assert.equal(first.ourRanking, 1)
assert.deepEqual(first.brands.map(brand => [brand.brand, brand.rank, brand.isTarget === true]), [
  ["测试品牌", 1, true],
  ["华岳工程咨询有限公司", 1, false],
  ["恒信项目管理有限公司", 3, false],
])
assert.deepEqual(first.perModel.map(item => [item.model, item.mentions, item.total]), [["kimi", 1, 1], ["qwen", 1, 1]])

assert.equal(second.ourRate, 0)
assert.equal(second.ourRanking, null)
assert.ok(!second.brands.some(brand => brand.isTarget), "a question that never names us does not list us")
assert.deepEqual(second.brands.map(brand => [brand.brand, brand.rank, brand.penetrationRate]), [["中达建设监理有限公司", 1, 1], ["华岳工程咨询有限公司", 2, 0.5]])

const crowded = stats[2]
assert.equal(crowded.brandCount, 25)
assert.ok(crowded.brands.length <= 21, "the leaders, plus us")
assert.ok(crowded.brands.some(brand => brand.isTarget), "ours is kept wherever it ranks")

// The overall ranking shares ties too: 华岳 and we are each in 3 answers,
// so we share first place rather than coming second.
assert.equal(result.industryShare[0].count, 3)
assert.equal(result.ourRanking, 1)

console.log("Penetration per-question rates, rankings and shared ranks passed.")
