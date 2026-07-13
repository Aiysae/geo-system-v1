import { NextRequest, NextResponse } from "next/server"
import { createCommercialReportJob } from "@/lib/reports/report-jobs"
import { validateReportBranding } from "@/lib/reports/report-branding-store"
import { requireUserId } from "@/lib/with-credits"
import type {
  CommercialReportDetail,
  CommercialReportInput,
  CommercialReportKind,
  DifficultyAssessmentEntry,
  PenetrationResult,
} from "@/types"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const MAX_REPORT_PAYLOAD_BYTES = 20 * 1024 * 1024
const REPORT_KINDS = new Set<CommercialReportKind>(["combined", "penetration", "difficulty"])
const REPORT_DETAILS = new Set<CommercialReportDetail>(["concise", "full"])
const MODEL_KEYS = new Set(["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function limitedString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .map(item => limitedString(item, maxLength))
    .filter(Boolean)
}

function validPenetration(value: unknown): value is PenetrationResult {
  if (!isRecord(value) || !isRecord(value.byModel) || !isRecord(value.aggregated)) return false
  if (typeof value.generatedAt !== "string") return false

  let totalAnswers = 0
  for (const [model, items] of Object.entries(value.byModel)) {
    if (!MODEL_KEYS.has(model) || !Array.isArray(items) || items.length > 600) return false
    totalAnswers += items.length
    if (totalAnswers > 3_600) return false
    for (const item of items) {
      if (!isRecord(item) || typeof item.question !== "string" || typeof item.answer !== "string") return false
      if (!Array.isArray(item.mentionedBrands)) return false
      if (item.hitOur !== undefined && typeof item.hitOur !== "boolean") return false
      if (item.searchSources !== undefined && (!Array.isArray(item.searchSources) || item.searchSources.length > 200)) return false
    }
  }

  const aggregated = value.aggregated
  return typeof aggregated.penetrationRate === "number"
    && typeof aggregated.ourMentions === "number"
    && typeof aggregated.totalSlots === "number"
    && Array.isArray(aggregated.industryShare)
    && aggregated.industryShare.length <= 1_000
    && Array.isArray(aggregated.perModelRate)
    && aggregated.perModelRate.length <= 6
    && Array.isArray(aggregated.missedQuestions)
    && aggregated.missedQuestions.length <= 600
    && Array.isArray(aggregated.topCompetitors)
}

function validDifficulty(value: unknown): value is DifficultyAssessmentEntry {
  if (!isRecord(value) || !isRecord(value.result) || !isRecord(value.result.dimensions)) return false
  return typeof value.id === "string"
    && typeof value.industry === "string"
    && typeof value.city === "string"
    && typeof value.createdAt === "string"
    && typeof value.result.totalScore === "number"
    && typeof value.result.level === "string"
    && typeof value.result.summary === "string"
    && Object.keys(value.result.dimensions).length <= 50
    && Array.isArray(value.result.insights)
    && Array.isArray(value.result.suggestions)
}

function parseInput(value: unknown): CommercialReportInput | null {
  if (!isRecord(value) || !isRecord(value.client)) return null
  const kind = value.kind as CommercialReportKind
  const detail = value.detail as CommercialReportDetail
  if (!REPORT_KINDS.has(kind) || !REPORT_DETAILS.has(detail)) return null

  const client = {
    id: limitedString(value.client.id, 160),
    name: limitedString(value.client.name, 160),
    ourBrand: limitedString(value.client.ourBrand, 160),
    brandAliases: stringList(value.client.brandAliases, 100, 160),
    industry: limitedString(value.client.industry, 240),
    website: limitedString(value.client.website, 2_000),
  }
  if (!client.id || !client.name) return null

  const penetration = value.penetration === undefined ? undefined : value.penetration
  const difficulty = value.difficulty === undefined ? undefined : value.difficulty
  if (penetration !== undefined && !validPenetration(penetration)) return null
  if (difficulty !== undefined && !validDifficulty(difficulty)) return null
  if (kind === "penetration" && !penetration) return null
  if (kind === "difficulty" && !difficulty) return null
  if (kind === "combined" && !penetration && !difficulty) return null

  return {
    kind,
    detail,
    branding: validateReportBranding(value.branding),
    client,
    penetration: penetration as PenetrationResult | undefined,
    difficulty: difficulty as DifficultyAssessmentEntry | undefined,
  }
}

export async function POST(req: NextRequest) {
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response

    const contentLength = Number(req.headers.get("content-length") || 0)
    if (contentLength > MAX_REPORT_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "报告数据过大，请选择精简版后重试" }, { status: 413 })
    }

    const body = await req.json()
    const input = parseInput(isRecord(body) ? body.input : null)
    if (!input) {
      return NextResponse.json({ error: "报告数据不完整或格式异常" }, { status: 400 })
    }
    if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_REPORT_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "报告数据过大，请选择精简版后重试" }, { status: 413 })
    }

    const job = await createCommercialReportJob(input, userGuard.userId)
    return NextResponse.json(job, { status: 202 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建专业报告任务失败" },
      { status: 400 },
    )
  }
}
