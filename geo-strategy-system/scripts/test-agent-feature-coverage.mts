import assert from "node:assert/strict"
import fs from "node:fs/promises"

const { AGENT_ACTIONS } = await import("../src/lib/agent/action-catalog")
const { AGENT_SCOPE_PRESETS } = await import("../src/lib/agent/scopes")

const requiredByWorkflow = {
  penetration: [
    "penetration.run",
    "penetration.questions.generate",
    "penetration.brands.reanalyze",
    "penetration.automation.get",
    "penetration.automation.save",
    "penetration.automation.run",
    "penetration.automation.cancel",
  ],
  research: ["research.run", "research.compare"],
  diagnosis: ["diagnosis.run"],
  difficulty: ["difficulty.run"],
  keyword: [
    "keyword.extract",
    "keyword.advantages",
    "keyword.strategy.run",
    "keyword.questions.run",
    "publishing.plan.get",
    "publishing.plan.create",
    "publishing.plan.activate",
    "publishing.plan.delete",
  ],
  article: [
    "article.generate",
    "article.rewrite",
    "article.batch.run",
    "article.batch.delete",
    "article.strategy.plan",
    "article.media.upload",
    "article.media.run",
    "article.production.run",
    "article.production.get",
    "article.production.cancel",
  ],
  feedback: [
    "feedback.action.create",
    "feedback.action.delete",
    "feedback.actions.import",
    "feedback.report.create",
    "feedback.report.manage",
    "feedback.visibility.update",
    "feedback.automation.save",
    "feedback.automation.run",
  ],
  knowledge: ["knowledge.import", "knowledge.commit"],
  report: ["report.create"],
} as const

const names = new Set(AGENT_ACTIONS.map(action => action.name))
for (const [workflow, expected] of Object.entries(requiredByWorkflow)) {
  for (const action of expected) {
    assert.ok(names.has(action), `${workflow} workflow is missing Agent action ${action}`)
  }
}

const active = AGENT_ACTIONS.filter(action => !action.deprecated)
assert.ok(active.every(action => action.mcpTool), "Every active Agent action must have an MCP tool")
assert.equal(
  new Set(active.map(action => action.mcpTool)).size,
  active.length,
  "MCP tool names must remain unique",
)
assert.ok(AGENT_SCOPE_PRESETS.full.includes("article.manage"))
assert.ok(!AGENT_SCOPE_PRESETS.operator.includes("article.manage"))

for (const prefix of ["admin.", "payment.", "recharge.", "credential.", "account.password"]) {
  assert.ok(
    !AGENT_ACTIONS.some(action => action.name.startsWith(prefix)),
    `${prefix} actions must remain human-only`,
  )
}

for (const destructive of [
  "article.batch.delete",
  "feedback.action.delete",
  "publishing.plan.delete",
]) {
  assert.equal(
    AGENT_ACTIONS.find(action => action.name === destructive)?.destructive,
    true,
    `${destructive} must be marked destructive`,
  )
}

const cli = await fs.readFile("cli/shitu-geo.mjs", "utf8")
for (const shortcut of [
  "articles:batch-delete",
  "feedback:action-delete",
  "feedback:automation-save",
  "publishing:plan-delete",
  "publishing:task-complete",
]) {
  assert.match(cli, new RegExp(shortcut.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
}

console.log(`Agent feature coverage passed for ${AGENT_ACTIONS.length} actions.`)
