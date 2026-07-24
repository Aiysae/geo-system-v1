import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-workspace-summaries-"))
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE = path.join(tempDir, "workspaces.json")

const { createWorkspaceClient, listWorkspaceClientSummaries } = await import(
  "../src/lib/workspace-store"
)

try {
  const now = new Date().toISOString()
  await createWorkspaceClient("summary-user", {
    id: "client-summary-1",
    name: "测试客户",
    subjectType: "brand",
    ourBrand: "测试品牌",
    industry: "企业服务",
    website: "https://example.com",
    questions: ["问题一？", "问题二？"],
    competitors: [],
    selectedModels: ["doubao", "qwen"],
    diagnosis: { overallScore: 80 },
    createdAt: now,
    updatedAt: now,
  })

  const summaries = await listWorkspaceClientSummaries("summary-user")
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0]?.name, "测试客户")
  assert.equal(summaries[0]?.questionCount, 2)
  assert.equal(summaries[0]?.selectedModelCount, 2)
  assert.equal(summaries[0]?.completedModules.includes("diagnosis"), true)
  console.log("Workspace client summary tests passed.")
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
