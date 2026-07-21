import fs from "fs/promises"
import os from "os"
import path from "path"
import assert from "node:assert/strict"
import type { Client } from "../src/types"

const testFile = path.join(os.tmpdir(), `geo-workspace-sync-${process.pid}.json`)
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE = testFile

const {
  WorkspaceConflictError,
  createWorkspaceClient,
  importLegacyWorkspaceClients,
  listWorkspaceClients,
  mutateWorkspaceClientLatest,
  patchWorkspaceClient,
} = await import("../src/lib/workspace-store")

const now = new Date().toISOString()
const client: Client = {
  id: "workspace-test-client",
  name: "同步测试客户",
  subjectType: "brand",
  ourBrand: "原品牌",
  brandAliases: [],
  industry: "测试行业",
  website: "",
  questions: ["采购这类服务需要多少预算？"],
  questionGenerationSettings: {
    count: 10,
    keywords: "预算",
    allocationMode: "custom",
    categories: ["purchase_decision"],
    categoryCounts: { purchase_decision: 10 },
  },
  questionIntentHints: [{
    question: "采购这类服务需要多少预算？",
    category: "purchase_decision",
  }],
  competitors: [],
  selectedModels: ["qwen"],
  createdAt: now,
  updatedAt: now,
}

try {
  const created = await createWorkspaceClient("user-a", client)
  assert.equal(created.versions.core, 1)
  assert.equal(created.client.questionGenerationSettings?.count, 10)
  assert.equal(created.client.questionIntentHints?.[0]?.category, "purchase_decision")
  assert.equal((await listWorkspaceClients("user-b")).length, 0, "accounts must be isolated")

  const coreUpdated = await patchWorkspaceClient({
    userId: "user-a",
    clientId: client.id,
    patch: { ourBrand: "设备 A 品牌" },
    unsetFields: [],
    expectedVersions: created.versions,
  })
  assert.equal(coreUpdated?.versions.core, 2)

  const articleUpdated = await patchWorkspaceClient({
    userId: "user-a",
    clientId: client.id,
    patch: {
      articleGeneration: {
        promptKey: "thirdPartyObservation",
        modelProvider: "article",
        model: "",
        sourceUrl: "",
        sourceTitle: "",
        sourceMarkdown: "",
        rewriteBrand: "",
        rewriteMaterials: "",
        extractStatus: "idle",
        coreQuestion: "",
        keywords: "",
        region: "",
        business: "",
        advantages: "",
        audience: "",
        extraRequirements: "",
        output: "设备 B 文章",
        status: "idle",
      },
    },
    unsetFields: [],
    expectedVersions: created.versions,
  })
  assert.equal(articleUpdated?.client.ourBrand, "设备 A 品牌")
  assert.equal(articleUpdated?.versions.articleGeneration, 1)

  const jobUpdated = await patchWorkspaceClient({
    userId: "user-a",
    clientId: client.id,
    patch: { penetrationJobId: "job-1" },
    unsetFields: [],
    expectedVersions: articleUpdated!.versions,
  })
  assert.equal(jobUpdated?.versions.jobs, 1)
  assert.equal(jobUpdated?.versions.penetration, 0)

  const penetrationUpdated = await mutateWorkspaceClientLatest({
    userId: "user-a",
    clientId: client.id,
    mutate: () => ({
      patch: {
        penetration: {
          byModel: {},
          aggregated: {
            penetrationRate: 0,
            ourMentions: 0,
            totalSlots: 0,
            industryShare: [],
            ourRanking: null,
            perModelRate: [],
            missedQuestions: [],
            topCompetitors: [],
          },
          generatedAt: now,
        },
      },
    }),
  })
  assert.equal(penetrationUpdated?.versions.penetration, 1)
  assert.equal(penetrationUpdated?.versions.jobs, 1)

  const idempotent = await patchWorkspaceClient({
    userId: "user-a",
    clientId: client.id,
    patch: { penetration: penetrationUpdated!.client.penetration },
    unsetFields: [],
    expectedVersions: jobUpdated!.versions,
  })
  assert.equal(idempotent?.versions.penetration, 1, "stale idempotent writes must not conflict")

  await assert.rejects(
    patchWorkspaceClient({
      userId: "user-a",
      clientId: client.id,
      patch: { industry: "冲突行业" },
      unsetFields: [],
      expectedVersions: created.versions,
    }),
    error => error instanceof WorkspaceConflictError,
    "stale updates in the same section must conflict",
  )

  const firstImport = await importLegacyWorkspaceClients("user-a", "device-a:payload-1", [client])
  assert.equal(firstImport.importedCount, 1)
  assert.equal(firstImport.duplicatedCount, 1)
  const secondImport = await importLegacyWorkspaceClients("user-a", "device-a:payload-1", [client])
  assert.equal(secondImport.alreadyImported, true)
  assert.equal(secondImport.clients.length, 2, "repeated imports must not duplicate clients")

  console.log("Workspace sync contract passed")
} finally {
  await fs.rm(testFile, { force: true })
}
