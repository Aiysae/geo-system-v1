import assert from "node:assert/strict"

const imported = await import("../src/lib/workspace-draft") as {
  default?: typeof import("../src/lib/workspace-draft")
} & typeof import("../src/lib/workspace-draft")
const draft = imported.default || imported

const merged = draft.mergeWorkspaceDraftPatches(
  { questions: ["A"], industry: "\u65e7\u884c\u4e1a" },
  { industry: "\u65b0\u884c\u4e1a", website: "https://example.com" },
)
assert.deepEqual(merged, {
  questions: ["A"],
  industry: "\u65b0\u884c\u4e1a",
  website: "https://example.com",
})

const newerLocalEdit = draft.removeAcknowledgedWorkspaceDraftFields(
  { questions: ["B"], industry: "\u65b0\u884c\u4e1a" },
  { questions: ["A"], industry: "\u65b0\u884c\u4e1a" },
)
assert.deepEqual(newerLocalEdit, { questions: ["B"] })

console.log("workspace draft tests passed")
