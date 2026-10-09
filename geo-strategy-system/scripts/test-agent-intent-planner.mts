import assert from "node:assert/strict"

const { planAgentRequest } = await import("../src/lib/agent/intent-planner")

const clients = [
  {
    id: "client-xuanyi",
    name: "玄易 APP",
    ourBrand: "玄易",
    aliases: ["玄易命理"],
    subjectType: "brand" as const,
    teamId: "team-a",
  },
  {
    id: "client-doctor",
    name: "张医生个人 IP",
    ourBrand: "张医生",
    aliases: ["张大夫"],
    subjectType: "person" as const,
  },
]

const penetration = planAgentRequest({
  request: "帮我看看玄易现在在各个 AI 里面有没有被推荐，结果要能联网核验",
  clients,
})
assert.equal(penetration.primaryWorkflow.key, "penetration_check")
assert.equal(penetration.primaryWorkflow.actions[0], "penetration.run")
assert.equal(penetration.clientResolution.status, "resolved")
assert.equal(penetration.clientResolution.clientId, "client-xuanyi")
assert.equal(penetration.executionPolicy.mustDryRunFirst, true)

const diagnosis = planAgentRequest({
  request: "这个官网为什么不容易被 AI 看懂，顺便检查 H1、robots 和 llms.txt",
  clients,
})
assert.equal(diagnosis.primaryWorkflow.key, "website_diagnosis")
assert.deepEqual(diagnosis.primaryWorkflow.actions, ["diagnosis.run"])

const publishing = planAgentRequest({
  request: "按这个客户今天的发文配额生成文章，搜狐和知乎分别打包",
  clients,
})
assert.equal(publishing.primaryWorkflow.key, "daily_content_production")
assert.deepEqual(publishing.primaryWorkflow.actions, [
  "publishing.plan.get",
  "publishing.tasks.list",
  "article.production.run",
  "article.production.get",
])

const feedback = planAgentRequest({
  request: "把最近一个月做过的事情整理成客户能打开的月报链接",
  clients,
})
assert.equal(feedback.primaryWorkflow.key, "feedback_report")
assert.ok(feedback.primaryWorkflow.actions.includes("feedback.report.create"))

const ambiguousClient = planAgentRequest({
  request: "给客户做一次渗透率检测",
  clients,
})
assert.equal(ambiguousClient.clientResolution.status, "needs_clarification")
assert.ok(ambiguousClient.clarificationQuestions.length > 0)

const destructive = planAgentRequest({
  request: "把玄易的发布规划草稿删除掉",
  clients,
})
assert.equal(destructive.primaryWorkflow.key, "publishing_plan_delete")
assert.equal(destructive.executionPolicy.requiresConfirmation, true)

console.log("Agent fuzzy-intent planning and client resolution tests passed.")
