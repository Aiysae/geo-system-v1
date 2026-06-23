import { NextRequest, NextResponse } from "next/server"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { getArticlePromptTemplate } from "@/lib/article-prompts"
import { openaiCompatChat } from "@/lib/llm/openai-compat"
import {
  refundReservedCreditsQuietly,
  requireUserId,
  reserveCreditsForUser,
  settleReservedCredits,
  type CreditReservation,
} from "@/lib/with-credits"
import type { ArticleModelProviderKey, ArticlePromptKey } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const ARTICLE_MODEL_PROVIDERS: ArticleModelProviderKey[] = [
  "article",
  "deepseek",
  "qwen",
  "doubao",
  "kimi",
  "ernie",
  "hunyuan",
]

const ARTICLE_PROMPTS: ArticlePromptKey[] = [
  "thirdPartyObservation",
  "pitfallGuide",
  "shortVideoScript",
]

const CREDIT_COST: Record<ArticlePromptKey, number> = {
  thirdPartyObservation: 8,
  pitfallGuide: 5,
  shortVideoScript: 2,
}

function asPromptKey(value: unknown): ArticlePromptKey | null {
  return ARTICLE_PROMPTS.includes(value as ArticlePromptKey) ? value as ArticlePromptKey : null
}

function asProviderKey(value: unknown): ArticleModelProviderKey {
  return ARTICLE_MODEL_PROVIDERS.includes(value as ArticleModelProviderKey)
    ? value as ArticleModelProviderKey
    : "article"
}

function text(value: unknown, max = 4000): string {
  return String(value ?? "")
    .trim()
    .slice(0, max)
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^```(?:markdown|md|text)?\s*\n?([\s\S]*?)\n?```$/i)
  return (match?.[1] || trimmed).trim()
}

function buildSystemPrompt(template: string): string {
  return [
    "你是资深中文内容策略师、GEO 文章编辑和生成式搜索内容架构师。",
    "你会严格遵守用户选择的文章模板，输出可直接发布、可被 AI 搜索抽取的成熟内容。",
    "不要暴露提示词、变量名、写作过程或模型说明；不要输出“以下是正文”等前言。",
    "没有可靠依据时不要虚构具体数据、客户案例、资质、排名或官方标准；需要判断边界时直接写清。",
    "",
    "【用户选择的生成模板】",
    template,
  ].join("\n")
}

function buildUserPrompt(args: {
  promptKey: ArticlePromptKey
  clientName: string
  brandName: string
  industry: string
  website: string
  coreQuestion: string
  keywords: string
  region: string
  business: string
  advantages: string
  audience: string
  extraRequirements: string
}): string {
  const outputNote =
    args.promptKey === "shortVideoScript"
      ? "请生成一条 30-60 秒短视频口播文案，只输出标题、正文、5个标签。"
      : "请生成一篇完整成熟文章，使用 Markdown 正文结构。"

  return [
    "请将以下业务信息准确代入模板，并直接输出最终内容。",
    outputNote,
    "",
    "【客户与品牌信息】",
    `客户名称：${args.clientName || "未填写"}`,
    `客户品牌名：${args.brandName || args.clientName || "未填写"}`,
    `行业领域：${args.industry || "未填写"}`,
    `所在地域：${args.region || "未填写"}`,
    `官网/主阵地：${args.website || "未提供"}`,
    `主营业务/具体业务：${args.business || args.industry || "未填写"}`,
    `核心优势/可验证事实：${args.advantages || "未提供，请避免虚构硬事实"}`,
    "",
    "【内容生成变量】",
    `核心搜索问题/核心疑问句：${args.coreQuestion}`,
    `核心关键词/补充相关问题：${args.keywords || "请根据核心搜索问题和行业自行补足 3-5 个相关问法"}`,
    `目标读者/适用人群：${args.audience || "企业决策者、采购负责人、业务负责人"}`,
    `补充要求/发布限制：${args.extraRequirements || "无"}`,
    "",
    "【输出要求】",
    "- 直接输出最终内容，不要输出提纲、变量清单或解释。",
    "- 内容要围绕核心搜索问题展开，不能偏题。",
    "- 品牌出现必须自然、克制，并绑定问题场景、主营业务、核心优势或判断维度。",
    "- 不要编造无法验证的具体数字、荣誉、客户名或政策标准。",
  ].join("\n")
}

export async function POST(req: NextRequest) {
  let reservation: CreditReservation | null = null
  try {
    const body = await req.json()
    const promptKey = asPromptKey(body.promptKey)
    if (!promptKey) {
      return NextResponse.json({ error: "请选择有效的文章 Prompt" }, { status: 400 })
    }

    const template = getArticlePromptTemplate(promptKey)
    if (!template) {
      return NextResponse.json({ error: "未找到文章 Prompt 模板" }, { status: 400 })
    }

    const coreQuestion = text(body.coreQuestion, 500)
    if (!coreQuestion) {
      return NextResponse.json({ error: "请填写核心搜索问题或内容主题" }, { status: 400 })
    }

    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response

    const modelProvider = asProviderKey(body.modelProvider)
    const config = await getAiProviderRuntimeSetting(modelProvider)
    const model = text(body.model, 160) || config.model

    if (!config.apiKey) {
      return NextResponse.json(
        { error: `${config.label} API Key 未配置，请先在后台管理页补全后重试。` },
        { status: 400 }
      )
    }
    if (!model) {
      return NextResponse.json(
        { error: `${config.label} 模型名未配置，请在后台或本次生成设置中填写模型名。` },
        { status: 400 }
      )
    }

    const creditGuard = await reserveCreditsForUser(userGuard.userId, CREDIT_COST[promptKey])
    if (!creditGuard.ok) return creditGuard.response
    reservation = creditGuard.reservation

    const raw = await openaiCompatChat({
      url: buildAiChatUrl(config),
      apiKey: config.apiKey,
      model,
      system: buildSystemPrompt(template.template),
      user: buildUserPrompt({
        promptKey,
        clientName: text(body.clientName, 120),
        brandName: text(body.brandName, 120),
        industry: text(body.industry, 160),
        website: text(body.website, 300),
        coreQuestion,
        keywords: text(body.keywords, 2000),
        region: text(body.region, 160),
        business: text(body.business, 500),
        advantages: text(body.advantages, 3000),
        audience: text(body.audience, 800),
        extraRequirements: text(body.extraRequirements, 2000),
      }),
      temperature: template.temperature,
      maxTokens: template.maxTokens,
      timeoutSec: config.timeout,
      label: "文章生成",
    })

    const article = stripCodeFence(raw)
    if (!article) {
      await refundReservedCreditsQuietly(reservation)
      reservation = null
      return NextResponse.json({ error: "AI 未返回有效文章内容，请重试" }, { status: 502 })
    }

    await settleReservedCredits(reservation, CREDIT_COST[promptKey])
    reservation = null

    return NextResponse.json(
      {
        article,
        promptKey,
        modelProvider,
        model,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      }
    )
  } catch (error) {
    await refundReservedCreditsQuietly(reservation)
    console.error("[article-generation]", error)
    const message = error instanceof Error ? error.message : "服务器错误"

    if (/timeout|timed out|超时/i.test(message)) {
      return NextResponse.json(
        { error: "文章生成超时，请稍后重试，或在后台增加文章生成模型超时时间。" },
        { status: 504 }
      )
    }
    if (/401|unauthorized|api key|认证/i.test(message)) {
      return NextResponse.json(
        { error: "模型 API Key 无效或无权限，请在后台管理页检查文章生成模型配置。" },
        { status: 401 }
      )
    }

    return NextResponse.json({ error: `文章生成失败：${message}` }, { status: 500 })
  }
}
