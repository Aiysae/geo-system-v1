import { NextRequest, NextResponse } from "next/server"
import type {
  AnalysisSubjectType,
  ModelKey,
  PenetrationByModel,
  PenetrationMentionedEntity,
  PenetrationItem,
  PenetrationPromptPurity,
  PenetrationSource,
  PenetrationSearchMode,
  SourceDomainCount,
  PersonSubjectProfile,
} from "@/types"
import { ADAPTERS } from "@/lib/llm"
import { aggregatePenetration, isSameBrand, parseJsonLoose } from "@/lib/score-utils"
import { isPlatformName } from "@/lib/platform-blacklist"
import {
  createSubjectResolver,
  isSameSubject,
  isUsablePersonName,
} from "@/lib/subject-canonicalization"
import {
  normalizeAnalysisSubjectType,
  normalizePersonSubjectProfile,
} from "@/lib/analysis-subject"
import {
  authAndReserveCredits,
  refundReservedCreditsQuietly,
  requireUserId,
  settleReservedCredits,
  type CreditReservation,
} from "@/lib/with-credits"
import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"
import { isInternalApiRequest } from "@/lib/internal-api"
import {
  formatPenetrationProviderError,
  isPermanentPenetrationProviderError,
} from "@/lib/penetration/provider-errors"
import { runPenetrationProviderCall } from "@/lib/penetration/provider-concurrency"
import { isCompletePenetrationItem } from "@/lib/penetration/slot-policy"
import { getPenetrationModelReadiness } from "@/lib/penetration/model-readiness"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"
import { listWorkspaceClients } from "@/lib/workspace-store"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"
export const revalidate = 0

const BLIND_QUERY_MAX_TOKENS = 2048
const JUDGE_BATCH_TIMEOUT_SEC = 45
const JUDGE_BATCH_MAX_TOKENS = 3072

interface PenetrationAuditProfile {
  searchMode: PenetrationSearchMode
  promptPurity: PenetrationPromptPurity
  webVerificationNote: string
}

function blindQueryTimeoutSec(model: ModelKey): number {
  const envValue = Number(process.env[`PENETRATION_${model.toUpperCase()}_TIMEOUT_SEC`])
  if (Number.isFinite(envValue) && envValue >= 30) return Math.min(300, Math.round(envValue))
  if (model === "ernie" || model === "kimi") return 180
  if (model === "hunyuan") return 240
  if (model === "doubao") return 150
  return 120
}

function blindQueryMaxTokens(model: ModelKey): number {
  // TokenHub's Hunyuan search stream is more reliable when the response stays
  // concise; sources and the untouched answer are still preserved in full.
  return model === "hunyuan" ? 1200 : BLIND_QUERY_MAX_TOKENS
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
function buildJudgeSystemPrompt(
  subjectType: AnalysisSubjectType,
): string {
  if (subjectType === "person") {
    return `你是一个严谨的"人物实体识别与同行判定引擎"。你的唯一任务是逐条审阅 AI 回答原文，抽取其中明确出现的具名人物与机构，并判断人物是否属于目标人物的直接同行。

【硬性纪律 — 严禁幻觉】
1. 只输出回答原文中确实出现的完整姓名和机构名，保持原文写法；不得补全姓氏、猜测身份或添加原文外的人物。
2. 姓名必须能指向具体人物。严禁把"医生、律师、专家、主任、教授、博主、创始人、业内人士、某医生"等职业或泛称当作姓名。
3. 人物与机构必须分开：医院、律所、公司、学校、协会、平台和媒体只能进入 mentionedOrganizations，不能当作人物。
4. isPeer 表示该人物与目标人物处于同一用户选择集合，需综合职业、专业方向、服务地区和回答上下文判断；不能仅按姓名出现次数判断。
5. 同行业但职业不同、仅被引用的作者/记者/患者、历史人物、平台创始人或机构负责人，如不是问题中的直接替代选择，isPeer 必须为 false。
6. 已知同行名单只用于帮助识别，原文未出现就绝不能输出。
7. 不确定是否是姓名或是否属于直接同行时，宁可不输出或将 isPeer 设为 false。
8. 每个输入 id 必须且只能对应一个输出项，不得遗漏或新增 id。

【输出格式 — 严格 JSON，禁止 markdown 包裹、禁止任何额外文字】
{
  "items": [
    {
      "id": "输入中的 id",
      "mentionedPeople": [
        {
          "name": "原文中的完整姓名",
          "profession": "原文可确认的职业；无法确认则空字符串",
          "organization": "原文可确认的所属机构；无法确认则空字符串",
          "isPeer": true
        }
      ],
      "mentionedOrganizations": ["原文中确实出现的医院、律所、公司、学校或协会；去重"],
      "topRecommended": "原文明确排第一或最被推荐的同行人物姓名；没有明确倾向则空字符串"
    }
  ]
}`
  }

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
  subjectType: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  competitors: string[]
  entries: Array<{ id: string; answer: string }>
}): string {
  if (args.subjectType === "person") {
    const profile = normalizePersonSubjectProfile(args.personProfile)
    const peerLine = args.competitors.length > 0
      ? `【已知同行人物参考清单 — 仅供识别，原文没出现就不能输出】\n${args.competitors.join("、")}\n\n`
      : ""
    return `【目标人物同行判定基准】
${JSON.stringify({
  profession: profile.profession,
  specialties: profile.specialties,
  organization: profile.organization,
  region: profile.region,
  title: profile.title,
})}

${peerLine}【待审阅回答列表】
${JSON.stringify(args.entries)}

请逐条抽取具名人物与机构，并严格按 system 规定返回 JSON。`
  }

  const compLine =
    args.competitors.length > 0
      ? `【已知主要竞品参考清单 — 仅供识别，原文没出现就不能输出】\n${args.competitors.join("、")}\n\n`
      : ""
  return `${compLine}【待审阅回答列表】
${JSON.stringify(args.entries)}

请逐条抽取全部品牌，并严格按 system 规定返回 JSON。`
}

// 同一次任务重试保持稳定；用户主动重测或同题重复采样时使用不同 seed。
function deriveSampleSeed(model: ModelKey, sampleId: string): number {
  let h = 2166136261
  const s = `${model}::${sampleId}`
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

function isGenericSubjectCandidate(
  value: string,
  ourBrand: string,
  subjectType: AnalysisSubjectType,
): boolean {
  return subjectType === "person"
    ? !isUsablePersonName(value)
    : isGenericBrandCandidate(value, ourBrand)
}

function dedupeMentionedEntities(
  entities: PenetrationMentionedEntity[],
): PenetrationMentionedEntity[] {
  const seen = new Set<string>()
  const result: PenetrationMentionedEntity[] = []
  for (const entity of entities) {
    const name = entity.name.trim()
    const key = `${entity.kind}:${normalize(name)}`
    if (!name || seen.has(key)) continue
    seen.add(key)
    result.push({ ...entity, name })
  }
  return result
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

async function getPenetrationAuditProfile(model: ModelKey): Promise<PenetrationAuditProfile> {
  const config = await getAiProviderRuntimeSetting(model)

  if (model === "qwen") {
    return config.extra.enableSearch === true
      ? {
          searchMode: "native_web",
          promptPurity: "raw_question_only",
          webVerificationNote: "已请求通义千问/百炼官方联网搜索插件；该插件会产生独立百炼计费。",
        }
      : {
          searchMode: "none",
          promptPurity: "raw_question_only",
          webVerificationNote: "后台未启用通义千问/百炼官方联网搜索插件，严格模式不会使用本地检索兜底。",
        }
  }

  if (model === "ernie") {
    return {
      searchMode: "native_web",
      promptPurity: "raw_question_only",
      webVerificationNote: "严格模式使用百度 AI 搜索 required 强制联网，并只接收网页类型 references。",
    }
  }

  if (model === "hunyuan") {
    return {
      searchMode: "native_web",
      promptPurity: "raw_question_only",
      webVerificationNote: "严格模式使用腾讯 TokenHub HY3 官方联网搜索，并读取 search_results。",
    }
  }

  if (model === "deepseek") {
    return {
      searchMode: "native_web",
      promptPurity: "raw_question_only",
      webVerificationNote: "严格模式使用百炼托管 DeepSeek V4 强制联网，并返回结构化网页来源。",
    }
  }

  if (model === "doubao") {
    return {
      searchMode: "native_web",
      promptPurity: "raw_question_only",
      webVerificationNote: "严格模式使用火山方舟 Responses API 内置 web_search，并读取网址引用。",
    }
  }

  if (model === "kimi") {
    return {
      searchMode: "native_web",
      promptPurity: "raw_question_only",
      webVerificationNote: "严格模式通过百度 AI 搜索调用 Kimi K2.6，强制联网并返回网页 references。",
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
    webExecutionVerified?: boolean
    providerRequestIds?: string[]
    answerReceived?: boolean
  } = {}
): Pick<
  PenetrationItem,
  | "searchMode"
  | "promptPurity"
  | "webAttempted"
  | "webExecutionVerified"
  | "providerRequestIds"
  | "searchQueries"
  | "webFailureReason"
  | "sourceCount"
  | "webVerified"
  | "webVerificationNote"
> {
  const sourceCount = searchSources.length
  const webFailureReason = overrides.webFailureReason ?? null
  const webExecutionVerified = overrides.webExecutionVerified === true || sourceCount > 0
  const providerRequestIds = overrides.providerRequestIds ?? []
  const webVerified =
    overrides.answerReceived === true
    && webExecutionVerified
    && sourceCount > 0
    && providerRequestIds.some(value => value.trim())
  return {
    searchMode: overrides.searchMode ?? profile.searchMode,
    promptPurity: overrides.promptPurity ?? profile.promptPurity,
    webAttempted: true,
    webExecutionVerified,
    providerRequestIds,
    searchQueries: overrides.searchQueries ?? [],
    webFailureReason,
    sourceCount,
    webVerified,
    webVerificationNote:
      webVerified
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
  sampleId: string,
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
    | "webExecutionVerified"
    | "providerRequestIds"
    | "searchQueries"
    | "webFailureReason"
    | "sourceCount"
    | "webVerified"
    | "webVerificationNote"
  >
}> {
  const adapter = ADAPTERS[model]
  const seed = deriveSampleSeed(model, sampleId)
  const t0 = Date.now()
  const collectedSources: PenetrationSource[] = []
  const searchQueries = new Set<string>()
  const providerRequestIds = new Set<string>()
  let actualSearchMode = auditProfile.searchMode
  let actualPromptPurity = auditProfile.promptPurity
  let webFailureReason: string | null = null
  let webExecutionVerified = false

  try {
    const maxAttempts = 1
    let answer = ""
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let raw = ""
      try {
        raw = await runPenetrationProviderCall(model, "consumer", () =>
          adapter.chat({
            system: "",
            user: question,
            temperature: 0,
            seed: seed + attempt,
            mode: "consumer",
            jsonMode: false,
            maxTokens: blindQueryMaxTokens(model),
            timeoutSec: blindQueryTimeoutSec(model),
            forceWebSearch: true,
            rawQuestionOnly: true,
            requireWebEvidence: true,
            officialWebOnly: true,
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
              if (event.searchExecuted) {
                webExecutionVerified = true
                if (!event.failureReason) webFailureReason = null
              }
              if (event.providerRequestId?.trim()) providerRequestIds.add(event.providerRequestId.trim())
              collectedSources.push(...event.sources)
            },
          }),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (attempt < maxAttempts - 1 && !isPermanentPenetrationProviderError(message)) {
          console.warn(
            `[penetration·blind] ${adapter.label} 本次没有形成可验证联网回答，将以同一原始问题重试 (${attempt + 1}/${maxAttempts})。`,
          )
          await sleep(1500)
          continue
        }
        throw error
      }
      answer = raw || ""
      if (answer.trim() || attempt === maxAttempts - 1) break
      console.warn(`[penetration·blind] ${adapter.label} 返回空内容，将串行重试一次。`)
      await sleep(1500)
    }
    if (!answer.trim()) {
      throw new Error("官方联网返回空内容，自动重试后仍为空。")
    }
    const searchSources = dedupeSources(collectedSources)
    const sourceDomains = summarizeSourceDomains(searchSources)
    if (searchSources.length === 0) {
      throw new Error(webFailureReason || "官方联网没有返回可点击、可读取的有效信源网址，已进入后台补采。")
    }
    if (providerRequestIds.size === 0) {
      throw new Error("厂商没有返回可审计请求编号，已进入后台补采。")
    }
    const auditFields = buildAuditFields(auditProfile, searchSources, {
      searchMode: actualSearchMode,
      promptPurity: actualPromptPurity,
      searchQueries: Array.from(searchQueries),
      webFailureReason,
      webExecutionVerified,
      providerRequestIds: Array.from(providerRequestIds),
      answerReceived: true,
    })
    console.log(
      `[penetration·blind] ✓ ${adapter.label} | seed=${seed} | searchMode=${auditFields.searchMode} | promptPurity=${auditFields.promptPurity} | webVerified=${auditFields.webVerified} | webExecuted=${auditFields.webExecutionVerified} | sources=${searchSources.length} | ${Date.now() - t0}ms | answerLen=${answer.length} | q="${question.slice(0, 30)}..."`
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
      webExecutionVerified,
      providerRequestIds: Array.from(providerRequestIds),
      answerReceived: false,
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
  mentionedEntities: PenetrationMentionedEntity[]
  topRecommended: string | null
}

async function judgeAnswersBatch(
  judgeModel: ModelKey,
  args: {
    subjectType: AnalysisSubjectType
    personProfile?: PersonSubjectProfile
    competitors: string[]
    entries: Array<{ id: string; answer: string }>
  }
): Promise<{ items: BatchJudgeItem[]; error?: string }> {
  if (args.entries.length === 0) return { items: [] }
  const adapter = ADAPTERS[judgeModel]
  const sys = buildJudgeSystemPrompt(args.subjectType)
  const user = buildJudgeUserPrompt(args)
  const t0 = Date.now()

  async function attempt(extraHint = ""): Promise<BatchJudgeItem[] | null> {
    const raw = await runPenetrationProviderCall(judgeModel, "judge", () =>
      adapter.chat({
        system: sys + extraHint,
        user,
        temperature: 0,
        seed: 43,
        mode: "judge",
        jsonMode: true,
        maxTokens: JUDGE_BATCH_MAX_TOKENS,
        timeoutSec: JUDGE_BATCH_TIMEOUT_SEC,
        allowWebSearch: false,
      }),
    )
    const parsed = parseJsonLoose(raw) as { items?: unknown } | null
    if (!parsed || !Array.isArray(parsed.items)) return null
    return parsed.items
      .map((value): BatchJudgeItem | null => {
        if (!value || typeof value !== "object") return null
        const item = value as {
          id?: unknown
          mentionedBrands?: unknown
          mentionedPeople?: unknown
          mentionedOrganizations?: unknown
          topRecommended?: unknown
        }
        const id = typeof item.id === "string" ? item.id.trim() : ""
        if (!id) return null
        const mentionedEntities: PenetrationMentionedEntity[] = []
        let mentionedBrands: string[] = []
        if (args.subjectType === "person") {
          const people = Array.isArray(item.mentionedPeople) ? item.mentionedPeople : []
          for (const value of people) {
            if (!value || typeof value !== "object") continue
            const person = value as Record<string, unknown>
            const name = String(person.name || "").trim()
            if (!name) continue
            const isPeer = person.isPeer === true
            mentionedEntities.push({
              name,
              kind: "person",
              isPeer,
              profession: String(person.profession || "").trim() || undefined,
              organization: String(person.organization || "").trim() || undefined,
            })
            if (isPeer) mentionedBrands.push(name)
          }
          const organizations = Array.isArray(item.mentionedOrganizations)
            ? item.mentionedOrganizations
            : []
          for (const value of organizations) {
            const name = typeof value === "string"
              ? value.trim()
              : value && typeof value === "object"
                ? String((value as Record<string, unknown>).name || "").trim()
                : ""
            if (name) mentionedEntities.push({ name, kind: "organization" })
          }
        } else {
          mentionedBrands = Array.isArray(item.mentionedBrands)
            ? item.mentionedBrands.map(x => String(x).trim()).filter(Boolean)
            : []
          mentionedEntities.push(
            ...mentionedBrands.map(name => ({ name, kind: "brand" as const })),
          )
        }
        const topRecommended =
          typeof item.topRecommended === "string" && item.topRecommended.trim()
            ? item.topRecommended.trim()
            : null
        return { id, mentionedBrands, mentionedEntities, topRecommended }
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
  sampleId: string
  ourBrand: string
  brandAliases: string[]
  competitors: string[]
  subjectType: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  auditProfile: PenetrationAuditProfile
}): Promise<PenetrationItem & { error?: string; judgeError?: string }> {
  const blind = await blindQuery(args.model, args.question, args.sampleId, args.auditProfile)
  const sampledAt = new Date().toISOString()

  if (blind.error || !blind.answer) {
    return {
      sampleId: args.sampleId,
      sampledAt,
      question: args.question,
      answer: "",
      mentionedBrands: [],
      mentionedEntities: [],
      topRecommended: null,
      searchSources: blind.searchSources,
      sourceDomains: blind.sourceDomains,
      topSourceDomain: blind.topSourceDomain,
      ...blind.auditFields,
      hitOur: false,
      error: blind.error || "回答为空",
    }
  }

  const resolver = createSubjectResolver({
    subjectType: args.subjectType,
    ourBrand: args.ourBrand,
    brandAliases: args.brandAliases,
    competitors: args.competitors,
  })
  const knownSubjects = resolver.knownNames
  const mentionedBrands = resolver.canonicalizeList(knownSubjects
    .map(x => x.trim())
    .filter((subject, index, all) => {
      if (
        !subject ||
        isPlatformName(subject) ||
        isGenericSubjectCandidate(subject, args.ourBrand, args.subjectType) ||
        !answerMentionsBrand(blind.answer, subject)
      ) {
        return false
      }
      return all.findIndex(other => normalize(other) === normalize(subject)) === index
    }))
    .map(subject => subject.display)

  const codeHit = resolver.targetNames.some(brand => answerMentionsBrand(blind.answer, brand))

  return {
    sampleId: args.sampleId,
    sampledAt,
    question: args.question,
    answer: blind.answer,
    mentionedBrands,
    mentionedEntities: args.subjectType === "person"
      ? mentionedBrands.map(name => ({ name, kind: "person", isPeer: true }))
      : undefined,
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

function mergeVerifiedSubjects(
  item: PenetrationItem,
  candidates: PenetrationMentionedEntity[],
  ourBrand: string,
  brandAliases: string[],
  competitors: string[],
  subjectType: AnalysisSubjectType,
): { mentionedSubjects: string[]; entities: PenetrationMentionedEntity[] } {
  const candidateNames = candidates
    .filter(entity => entity.kind === (subjectType === "person" ? "person" : "brand"))
    .map(entity => entity.name)
  const resolver = createSubjectResolver({
    subjectType,
    ourBrand,
    brandAliases,
    competitors,
    observedBrands: [...item.mentionedBrands, ...candidateNames],
  })
  const knownKeys = new Set(
    resolver.canonicalizeList(resolver.knownNames).map(subject => subject.key),
  )
  const candidateByKey = new Map<string, PenetrationMentionedEntity>()
  for (const entity of candidates) {
    if (!entity.name.trim() || !answerMentionsBrand(item.answer, entity.name)) continue
    if (entity.kind === "person" && !isUsablePersonName(entity.name)) continue
    const key = `${entity.kind}:${normalize(entity.name)}`
    if (!candidateByKey.has(key)) candidateByKey.set(key, entity)
  }

  const merged = [...item.mentionedBrands, ...candidateNames]
    .map(subject => subject.trim())
    .filter(subject => {
      return (
        !!subject &&
        !isPlatformName(subject) &&
        !isGenericSubjectCandidate(subject, ourBrand, subjectType) &&
        answerMentionsBrand(item.answer, subject)
      )
    })

  if (item.hitOur && ourBrand.trim()) merged.push(ourBrand.trim())

  const mentionedSubjects = resolver.canonicalizeList(merged)
    .filter(subject => {
      if (subjectType !== "person") return true
      if (subject.isTarget || knownKeys.has(subject.key)) return true
      return candidates.some(entity =>
        entity.kind === "person"
        && entity.isPeer === true
        && resolver.canonicalize(entity.name)?.key === subject.key
      )
    })
    .map(subject => subject.display)

  if (subjectType !== "person") {
    return {
      mentionedSubjects,
      entities: mentionedSubjects.map(name => ({ name, kind: "brand" })),
    }
  }

  const personEntities = resolver.canonicalizeList([
    ...(item.mentionedEntities || [])
      .filter(entity => entity.kind === "person")
      .map(entity => entity.name),
    ...candidateNames,
  ]).map(person => {
    const source = Array.from(candidateByKey.values()).find(entity =>
      entity.kind === "person"
      && resolver.canonicalize(entity.name)?.key === person.key
    )
    return {
      name: person.display,
      kind: "person" as const,
      isPeer: mentionedSubjects.some(name => resolver.canonicalize(name)?.key === person.key),
      profession: source?.profession,
      organization: source?.organization,
    }
  })
  const organizationEntities = Array.from(candidateByKey.values())
    .filter(entity => entity.kind === "organization")
    .map(entity => ({ ...entity, isPeer: undefined }))

  return {
    mentionedSubjects,
    entities: [...personEntities, ...dedupeMentionedEntities(organizationEntities)],
  }
}

async function enrichWithBatchJudge(
  results: ProcessedSlot[],
  judgeModel: ModelKey,
  competitors: string[],
  ourBrand: string,
  brandAliases: string[],
  subjectType: AnalysisSubjectType,
  personProfile?: PersonSubjectProfile,
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
      subjectType,
      personProfile,
      competitors,
      entries: job.slots.map(slot => ({ id: slot.id, answer: slot.item.answer })),
    })
    const judgedById = new Map(judged.items.map(item => [item.id, item]))

    for (const slot of job.slots) {
      const result = judgedById.get(slot.id)
      const merged = mergeVerifiedSubjects(
        slot.item,
        result?.mentionedEntities ?? [],
        ourBrand,
        brandAliases,
        competitors,
        subjectType,
      )
      slot.item.mentionedBrands = merged.mentionedSubjects
      slot.item.mentionedEntities = merged.entities
      // 裁判抽出的品牌必须先通过回答原文字面校验。通过后，再允许简称/公司全称
      // 之间的同品牌匹配回写 hitOur，例如“木点点”命中“木点点整装（深圳）有限公司”。
      slot.item.hitOur =
        slot.item.hitOur ||
        slot.item.mentionedBrands.some(brand =>
          [ourBrand, ...brandAliases].some(target =>
            subjectType === "person"
              ? isSameSubject(brand, target, "person")
              : isSameBrand(brand, target)
          ),
        )
      slot.item.topRecommended =
        result?.topRecommended &&
        !isPlatformName(result.topRecommended) &&
        answerMentionsBrand(slot.item.answer, result.topRecommended) &&
        (
          subjectType !== "person"
          || slot.item.mentionedBrands.some(name =>
            isSameSubject(name, result.topRecommended || "", "person")
          )
        )
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
  return model === "kimi" || model === "doubao" || model === "hunyuan" ? 1 : 3
}

async function handler(req: NextRequest) {
  let reservation: CreditReservation | null = null
  try {
    const internalJobRequest = isInternalApiRequest(req, "penetration-job")
    const body = await req.json()
    let subjectType = normalizeAnalysisSubjectType(body.subjectType)
    let personProfile = normalizePersonSubjectProfile(body.personProfile)
    let ourBrand = String(body.ourBrand || "").trim()
    const questions: string[] = Array.isArray(body.questions)
      ? body.questions.map((q: unknown) => String(q).trim()).filter(Boolean)
      : []
    const requestedRunId = String(body.runId || "").trim()
    const runId = /^[A-Za-z0-9_-]{16,200}$/.test(requestedRunId)
      ? requestedRunId
      : `penetration_${crypto.randomUUID().replace(/-/g, "")}`
    const sampleStart = Number.isSafeInteger(body.sampleStart) && body.sampleStart >= 0
      ? Math.min(body.sampleStart, 1_000_000)
      : 0
    const questionSamples = questions.map((question, index) => ({
      question,
      sampleIndex: sampleStart + index,
    }))
    let competitors: string[] = Array.isArray(body.competitors)
      ? body.competitors.map((q: unknown) => String(q).trim()).filter(Boolean)
      : []
    let brandAliases: string[] = Array.isArray(body.brandAliases)
      ? body.brandAliases.map((q: unknown) => String(q).trim()).filter(Boolean)
      : []
    const models: ModelKey[] = Array.isArray(body.models)
      ? body.models.filter((m: unknown): m is ModelKey =>
          typeof m === "string" && m in ADAPTERS
        )
      : []

    if (!internalJobRequest) {
      const userGuard = await requireUserId()
      if (!userGuard.ok) return userGuard.response
      const clientId = String(body.clientId || "").trim()
      const access = await resolveWorkspaceAccess(userGuard.userId, clientId || undefined)
      if (!access.ok) {
        return NextResponse.json({ error: access.message, code: access.code }, { status: 403 })
      }
      if (access.mode === "client") {
        const client = (await listWorkspaceClients(access.ownerUserId))
          .find(record => record.client.id === access.clientId)?.client
        if (!client) {
          return NextResponse.json({ error: "已授权的客户面板不存在，请联系管理员" }, { status: 404 })
        }
        ourBrand = client.ourBrand.trim()
        subjectType = normalizeAnalysisSubjectType(client.subjectType)
        personProfile = normalizePersonSubjectProfile(client.personProfile)
        brandAliases = client.brandAliases ?? []
        competitors = client.competitors
      }
    }

    if (!ourBrand) {
      return NextResponse.json(
        { error: subjectType === "person" ? "请填写目标人物姓名" : "请填写我方品牌名" },
        { status: 400 },
      )
    }
    if (questions.length === 0) {
      return NextResponse.json({ error: "请至少提供一个疑问句" }, { status: 400 })
    }
    if (models.length === 0) {
      return NextResponse.json({ error: "请至少选择一个模型" }, { status: 400 })
    }

    // 强校验严格联网能力：未通过预检的模型显式跳过，绝不返回 Mock 或无来源自答。
    const activeModels: ModelKey[] = []
    const skipped: Array<{ model: ModelKey; reason: string }> = []
    for (const m of models) {
      const readiness = await getPenetrationModelReadiness(m)
      if (readiness.ready) activeModels.push(m)
      else skipped.push({ model: m, reason: readiness.reason || "严格联网预检未通过" })
    }

    if (activeModels.length === 0) {
      return NextResponse.json(
        {
          error: `所选模型均未通过严格联网预检：${skipped
            .map(item => `${ADAPTERS[item.model].label}（${item.reason}）`)
            .join("、")}`,
          skipped: skipped.map(item => ({
            model: item.model,
            label: ADAPTERS[item.model].label,
            reason: item.reason,
          })),
        },
        { status: 400 }
      )
    }

    const featureKey = "penetrationSlot"
    const slotCount = activeModels.length * questions.length
    const requiredCredits = estimateFeatureCredits(featureKey, slotCount)
    const judgeModel = await pickJudge(activeModels)
    if (!judgeModel) {
      return NextResponse.json(
        { error: "没有任何已配置的大模型可作为裁判，请先在后台管理页配置至少一个 API Key" },
        { status: 400 }
      )
    }

    if (!internalJobRequest) {
      const guard = await authAndReserveCredits(requiredCredits, {
        featureKey,
        source: "api:penetration",
        description: getFeaturePrice(featureKey).label,
        metadata: {
          modelCount: activeModels.length,
          questionCount: questions.length,
          slotCount,
          brandAliasCount: brandAliases.length,
          subjectType,
        },
      })
      if (!guard.ok) return guard.response
      reservation = guard.reservation
    }

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
        return mapWithConcurrency(questionSamples, modelConcurrency(m), async sample => {
          const q = sample.question
          const sampleId = `${runId}_${m}_${sample.sampleIndex + 1}`
          if (permanentError) {
            const auditFields = buildAuditFields(auditProfile, [])
            return {
              model: m,
              item: {
                sampleId,
                sampledAt: new Date().toISOString(),
                question: q,
                answer: "",
                mentionedBrands: [],
                mentionedEntities: [],
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
            sampleId,
            ourBrand,
            brandAliases,
            competitors,
            subjectType,
            personProfile,
            auditProfile,
          })
          if (item.error && isPermanentPenetrationProviderError(item.error)) {
            permanentError = formatPenetrationProviderError(m, item.error)
            item.error = permanentError
          }
          return { model: m, item }
        })
      })
    )
    const results = groupedResults.flat()
    const knownSubjectResolver = createSubjectResolver({
      subjectType,
      ourBrand,
      brandAliases,
      competitors,
    })
    await enrichWithBatchJudge(
      results,
      judgeModel,
      knownSubjectResolver.knownNames,
      ourBrand,
      brandAliases,
      subjectType,
      personProfile,
    )
    console.log(`[penetration] 全部完成 耗时 ${Date.now() - t0}ms`)

    // mapWithConcurrency 保留输入下标顺序；不能再按问题文字建 Map，重复问题是独立样本。
    const byModel: PenetrationByModel = {}
    for (const m of activeModels) byModel[m] = []
    for (const { model, item } of results) byModel[model]!.push(item)

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

    const aggregated = aggregatePenetration(
      byModel,
      ourBrand,
      brandAliases,
      competitors,
      subjectType,
      {
        plannedQuestions: questions,
        plannedSlots: activeModels.length * questions.length,
        modelCount: activeModels.length,
      },
    )

    const successfulSlots = results.filter(result => isCompletePenetrationItem(result.item)).length
    if (reservation) {
      await settleReservedCredits(reservation, estimateFeatureCredits(featureKey, successfulSlots))
      reservation = null
    }

    return NextResponse.json(
      {
        byModel,
        aggregated,
        generatedAt: new Date().toISOString(),
        judgeModel,
        judgeLabel: `${ADAPTERS[judgeModel].label}（批量${
          subjectType === "person" ? "人物与同行" : "品牌"
        }裁判，不联网）`,
        skipped: skipped.map(item => `${ADAPTERS[item.model].label}（${item.reason}）`),
        skippedDetail: skipped.map(item => ({
          model: item.model,
          label: ADAPTERS[item.model].label,
          reason: item.reason,
        })),
        modelErrors,
        judgeErrors,
        requestId: runId,
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
