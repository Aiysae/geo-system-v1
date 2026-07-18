import { NextRequest, NextResponse } from "next/server"
import { getArticlePromptOption } from "@/lib/article-prompt-meta"
import { createArticleBatch, listArticleBatches } from "@/lib/article-batches/manager"
import { requireUserId } from "@/lib/with-credits"
import type {
  ArticleBatchTopicMode,
  ArticleModelProviderKey,
  ArticlePromptKey,
} from "@/types"
import {
  requireStandardAccountMode,
  resolveWorkspaceAccess,
} from "@/lib/client-accounts"
import { normalizeAnalysisSubjectType } from "@/lib/analysis-subject"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const TOPIC_MODES = new Set<ArticleBatchTopicMode>(["auto", "questions", "custom"])
const PROVIDERS = new Set<ArticleModelProviderKey>([
  "article",
  "deepseek",
  "qwen",
  "doubao",
  "kimi",
  "ernie",
  "hunyuan",
])

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const clientId = text(req.nextUrl.searchParams.get("clientId"), 200)
  if (!clientId) return NextResponse.json({ error: "客户标识缺失" }, { status: 400 })
  const access = await resolveWorkspaceAccess(auth.userId, clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.message, code: access.code }, { status: 403 })
  }
  const batches = await listArticleBatches(access.ownerUserId, clientId)
  return NextResponse.json({ batches }, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  })
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUserId()
    if (!auth.ok) return auth.response
    const accountAccess = await requireStandardAccountMode(auth.userId)
    if (!accountAccess.ok) {
      return NextResponse.json(
        { error: accountAccess.message, code: "CLIENT_ACCOUNT_READ_ONLY" },
        { status: 403 },
      )
    }
    const body = record(await req.json())
    const base = record(body.basePayload)
    const requestId = text(body.requestId, 160)
    const clientId = text(body.clientId, 200)
    const count = Math.floor(Number(body.count))
    const topicMode = text(body.topicMode, 24) as ArticleBatchTopicMode
    const promptKey = text(base.promptKey, 80) as ArticlePromptKey
    const prompt = getArticlePromptOption(promptKey)
    const modelProvider = text(base.modelProvider, 40) as ArticleModelProviderKey

    if (!/^[A-Za-z0-9_-]{16,160}$/.test(requestId)) {
      return NextResponse.json({ error: "批次请求编号无效，请刷新后重试" }, { status: 400 })
    }
    if (!clientId) return NextResponse.json({ error: "客户标识缺失" }, { status: 400 })
    if (!Number.isFinite(count) || count < 2 || count > 50) {
      return NextResponse.json({ error: "批量生成数量必须在 2 到 50 篇之间" }, { status: 400 })
    }
    if (!TOPIC_MODES.has(topicMode)) {
      return NextResponse.json({ error: "请选择有效的批量选题方式" }, { status: 400 })
    }
    if (!prompt || promptKey === "rewrite") {
      return NextResponse.json({ error: "批量生成暂不支持文章改写模板" }, { status: 400 })
    }
    if (!PROVIDERS.has(modelProvider)) {
      return NextResponse.json({ error: "文章模型来源无效" }, { status: 400 })
    }

    const coreQuestion = text(base.coreQuestion, 500)
    if (!coreQuestion) {
      return NextResponse.json({ error: "请先填写核心搜索问题或内容主题" }, { status: 400 })
    }

    const result = await createArticleBatch({
      requestId,
      clientId,
      promptTitle: prompt.title,
      count,
      topicMode,
      customTopics: text(body.customTopics, 30_000),
      similarityRetry: body.similarityRetry !== false,
      basePayload: {
        promptKey,
        modelProvider,
        model: text(base.model, 160),
        clientName: text(base.clientName, 160),
        brandName: text(base.brandName, 160),
        subjectType: normalizeAnalysisSubjectType(base.subjectType),
        subjectContext: text(base.subjectContext, 4_000),
        industry: text(base.industry, 240),
        website: text(base.website, 2_000),
        coreQuestion,
        keywords: text(base.keywords, 8_000),
        region: text(base.region, 240),
        business: text(base.business, 1_000),
        advantages: text(base.advantages, 12_000),
        audience: text(base.audience, 2_000),
        extraRequirements: text(base.extraRequirements, 5_000),
      },
    }, auth.userId)
    if (!result.ok) return result.response
    return NextResponse.json(result.batch, {
      status: result.reused ? 200 : 202,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量文章任务创建失败"
    const inputError = /(请选择|请先|缺失|无效|至少|补足|2 到 50)/.test(message)
    return NextResponse.json({ error: message }, { status: inputError ? 400 : 500 })
  }
}
