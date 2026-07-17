import { createHash } from "crypto"
import { Pool } from "pg"
import type { ModelKey, PenetrationResult } from "../src/types"

const connectionString = String(process.env.DATABASE_URL || "").trim()
if (!connectionString) throw new Error("DATABASE_URL is required")

const apply = process.argv.includes("--apply")
if (apply && process.env.MIGRATION_CONFIRM !== "PENETRATION_HISTORY_BACKFILL") {
  throw new Error(
    "正式补录前请设置 MIGRATION_CONFIRM=PENETRATION_HISTORY_BACKFILL，并同时使用 --apply",
  )
}

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
})

type WorkspaceRow = {
  user_id: string
  client_id: string
  core: Record<string, unknown>
  penetration_data: Record<string, unknown>
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item || "").trim()).filter(Boolean)
    : []
}

function resultQuestions(result: PenetrationResult): string[] {
  const seen = new Set<string>()
  const questions: string[] = []
  for (const items of Object.values(result.byModel)) {
    for (const item of items || []) {
      const question = item.question.trim()
      if (!question || seen.has(question)) continue
      seen.add(question)
      questions.push(question)
    }
  }
  return questions
}

function resultModels(result: PenetrationResult): ModelKey[] {
  return (Object.keys(result.byModel) as ModelKey[])
    .filter(model => Boolean(result.byModel[model]?.length))
}

function completedSlots(result: PenetrationResult): number {
  return Object.values(result.byModel).reduce(
    (total, items) => total + (items || []).filter(item => item.answer.trim()).length,
    0,
  )
}

function historyId(userId: string, clientId: string, generatedAt: string): string {
  const hash = createHash("sha256")
    .update(`${userId}\u0000${clientId}\u0000${generatedAt}`)
    .digest("hex")
    .slice(0, 28)
  return `phist_backfill_${hash}`
}

try {
  const result = await pool.query<WorkspaceRow>(
    `SELECT c.user_id,
            c.id AS client_id,
            c.core,
            s.data AS penetration_data
     FROM geo_workspace_clients c
     INNER JOIN geo_workspace_sections s
       ON s.user_id = c.user_id
      AND s.client_id = c.id
      AND s.section = 'penetration'
     WHERE c.deleted_at IS NULL
       AND s.data ? 'penetration'
     ORDER BY c.user_id, c.id`,
  )

  const candidates = result.rows.flatMap(row => {
    const penetration = row.penetration_data.penetration as PenetrationResult | undefined
    if (!penetration?.generatedAt || !penetration.byModel || !penetration.aggregated) return []
    const questions = resultQuestions(penetration)
    const models = resultModels(penetration)
    return [{
      row,
      penetration,
      questions,
      models,
      id: historyId(row.user_id, row.client_id, penetration.generatedAt),
    }]
  })

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    workspaceRows: result.rows.length,
    candidates: candidates.length,
    sample: candidates.slice(0, 5).map(candidate => ({
      id: candidate.id,
      clientId: candidate.row.client_id,
      clientName: String(candidate.row.core.name || ""),
      generatedAt: candidate.penetration.generatedAt,
      questions: candidate.questions.length,
      models: candidate.models.length,
    })),
  }, null, 2))

  if (!apply) {
    console.log(
      "预览完成：确认后使用 MIGRATION_CONFIRM=PENETRATION_HISTORY_BACKFILL 和 --apply 正式补录。",
    )
  } else {
    const {
      buildPenetrationHistoryRecord,
      savePenetrationHistoryRecord,
    } = await import("../src/lib/penetration/history-store")

    let saved = 0
    for (const candidate of candidates) {
      const { row, penetration, questions, models, id } = candidate
      const core = row.core
      const record = buildPenetrationHistoryRecord({
        id,
        request: {
          clientId: row.client_id,
          clientName: String(core.name || core.ourBrand || row.client_id),
          ourBrand: String(core.ourBrand || ""),
          brandAliases: stringList(core.brandAliases),
          industry: String(core.industry || ""),
          website: String(core.website || ""),
          questions: questions.length > 0 ? questions : stringList(core.questions),
          competitors: stringList(core.competitors),
          models: models.length > 0 ? models : stringList(core.selectedModels) as ModelKey[],
          activeModels: models.length > 0 ? models : stringList(core.selectedModels) as ModelKey[],
          skippedModels: [],
          operation: "replace",
        },
        status: "succeeded",
        source: "workspace_backfill",
        result: penetration,
        completedSlots: completedSlots(penetration),
        totalSlots: penetration.aggregated.totalSlots,
        createdAt: penetration.generatedAt,
        completedAt: penetration.generatedAt,
      })
      await savePenetrationHistoryRecord(row.user_id, record)
      saved++
    }
    console.log(JSON.stringify({ saved, candidates: candidates.length }, null, 2))
  }
} finally {
  await pool.end()
}
