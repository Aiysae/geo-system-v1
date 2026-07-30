import { createHash } from "node:crypto"
import { Pool } from "pg"
import {
  buildBackgroundSystemOutputRecord,
  buildDifficultySystemOutputRecord,
  buildPenetrationSystemOutputRecord,
} from "../src/lib/system-output/builders"
import {
  saveSystemOutputRecord,
  type SystemOutputListFilters,
} from "../src/lib/system-output/store"
import {
  getPenetrationHistoryRecord,
  listPenetrationHistoryRecords,
} from "../src/lib/penetration/history-store"
import { listWorkspaceClients } from "../src/lib/workspace-store"
import type { SystemOutputRecord } from "../src/types/system-output"

const apply = process.argv.includes("--apply")
if (apply && process.env.MIGRATION_CONFIRM !== "SYSTEM_OUTPUT_BACKFILL") {
  throw new Error("Set MIGRATION_CONFIRM=SYSTEM_OUTPUT_BACKFILL before using --apply")
}

const connectionString = String(process.env.DATABASE_URL || "").trim()
if (!connectionString) throw new Error("DATABASE_URL is required")

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
})

let candidates = 0
let created = 0
let existing = 0

try {
  const owners = await discoverOwners(pool)
  for (const ownerUserId of owners) {
    const clients = await listWorkspaceClients(ownerUserId)
    for (const { client } of clients) {
      const baseRequest = {
        ourBrand: client.ourBrand,
        brandAliases: client.brandAliases || [],
        industry: client.industry,
        website: client.website,
        subjectType: client.subjectType,
        personProfile: client.personProfile,
        competitors: client.competitors,
      }
      if (client.research) {
        await collect(ownerUserId, {
          ...buildBackgroundSystemOutputRecord({
            ownerUserId,
            actorUserId: ownerUserId,
            taskId: legacyTaskId("research", client.id, client.research.generatedAt),
            clientId: client.id,
            clientName: client.name,
            kind: "research",
            request: {
              ...baseRequest,
              mode: client.research.mode,
              sourceMode: client.research.sourceMode || client.researchSourceMode,
              hypothesis: client.research.hypothesis,
            },
            result: client.research,
            createdAt: client.research.generatedAt,
            completedAt: client.research.generatedAt,
          }),
          source: "workspace_backfill",
        })
      }
      if (client.competitorCompare) {
        await collect(ownerUserId, {
          ...buildBackgroundSystemOutputRecord({
            ownerUserId,
            actorUserId: ownerUserId,
            taskId: legacyTaskId("competitor", client.id, client.competitorCompare.generatedAt),
            clientId: client.id,
            clientName: client.name,
            kind: "competitorCompare",
            request: {
              ...baseRequest,
              selectedCompetitors: client.competitorCompare.selectedCompetitors,
              sourceMode: client.competitorCompareSourceMode,
            },
            result: client.competitorCompare,
            createdAt: client.competitorCompare.generatedAt,
            completedAt: client.competitorCompare.generatedAt,
          }),
          source: "workspace_backfill",
        })
      }
      if (client.diagnosis) {
        await collect(ownerUserId, {
          ...buildBackgroundSystemOutputRecord({
            ownerUserId,
            actorUserId: ownerUserId,
            taskId: legacyTaskId("diagnosis", client.id, client.diagnosis.generatedAt),
            clientId: client.id,
            clientName: client.name,
            kind: "diagnosis",
            request: baseRequest,
            result: client.diagnosis,
            createdAt: client.diagnosis.generatedAt,
            completedAt: client.diagnosis.generatedAt,
          }),
          source: "workspace_backfill",
        })
      }
      for (const entry of client.difficultyAssessments || []) {
        await collect(ownerUserId, {
          ...buildDifficultySystemOutputRecord({
            ownerUserId,
            actorUserId: ownerUserId,
            taskId: legacyTaskId("difficulty", client.id, entry.id || entry.createdAt),
            clientId: client.id,
            clientName: client.name,
            request: {
              mode: entry.mode,
              subjectType: entry.subjectType,
              personProfile: entry.personProfile,
              industry: entry.industry,
              city: entry.city,
              scope: entry.scope,
              targetBrand: entry.targetBrand || client.ourBrand,
              website: entry.website || client.website,
            },
            result: entry.result,
            createdAt: entry.createdAt,
            completedAt: entry.result.generatedAt || entry.createdAt,
          }),
          source: "workspace_backfill",
        })
      }
    }

    let page = 1
    const filters: SystemOutputListFilters = { pageSize: 100 }
    while (true) {
      const history = await listPenetrationHistoryRecords(ownerUserId, {
        page,
        pageSize: filters.pageSize,
      })
      for (const item of history.items) {
        const full = await getPenetrationHistoryRecord(ownerUserId, item.id)
        if (full) await collect(ownerUserId, buildPenetrationSystemOutputRecord(ownerUserId, full))
      }
      if (!history.hasMore) break
      page += 1
    }
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "preview",
    owners: owners.length,
    candidates,
    created,
    existing,
  }, null, 2))
} finally {
  await pool.end()
}

async function collect(ownerUserId: string, record: SystemOutputRecord): Promise<void> {
  candidates += 1
  if (!apply) return
  const saved = await saveSystemOutputRecord(ownerUserId, record)
  if (saved.created) created += 1
  else existing += 1
}

function legacyTaskId(kind: string, clientId: string, seed: string): string {
  const digest = createHash("sha256")
    .update(`${kind}\u0000${clientId}\u0000${seed}`)
    .digest("hex")
    .slice(0, 32)
  return `legacy_${kind}_${digest}`
}

async function discoverOwners(db: Pool): Promise<string[]> {
  const tables = await db.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('geo_workspace_clients', 'geo_penetration_history_v1')`,
  )
  const names = new Set(tables.rows.map(row => row.table_name))
  const owners = new Set<string>()
  if (names.has("geo_workspace_clients")) {
    const result = await db.query<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM geo_workspace_clients WHERE deleted_at IS NULL`,
    )
    for (const row of result.rows) owners.add(row.user_id)
  }
  if (names.has("geo_penetration_history_v1")) {
    const result = await db.query<{ owner_user_id: string }>(
      `SELECT DISTINCT owner_user_id
       FROM geo_penetration_history_v1
       WHERE deleted_at IS NULL`,
    )
    for (const row of result.rows) owners.add(row.owner_user_id)
  }
  return [...owners].filter(Boolean).sort()
}
