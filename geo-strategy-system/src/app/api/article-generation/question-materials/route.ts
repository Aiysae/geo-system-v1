import { NextRequest, NextResponse } from "next/server"
import {
  deleteArticleQuestionMaterials,
  importArticleQuestionMaterials,
  listArticleQuestionMaterials,
} from "@/lib/article-question-materials"
import { MAX_ARTICLE_QUESTION_IMPORT_ROWS } from "@/lib/article-question-import"
import {
  extractQuestionAdvantages,
  resolveQuestionAdvantage,
} from "@/lib/geo-strategy/question-advantages"
import {
  isOperationAccessError,
  requireOperationAccess,
} from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type { ArticleQuestionMaterialInput } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_BODY_BYTES = 8 * 1024 * 1024

function noStore(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      ...init?.headers,
      "Cache-Control": "private, no-store, no-cache, must-revalidate",
    },
  })
}

function text(value: unknown, max = 3_000): string {
  return String(value ?? "").trim().slice(0, max)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseRows(value: unknown): ArticleQuestionMaterialInput[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_ARTICLE_QUESTION_IMPORT_ROWS + 1).map(raw => {
    const row = record(raw)
    return {
      rowNumber: Math.max(1, Math.floor(Number(row.rowNumber) || 1)),
      question: text(row.question, 500),
      matchedAdvantage: text(row.matchedAdvantage, 3_000) || undefined,
      keyword: text(row.keyword, 200) || undefined,
      category: text(row.category, 120) || undefined,
      intent: text(row.intent, 300) || undefined,
      decisionDimension: text(row.decisionDimension, 200) || undefined,
      contentAngle: text(row.contentAngle, 500) || undefined,
      geoOptimizationText: text(row.geoOptimizationText, 2_000) || undefined,
    }
  })
}

export async function GET(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const clientId = text(request.nextUrl.searchParams.get("clientId"), 200)
    const teamId = text(request.nextUrl.searchParams.get("teamId"), 200) || undefined
    if (!clientId) return noStore({ error: "客户标识缺失" }, { status: 400 })
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "article",
      action: "view",
      teamId,
    })
    const materials = await listArticleQuestionMaterials(
      access.dataOwnerUserId,
      access.clientId,
    )
    return noStore({ materials })
  } catch (error) {
    return noStore(
      { error: error instanceof Error ? error.message : "读取文章素材失败" },
      { status: isOperationAccessError(error) ? 403 : 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const contentLength = Number(request.headers.get("content-length") || 0)
    if (contentLength > MAX_BODY_BYTES) {
      return noStore({ error: "导入内容过多，请拆分文件后重试" }, { status: 413 })
    }
    const body = record(await request.json())
    const clientId = text(body.clientId, 200)
    const teamId = text(body.teamId, 200) || undefined
    const rows = parseRows(body.rows)
    if (!clientId) return noStore({ error: "客户标识缺失" }, { status: 400 })
    if (rows.length === 0) {
      return noStore({ error: "请至少导入一条疑问句" }, { status: 400 })
    }
    if (rows.length > MAX_ARTICLE_QUESTION_IMPORT_ROWS) {
      return noStore(
        { error: `单次最多导入 ${MAX_ARTICLE_QUESTION_IMPORT_ROWS} 行` },
        { status: 400 },
      )
    }
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "article",
      action: "edit",
      teamId,
    })
    const client = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(item => item.client.id === access.clientId)?.client
    if (!client) return noStore({ error: "客户档案不存在" }, { status: 404 })

    const keywordAdvantages = extractQuestionAdvantages(
      client.keywordStrategy?.strategyPlan,
    )
    const result = await importArticleQuestionMaterials({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      actorUserId: access.actorUserId,
      importBatchId: text(body.importBatchId, 120),
      sourceFileName: text(body.sourceFileName, 180),
      rows,
      existingQuestionMaterials: (client.keywordStrategy?.questions || []).map(item => ({
        question: item.question,
        matchedAdvantage: item.matched_advantage?.trim()
          || resolveQuestionAdvantage(item, keywordAdvantages)
          || undefined,
      })),
    })
    return noStore(result, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入文章素材失败"
    return noStore(
      { error: message },
      {
        status: isOperationAccessError(error)
          ? 403
          : /正在导入/.test(message)
            ? 409
            : 400,
      },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const body = record(await request.json())
    const clientId = text(body.clientId, 200)
    const teamId = text(body.teamId, 200) || undefined
    if (!clientId) return noStore({ error: "客户标识缺失" }, { status: 400 })
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "article",
      action: "edit",
      teamId,
    })
    const deletedCount = await deleteArticleQuestionMaterials({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      ids: Array.isArray(body.ids)
        ? body.ids.map(item => text(item, 200)).filter(Boolean)
        : [],
      importBatchId: text(body.importBatchId, 120) || undefined,
    })
    return noStore({ ok: true, deletedCount })
  } catch (error) {
    return noStore(
      { error: error instanceof Error ? error.message : "删除文章素材失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}
