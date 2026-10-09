import "server-only"

import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Pool, type PoolClient } from "pg"
import {
  calculatePublishingPlan,
  normalizePublishingPlanInput,
  type PublishingQuestionMaterial,
} from "@/lib/publishing-plan/calculator"
import { PUBLISHING_PLAN_SCHEMA_SQL } from "@/lib/publishing-plan/schema"
import type {
  PublishingContentAsset,
  PublishingPlan,
  PublishingPlanInput,
  PublishingPlanSourceEvidence,
  PublishingTask,
  PublishingTaskListFilters,
  PublishingTaskStatus,
} from "@/types/publishing-plan"

type PlanRow = {
  owner_user_id: string
  id: string
  client_id: string
  client_name: string
  version: number
  status: PublishingPlan["status"]
  input: PublishingPlan["input"]
  calculation: PublishingPlan["calculation"]
  source_snapshot: PublishingPlanSourceEvidence[]
  recommendation_model: string | null
  recommendation_generated_at: string | Date | null
  created_by_user_id: string
  created_at: string | Date
  updated_at: string | Date
  activated_at: string | Date | null
  archived_at: string | Date | null
}

type AssetRow = {
  owner_user_id: string
  id: string
  plan_id: string
  client_id: string
  window_id: string
  content_type: PublishingContentAsset["contentType"]
  planned_date: string | Date
  title: string | null
  question_id: string | null
  question: string | null
  matched_advantage: string | null
  prompt_key: string | null
  generation_job_id: string | null
  generated_article_id: string | null
  status: PublishingContentAsset["status"]
  created_at: string | Date
  updated_at: string | Date
}

type TaskRow = {
  owner_user_id: string
  id: string
  plan_id: string
  plan_version: number
  client_id: string
  asset_id: string
  planned_date: string | Date
  platform_key: string
  platform_name: string
  account_slot: number
  status: PublishingTaskStatus
  planned_cost_cents: number
  title: string | null
  published_url: string | null
  published_at: string | Date | null
  evidence: PublishingTask["evidence"]
  claimed_by: string | null
  claim_token: string | null
  claim_expires_at: string | Date | null
  failure_reason: string | null
  execution_action_id: string | null
  created_at: string | Date
  updated_at: string | Date
}

type FileState = {
  plans: Record<string, PublishingPlan>
  assets: Record<string, PublishingContentAsset>
  tasks: Record<string, PublishingTask>
}

export interface CreatePublishingPlanDraftInput {
  ownerUserId: string
  clientId: string
  clientName: string
  createdByUserId: string
  input: PublishingPlanInput
  sourceSnapshot?: PublishingPlanSourceEvidence[]
  recommendationModel?: string
  recommendationGeneratedAt?: string
  questionMaterials?: PublishingQuestionMaterial[]
}

export interface CompletePublishingTaskInput {
  ownerUserId: string
  taskId: string
  actorUserId: string
  claimToken?: string
  publishedUrl: string
  publishedAt?: string
  title?: string
  evidence?: PublishingTask["evidence"]
  executionActionId?: string
}

export interface CompleteNextPublishingTaskInput {
  ownerUserId: string
  clientId: string
  planId: string
  plannedDate: string
  platformKey: string
  actorUserId: string
  publishedUrl: string
  publishedAt?: string
  title?: string
  evidence?: PublishingTask["evidence"]
  executionActionId: string
}

const DEFAULT_FILE_PATH = process.env.NODE_ENV === "production"
  ? "/var/lib/geo-system/publishing-plans.json"
  : path.join(process.cwd(), ".data", "publishing-plans.json")

const globalState = globalThis as typeof globalThis & {
  __geoPublishingPlanPool?: Pool
  __geoPublishingPlanSchema?: Promise<void>
  __geoPublishingPlanFileQueue?: Promise<unknown>
}

function backend(): "postgres" | "file" {
  const configured = String(process.env.PUBLISHING_PLAN_STORE || "").trim().toLowerCase()
  if (configured === "postgres" || configured === "file") return configured
  if (configured) throw new Error(`Unsupported PUBLISHING_PLAN_STORE: ${configured}`)
  return process.env.DATABASE_URL ? "postgres" : "file"
}

function pool(): Pool {
  if (globalState.__geoPublishingPlanPool) return globalState.__geoPublishingPlanPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required for publishing plans")
  globalState.__geoPublishingPlanPool = new Pool({
    connectionString,
    max: Math.max(1, Math.min(6, Number(process.env.PUBLISHING_PLAN_DB_POOL_MAX) || 3)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  })
  globalState.__geoPublishingPlanPool.on("error", error => {
    console.error("[publishing-plan-db]", error.message)
  })
  return globalState.__geoPublishingPlanPool
}

export async function ensurePublishingPlanSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!globalState.__geoPublishingPlanSchema) {
    globalState.__geoPublishingPlanSchema = pool().query(PUBLISHING_PLAN_SCHEMA_SQL)
      .then(() => undefined)
      .catch(error => {
        globalState.__geoPublishingPlanSchema = undefined
        throw error
      })
  }
  await globalState.__geoPublishingPlanSchema
}

export async function createPublishingPlanDraft(
  input: CreatePublishingPlanDraftInput,
): Promise<PublishingPlan> {
  if (backend() === "postgres") return createPostgresDraft(input)
  return withFileState(async state => {
    const existing = Object.values(state.plans).filter(plan => (
      plan.ownerUserId === input.ownerUserId && plan.clientId === input.clientId
    ))
    const version = Math.max(0, ...existing.map(plan => plan.version)) + 1
    const plan = buildPlan(input, version)
    state.plans[fileKey(input.ownerUserId, plan.id)] = withoutLiveRecords(plan)
    for (const asset of plan.calculation.assets) state.assets[fileKey(input.ownerUserId, asset.id)] = asset
    for (const task of plan.calculation.tasks) state.tasks[fileKey(input.ownerUserId, task.id)] = task
    return plan
  }, true)
}

export async function listPublishingPlans(
  ownerUserId: string,
  clientId: string,
): Promise<PublishingPlan[]> {
  if (backend() === "postgres") {
    await ensurePublishingPlanSchema()
    const result = await pool().query<PlanRow>(
      `SELECT * FROM geo_publishing_plans_v1
       WHERE owner_user_id = $1 AND client_id = $2
       ORDER BY version DESC`,
      [ownerUserId, clientId],
    )
    return result.rows.map(row => planFromRow(row))
  }
  return withFileState(state => Object.values(state.plans)
    .filter(plan => plan.ownerUserId === ownerUserId && plan.clientId === clientId)
    .sort((left, right) => right.version - left.version))
}

export async function getPublishingPlan(
  ownerUserId: string,
  planId: string,
  includeRecords = true,
): Promise<PublishingPlan | null> {
  if (backend() === "postgres") {
    await ensurePublishingPlanSchema()
    const result = await pool().query<PlanRow>(
      `SELECT * FROM geo_publishing_plans_v1 WHERE owner_user_id = $1 AND id = $2 LIMIT 1`,
      [ownerUserId, planId],
    )
    if (!result.rows[0]) return null
    if (!includeRecords) return planFromRow(result.rows[0])
    const [assets, tasks] = await Promise.all([
      listPostgresAssets(ownerUserId, planId),
      listPublishingTasks(ownerUserId, planId, {}),
    ])
    return planFromRow(result.rows[0], assets, tasks)
  }
  return withFileState(state => {
    const stored = state.plans[fileKey(ownerUserId, planId)]
    if (!stored) return null
    if (!includeRecords) return structuredClone(stored)
    const assets = Object.values(state.assets).filter(asset => asset.planId === planId)
    const tasks = Object.values(state.tasks).filter(task => task.planId === planId)
    return withRecords(stored, assets, tasks)
  })
}

export async function getCurrentPublishingPlan(
  ownerUserId: string,
  clientId: string,
  includeRecords = true,
): Promise<PublishingPlan | null> {
  const plans = await listPublishingPlans(ownerUserId, clientId)
  const selected = plans.find(plan => plan.status === "active") || plans.find(plan => plan.status === "draft")
  return selected ? getPublishingPlan(ownerUserId, selected.id, includeRecords) : null
}

export async function getActivePublishingPlan(
  ownerUserId: string,
  clientId: string,
  includeRecords = true,
): Promise<PublishingPlan | null> {
  const active = (await listPublishingPlans(ownerUserId, clientId))
    .find(plan => plan.status === "active")
  return active ? getPublishingPlan(ownerUserId, active.id, includeRecords) : null
}

export async function activatePublishingPlan(
  ownerUserId: string,
  planId: string,
): Promise<PublishingPlan> {
  const now = new Date().toISOString()
  if (backend() === "postgres") {
    await ensurePublishingPlanSchema()
    const db = await pool().connect()
    try {
      await db.query("BEGIN")
      const selected = await db.query<PlanRow>(
        `SELECT * FROM geo_publishing_plans_v1
         WHERE owner_user_id = $1 AND id = $2 FOR UPDATE`,
        [ownerUserId, planId],
      )
      const row = selected.rows[0]
      if (!row) throw new Error("发布规划不存在")
      await db.query(
        `UPDATE geo_publishing_plans_v1
         SET status = 'archived', archived_at = $3, updated_at = $3
         WHERE owner_user_id = $1 AND client_id = $2 AND status = 'active' AND id <> $4`,
        [ownerUserId, row.client_id, now, planId],
      )
      const activated = await db.query<PlanRow>(
        `UPDATE geo_publishing_plans_v1
         SET status = 'active', activated_at = COALESCE(activated_at, $3),
             archived_at = NULL, updated_at = $3
         WHERE owner_user_id = $1 AND id = $2 RETURNING *`,
        [ownerUserId, planId, now],
      )
      await db.query("COMMIT")
      return planFromRow(activated.rows[0])
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      db.release()
    }
  }
  return withFileState(state => {
    const key = fileKey(ownerUserId, planId)
    const selected = state.plans[key]
    if (!selected) throw new Error("发布规划不存在")
    for (const [candidateKey, plan] of Object.entries(state.plans)) {
      if (plan.ownerUserId === ownerUserId && plan.clientId === selected.clientId && plan.status === "active" && plan.id !== planId) {
        state.plans[candidateKey] = { ...plan, status: "archived", archivedAt: now, updatedAt: now }
      }
    }
    const activated = { ...selected, status: "active" as const, activatedAt: selected.activatedAt || now, archivedAt: undefined, updatedAt: now }
    state.plans[key] = activated
    return activated
  }, true)
}

export async function deletePublishingPlanDraft(ownerUserId: string, planId: string): Promise<boolean> {
  if (backend() === "postgres") {
    await ensurePublishingPlanSchema()
    const result = await pool().query(
      `DELETE FROM geo_publishing_plans_v1
       WHERE owner_user_id = $1 AND id = $2 AND status = 'draft'`,
      [ownerUserId, planId],
    )
    return (result.rowCount || 0) > 0
  }
  return withFileState(state => {
    const key = fileKey(ownerUserId, planId)
    if (state.plans[key]?.status !== "draft") return false
    delete state.plans[key]
    for (const [assetKey, asset] of Object.entries(state.assets)) if (asset.planId === planId) delete state.assets[assetKey]
    for (const [taskKey, task] of Object.entries(state.tasks)) if (task.planId === planId) delete state.tasks[taskKey]
    return true
  }, true)
}

export async function listPublishingTasks(
  ownerUserId: string,
  planId: string,
  filters: PublishingTaskListFilters,
): Promise<PublishingTask[]> {
  if (backend() === "postgres") {
    await ensurePublishingPlanSchema()
    const values: unknown[] = [ownerUserId, planId]
    const where = ["owner_user_id = $1", "plan_id = $2"]
    if (filters.date) {
      values.push(filters.date)
      where.push(`planned_date = $${values.length}`)
    }
    if (filters.from) {
      values.push(filters.from)
      where.push(`planned_date >= $${values.length}`)
    }
    if (filters.to) {
      values.push(filters.to)
      where.push(`planned_date <= $${values.length}`)
    }
    if (filters.status) {
      values.push(filters.status)
      where.push(`status = $${values.length}`)
    }
    if (filters.platformKey) {
      values.push(filters.platformKey)
      where.push(`platform_key = $${values.length}`)
    }
    values.push(Math.max(1, Math.min(10_000, filters.limit || 5_000)))
    const result = await pool().query<TaskRow>(
      `SELECT * FROM geo_publishing_tasks_v1
       WHERE ${where.join(" AND ")}
       ORDER BY planned_date, platform_name, account_slot, id
       LIMIT $${values.length}`,
      values,
    )
    return result.rows.map(taskFromRow)
  }
  return withFileState(state => Object.values(state.tasks)
    .filter(task => task.ownerUserId === ownerUserId && task.planId === planId)
    .filter(task => !filters.date || task.plannedDate === filters.date)
    .filter(task => !filters.from || task.plannedDate >= filters.from)
    .filter(task => !filters.to || task.plannedDate <= filters.to)
    .filter(task => !filters.status || task.status === filters.status)
    .filter(task => !filters.platformKey || task.platformKey === filters.platformKey)
    .sort((left, right) => left.plannedDate.localeCompare(right.plannedDate) || left.platformName.localeCompare(right.platformName, "zh-CN"))
    .slice(0, Math.max(1, Math.min(10_000, filters.limit || 5_000))))
}

export async function getPublishingTask(
  ownerUserId: string,
  taskId: string,
): Promise<PublishingTask | null> {
  if (backend() === "postgres") {
    await ensurePublishingPlanSchema()
    const result = await pool().query<TaskRow>(
      `SELECT * FROM geo_publishing_tasks_v1 WHERE owner_user_id = $1 AND id = $2 LIMIT 1`,
      [ownerUserId, taskId],
    )
    return result.rows[0] ? taskFromRow(result.rows[0]) : null
  }
  return withFileState(state => state.tasks[fileKey(ownerUserId, taskId)] || null)
}

export async function updatePublishingAssetGeneration(input: {
  ownerUserId: string
  assetId: string
  status: PublishingContentAsset["status"]
  generationJobId?: string
  generatedArticleId?: string
  title?: string
}): Promise<PublishingContentAsset | null> {
  const now = new Date().toISOString()
  if (backend() === "postgres") {
    await ensurePublishingPlanSchema()
    const result = await pool().query<AssetRow>(
      `UPDATE geo_publishing_assets_v1
       SET status = $3,
           generation_job_id = COALESCE($4, generation_job_id),
           generated_article_id = COALESCE($5, generated_article_id),
           title = COALESCE($6, title),
           updated_at = $7
       WHERE owner_user_id = $1 AND id = $2
       RETURNING *`,
      [
        input.ownerUserId,
        input.assetId,
        input.status,
        clean(input.generationJobId, 200) || null,
        clean(input.generatedArticleId, 200) || null,
        clean(input.title, 300) || null,
        now,
      ],
    )
    return result.rows[0] ? assetFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const key = fileKey(input.ownerUserId, input.assetId)
    const asset = state.assets[key]
    if (!asset) return null
    const updated: PublishingContentAsset = {
      ...asset,
      status: input.status,
      generationJobId: clean(input.generationJobId, 200) || asset.generationJobId,
      generatedArticleId: clean(input.generatedArticleId, 200) || asset.generatedArticleId,
      title: clean(input.title, 300) || asset.title,
      updatedAt: now,
    }
    state.assets[key] = updated
    return updated
  }, true)
}

export async function claimPublishingTasks(input: {
  ownerUserId: string
  clientId: string
  planId: string
  agentId: string
  date?: string
  limit?: number
  leaseSeconds?: number
}): Promise<PublishingTask[]> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + Math.max(60, Math.min(3_600, input.leaseSeconds || 900)) * 1_000).toISOString()
  const claimToken = `pubclaim_${randomUUID().replace(/-/g, "")}`
  const limit = Math.max(1, Math.min(100, input.limit || 10))
  if (backend() === "postgres") {
    await ensurePublishingPlanSchema()
    const result = await pool().query<TaskRow>(
      `WITH candidates AS (
         SELECT task.owner_user_id, task.id
         FROM geo_publishing_tasks_v1 task
         JOIN geo_publishing_plans_v1 plan
           ON plan.owner_user_id = task.owner_user_id AND plan.id = task.plan_id
         WHERE task.owner_user_id = $1 AND task.client_id = $2 AND task.plan_id = $3
           AND plan.status = 'active'
           AND ($4::date IS NULL OR task.planned_date = $4::date)
           AND (task.status = 'planned' OR (task.status = 'claimed' AND task.claim_expires_at <= NOW()))
         ORDER BY task.planned_date, task.platform_name, task.id
         FOR UPDATE OF task SKIP LOCKED
         LIMIT $5
       )
       UPDATE geo_publishing_tasks_v1 task
       SET status = 'claimed', claimed_by = $6, claim_token = $7,
           claim_expires_at = $8, updated_at = NOW()
       FROM candidates
       WHERE task.owner_user_id = candidates.owner_user_id AND task.id = candidates.id
       RETURNING task.*`,
      [input.ownerUserId, input.clientId, input.planId, input.date || null, limit, input.agentId, claimToken, expiresAt],
    )
    return result.rows.map(taskFromRow)
  }
  return withFileState(state => {
    const plan = state.plans[fileKey(input.ownerUserId, input.planId)]
    if (!plan || plan.status !== "active") throw new Error("只有已生效规划可以领取任务")
    const candidates = Object.entries(state.tasks)
      .filter(([, task]) => task.ownerUserId === input.ownerUserId && task.clientId === input.clientId && task.planId === input.planId)
      .filter(([, task]) => !input.date || task.plannedDate === input.date)
      .filter(([, task]) => task.status === "planned" || (task.status === "claimed" && String(task.claimExpiresAt || "") <= now.toISOString()))
      .sort(([, left], [, right]) => left.plannedDate.localeCompare(right.plannedDate) || left.platformName.localeCompare(right.platformName, "zh-CN"))
      .slice(0, limit)
    return candidates.map(([key, task]) => {
      const claimed: PublishingTask = { ...task, status: "claimed", claimedBy: input.agentId, claimToken, claimExpiresAt: expiresAt, updatedAt: now.toISOString() }
      state.tasks[key] = claimed
      return claimed
    })
  }, true)
}

export async function completePublishingTask(input: CompletePublishingTaskInput): Promise<PublishingTask> {
  const url = normalizeHttpUrl(input.publishedUrl)
  const now = new Date().toISOString()
  const publishedAt = validIso(input.publishedAt) || now
  if (backend() === "postgres") {
    await ensurePublishingPlanSchema()
    const values = [
      input.ownerUserId,
      input.taskId,
      url,
      publishedAt,
      clean(input.title, 300) || null,
      JSON.stringify(normalizeEvidence(input.evidence, url)),
      clean(input.executionActionId, 200) || null,
      now,
      input.claimToken || null,
    ]
    const result = await pool().query<TaskRow>(
      `UPDATE geo_publishing_tasks_v1
       SET status = 'completed', published_url = $3, published_at = $4,
           title = COALESCE($5, title), evidence = $6::jsonb,
           execution_action_id = COALESCE($7, execution_action_id),
           claimed_by = NULL, claim_token = NULL, claim_expires_at = NULL,
           failure_reason = NULL, updated_at = $8
       WHERE owner_user_id = $1 AND id = $2
         AND ($9::text IS NULL OR claim_token = $9)
       RETURNING *`,
      values,
    )
    if (!result.rows[0]) throw new Error("发布任务不存在、已被其他执行者领取或领取凭证已失效")
    return taskFromRow(result.rows[0])
  }
  return withFileState(state => {
    const key = fileKey(input.ownerUserId, input.taskId)
    const task = state.tasks[key]
    if (!task || (input.claimToken && task.claimToken !== input.claimToken)) {
      throw new Error("发布任务不存在、已被其他执行者领取或领取凭证已失效")
    }
    const completed: PublishingTask = {
      ...task,
      status: "completed",
      publishedUrl: url,
      publishedAt,
      title: clean(input.title, 300) || task.title,
      evidence: normalizeEvidence(input.evidence, url),
      executionActionId: clean(input.executionActionId, 200) || task.executionActionId,
      claimedBy: undefined,
      claimToken: undefined,
      claimExpiresAt: undefined,
      failureReason: undefined,
      updatedAt: now,
    }
    state.tasks[key] = completed
    return completed
  }, true)
}

export async function completeNextPublishingTask(
  input: CompleteNextPublishingTaskInput,
): Promise<PublishingTask | null> {
  const url = normalizeHttpUrl(input.publishedUrl)
  const now = new Date().toISOString()
  const publishedAt = validIso(input.publishedAt) || now
  const evidence = normalizeEvidence(input.evidence, url)
  if (backend() === "postgres") {
    await ensurePublishingPlanSchema()
    const result = await pool().query<TaskRow>(
      `WITH action_lock AS (
         SELECT pg_advisory_xact_lock(hashtextextended($10, 0))
       ), existing AS (
         SELECT task.id
         FROM geo_publishing_tasks_v1 task
         CROSS JOIN action_lock
         WHERE task.owner_user_id = $1 AND task.plan_id = $2
           AND task.client_id = $3 AND task.execution_action_id = $10
         LIMIT 1
       ), candidate AS (
         SELECT task.id
         FROM geo_publishing_tasks_v1 task
         JOIN geo_publishing_plans_v1 plan
           ON plan.owner_user_id = task.owner_user_id AND plan.id = task.plan_id
         WHERE task.owner_user_id = $1 AND task.plan_id = $2 AND task.client_id = $3
           AND task.planned_date = $4::date AND task.platform_key = $5
           AND plan.status = 'active'
           AND (
             task.status IN ('planned', 'failed')
             OR (task.status = 'claimed' AND task.claim_expires_at <= NOW())
           )
           AND NOT EXISTS (SELECT 1 FROM existing)
         ORDER BY task.account_slot, task.id
         FOR UPDATE OF task SKIP LOCKED
         LIMIT 1
       )
       UPDATE geo_publishing_tasks_v1 task
       SET status = 'completed', published_url = $6, published_at = $7,
           title = COALESCE($8, task.title), evidence = $9::jsonb,
           execution_action_id = $10, claimed_by = NULL, claim_token = NULL,
           claim_expires_at = NULL, failure_reason = NULL, updated_at = $11
       WHERE task.owner_user_id = $1
         AND task.id = COALESCE((SELECT id FROM existing), (SELECT id FROM candidate))
       RETURNING task.*`,
      [
        input.ownerUserId,
        input.planId,
        input.clientId,
        input.plannedDate,
        input.platformKey,
        url,
        publishedAt,
        clean(input.title, 300) || null,
        JSON.stringify(evidence),
        clean(input.executionActionId, 200),
        now,
      ],
    )
    return result.rows[0] ? taskFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const plan = state.plans[fileKey(input.ownerUserId, input.planId)]
    if (!plan || plan.status !== "active" || plan.clientId !== input.clientId) return null
    const existing = Object.entries(state.tasks).find(([, task]) => (
      task.ownerUserId === input.ownerUserId
      && task.planId === input.planId
      && task.executionActionId === input.executionActionId
    ))
    const candidate = existing || Object.entries(state.tasks)
      .filter(([, task]) => (
        task.ownerUserId === input.ownerUserId
        && task.planId === input.planId
        && task.clientId === input.clientId
        && task.plannedDate === input.plannedDate
        && task.platformKey === input.platformKey
        && (
          task.status === "planned"
          || task.status === "failed"
          || (task.status === "claimed" && String(task.claimExpiresAt || "") <= now)
        )
      ))
      .sort(([, left], [, right]) => left.accountSlot - right.accountSlot || left.id.localeCompare(right.id))[0]
    if (!candidate) return null
    const [key, task] = candidate
    const completed: PublishingTask = {
      ...task,
      status: "completed",
      publishedUrl: url,
      publishedAt,
      title: clean(input.title, 300) || task.title,
      evidence,
      executionActionId: clean(input.executionActionId, 200),
      claimedBy: undefined,
      claimToken: undefined,
      claimExpiresAt: undefined,
      failureReason: undefined,
      updatedAt: now,
    }
    state.tasks[key] = completed
    return completed
  }, true)
}

export async function reopenPublishingTaskByExecutionAction(input: {
  ownerUserId: string
  clientId: string
  executionActionId: string
}): Promise<number> {
  if (backend() === "postgres") {
    await ensurePublishingPlanSchema()
    const result = await pool().query(
      `UPDATE geo_publishing_tasks_v1
       SET status = 'planned', published_url = NULL, published_at = NULL,
           evidence = '[]'::jsonb, execution_action_id = NULL,
           claimed_by = NULL, claim_token = NULL, claim_expires_at = NULL,
           failure_reason = NULL, updated_at = NOW()
       WHERE owner_user_id = $1 AND client_id = $2 AND execution_action_id = $3`,
      [input.ownerUserId, input.clientId, input.executionActionId],
    )
    return result.rowCount || 0
  }
  return withFileState(state => {
    let count = 0
    for (const [key, task] of Object.entries(state.tasks)) {
      if (
        task.ownerUserId !== input.ownerUserId
        || task.clientId !== input.clientId
        || task.executionActionId !== input.executionActionId
      ) continue
      state.tasks[key] = {
        ...task,
        status: "planned",
        publishedUrl: undefined,
        publishedAt: undefined,
        evidence: [],
        executionActionId: undefined,
        claimedBy: undefined,
        claimToken: undefined,
        claimExpiresAt: undefined,
        failureReason: undefined,
        updatedAt: new Date().toISOString(),
      }
      count += 1
    }
    return count
  }, true)
}

export async function failPublishingTask(input: {
  ownerUserId: string
  taskId: string
  claimToken?: string
  reason: string
}): Promise<PublishingTask> {
  const reason = clean(input.reason, 800) || "发布失败"
  const now = new Date().toISOString()
  if (backend() === "postgres") {
    await ensurePublishingPlanSchema()
    const result = await pool().query<TaskRow>(
      `UPDATE geo_publishing_tasks_v1
       SET status = 'failed', failure_reason = $3, claimed_by = NULL,
           claim_token = NULL, claim_expires_at = NULL, updated_at = $4
       WHERE owner_user_id = $1 AND id = $2
         AND ($5::text IS NULL OR claim_token = $5)
       RETURNING *`,
      [input.ownerUserId, input.taskId, reason, now, input.claimToken || null],
    )
    if (!result.rows[0]) throw new Error("发布任务不存在或领取凭证已失效")
    return taskFromRow(result.rows[0])
  }
  return withFileState(state => {
    const key = fileKey(input.ownerUserId, input.taskId)
    const task = state.tasks[key]
    if (!task || (input.claimToken && task.claimToken !== input.claimToken)) throw new Error("发布任务不存在或领取凭证已失效")
    const failed: PublishingTask = { ...task, status: "failed", failureReason: reason, claimedBy: undefined, claimToken: undefined, claimExpiresAt: undefined, updatedAt: now }
    state.tasks[key] = failed
    return failed
  }, true)
}

async function createPostgresDraft(input: CreatePublishingPlanDraftInput): Promise<PublishingPlan> {
  await ensurePublishingPlanSchema()
  const db = await pool().connect()
  try {
    await db.query("BEGIN")
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${input.ownerUserId}:${input.clientId}:publishing-plan`])
    const versionResult = await db.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version
       FROM geo_publishing_plans_v1 WHERE owner_user_id = $1 AND client_id = $2`,
      [input.ownerUserId, input.clientId],
    )
    const plan = buildPlan(input, Number(versionResult.rows[0]?.version || 1))
    const stored = withoutLiveRecords(plan)
    await db.query(
      `INSERT INTO geo_publishing_plans_v1 (
         owner_user_id,id,client_id,client_name,version,status,input,calculation,
         source_snapshot,recommendation_model,recommendation_generated_at,
         created_by_user_id,created_at,updated_at
       ) VALUES ($1,$2,$3,$4,$5,'draft',$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$12)`,
      [
        plan.ownerUserId, plan.id, plan.clientId, plan.clientName, plan.version,
        JSON.stringify(plan.input), JSON.stringify(stored.calculation), JSON.stringify(plan.sourceSnapshot),
        plan.recommendationModel || null, plan.recommendationGeneratedAt || null,
        plan.createdByUserId, plan.createdAt,
      ],
    )
    await insertAssets(db, plan.ownerUserId, plan.calculation.assets)
    await insertTasks(db, plan.ownerUserId, plan.calculation.tasks)
    await db.query("COMMIT")
    return plan
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined)
    throw error
  } finally {
    db.release()
  }
}

function buildPlan(input: CreatePublishingPlanDraftInput, version: number): PublishingPlan {
  const now = new Date().toISOString()
  const id = `pubplan_${randomUUID().replace(/-/g, "")}`
  const normalizedInput = normalizePublishingPlanInput(input.input)
  const calculation = calculatePublishingPlan(normalizedInput, {
    ownerUserId: input.ownerUserId,
    clientId: input.clientId,
    planId: id,
    planVersion: version,
    questionMaterials: input.questionMaterials,
    now,
  })
  return {
    id,
    ownerUserId: input.ownerUserId,
    clientId: input.clientId,
    clientName: clean(input.clientName, 180) || "未命名客户",
    version,
    status: "draft",
    input: normalizedInput,
    calculation,
    sourceSnapshot: input.sourceSnapshot || [],
    recommendationModel: clean(input.recommendationModel, 160) || undefined,
    recommendationGeneratedAt: validIso(input.recommendationGeneratedAt),
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
  }
}

function withoutLiveRecords(plan: PublishingPlan): PublishingPlan {
  return {
    ...plan,
    calculation: { ...plan.calculation, assets: [], tasks: [] },
  }
}

async function insertAssets(db: PoolClient, ownerUserId: string, assets: PublishingContentAsset[]): Promise<void> {
  if (assets.length === 0) return
  await db.query(
    `INSERT INTO geo_publishing_assets_v1 (
       owner_user_id,id,plan_id,client_id,window_id,content_type,planned_date,title,
       question_id,question,matched_advantage,prompt_key,generation_job_id,
       generated_article_id,status,created_at,updated_at
     ) SELECT $1,x.id,x.plan_id,x.client_id,x.window_id,x.content_type,x.planned_date::date,
       x.title,x.question_id,x.question,x.matched_advantage,x.prompt_key,x.generation_job_id,
       x.generated_article_id,x.status,x.created_at::timestamptz,x.updated_at::timestamptz
     FROM jsonb_to_recordset($2::jsonb) AS x(
       id text,plan_id text,client_id text,window_id text,content_type text,planned_date text,
       title text,question_id text,question text,matched_advantage text,prompt_key text,
       generation_job_id text,generated_article_id text,status text,created_at text,updated_at text
     )`,
    [ownerUserId, JSON.stringify(assets.map(asset => snakeAsset(asset)))],
  )
}

async function insertTasks(db: PoolClient, ownerUserId: string, tasks: PublishingTask[]): Promise<void> {
  if (tasks.length === 0) return
  await db.query(
    `INSERT INTO geo_publishing_tasks_v1 (
       owner_user_id,id,plan_id,plan_version,client_id,asset_id,planned_date,
       platform_key,platform_name,account_slot,status,planned_cost_cents,title,evidence,
       created_at,updated_at
     ) SELECT $1,x.id,x.plan_id,x.plan_version,x.client_id,x.asset_id,x.planned_date::date,
       x.platform_key,x.platform_name,x.account_slot,x.status,x.planned_cost_cents,x.title,
       x.evidence,x.created_at::timestamptz,x.updated_at::timestamptz
     FROM jsonb_to_recordset($2::jsonb) AS x(
       id text,plan_id text,plan_version integer,client_id text,asset_id text,planned_date text,
       platform_key text,platform_name text,account_slot integer,status text,
       planned_cost_cents integer,title text,evidence jsonb,created_at text,updated_at text
     )`,
    [ownerUserId, JSON.stringify(tasks.map(task => snakeTask(task)))],
  )
}

async function listPostgresAssets(ownerUserId: string, planId: string): Promise<PublishingContentAsset[]> {
  const result = await pool().query<AssetRow>(
    `SELECT * FROM geo_publishing_assets_v1
     WHERE owner_user_id = $1 AND plan_id = $2 ORDER BY planned_date, id`,
    [ownerUserId, planId],
  )
  return result.rows.map(assetFromRow)
}

function planFromRow(row: PlanRow, assets: PublishingContentAsset[] = [], tasks: PublishingTask[] = []): PublishingPlan {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    clientId: row.client_id,
    clientName: row.client_name,
    version: Number(row.version),
    status: row.status,
    input: row.input,
    calculation: { ...row.calculation, assets, tasks },
    sourceSnapshot: Array.isArray(row.source_snapshot) ? row.source_snapshot : [],
    recommendationModel: row.recommendation_model || undefined,
    recommendationGeneratedAt: iso(row.recommendation_generated_at),
    createdByUserId: row.created_by_user_id,
    createdAt: iso(row.created_at) || new Date().toISOString(),
    updatedAt: iso(row.updated_at) || new Date().toISOString(),
    activatedAt: iso(row.activated_at),
    archivedAt: iso(row.archived_at),
  }
}

function assetFromRow(row: AssetRow): PublishingContentAsset {
  return {
    id: row.id,
    planId: row.plan_id,
    clientId: row.client_id,
    windowId: row.window_id,
    contentType: row.content_type,
    plannedDate: dateOnly(row.planned_date),
    title: row.title || undefined,
    questionId: row.question_id || undefined,
    question: row.question || undefined,
    matchedAdvantage: row.matched_advantage || undefined,
    promptKey: row.prompt_key || undefined,
    generationJobId: row.generation_job_id || undefined,
    generatedArticleId: row.generated_article_id || undefined,
    status: row.status,
    createdAt: iso(row.created_at) || new Date().toISOString(),
    updatedAt: iso(row.updated_at) || new Date().toISOString(),
  }
}

function taskFromRow(row: TaskRow): PublishingTask {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    planId: row.plan_id,
    planVersion: Number(row.plan_version),
    clientId: row.client_id,
    assetId: row.asset_id,
    plannedDate: dateOnly(row.planned_date),
    platformKey: row.platform_key,
    platformName: row.platform_name,
    accountSlot: Number(row.account_slot),
    status: row.status,
    plannedCostCents: Number(row.planned_cost_cents),
    title: row.title || undefined,
    publishedUrl: row.published_url || undefined,
    publishedAt: iso(row.published_at),
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    claimedBy: row.claimed_by || undefined,
    claimToken: row.claim_token || undefined,
    claimExpiresAt: iso(row.claim_expires_at),
    failureReason: row.failure_reason || undefined,
    executionActionId: row.execution_action_id || undefined,
    createdAt: iso(row.created_at) || new Date().toISOString(),
    updatedAt: iso(row.updated_at) || new Date().toISOString(),
  }
}

function snakeAsset(asset: PublishingContentAsset) {
  return {
    id: asset.id,
    plan_id: asset.planId,
    client_id: asset.clientId,
    window_id: asset.windowId,
    content_type: asset.contentType,
    planned_date: asset.plannedDate,
    title: asset.title || null,
    question_id: asset.questionId || null,
    question: asset.question || null,
    matched_advantage: asset.matchedAdvantage || null,
    prompt_key: asset.promptKey || null,
    generation_job_id: asset.generationJobId || null,
    generated_article_id: asset.generatedArticleId || null,
    status: asset.status,
    created_at: asset.createdAt,
    updated_at: asset.updatedAt,
  }
}

function snakeTask(task: PublishingTask) {
  return {
    id: task.id,
    plan_id: task.planId,
    plan_version: task.planVersion,
    client_id: task.clientId,
    asset_id: task.assetId,
    planned_date: task.plannedDate,
    platform_key: task.platformKey,
    platform_name: task.platformName,
    account_slot: task.accountSlot,
    status: task.status,
    planned_cost_cents: task.plannedCostCents,
    title: task.title || null,
    evidence: task.evidence,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  }
}

function withRecords(plan: PublishingPlan, assets: PublishingContentAsset[], tasks: PublishingTask[]): PublishingPlan {
  return { ...structuredClone(plan), calculation: { ...plan.calculation, assets, tasks } }
}

function iso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function dateOnly(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return new Date(value).toISOString().slice(0, 10)
}

function validIso(value: unknown): string | undefined {
  const text = String(value || "").trim()
  if (!text) return undefined
  const date = new Date(text)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function clean(value: unknown, max: number): string {
  return String(value || "").trim().slice(0, max)
}

function normalizeHttpUrl(value: unknown): string {
  const text = clean(value, 2_000)
  try {
    const url = new URL(text)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error()
    return url.toString()
  } catch {
    throw new Error("发布证据必须是可访问的 http 或 https 网址")
  }
}

function normalizeEvidence(value: PublishingTask["evidence"] | undefined, publishedUrl: string): PublishingTask["evidence"] {
  const rows = Array.isArray(value) ? value : []
  const output = rows.slice(0, 20).flatMap(item => {
    try {
      return [{ label: clean(item.label, 120) || "发布证据", url: normalizeHttpUrl(item.url) }]
    } catch {
      return []
    }
  })
  if (!output.some(item => item.url === publishedUrl)) output.unshift({ label: "发布页面", url: publishedUrl })
  return output
}

function filePath(): string {
  return String(process.env.PUBLISHING_PLAN_FILE || DEFAULT_FILE_PATH)
}

function fileKey(ownerUserId: string, id: string): string {
  return `${ownerUserId}\u0000${id}`
}

async function loadFileState(): Promise<FileState> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath(), "utf8")) as Partial<FileState>
    return { plans: parsed.plans || {}, assets: parsed.assets || {}, tasks: parsed.tasks || {} }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
      console.warn("[publishing-plan-file] load failed", error)
    }
    return { plans: {}, assets: {}, tasks: {} }
  }
}

async function saveFileState(state: FileState): Promise<void> {
  const target = filePath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(state), "utf8")
  await fs.rename(temporary, target)
}

async function withFileState<T>(
  action: (state: FileState) => T | Promise<T>,
  persist = false,
): Promise<T> {
  const previous = globalState.__geoPublishingPlanFileQueue || Promise.resolve()
  const operation = previous.catch(() => undefined).then(async () => {
    const state = await loadFileState()
    const result = await action(state)
    if (persist) await saveFileState(state)
    return result
  })
  globalState.__geoPublishingPlanFileQueue = operation.then(() => undefined, () => undefined)
  return operation
}

export async function closePublishingPlanStoreConnection(): Promise<void> {
  if (globalState.__geoPublishingPlanPool) await globalState.__geoPublishingPlanPool.end()
  globalState.__geoPublishingPlanPool = undefined
  globalState.__geoPublishingPlanSchema = undefined
}
