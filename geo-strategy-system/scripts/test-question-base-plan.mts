import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as BasePlanModule from "../src/lib/geo-strategy/question-base-plan"

const require = createRequire(import.meta.url)
const { questionBasePlan } = require("../src/lib/geo-strategy/question-base-plan.ts") as typeof BasePlanModule

const client = { name: "浙江明康工程咨询有限公司", ourBrand: "", industry: "工程监理" }
const typed = {
  extractedProfile: null,
  projectName: "",
  industry: "",
  audience: "建设单位",
  productDesc: "工程监理",
  geoGoals: "",
  competitorsRaw: "江南管理\n求是监理",
  locationTerms: "杭州；浙江",
  painPointsRaw: "- 回款慢\n- 审批慢",
  coreAdvantages: "1. 综合资质",
}

// Without a profile, questions come from the client and what was typed in.
const basic = questionBasePlan(typed, client, "brand")
assert.equal(basic.profile.brand_or_product, "浙江明康工程咨询有限公司")
assert.equal(basic.profile.industry, "工程监理")
assert.deepEqual(basic.profile.competitors, ["江南管理", "求是监理"])
assert.deepEqual(basic.profile.terms, ["杭州", "浙江"])
assert.deepEqual(basic.profile.pain_points, ["回款慢", "审批慢"])
assert.deepEqual(basic.profile.advantages, ["综合资质"])
assert.deepEqual(basic.keyword_strategy.core_keywords, [])

// A confirmed profile wins, and switched-off items stay out.
const item = (text: string, enabled = true) => ({ id: text, text, enabled, confidence: "high" as const })
const fromProfile = questionBasePlan({
  ...typed,
  extractedProfile: {
    project_name: "明康咨询",
    industry: "工程咨询",
    audience: "项目团队",
    product_description: "监理与全过程咨询",
    pain_points: [item("管理费不透明"), item("已关闭的痛点", false)],
    advantages: [item("15 米级盾构")],
    weaknesses: [item("合作流程未公开")],
    competitors: [item("中恒通达")],
    scenes: [item("资质合作")],
    geo_goals: "浙江实力题进前 3",
    source_notes: "",
  },
}, client, "brand")
assert.equal(fromProfile.project_name, "明康咨询")
assert.equal(fromProfile.profile.industry, "工程咨询")
assert.deepEqual(fromProfile.profile.pain_points, ["管理费不透明"])
assert.deepEqual(fromProfile.profile.weaknesses, ["合作流程未公开"])
assert.equal(fromProfile.profile.business_goals, "浙江实力题进前 3")

console.log("question base plan: questions without a strategy report passed")
