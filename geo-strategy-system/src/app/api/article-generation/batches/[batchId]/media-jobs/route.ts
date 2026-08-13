import { NextRequest, NextResponse } from "next/server"
import {
  createArticleMediaJob,
  listArticleMediaJobs,
} from "@/lib/article-media/jobs"
import {
  isTeamAccessError,
  requireArticleBatchAccess,
} from "@/lib/article-batches/access"
import { requireUserId } from "@/lib/with-credits"
import type {
  ArticleMediaMappingMode,
  ArticleMediaTemplateKey,
} from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" }
const TEMPLATES = new Set<ArticleMediaTemplateKey>(["opening", "standard", "rich"])
const MAPPING_MODES = new Set<ArticleMediaMappingMode>(["round_robin", "same_set", "per_article"])

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { batchId } = await context.params
    const authorized = await requireArticleBatchAccess({ batchId, userId: auth.userId, action: "view" })
    if (!authorized) return NextResponse.json({ error: "文章批次不存在" }, { status: 404 })
    const jobs = await listArticleMediaJobs(auth.userId, batchId)
    return NextResponse.json({ jobs }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取配图任务失败" },
      { status: isTeamAccessError(error) ? 403 : 500, headers: NO_STORE_HEADERS },
    )
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { batchId } = await context.params
    const authorized = await requireArticleBatchAccess({ batchId, userId: auth.userId, action: "edit" })
    if (!authorized) return NextResponse.json({ error: "文章批次不存在" }, { status: 404 })
    const body = await req.json().catch(() => ({})) as {
      clientId?: string
      requestId?: string
      itemIds?: string[]
      assetIds?: string[]
      itemAssetMap?: Record<string, string[]>
      template?: ArticleMediaTemplateKey
      mappingMode?: ArticleMediaMappingMode
    }
    if (body.clientId && authorized.batch.clientId !== String(body.clientId).trim()) {
      return NextResponse.json({ error: "文章批次与当前客户不一致" }, { status: 400 })
    }
    const template = String(body.template || "standard") as ArticleMediaTemplateKey
    const mappingMode = String(body.mappingMode || "round_robin") as ArticleMediaMappingMode
    if (!TEMPLATES.has(template) || !MAPPING_MODES.has(mappingMode)) {
      return NextResponse.json({ error: "配图规则无效" }, { status: 400 })
    }
    const requestId = String(body.requestId || "").trim()
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(requestId)) {
      return NextResponse.json({ error: "配图任务标识无效" }, { status: 400 })
    }
    const result = await createArticleMediaJob({
      ownerUserId: auth.userId,
      workspaceOwnerUserId: authorized.access.dataOwnerUserId,
      teamId: authorized.access.teamId,
      batchId,
      requestId,
      itemIds: Array.isArray(body.itemIds) ? body.itemIds : [],
      assetIds: Array.isArray(body.assetIds) ? body.assetIds : [],
      itemAssetMap: body.itemAssetMap,
      template,
      mappingMode,
    })
    return NextResponse.json(result, { status: result.reused ? 200 : 202, headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建批量配图任务失败" },
      { status: isTeamAccessError(error) ? 403 : 500, headers: NO_STORE_HEADERS },
    )
  }
}
