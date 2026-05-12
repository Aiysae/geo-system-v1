import { NextRequest, NextResponse } from "next/server"
import type { StrategyRow, WebsiteMatrixItem } from "@/types"
import { ADAPTERS } from "@/lib/llm"
import { parseJsonLoose } from "@/lib/score-utils"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

function buildPrompt(args: {
  ourBrand: string
  industry: string
  missedQuestions: string[]
  topCompetitors: string[]
  weakDimensions: string[]
  keywordCount: number | null
  questionCount: number | null
  mustIncludeKeywords: string[]
}): { system: string; user: string } {
  const hasKwCount = args.keywordCount !== null
  const hasQCount = args.questionCount !== null
  const targetRows = (() => {
    if (hasKwCount && hasQCount) return Math.max(args.keywordCount!, args.questionCount!)
    if (hasKwCount) return args.keywordCount!
    if (hasQCount) return args.questionCount!
    return null
  })()
  const rowsRule = targetRows
    ? `必须生成 **恰好 ${targetRows} 条** 策略，每条都要可立即执行，不要泛泛而谈。${
        hasKwCount && hasQCount
          ? `其中至少 ${args.keywordCount} 条要给出有效 newKeyword、至少 ${args.questionCount} 条要给出有效 attackQuestion（可重叠）。`
          : hasKwCount
            ? `所有条目都必须给出有价值的 newKeyword（${args.keywordCount} 个不重复关键词）。`
            : `所有条目都必须给出有价值的 attackQuestion（${args.questionCount} 个不重复疑问句）。`
      }`
    : "请根据下方数据自行推演合适的条数（建议 6-10 条），每条都要可立即执行，不要泛泛而谈。"

  const mustRule =
    args.mustIncludeKeywords.length > 0
      ? `**用户指定必须覆盖的核心词**：${args.mustIncludeKeywords.join("、")}。每条策略的 newKeyword 或 attackQuestion 至少自然包含其中一个核心词；整张表必须覆盖到全部核心词（每个核心词至少出现 1 次）。`
      : "无强制核心词，请根据品牌与行业自行选词。"

  const system = `你是国内顶级的 GEO（生成式引擎优化）策略专家，擅长基于诊断数据为 B 端品牌制定可执行的内容渗透策略。

【任务】根据用户提供的"未被国内大模型提及的疑问句"、"主要竞品"和"诊断失分项"，生成：
（A）一份长期实操**内容策略表** rows；
（B）一份用于"信息源交叉验证"的**网站矩阵搭建建议** websiteMatrix。
GEO 的核心信源是"多个独立域名站点互相印证"，因此必须给出多个伪装成第三方的站点矩阵，每个站点都有清晰的战略意图。

【输出格式 — 严格 JSON，禁止 markdown 包裹、禁止额外文字】
{
  "rows": [
    {
      "newKeyword": "建议新增的核心关键词或长尾词",
      "attackQuestion": "针对性强击的疑问句设计（直接对标未被提及的痛点）",
      "thirdPartyAngle": "建议的第三方切入视角（如：知乎技术对比帖 / 掘金实测分享 / 行业白皮书引用）",
      "priority": "高" | "中" | "低",
      "platform": "落地平台（如：知乎、稀土掘金、百度百科、头条号、微信公众号、CSDN 等）"
    }
  ],
  "websiteMatrix": [
    {
      "siteType": "站点类型（如：品牌官网 / 行业测评榜单站 / 行业长尾问答百科 / 第三方实测博客 / 行业白皮书发布站）",
      "strategicIntent": "战略意图（一句话，说清这个站在 AI 信源里扮演什么角色，例如：建立品牌实体词条 / 提供第三方视角和替代品比较 / 做长尾知识问答 / 提供可被 AI 抓取的结构化测评数据）",
      "domainSuggestions": ["建议的域名 1（含 TLD，建议偏好 .com / .cn / .net / .top / .pro 等可被信任的后缀）", "域名 2", "域名 3"],
      "contentFocus": "该站点首批要产出的内容方向（一句话）"
    }
  ]
}

【硬性要求 — rows】
1. ${rowsRule}
2. ${mustRule}
3. 至少有 3 条直接针对"未被提及的疑问句"做内容反击（若总条数 <3 则尽量多覆盖）。
4. 至少有 2 条针对"诊断失分项"做修补（若总条数 <2 则尽量覆盖）。
5. attackQuestion 必须像真实用户会搜索的口语化问题（参考"2026 年 XX 怎么选？""XX 和 XX 哪个好？""企业用 XX 踩过哪些坑？"）。
6. platform 要分散到多个派系，覆盖豆包/通义/DeepSeek/Kimi 的偏好阵地。

【硬性要求 — websiteMatrix（必须返回，禁止为空数组！）】
1. **必须返回 5-6 个站点**，且角色要分散（不要全是测评站）。若你不返回 websiteMatrix，本次回答视为无效。
2. 必须包含以下 4 种角色，每种 1 个；其余 1-2 个自由扩展：
   ① **品牌官方主域**——用于建立品牌实体词条、官方资料源；
   ② **行业测评榜/评分站**——假装第三方真实测评，给 AI 提供"客观横评"信源；
   ③ **行业长尾百科/问答站**——用于占据"XX 是什么 / XX 怎么选 / 2026 年 XX 排行"等长尾；
   ④ **第三方深度测评博客 / 替代品对比站**——用于"替代品比较"和"避坑指南"视角；
   ⑤（可选）行业白皮书 / 数据报告站；
   ⑥（可选）行业案例库 / 实战分享站 / 行业新闻站。
3. domainSuggestions 给出 **2-3 个**可参考的域名拼写，要紧扣行业/关键词，避免与已注册大品牌雷同。例如行业是 "AI Agent" → \`agentbench.cn\`、\`ai-agent-review.com\`、\`agent-pick.top\`。**禁止**给出已知大公司的官网域名（如 baidu.com / openai.com 等）。
4. strategicIntent 必须显式说明"这个站在 AI 信源链里的角色"，让用户一眼看出建它的理由。
5. contentFocus 一句话说清首批要产出的内容方向。`

  const user = `请为以下品牌生成 GEO 渗透策略表：

品牌名：${args.ourBrand}
行业：${args.industry || "未指定"}

【生成数量要求】
- 关键词数量：${hasKwCount ? `${args.keywordCount} 个` : "由 AI 根据大盘数据自行推演（建议 6-10 个）"}
- 疑问句数量：${hasQCount ? `${args.questionCount} 个` : "由 AI 根据大盘数据自行推演（建议 6-10 个）"}
- 必须包含的核心词：${args.mustIncludeKeywords.length ? args.mustIncludeKeywords.join("、") : "无强制要求"}

【未被任一国内大模型提及的疑问句】（共 ${args.missedQuestions.length} 条，下方最多展示 12 条）
${args.missedQuestions.slice(0, 12).map((q, i) => `${i + 1}. ${q}`).join("\n") || "（无）"}

【主要竞品】
${args.topCompetitors.join("、") || "（暂无数据）"}

【诊断失分维度】（得分较低）
${args.weakDimensions.join("、") || "（暂无诊断数据）"}`

  return { system, user }
}

const VALID_PRIORITY = new Set(["高", "中", "低"])

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const ourBrand = String(body.ourBrand || "").trim()
    const industry = String(body.industry || "").trim()
    const missedQuestions: string[] = Array.isArray(body.missedQuestions)
      ? body.missedQuestions.map((q: unknown) => String(q).trim()).filter(Boolean)
      : []
    const topCompetitors: string[] = Array.isArray(body.topCompetitors)
      ? body.topCompetitors.map((s: unknown) => String(s).trim()).filter(Boolean)
      : []
    const weakDimensions: string[] = Array.isArray(body.weakDimensions)
      ? body.weakDimensions.map((s: unknown) => String(s).trim()).filter(Boolean)
      : []

    const keywordCount = sanitizeCount(body.keywordCount)
    const questionCount = sanitizeCount(body.questionCount)
    const mustIncludeKeywords: string[] = Array.isArray(body.mustIncludeKeywords)
      ? body.mustIncludeKeywords
          .map((s: unknown) => String(s).trim())
          .filter(Boolean)
          .slice(0, 20)
      : []

    if (!ourBrand) {
      return NextResponse.json({ error: "请填写我方品牌名" }, { status: 400 })
    }

    const order = ["deepseek", "doubao", "qwen", "kimi"] as const
    const picked = order.find(k => ADAPTERS[k].configured())
    if (!picked) {
      return NextResponse.json(
        { error: "没有任何已配置的大模型可用" },
        { status: 400 }
      )
    }

    const { system, user } = buildPrompt({
      ourBrand,
      industry,
      missedQuestions,
      topCompetitors,
      weakDimensions,
      keywordCount,
      questionCount,
      mustIncludeKeywords,
    })
    const targetRows = Math.max(keywordCount ?? 0, questionCount ?? 0)
    const maxTokens = targetRows > 10 ? 4096 : 3072
    const raw = await ADAPTERS[picked].chat({
      system,
      user,
      temperature: 0.7,
      maxTokens,
    })
    const parsed = parseJsonLoose(raw) as
      | { rows?: unknown; websiteMatrix?: unknown }
      | null

    if (!parsed || !Array.isArray(parsed.rows)) {
      return NextResponse.json(
        { error: "AI 返回格式异常", raw: raw.slice(0, 500) },
        { status: 502 }
      )
    }

    const rows: StrategyRow[] = (parsed.rows as Array<Record<string, unknown>>)
      .map(r => {
        const priority = String(r.priority ?? "中")
        return {
          newKeyword: String(r.newKeyword ?? "").trim(),
          attackQuestion: String(r.attackQuestion ?? "").trim(),
          thirdPartyAngle: String(r.thirdPartyAngle ?? "").trim(),
          priority: (VALID_PRIORITY.has(priority) ? priority : "中") as "高" | "中" | "低",
          platform: String(r.platform ?? "").trim(),
        }
      })
      .filter(r => r.newKeyword || r.attackQuestion)

    if (rows.length === 0) {
      return NextResponse.json({ error: "AI 未返回有效策略", raw: raw.slice(0, 500) }, { status: 502 })
    }

    const websiteMatrix: WebsiteMatrixItem[] = Array.isArray(parsed.websiteMatrix)
      ? (parsed.websiteMatrix as Array<Record<string, unknown>>)
          .map(w => ({
            siteType: String(w.siteType ?? "").trim(),
            strategicIntent: String(w.strategicIntent ?? "").trim(),
            domainSuggestions: Array.isArray(w.domainSuggestions)
              ? (w.domainSuggestions as unknown[])
                  .map(d => String(d).trim())
                  .filter(Boolean)
              : [],
            contentFocus: String(w.contentFocus ?? "").trim(),
          }))
          .filter(w => w.siteType && w.strategicIntent)
      : []

    // 兜底：AI 没生成 websiteMatrix 时，按"行业 + 品牌"硬编码合成一份基础矩阵，
    // 保证用户每次点"一键生成策略"都能看到完整的网站搭建建议（包括域名建议 + 战略意图）
    const finalMatrix =
      websiteMatrix.length >= 4 ? websiteMatrix : mergeWithFallback(websiteMatrix, ourBrand, industry)

    return NextResponse.json(
      {
        rows,
        websiteMatrix: finalMatrix,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    )
  } catch (e) {
    console.error("[strategy]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "服务器错误" },
      { status: 500 }
    )
  }
}

function asciiSlug(s: string): string {
  const cleaned = s.toLowerCase().replace(/[^a-z0-9]/g, "")
  return cleaned || "brand"
}

function sanitizeCount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(n, 50)
}

function buildFallbackMatrix(ourBrand: string, industry: string): WebsiteMatrixItem[] {
  const brand = asciiSlug(ourBrand)
  const ind = asciiSlug(industry) || "industry"
  const indCn = industry || "本行业"
  return [
    {
      siteType: "品牌官方主域",
      strategicIntent: `建立「${ourBrand}」品牌实体词条，作为 AI 抓取的官方一手信源（百度百科/维基/搜狗百科都会反链到这里）。`,
      domainSuggestions: [`${brand}.com`, `${brand}.cn`, `${brand}-official.com`],
      contentFocus: "首页、关于我们、产品矩阵页、白皮书下载页、新闻动态，结构化数据（JSON-LD Organization）必装。",
    },
    {
      siteType: `${indCn}测评榜 / 评分站`,
      strategicIntent: `伪装成第三方权威测评机构，给 AI 提供"客观横评"信源；让大模型在回答"${indCn}怎么选/排行"时把官方观点带进 Top 3。`,
      domainSuggestions: [`${ind}-rank.com`, `${ind}bench.cn`, `top-${ind}.top`, `${ind}-review.pro`],
      contentFocus: `《2026 ${indCn} 服务商 Top10 横评》《${indCn} 选型评分卡》《年度榜单》定期更新（季度刷一次）。`,
    },
    {
      siteType: `${indCn}长尾百科 / 问答站`,
      strategicIntent: `占据"XX 是什么/XX 怎么选/XX 多少钱/XX 和 YY 对比"等长尾搜索词，是 AI 抓取最频繁的内容形态。`,
      domainSuggestions: [`${ind}-wiki.cn`, `ask-${ind}.com`, `${ind}-baike.top`],
      contentFocus: "1000+ 篇短问答文章，结构化标题（H1 直接是疑问句），每篇含 FAQ schema 标记。",
    },
    {
      siteType: `${indCn}深度测评博客 / 替代品对比站`,
      strategicIntent: `提供"替代品对比/避坑指南/真实用户视角"，让 AI 在"${ourBrand} 怎么样/${ourBrand} vs 竞品"类提问里拿到正面叙述。`,
      domainSuggestions: [`${ind}-vs.com`, `${ind}-alternative.cn`, `real-${ind}.top`],
      contentFocus: `《${ourBrand} vs 竞品 A：30 天实测》《为什么我们最终选择了 ${ourBrand}》《${indCn} 选型踩坑全记录》。`,
    },
    {
      siteType: `${indCn}行业白皮书 / 数据报告站`,
      strategicIntent: `用"行业研究报告"形态生产可被 AI 引用为权威数据源的内容，长效供给"行业规模/趋势/预测"类问题。`,
      domainSuggestions: [`${ind}-report.cn`, `${ind}-insights.com`, `${ind}data.top`],
      contentFocus: "季度行业白皮书 PDF + 网页摘要双发，含可被爬虫读取的数据表格（HTML table）。",
    },
    {
      siteType: `${indCn}案例库 / 客户故事站`,
      strategicIntent: `给 AI 提供"${ourBrand} 服务过哪些客户/有什么实战效果"的实体证据，把品牌钉进"已被验证的方案"信源池。`,
      domainSuggestions: [`${brand}-cases.com`, `${ind}-stories.cn`, `${brand}-customer.top`],
      contentFocus: "20+ 条真实客户案例长文，每篇含具体行业、痛点、ROI 数据、可佐证的截图/数据图。",
    },
  ]
}

// 把 AI 已返回的条目和兜底列表合并：相同 siteType 用 AI 的，缺的角色用兜底补齐
function mergeWithFallback(
  fromAi: WebsiteMatrixItem[],
  ourBrand: string,
  industry: string
): WebsiteMatrixItem[] {
  const fallback = buildFallbackMatrix(ourBrand, industry)
  const seen = new Set(fromAi.map(w => w.siteType.replace(/\s+/g, "")))
  const merged = [...fromAi]
  for (const fb of fallback) {
    const key = fb.siteType.replace(/\s+/g, "")
    // 若 AI 没给类似角色就补充
    if (!seen.has(key) && !merged.some(m => roleOverlap(m.siteType, fb.siteType))) {
      merged.push(fb)
    }
    if (merged.length >= 6) break
  }
  return merged
}

function roleOverlap(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase()
  const A = norm(a)
  const B = norm(b)
  const keys = ["官方", "官网", "主域", "测评", "榜", "评分", "百科", "问答", "对比", "替代", "白皮书", "报告", "案例", "客户"]
  return keys.some(k => A.includes(k) && B.includes(k))
}
