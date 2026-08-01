import assert from "node:assert/strict"
const navigationModule = await import("../src/lib/workspace-navigation") as typeof import("../src/lib/workspace-navigation") & {
  default?: typeof import("../src/lib/workspace-navigation")
}
const {
  buildWorkspaceResultUrl,
  parseWorkspaceNavigation,
  resolveInitialWorkspaceModule,
} = navigationModule.default || navigationModule

const keywordResultUrl = buildWorkspaceResultUrl({
  clientId: "client A",
  teamId: "team/1",
  module: "keyword",
  view: "questions",
  jobId: "qjob:latest",
})

assert.equal(
  keywordResultUrl,
  "/workspace?clientId=client+A&teamId=team%2F1&module=keyword&view=questions&jobId=qjob%3Alatest",
)

assert.deepEqual(
  parseWorkspaceNavigation(keywordResultUrl),
  {
    clientId: "client A",
    teamId: "team/1",
    module: "keyword",
    view: "questions",
    jobId: "qjob:latest",
  },
)

assert.equal(
  resolveInitialWorkspaceModule("keyword", module => module !== "article", "penetration"),
  "keyword",
)
assert.equal(
  resolveInitialWorkspaceModule("article", module => module !== "article", "penetration"),
  "penetration",
)
assert.equal(
  resolveInitialWorkspaceModule("unknown", () => true, "research"),
  "research",
)

console.log("workspace navigation tests passed")
