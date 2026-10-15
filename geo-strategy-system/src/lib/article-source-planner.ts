import "server-only"

import { resolveArticleAuxiliaryModel } from "@/lib/article-models"
import { runArticleModelChat } from "@/lib/article-model-runtime"

export interface ArticleSourcePlan {
  laws: string[]
  standards: string[]
}

const MAX_NAMES = 3
const MAX_NAME_LENGTH = 60

/**
 * Asks the cheap auxiliary model which laws, regulations and national
 * standards govern the article's question. Generic keyword searches rarely
 * reach national documents, while searching their exact names does. The names
 * are only search terms: a misremembered title simply finds nothing, and only
 * authoritative, on-topic search results ever reach the writer.
 */
export function buildArticleSourcePlanningPrompt(args: {
  coreQuestion: string
  industry?: string
  region?: string
}): string {
  return [
    "下面是一篇中文文章要回答的问题。请列出与它直接相关、真实存在的中国法律法规和国家/行业标准的正式名称，供检索官方原文。",
    "直接相关包括：调整该问题中交易、合同、服务或行为的基础法律（例如服务合作、验收、修改、违约等问题适用“中华人民共和国民法典”合同编），以及该行业的专门法规和标准。",
    "只列你确信真实存在的；名称或编号不确定就不列，不要为凑数列入只是同一大领域、但不能回答该问题的法规。没有就返回空数组。",
    "法律法规写全称（如“中华人民共和国民法典”“政府采购需求管理办法”）；标准写编号加名称（如“GB/T 35273 信息安全技术 个人信息安全规范”）。",
    `各最多 ${MAX_NAMES} 个，按相关性排序。只输出 JSON：{"laws":["..."],"standards":["..."]}`,
    "",
    `问题：${args.coreQuestion}`,
    `行业：${args.industry || "未填写"}`,
    `地域：${args.region || "未填写"}`,
  ].join("\n")
}

function cleanNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names = value
    .map(item => String(item ?? "").replace(/[《》“”"]/g, "").replace(/\s+/g, " ").trim())
    .filter(name => name.length >= 4 && name.length <= MAX_NAME_LENGTH)
  return Array.from(new Set(names)).slice(0, MAX_NAMES)
}

export function parseArticleSourcePlan(content: string): ArticleSourcePlan {
  const source = String(content || "")
  const start = source.indexOf("{")
  const end = source.lastIndexOf("}")
  if (start < 0 || end <= start) return { laws: [], standards: [] }
  try {
    const parsed = JSON.parse(source.slice(start, end + 1)) as Record<string, unknown>
    return { laws: cleanNames(parsed.laws), standards: cleanNames(parsed.standards) }
  } catch {
    return { laws: [], standards: [] }
  }
}

/** Search terms aimed at official texts: government sites for laws, the national standard system for standards. */
export function articleSourcePlanQueries(plan: ArticleSourcePlan): string[] {
  return [
    ...plan.laws.map(name => `${name} site:gov.cn`),
    ...plan.standards.map(name => `${name} site:samr.gov.cn`),
  ]
}

export async function planArticleAuthoritativeSources(args: {
  coreQuestion: string
  industry?: string
  region?: string
  signal: AbortSignal
  userId: string
}): Promise<ArticleSourcePlan> {
  try {
    const result = await runArticleModelChat(await resolveArticleAuxiliaryModel(), {
      signal: args.signal,
      system: "你是熟悉中国法律法规和国家标准体系的检索助理。只输出 JSON，不编造不存在的法规或标准。",
      user: buildArticleSourcePlanningPrompt(args),
      temperature: 0,
      maxTokens: 400,
      jsonMode: true,
      mode: "judge",
      label: "法规标准检索规划",
      webPolicy: "disabled",
      requestTimeoutMs: 20_000,
      totalTimeoutMs: 30_000,
      usageContext: { userId: args.userId, task: "article_source_planning" },
    })
    return parseArticleSourcePlan(result.content)
  } catch (error) {
    args.signal.throwIfAborted()
    // Planning only widens the search; without it the article still gets the
    // standard authoritative queries.
    console.warn("[article-source-planner] skipped", error instanceof Error ? error.message : error)
    return { laws: [], standards: [] }
  }
}
