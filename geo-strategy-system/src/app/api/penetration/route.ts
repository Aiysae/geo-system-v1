import { NextRequest, NextResponse } from "next/server"
import type {
  ModelKey,
  PenetrationByModel,
  PenetrationItem,
  PenetrationPromptPurity,
  PenetrationSource,
  PenetrationSearchMode,
  SourceDomainCount,
} from "@/types"
import { ADAPTERS } from "@/lib/llm"
import { aggregatePenetration, isSameBrand, parseJsonLoose } from "@/lib/score-utils"
import { isPlatformName } from "@/lib/platform-blacklist"
import {
  authAndReserveCredits,
  refundReservedCreditsQuietly,
  settleReservedCredits,
  type CreditReservation,
} from "@/lib/with-credits"
import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"
export const revalidate = 0

const BLIND_QUERY_TIMEOUT_SEC = 75
const BLIND_QUERY_MAX_TOKENS = 2048
const JUDGE_BATCH_TIMEOUT_SEC = 45
const JUDGE_BATCH_MAX_TOKENS = 3072

interface PenetrationAuditProfile {
  searchMode: PenetrationSearchMode
  promptPurity: PenetrationPromptPurity
  webVerificationNote: string
}

// ============================================================================
// 两阶段管线
//   Stage A · 客观联网单问
//     - 每个 (model, question) 都是独立请求
//     - 给被测模型只发用户疑问句本身，不注入 system prompt、目标品牌或检测意图
//     - 通过模型原生联网参数或 search_web 工具选择强制联网搜索
//     - 输出：纯自然语言回答（不强制 JSON）
//
//   Stage B · 独立裁判 AI 批量检测
//     - 每个被测模型的多条回答打包后交给裁判，减少请求次数与网关耗时
//     - 裁判不联网，只审阅回答原文，避免引入原回答没有出现的新品牌
//     - 输出严格 JSON：每条回答中提到的所有具体品牌、最被推荐的那个
//
//   Stage C · 代码层最终安全网
//     - 全称直接命中，或裁判抽取且通过回答原文字面校验的同品牌简称/别名命中
//     - 裁判给出的 mentionedBrands 也必须能在 answer 文本里找到对应字面，
//       否则丢弃（防止裁判反过来又产生幻觉）
// ============================================================================

// ---------- Stage B · 裁判 System Prompt ----------
function buildJudgeSystemPrompt(): string {
  return `你是一个严谨的"品牌识别引擎"。你的唯一任务是逐条审阅一组 AI 回答原文，从中客观抽取被提到的具体品牌、公司、产品或服务商名称。

【硬性纪律 — 严禁幻觉】
1. 只识别真实出现在对应回答原文里的名字，保持原文写法。严禁补充、推测、扩展任何原文没有写出的品牌。
2. "品牌/公司/产品/服务商"必须是专有名词。严禁把以下内容当作品牌输出：
   - 地域词：深圳、香港、深港、本地、附近、全国、海外
   - 类目词：全屋定制、整装、装修、家装、家居、家具、设计、施工、木作、衣柜、橱柜
   - 属性/形容词：高端、性价比、靠谱、可靠、专业、优质、环保、进口、国产、预算有限
   - 业务/能力词：板材、工艺、案例、口碑、售后、门店、工厂、套餐、方案、供应链、报价、验收
   - 泛称：品牌、公司、服务商、供应商、厂家、商家、团队、机构、平台
   除非这些词是一个完整专有名词的一部分，例如"尚品宅配""欧派家居"可以输出；"高端全屋定制""深圳本地公司"不能输出。
3. 排除以下"平台/媒体/渠道/通用 AI 工具"类目（这些不是行业品牌）：
   - 内容平台：小红书、抖音、快手、B站、知乎、微博、微信、公众号、视频号、今日头条、百家号、CSDN、掘金、简书、豆瓣、贴吧、虎扑
   - 电商：淘宝、天猫、京东、拼多多、唯品会、苏宁、美团、大众点评
   - 搜索/通用：百度、谷歌、Google、Bing、必应、搜狗、360、夸克
   - AI 通用大模型本体：豆包、DeepSeek、通义千问、Kimi、文心一言、腾讯元宝、混元、ChatGPT、Claude
4. 已知竞品清单只用于帮助识别名称，绝不能因此把原文没有出现的品牌写进结果。
5. 如果一个词看起来像描述、类目、形容词或普通名词，不确定时一律不要输出。
6. 每个输入 id 必须且只能对应一个输出项，不得遗漏或新增 id。

【输出格式 — 严格 JSON，禁止 markdown 包裹、禁止任何额外文字】
{
  "items": [
    {
      "id": "输入中的 id",
      "mentionedBrands": ["原文中确实出现的全部具体品牌/公司/产品/服务商专有名词；去重"],
      "topRecommended": "原文中明确排第一或最被推荐的品牌；没有明确倾向则填空字符串"
    }
  ]
}`
}

function buildJudgeUserPrompt(args: {
  competitors: string[]
  entries: Array<{ id: string; answer: string }>
}): string {
  const compLine =
    args.competitors.length > 0
      ? `【已知主要竞品参考清单 — 仅供识别，原文没出现就不能输出】\n${args.competitors.join("、")}\n\n`
      : ""
  return `${compLine}【待审阅回答列表】
${JSON.stringify(args.entries)}

请逐条抽取全部品牌，并严格按 system 规定返回 JSON。`
}

// 用 (model, question) 哈希派生稳定 seed
function deriveSeed(model: ModelKey, question: string): number {
  let h = 2166136261
  const s = `${model}::${question}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h | 0) % 2147483647
}

// 代码层安全网：抹平大小写 + 全/半角空格后做 includes
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s　]+/g, "").trim()
}
function answerMentionsBrand(answer: string, brand: string): boolean {
  if (!answer || !brand) return false
  const a = normalize(answer)
  const b = normalize(brand)
  if (b.length < 2) return false
  return a.includes(b)
}

const GENERIC_BRAND_CANDIDATES = new Set([
  "深圳",
  "香港",
  "深港",
  "本地",
  "附近",
  "全国",
  "海外",
  "全屋定制",
  "整装",
  "装修",
  "家装",
  "家居",
  "家具",
  "设计",
  "施工",
  "木作",
  "衣柜",
  "橱柜",
  "高端",
  "性价比",
  "靠谱",
  "可靠",
  "专业",
  "优质",
  "环保",
  "进口",
  "国产",
  "板材",
  "工艺",
  "案例",
  "口碑",
  "售后",
  "门店",
  "工厂",
  "套餐",
  "方案",
  "供应链",
  "报价",
  "验收",
  "品牌",
  "公司",
  "服务商",
  "供应商",
  "厂家",
  "商家",
  "团队",
  "机构",
  "平台",
])

function isGenericBrandCandidate(brand: string, ourBrand: string): boolean {
  const value = brand.trim()
  if (!value || isSameBrand(value, ourBrand)) return false
  const key = normalize(value)
  if (GENERIC_BRAND_CANDIDATES.has(value) || GENERIC_BRAND_CANDIDATES.has(key)) return true
  if (/(?:这类|几类|类型|维度|角度|标准|清单|能力|建议|选择|推荐)/u.test(value)) return true
  return /^(?:深圳|香港|深港|本地|附近|全国|海外)?(?:高端|性价比|靠谱|可靠|专业|优质|环保|进口|国产)?(?:全屋定制|整装|装修|家装|家居|家具|设计|施工|木作|衣柜|橱柜|公司|品牌|服务商|供应商|厂家|商家|门店|工厂|团队|机构|平台)+$/u.test(
    value
  )
}

function isPermanentProviderError(message: string): boolean {
  return /AccountOverdueError|overdue balance|insufficient balance|余额不足|欠费|invalid[_ ]api[_ ]key|incorrect api key|unauthorized|does not exist or you do not have access|InvalidEndpointOrModel/i.test(
    message
  )
}

function formatProviderError(model: ModelKey, message: string): string {
  if (model === "doubao" && /AccountOverdueError|overdue balance|余额不足|欠费/i.test(message)) {
    return "火山方舟账号存在欠费，当前豆包 API Key 已被平台拒绝调用。请在火山方舟结清欠费或在后台管理页更换一个有余额的 ARK_API_KEY。系统已停止本轮其余豆包请求，失败项不会计入渗透率分母。"
  }
  if (model === "doubao" && /InvalidEndpointOrModel|does not exist or you do not have access/i.test(message)) {
    return "豆包 Endpoint/模型不存在或当前账号无权访问。请在后台管理页选择“纯净盲测 · 豆包 Seed 2.0 Lite”，或填写当前账号已发布的 ep- Endpoint。系统已停止本轮其余豆包请求，失败项不会计入渗透率分母。"
  }
  return message
}

function dedupeSources(sources: PenetrationSource[]): PenetrationSource[] {
  const seen = new Set<string>()
  const out: PenetrationSource[] = []
  for (const source of sources) {
    const key = `${source.query}::${source.url}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(source)
  }
  return out
}

function summarizeSourceDomains(sources: PenetrationSource[]): SourceDomainCount[] {
  const counts = new Map<string, number>()
  for (const source of sources) {
    const domain = source.domain.trim()
    if (!domain || domain === "unknown") continue
    counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
}

function isTokenHubBaseUrl(baseUrl: string): boolean {
  return /tokenhub\.tencentmaas\.com/i.test(baseUrl)
}

async function getPenetrationAuditProfile(model: ModelKey): Promise<PenetrationAuditProfile> {
  const config = await getAiProviderRuntimeSetting(model)

  if (model === "qwen") {
    return {
      searchMode: "native_web",
      promptPurity: "raw_question_only",
      webVerificationNote: "已请求通义千问原生联网参数；如果上游未返回引用，将自动尝试公开网页预检索兜底。",
    }
  }

  if (model === "ernie") {
    return {
      searchMode: "native_web",
      promptPurity: "raw_question_only",
      webVerificationNote: "已请求百度千帆 web_search 参数并开启 trace；如果上游仍未返回引用，将自动尝试公开网页预检索兜底。",
    }
  }

  if (model === "hunyuan") {
    return isTokenHubBaseUrl(config.baseUrl)
      ? {
          searchMode: "presearch_context",
          promptPurity: "search_context_augmented",
          webVerificationNote: "腾讯 TokenHub 不稳定支持指定工具调用，系统先执行公开网页搜索，再把结果随问题交给模型。",
        }
      : {
          searchMode: "native_web",
          promptPurity: "raw_question_only",
          webVerificationNote: "已请求混元原生增强参数；如果上游未返回引用，将自动尝试公开网页预检索兜底。",
        }
  }

  if (model === "deepseek") {
    return isTokenHubBaseUrl(config.baseUrl)
      ? {
          searchMode: "presearch_context",
          promptPurity: "search_context_augmented",
          webVerificationNote: "DeepSeek TokenHub 网关不稳定支持指定工具调用，系统先执行公开网页搜索，再把结果随问题交给模型。",
        }
      : {
          searchMode: "local_tool_search",
          promptPurity: "tool_augmented",
          webVerificationNote: "DeepSeek 官方接口无原生联网开关，系统通过本地 search_web 工具强制公开网页检索。",
        }
  }

  if (model === "doubao") {
    return {
      searchMode: "local_tool_search",
      promptPurity: "tool_augmented",
      webVerificationNote: "渗透率情报不使用可能带知识库的豆包 Bot，豆包 Endpoint 通过本地 search_web 工具联网增强。",
    }
  }

  if (model === "kimi") {
    return {
      searchMode: "local_tool_search",
      promptPurity: "tool_augmented",
      webVerificationNote: "当前 Kimi 盲测走本地 search_web 工具，以规避 K2/网关对官方联网工具强制调用的不兼容。",
    }
  }

  return {
    searchMode: "none",
    promptPurity: "unknown",
    webVerificationNote: "未识别的模型联网模式。",
  }
}

function buildAuditFields(
  profile: PenetrationAuditProfile,
  searchSources: PenetrationSource[],
  overrides: {
    searchMode?: PenetrationSearchMode
    promptPurity?: PenetrationPromptPurity
    searchQueries?: string[]
    webFailureReason?: string | null
  } = {}
): Pick<
  PenetrationItem,
  | "searchMode"
  | "promptPurity"
  | "webAttempted"
  | "searchQueries"
  | "webFailureReason"
  | "sourceCount"
  | "webVerified"
  | "webVerificationNote"
> {
  const sourceCount = searchSources.length
  const webFailureReason = overrides.webFailureReason ?? null
  return {
    searchMode: overrides.searchMode ?? profile.searchMode,
    promptPurity: overrides.promptPurity ?? profile.promptPurity,
    webAttempted: true,
    searchQueries: overrides.searchQueries ?? [],
    webFailureReason,
    sourceCount,
    webVerified: sourceCount > 0,
    webVerificationNote:
      sourceCount > 0
        ? `已记录 ${sourceCount} 条可审计公开网页来源。`
        : webFailureReason || profile.webVerificationNote,
  }
}

// ============================================================================
// Stage A · 客观联网单问
// ============================================================================
async function blindQuery(
  model: ModelKey,
  question: string,
  auditProfile: PenetrationAuditProfile
): Promise<{
  answer: string
  error?: string
  searchSources: PenetrationSource[]
  sourceDomains: SourceDomainCount[]
  topSourceDomain: SourceDomainCount | null
  auditFields: Pick<
    PenetrationItem,
    | "searchMode"
    | "promptPurity"
    | "webAttempted"
    | "searchQueries"
    | "webFailureReason"
    | "sourceCount"
    | "webVerified"
    | "webVerificationNote"
  >
}> {
  const adapter = ADAPTERS[model]
  const seed = deriveSeed(model, question)
  const t0 = Date.now()
  const collectedSources: PenetrationSource[] = []
  const searchQueries = new Set<string>()
  let actualSearchMode = auditProfile.searchMode
  let actualPromptPurity = auditProfile.promptPurity
  let webFailureReason: string | null = null

  try {
    const maxAttempts = model === "kimi" ? 2 : 1
    let answer = ""
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const raw = await adapter.chat({
        system: "",
        user: question,
        temperature: 0,
        seed: seed + attempt,
        mode: "consumer",
        jsonMode: false,
        maxTokens: BLIND_QUERY_MAX_TOKENS,
        timeoutSec: BLIND_QUERY_TIMEOUT_SEC,
        forceWebSearch: true,
        rawQuestionOnly: true,
        requireWebEvidence: true,
        onSearchSources: event => {
          if (event.query?.trim()) searchQueries.add(event.query.trim())
          if (event.mode) {
            actualSearchMode = event.mode
            actualPromptPurity =
              event.mode === "presearch_context"
                ? "search_context_augmented"
                : event.mode === "local_tool_search"
                  ? "tool_augmented"
                  : auditProfile.promptPurity
          }
          if (event.failureReason) webFailureReason = event.failureReason
          collectedSources.push(...event.sources)
        },
      })
      answer = (raw || "").trim()
      const incomplete =
        answer.length < 80 ||
        /^(?:根据)?搜索结果(?:没有|未能)(?:直接)?(?:给出|找到|返回)/u.test(answer)
      if (!incomplete || attempt === maxAttempts - 1) break
      console.warn(
        `[penetration·blind] ${adapter.label} 返回不完整（${answer.length} 字），将串行重试一次。`
      )
      await sleep(1500)
    }
    if (answer.trim().length < 20) {
      throw new Error(`返回内容过短（${answer.trim().length} 字），自动重试后仍不完整`)
    }
    const searchSources = dedupeSources(collectedSources)
    const sourceDomains = summarizeSourceDomains(searchSources)
    if (searchSources.length === 0) {
      throw new Error(webFailureReason || "联网搜索未返回可审计来源，已阻断模型自答。")
    }
    const auditFields = buildAuditFields(auditProfile, searchSources, {
      searchMode: actualSearchMode,
      promptPurity: actualPromptPurity,
      searchQueries: Array.from(searchQueries),
      webFailureReason,
    })
    console.log(
      `[penetration·blind] ✓ ${adapter.label} | seed=${seed} | searchMode=${auditFields.searchMode} | promptPurity=${auditFields.promptPurity} | webVerified=${auditFields.webVerified} | sources=${searchSources.length} | ${Date.now() - t0}ms | answerLen=${answer.length} | q="${question.slice(0, 30)}..."`
    )
    console.log(`[penetration·blind-answer] preservedLen=${answer.length}`)
    return {
      answer,
      searchSources,
      sourceDomains,
      topSourceDomain: sourceDomains[0] ?? null,
      auditFields,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未知错误"
    const searchSources = dedupeSources(collectedSources)
    const sourceDomains = summarizeSourceDomains(searchSources)
    const auditFields = buildAuditFields(auditProfile, searchSources, {
      searchMode: actualSearchMode,
      promptPurity: actualPromptPurity,
      searchQueries: Array.from(searchQueries),
      webFailureReason: webFailureReason || msg,
    })
    console.error(`[penetration·blind] ✗ ${adapter.label} | ${msg} | q="${question.slice(0, 30)}..."`)
    return {
      answer: "",
      error: `${adapter.label} 接口调用失败：${msg}`,
      searchSources,
      sourceDomains,
      topSourceDomain: sourceDomains[0] ?? null,
      auditFields,
    }
  }
}

// ============================================================================
// Stage B · 独立裁判 AI 检测
// ============================================================================
interface BatchJudgeItem {
  id: string
  mentionedBrands: string[]
  topRecommended: string | null
}

async function judgeAnswersBatch(
  judgeModel: ModelKey,
  args: {
    competitors: string[]
    entries: Array<{ id: string; answer: string }>
  }
): Promise<{ items: BatchJudgeItem[]; error?: string }> {
  if (args.entries.length === 0) return { items: [] }
  const adapter = ADAPTERS[judgeModel]
  const sys = buildJudgeSystemPrompt()
  const user = buildJudgeUserPrompt(args)
  const t0 = Date.now()

  async function attempt(extraHint = ""): Promise<BatchJudgeItem[] | null> {
    const raw = await adapter.chat({
      system: sys + extraHint,
      user,
      temperature: 0,
      seed: 43,
      mode: "judge",
      jsonMode: true,
      maxTokens: JUDGE_BATCH_MAX_TOKENS,
      timeoutSec: JUDGE_BATCH_TIMEOUT_SEC,
      allowWebSearch: false,
    })
    const parsed = parseJsonLoose(raw) as { items?: unknown } | null
    if (!parsed || !Array.isArray(parsed.items)) return null
    return parsed.items
      .map((value): BatchJudgeItem | null => {
        if (!value || typeof value !== "object") return null
        const item = value as {
          id?: unknown
          mentionedBrands?: unknown
          topRecommended?: unknown
        }
        const id = typeof item.id === "string" ? item.id.trim() : ""
        if (!id) return null
        const mentionedBrands = Array.isArray(item.mentionedBrands)
          ? item.mentionedBrands.map(x => String(x).trim()).filter(Boolean)
          : []
        const topRecommended =
          typeof item.topRecommended === "string" && item.topRecommended.trim()
            ? item.topRecommended.trim()
            : null
        return { id, mentionedBrands, topRecommended }
      })
      .filter((item): item is BatchJudgeItem => !!item)
  }

  try {
    let items = await attempt()
    if (!items) {
      items = await attempt("\n\n必须返回包含 items 数组的严格 JSON；每个输入 id 都要有对应项。")
    }
    if (!items) {
      return {
        items: [],
        error: `${adapter.label} 批量裁判返回非 JSON，已保留代码层已知品牌匹配结果`,
      }
    }
    console.log(
      `[penetration·batch-judge] ✓ ${adapter.label} | ${Date.now() - t0}ms | inputs=${args.entries.length} | outputs=${items.length}`
    )
    return { items }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未知错误"
    console.error(`[penetration·batch-judge] ✗ ${adapter.label} | ${msg}`)
    return {
      items: [],
      error: `${adapter.label} 批量裁判接口调用失败：${msg}（已保留代码层已知品牌匹配结果）`,
    }
  }
}

// ============================================================================
// 单 slot 全流程：盲测 → 裁判 → 代码安全网 → 组装 PenetrationItem
// ============================================================================
async function processSlot(args: {
  model: ModelKey
  question: string
  ourBrand: string
  competitors: string[]
  auditProfile: PenetrationAuditProfile
}): Promise<PenetrationItem & { error?: string; judgeError?: string }> {
  const blind = await blindQuery(args.model, args.question, args.auditProfile)

  if (blind.error || !blind.answer) {
    return {
      question: args.question,
      answer: "",
      mentionedBrands: [],
      topRecommended: null,
      searchSources: blind.searchSources,
      sourceDomains: blind.sourceDomains,
      topSourceDomain: blind.topSourceDomain,
      ...blind.auditFields,
      hitOur: false,
      error: blind.error || "回答为空",
    }
  }

  const knownBrands = [args.ourBrand, ...args.competitors]
  const mentionedBrands = knownBrands
    .map(x => x.trim())
    .filter((brand, index, all) => {
      if (
        !brand ||
        isPlatformName(brand) ||
        isGenericBrandCandidate(brand, args.ourBrand) ||
        !answerMentionsBrand(blind.answer, brand)
      ) {
        return false
      }
      return all.findIndex(other => normalize(other) === normalize(brand)) === index
    })

  const codeHit = answerMentionsBrand(blind.answer, args.ourBrand)

  return {
    question: args.question,
    answer: blind.answer,
    mentionedBrands,
    topRecommended: null,
    searchSources: blind.searchSources,
    sourceDomains: blind.sourceDomains,
    topSourceDomain: blind.topSourceDomain,
    ...blind.auditFields,
    hitOur: codeHit,
  }
}

type ProcessedSlot = {
  model: ModelKey
  item: PenetrationItem & { error?: string; judgeError?: string }
}

function mergeVerifiedBrands(
  item: PenetrationItem,
  candidates: string[],
  ourBrand: string
): string[] {
  const merged = [...item.mentionedBrands, ...candidates]
    .map(brand => brand.trim())
    .filter(brand => {
      return (
        !!brand &&
        !isPlatformName(brand) &&
        !isGenericBrandCandidate(brand, ourBrand) &&
        answerMentionsBrand(item.answer, brand)
      )
    })

  if (item.hitOur && ourBrand.trim()) merged.push(ourBrand.trim())

  return merged.filter((brand, index, all) => {
    return all.findIndex(other => normalize(other) === normalize(brand)) === index
  })
}

async function enrichWithBatchJudge(
  results: ProcessedSlot[],
  judgeModel: ModelKey,
  competitors: string[],
  ourBrand: string
): Promise<void> {
  const jobs: Array<{
    model: ModelKey
    slots: Array<{ id: string; item: ProcessedSlot["item"] }>
  }> = []

  for (const model of Array.from(new Set(results.map(result => result.model)))) {
    const slots = results
      .filter(result => result.model === model && !!result.item.answer.trim())
      .map((result, index) => ({
        id: `${model}-${index + 1}`,
        item: result.item,
      }))
    for (let start = 0; start < slots.length; start += 5) {
      jobs.push({ model, slots: slots.slice(start, start + 5) })
    }
  }

  await mapWithConcurrency(jobs, 2, async job => {
    const judged = await judgeAnswersBatch(judgeModel, {
      competitors,
      entries: job.slots.map(slot => ({ id: slot.id, answer: slot.item.answer })),
    })
    const judgedById = new Map(judged.items.map(item => [item.id, item]))

    for (const slot of job.slots) {
      const result = judgedById.get(slot.id)
      slot.item.mentionedBrands = mergeVerifiedBrands(
        slot.item,
        result?.mentionedBrands ?? [],
        ourBrand
      )
      // 裁判抽出的品牌必须先通过回答原文字面校验。通过后，再允许简称/公司全称
      // 之间的同品牌匹配回写 hitOur，例如“木点点”命中“木点点整装（深圳）有限公司”。
      slot.item.hitOur =
        slot.item.hitOur ||
        slot.item.mentionedBrands.some(brand => isSameBrand(brand, ourBrand))
      slot.item.topRecommended =
        result?.topRecommended &&
        !isPlatformName(result.topRecommended) &&
        answerMentionsBrand(slot.item.answer, result.topRecommended)
          ? result.topRecommended
          : null
      if (judged.error) slot.item.judgeError = judged.error
    }
  })
}

// ============================================================================
// 选裁判模型：优先 DeepSeek（结构化输出最稳/最便宜），依次降级
// 强约束：裁判应尽量与"出题模型"不同，避免自证；只有当所有可用模型都被占用时才允许相同。
// ============================================================================
async function pickJudge(activeModels: ModelKey[]): Promise<ModelKey | null> {
  const order: ModelKey[] = ["deepseek", "qwen", "ernie", "hunyuan", "doubao", "kimi"]
  for (const m of order) {
    if (!activeModels.includes(m) && (await ADAPTERS[m].configured())) return m
  }
  for (const m of order) {
    if (activeModels.includes(m) && (await ADAPTERS[m].configured())) return m
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      out[index] = await worker(items[index], index)
    }
  })
  await Promise.all(workers)
  return out
}

function modelConcurrency(model: ModelKey): number {
  return model === "kimi" || model === "doubao" ? 1 : 3
}

async function handler(req: NextRequest) {
  let reservation: CreditReservation | null = null
  try {
    const body = await req.json()
    const ourBrand = String(body.ourBrand || "").trim()
    const questions: string[] = Array.isArray(body.questions)
      ? body.questions.map((q: unknown) => String(q).trim()).filter(Boolean)
      : []
    const competitors: string[] = Array.isArray(body.competitors)
      ? body.competitors.map((q: unknown) => String(q).trim()).filter(Boolean)
      : []
    const models: ModelKey[] = Array.isArray(body.models)
      ? body.models.filter((m: unknown): m is ModelKey =>
          typeof m === "string" && m in ADAPTERS
        )
      : []

    if (!ourBrand) {
      return NextResponse.json({ error: "请填写我方品牌名" }, { status: 400 })
    }
    if (questions.length === 0) {
      return NextResponse.json({ error: "请至少提供一个疑问句" }, { status: 400 })
    }
    if (models.length === 0) {
      return NextResponse.json({ error: "请至少选择一个模型" }, { status: 400 })
    }

    // ★ 强校验后台/环境模型配置：勾选但未配置 Key 的模型必须显式跳过，绝不返回 Mock
    const activeModels: ModelKey[] = []
    const skipped: ModelKey[] = []
    for (const m of models) {
      if (await ADAPTERS[m].configured()) activeModels.push(m)
      else skipped.push(m)
    }

    if (activeModels.length === 0) {
      return NextResponse.json(
        {
          error: `所选模型均未配置 API Key（缺失: ${skipped
            .map(m => ADAPTERS[m].label)
            .join("、")}）。请在后台管理页配置对应密钥后重试。`,
          skipped: skipped.map(m => ({ model: m, label: ADAPTERS[m].label })),
        },
        { status: 400 }
      )
    }

    const requiredCredits = activeModels.length * questions.length
    const judgeModel = await pickJudge(activeModels)
    if (!judgeModel) {
      return NextResponse.json(
        { error: "没有任何已配置的大模型可作为裁判，请先在后台管理页配置至少一个 API Key" },
        { status: 400 }
      )
    }

    const guard = await authAndReserveCredits(requiredCredits)
    if (!guard.ok) return guard.response
    reservation = guard.reservation

    const auditProfiles = Object.fromEntries(
      await Promise.all(
        activeModels.map(async m => [m, await getPenetrationAuditProfile(m)] as const)
      )
    ) as Record<ModelKey, PenetrationAuditProfile>

    console.log(
      `[penetration] 启动 ${activeModels.length} 模型 × ${questions.length} 问题 = ${
        activeModels.length * questions.length
      } 个 slot（Stage A 客观联网单问 + Stage B 非联网批量裁判 [${
        ADAPTERS[judgeModel].label
      }] + Stage C 原文交叉校验）`
    )
    const t0 = Date.now()

    const groupedResults = await Promise.all(
      activeModels.map(m => {
        let permanentError = ""
        const auditProfile = auditProfiles[m]
        return mapWithConcurrency(questions, modelConcurrency(m), async q => {
          if (permanentError) {
            const auditFields = buildAuditFields(auditProfile, [])
            return {
              model: m,
              item: {
                question: q,
                answer: "",
                mentionedBrands: [],
                topRecommended: null,
                searchSources: [],
                sourceDomains: [],
                topSourceDomain: null,
                ...auditFields,
                hitOur: false,
                error: permanentError,
              },
            }
          }
          const item = await processSlot({
            model: m,
            question: q,
            ourBrand,
            competitors,
            auditProfile,
          })
          if (item.error && isPermanentProviderError(item.error)) {
            permanentError = formatProviderError(m, item.error)
            item.error = permanentError
          }
          return { model: m, item }
        })
      })
    )
    const results = groupedResults.flat()
    await enrichWithBatchJudge(results, judgeModel, [ourBrand, ...competitors], ourBrand)
    console.log(`[penetration] 全部完成 耗时 ${Date.now() - t0}ms`)

    // 按 model → 题目顺序整理
    const byModel: PenetrationByModel = {}
    for (const m of activeModels) byModel[m] = []
    for (const { model, item } of results) byModel[model]!.push(item)
    for (const m of activeModels) {
      const map = new Map(byModel[m]!.map(it => [it.question, it]))
      byModel[m] = questions.map(q => map.get(q)).filter((it): it is PenetrationItem => !!it)
    }

    // 各模型错误透传（用于前端在对应栏显示红色提示）
    const modelErrors: Partial<Record<ModelKey, string>> = {}
    const judgeErrors: Partial<Record<ModelKey, string>> = {}
    for (const m of activeModels) {
      const slots = (byModel[m] ?? []) as Array<
        PenetrationItem & { error?: string; judgeError?: string }
      >
      const errs = slots.map(it => it.error).filter((x): x is string => !!x)
      const judgeErrs = slots.map(it => it.judgeError).filter((x): x is string => !!x)
      if (errs.length > 0 && errs.length === slots.length) {
        modelErrors[m] = errs[0]
      } else if (errs.length > 0) {
        modelErrors[m] = `部分请求失败（${errs.length}/${slots.length}）：${errs[0]}`
      }
      if (judgeErrs.length > 0) judgeErrors[m] = judgeErrs[0]
    }

    const aggregated = aggregatePenetration(byModel, ourBrand)

    const successfulSlots = results.filter(result => result.item.answer.trim().length > 0).length
    await settleReservedCredits(reservation, successfulSlots)
    reservation = null

    return NextResponse.json(
      {
        byModel,
        aggregated,
        generatedAt: new Date().toISOString(),
        judgeModel,
        judgeLabel: `${ADAPTERS[judgeModel].label}（批量品牌裁判，不联网）`,
        skipped: skipped.map(m => ADAPTERS[m].label),
        skippedDetail: skipped.map(m => ({
          model: m,
          label: ADAPTERS[m].label,
          reason: `${ADAPTERS[m].label} 接口配置缺失：请在后台管理页配置 API Key 和模型`,
        })),
        modelErrors,
        judgeErrors,
        requestId: crypto.randomUUID(),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    )
  } catch (e) {
    await refundReservedCreditsQuietly(reservation)
    console.error("[penetration] 未捕获异常:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "服务器错误" },
      { status: 500 }
    )
  }
}


export const POST = handler
