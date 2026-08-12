import "server-only"

import { createHash, randomUUID } from "crypto"
import { kv, setKvValues } from "@/lib/kv"
import {
  MAX_ARTICLE_QUESTION_IMPORT_ROWS,
  normalizeArticleQuestionMaterialKey,
} from "@/lib/article-question-import"
import type {
  ArticleQuestionMaterial,
  ArticleQuestionMaterialImportResult,
  ArticleQuestionMaterialInput,
  ArticleQuestionMaterialSkippedRow,
} from "@/types"

const MAX_STORED_MATERIALS_PER_CLIENT = 5_000
const IMPORT_RESULT_TTL_SECONDS = 60 * 60 * 24

const materialKey = (id: string) => `geo:article-question-material:v1:${id}`
const materialIndexKey = (ownerUserId: string, clientId: string) => (
  `geo:article-question-materials:v1:${ownerUserId}:${clientId}`
)
const importResultKey = (ownerUserId: string, clientId: string, importBatchId: string) => (
  `geo:article-question-import:v1:${ownerUserId}:${clientId}:${importBatchId}`
)
const importLockKey = (ownerUserId: string, clientId: string) => (
  `geo:article-question-import-lock:v1:${ownerUserId}:${clientId}`
)

function cleanId(value: unknown, label: string): string {
  const result = String(value || "").trim()
  if (!result || result.length > 200 || /[:\s]/.test(result)) {
    throw new Error(`${label}无效`)
  }
  return result
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max)
}

function validImportBatchId(value: unknown): string {
  const result = cleanText(value, 120)
  if (!/^aqi_[A-Za-z0-9_-]{12,110}$/.test(result)) {
    throw new Error("导入批次编号无效，请重新选择文件")
  }
  return result
}

function materialId(input: {
  ownerUserId: string
  clientId: string
  importBatchId: string
  rowNumber: number
  question: string
  matchedAdvantage?: string
}): string {
  const digest = createHash("sha256")
    .update([
      input.ownerUserId,
      input.clientId,
      input.importBatchId,
      String(input.rowNumber),
      normalizeArticleQuestionMaterialKey(input.question, input.matchedAdvantage),
    ].join("\u0000"))
    .digest("hex")
    .slice(0, 32)
  return `aqm_${digest}`
}

function normalizeRow(value: ArticleQuestionMaterialInput): ArticleQuestionMaterialInput {
  const question = cleanText(value.question, 500)
  return {
    rowNumber: Math.max(1, Math.floor(Number(value.rowNumber) || 1)),
    question,
    matchedAdvantage: cleanText(value.matchedAdvantage, 3_000) || undefined,
    keyword: cleanText(value.keyword, 200) || undefined,
    category: cleanText(value.category, 120) || undefined,
    intent: cleanText(value.intent, 300) || undefined,
    decisionDimension: cleanText(value.decisionDimension, 200) || undefined,
    contentAngle: cleanText(value.contentAngle, 500) || undefined,
    geoOptimizationText: cleanText(value.geoOptimizationText, 2_000) || undefined,
  }
}

async function loadMaterialRecords(ids: string[]): Promise<ArticleQuestionMaterial[]> {
  const loaded: ArticleQuestionMaterial[] = []
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100)
    const records = await Promise.all(
      chunk.map(id => kv.get<ArticleQuestionMaterial>(materialKey(id))),
    )
    loaded.push(...records.filter((item): item is ArticleQuestionMaterial => Boolean(item)))
  }
  return loaded
}

async function acquireImportLock(
  ownerUserId: string,
  clientId: string,
): Promise<() => Promise<void>> {
  const key = importLockKey(ownerUserId, clientId)
  const token = randomUUID()
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await kv.set(key, token, { nx: true, ex: 90 })) {
      return async () => {
        if (await kv.get<string>(key) === token) await kv.del(key)
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error("该客户正在导入文章素材，请稍后再试")
}

export async function listArticleQuestionMaterials(
  ownerUserIdValue: string,
  clientIdValue: string,
): Promise<ArticleQuestionMaterial[]> {
  const ownerUserId = cleanId(ownerUserIdValue, "客户所有者")
  const clientId = cleanId(clientIdValue, "客户")
  const ids = await kv.smembers<string[]>(materialIndexKey(ownerUserId, clientId))
  const materials = (await loadMaterialRecords(ids))
    .filter(item => item.clientId === clientId)
    .sort((left, right) => (
      right.createdAt.localeCompare(left.createdAt)
      || left.rowNumber - right.rowNumber
    ))
  const found = new Set(materials.map(item => item.id))
  const missing = ids.filter(id => !found.has(id))
  if (missing.length > 0) {
    await kv.srem(materialIndexKey(ownerUserId, clientId), ...missing)
  }
  return materials
}

export async function getArticleQuestionMaterialsByIds(input: {
  ownerUserId: string
  clientId: string
  ids: string[]
}): Promise<ArticleQuestionMaterial[]> {
  const ownerUserId = cleanId(input.ownerUserId, "客户所有者")
  const clientId = cleanId(input.clientId, "客户")
  const ids = [...new Set(input.ids.map(id => cleanText(id, 200)).filter(Boolean))].slice(0, 1_000)
  const indexedIds = new Set(
    await kv.smembers<string[]>(materialIndexKey(ownerUserId, clientId)),
  )
  const allowedIds = ids.filter(id => indexedIds.has(id))
  return (await loadMaterialRecords(allowedIds))
    .filter(item => item.clientId === clientId)
    .filter(item => allowedIds.includes(item.id))
    .map(item => ({ ...item }))
}

export async function importArticleQuestionMaterials(input: {
  ownerUserId: string
  clientId: string
  actorUserId: string
  importBatchId: string
  sourceFileName: string
  rows: ArticleQuestionMaterialInput[]
  existingQuestionMaterials?: Array<Pick<
    ArticleQuestionMaterialInput,
    "question" | "matchedAdvantage"
  >>
  /** @deprecated Use existingQuestionMaterials so distinct advantages remain importable. */
  existingQuestionTexts?: string[]
}): Promise<ArticleQuestionMaterialImportResult> {
  const ownerUserId = cleanId(input.ownerUserId, "客户所有者")
  const clientId = cleanId(input.clientId, "客户")
  cleanId(input.actorUserId, "操作用户")
  const importBatchId = validImportBatchId(input.importBatchId)
  const sourceFileName = cleanText(input.sourceFileName, 180) || "导入文件.xlsx"
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new Error("请至少导入一条疑问句")
  }
  if (input.rows.length > MAX_ARTICLE_QUESTION_IMPORT_ROWS) {
    throw new Error(`单次最多导入 ${MAX_ARTICLE_QUESTION_IMPORT_ROWS} 行`)
  }

  const resultKey = importResultKey(ownerUserId, clientId, importBatchId)
  const cached = await kv.get<ArticleQuestionMaterialImportResult>(resultKey)
  if (cached) return cached

  const release = await acquireImportLock(ownerUserId, clientId)
  try {
    const lockedCached = await kv.get<ArticleQuestionMaterialImportResult>(resultKey)
    if (lockedCached) return lockedCached
    const existing = await listArticleQuestionMaterials(ownerUserId, clientId)
    const existingKeys = new Set([
      ...existing.map(item => normalizeArticleQuestionMaterialKey(
        item.question,
        item.matchedAdvantage,
      )),
      ...(input.existingQuestionMaterials || []).map(item => (
        normalizeArticleQuestionMaterialKey(item.question, item.matchedAdvantage)
      )),
      ...(input.existingQuestionTexts || []).map(question => (
        normalizeArticleQuestionMaterialKey(question, undefined)
      )),
    ].filter(Boolean))
    const batchKeys = new Set<string>()
    const created: ArticleQuestionMaterial[] = []
    const skipped: ArticleQuestionMaterialSkippedRow[] = []
    let remainingCapacity = Math.max(0, MAX_STORED_MATERIALS_PER_CLIENT - existing.length)
    const now = new Date().toISOString()

    for (const raw of input.rows) {
      const row = normalizeRow(raw)
      const key = normalizeArticleQuestionMaterialKey(
        row.question,
        row.matchedAdvantage,
      )
      if (!key) {
        skipped.push({
          rowNumber: row.rowNumber,
          question: row.question,
          reason: "invalid",
          message: "疑问句为空或没有有效文字",
        })
        continue
      }
      if (batchKeys.has(key)) {
        skipped.push({
          rowNumber: row.rowNumber,
          question: row.question,
          reason: "duplicate_batch",
          message: "与本次文件中的疑问句与优势组合重复",
        })
        continue
      }
      batchKeys.add(key)
      if (existingKeys.has(key)) {
        skipped.push({
          rowNumber: row.rowNumber,
          question: row.question,
          reason: "duplicate_existing",
          message: "关键词策略或文章素材池中已有相同的疑问句与优势组合",
        })
        continue
      }
      if (remainingCapacity <= 0) {
        skipped.push({
          rowNumber: row.rowNumber,
          question: row.question,
          reason: "capacity",
          message: `当前客户最多保存 ${MAX_STORED_MATERIALS_PER_CLIENT} 条导入素材`,
        })
        continue
      }

      const material: ArticleQuestionMaterial = {
        ...row,
        id: materialId({
          ownerUserId,
          clientId,
          importBatchId,
          rowNumber: row.rowNumber,
          question: row.question,
          matchedAdvantage: row.matchedAdvantage,
        }),
        clientId,
        source: "excel",
        importBatchId,
        sourceFileName,
        createdAt: now,
      }
      created.push(material)
      existingKeys.add(key)
      remainingCapacity -= 1
    }

    await setKvValues(created.map(material => ({
      key: materialKey(material.id),
      value: material,
    })))
    if (created.length > 0) {
      await kv.sadd(
        materialIndexKey(ownerUserId, clientId),
        ...created.map(material => material.id),
      )
    }

    const result: ArticleQuestionMaterialImportResult = {
      importBatchId,
      created,
      skipped,
      createdCount: created.length,
      skippedCount: skipped.length,
      warningCount: created.filter(item => !item.matchedAdvantage).length,
    }
    await kv.set(resultKey, result, { ex: IMPORT_RESULT_TTL_SECONDS })
    return result
  } finally {
    await release()
  }
}

export async function deleteArticleQuestionMaterials(input: {
  ownerUserId: string
  clientId: string
  ids?: string[]
  importBatchId?: string
}): Promise<number> {
  const ownerUserId = cleanId(input.ownerUserId, "客户所有者")
  const clientId = cleanId(input.clientId, "客户")
  const selectedIds = new Set(
    (input.ids || []).map(id => cleanText(id, 200)).filter(Boolean).slice(0, 1_000),
  )
  const batchId = input.importBatchId
    ? validImportBatchId(input.importBatchId)
    : ""
  if (selectedIds.size === 0 && !batchId) return 0

  const materials = await listArticleQuestionMaterials(ownerUserId, clientId)
  const targets = materials.filter(material => (
    selectedIds.has(material.id)
    || (batchId && material.importBatchId === batchId)
  ))
  if (targets.length === 0) return 0

  for (let offset = 0; offset < targets.length; offset += 100) {
    await Promise.all(
      targets.slice(offset, offset + 100)
        .map(material => kv.del(materialKey(material.id))),
    )
  }
  await kv.srem(
    materialIndexKey(ownerUserId, clientId),
    ...targets.map(material => material.id),
  )
  if (batchId) await kv.del(importResultKey(ownerUserId, clientId, batchId))
  return targets.length
}
