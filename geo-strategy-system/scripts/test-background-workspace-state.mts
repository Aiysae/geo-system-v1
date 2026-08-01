import assert from "node:assert/strict"
import type { BackgroundJobRecord, Client } from "../src/types"

const imported = await import("../src/lib/background-job-workspace-state") as {
  default?: typeof import("../src/lib/background-job-workspace-state")
} & typeof import("../src/lib/background-job-workspace-state")
const workspace = imported.default || imported

const client = {
  id: "client-1",
  name: "\u5ba2\u6237 A",
  subjectType: "brand",
  ourBrand: "\u54c1\u724c A",
  industry: "\u6d4b\u8bd5",
  website: "https://example.com",
  questions: [],
  competitors: [],
  selectedModels: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  backgroundJobs: {
    research: { requestId: "request-research-1", jobId: "job-research-1" },
  },
} as unknown as Client

const researchJob = {
  id: "job-research-1",
  kind: "research",
  clientId: client.id,
  requestId: "request-research-1",
  status: "succeeded",
  progressPercent: 100,
  stage: "\u5b8c\u6210",
  result: {
    mode: "ai",
    executiveSummary: "\u7ed3\u679c",
    brandImage: "",
    modelMentality: "",
    dimensions: [],
    audiencePerception: [],
    trustSignals: [],
    evidenceGaps: [],
    risks: [],
    opportunities: [],
    recommendations: [],
    generatedAt: "2026-08-01T00:01:00.000Z",
  },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:01:00.000Z",
} as BackgroundJobRecord

const applied = workspace.applyBackgroundJobToClient(client, researchJob, "succeeded")
assert.equal(applied?.research?.executiveSummary, "\u7ed3\u679c")
assert.equal(applied?.backgroundJobs?.research, undefined)

assert.equal(
  workspace.applyBackgroundJobToClient({
    ...client,
    backgroundJobs: { research: { requestId: "newer-request", jobId: "newer-job" } },
  }, researchJob, "succeeded"),
  null,
)

const withoutActiveRef = workspace.applyBackgroundJobToClient({
  ...client,
  backgroundJobs: {},
}, researchJob, "succeeded")
assert.equal(withoutActiveRef?.research?.executiveSummary, "\u7ed3\u679c")
assert.equal(withoutActiveRef?.backgroundResultJobs?.research?.jobId, "job-research-1")

assert.equal(workspace.applyBackgroundJobToClient({
  ...client,
  backgroundJobs: {},
  backgroundResultJobs: {
    research: {
      jobId: "newer-job",
      requestId: "newer-request",
      status: "succeeded",
      createdAt: "2026-08-01T00:02:00.000Z",
      completedAt: "2026-08-01T00:03:00.000Z",
    },
  },
}, researchJob, "succeeded"), null)

console.log("background workspace state tests passed")
