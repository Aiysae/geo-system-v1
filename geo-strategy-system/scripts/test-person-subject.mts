import assert from "node:assert/strict"
import type { PenetrationByModel } from "../src/types"

const { aggregatePenetration } = await import("../src/lib/score-utils")
const { scoreDifficultyV2 } = await import("../src/lib/difficulty/scoring-v2")
const {
  createSubjectResolver,
  isUsablePersonName,
  isSameSubject,
} = await import("../src/lib/subject-canonicalization")
const { normalizeClientPayload } = await import("../src/lib/workspace-sync")

const legacyClient = normalizeClientPayload({
  id: "legacy-client",
  name: "旧品牌客户",
  ourBrand: "旧品牌",
  brandAliases: [],
  industry: "",
  website: "",
  questions: [],
  competitors: [],
  selectedModels: ["qwen"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})
assert.equal(legacyClient.subjectType, "brand", "旧客户必须自动按品牌模式读取")

const resolver = createSubjectResolver({
  subjectType: "person",
  ourBrand: "张伟",
  brandAliases: ["张伟医生"],
  competitors: ["李明|李明主任医师"],
  observedBrands: ["张伟医生", "李明", "李明辉", "某医生"],
})

assert.equal(resolver.canonicalize("张伟医生")?.isTarget, true)
assert.equal(resolver.canonicalize("李明主任医师")?.display, "李明")
assert.notEqual(
  resolver.canonicalize("李明")?.key,
  resolver.canonicalize("李明辉")?.key,
  "姓名包含关系不能触发人物合并",
)
assert.equal(resolver.canonicalize("某医生"), null)
assert.equal(isSameSubject("李明医生", "李明", "person"), true)
assert.equal(isSameSubject("李明辉", "李明", "person"), false)
assert.equal(isUsablePersonName("协和医院"), false)
assert.equal(isUsablePersonName("杭州明德律师事务所"), false)

const byModel: PenetrationByModel = {
  qwen: [{
    question: "杭州有哪些值得推荐的心内科医生？",
    answer: "张伟医生、李明主任医师和李明辉医生均有公开介绍，张伟医生来自杭州市第一人民医院。",
    mentionedBrands: ["张伟医生", "李明", "李明辉"],
    mentionedEntities: [
      { name: "张伟", kind: "person", isPeer: true },
      { name: "李明", kind: "person", isPeer: true },
      { name: "李明辉", kind: "person", isPeer: true },
      { name: "杭州市第一人民医院", kind: "organization" },
    ],
    topRecommended: null,
    hitOur: false,
  }],
}

const aggregate = aggregatePenetration(
  byModel,
  "张伟",
  ["张伟医生"],
  ["李明|李明主任医师"],
  "person",
)
assert.equal(aggregate.penetrationRate, 1)
assert.equal(aggregate.ourRanking, 1)
assert.equal(aggregate.industryShare.length, 3)
assert.equal(aggregate.institutionShare?.[0]?.brand, "杭州市第一人民医院")

const difficulty = scoreDifficultyV2({
  industry: "心内科医疗服务",
  mode: "brand",
  subjectType: "person",
  scope: "city",
  region: "杭州",
  signals: {
    competitorBrands: ["李明", "李明医生", "李明辉", "协和医院", "某医生"],
    estimatedCompetitorCount: undefined,
  },
})
assert.equal(difficulty.competitorCount, 2)
assert.deepEqual(difficulty.canonicalCompetitors, ["李明", "李明辉"])
assert.match(difficulty.dimensions.dimension1.name, /同行.*人物/)

console.log("Personal IP subject normalization and aggregation contract passed")
