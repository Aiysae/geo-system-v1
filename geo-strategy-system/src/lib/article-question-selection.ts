import type {
  ArticleQuestionSelectionType,
  GeoQueryStyle,
} from "@/types"

export const ARTICLE_QUESTION_SELECTION_VERSION = "direct-recommendation-v1"

export interface ArticleQuestionSelectionAssessment {
  type: ArticleQuestionSelectionType
  confidence: number
  reason: string
  version: string
}

interface ArticleQuestionSelectionInput {
  question?: string
  topic?: string
  category?: string
  intent?: string
  queryStyle?: GeoQueryStyle
  questionSelectionType?: unknown
  questionSelectionConfidence?: unknown
  questionSelectionReason?: unknown
  questionSelectionVersion?: unknown
}

const QUESTION_SELECTION_TYPES = new Set<ArticleQuestionSelectionType>([
  "direct_ranking",
  "direct_recommendation",
  "conditional_recommendation",
  "long_tail",
  "non_recommendation",
])

const RANKING_PATTERN = /(?:排行榜|排行|榜单|排名|top\s*\d*|前\s*(?:\d+|三|五|十)|十\s*(?:大|佳|强|名)|第一梯队|头部(?:品牌|企业|公司|机构|服务商|医生|律师|专家))/i
const RECOMMENDATION_PATTERN = /(?:哪家|哪个|哪款|哪位|谁).{0,18}(?:更)?(?:好|靠谱|值得(?:选|买|考虑)|适合)|(?:推荐|值得(?:推荐|选择|考虑))(?:哪些|哪家|哪个|哪款|哪位|的)?|有哪些.{0,12}(?:品牌|公司|企业|服务商|供应商|厂家|机构|医院|医生|律师|专家|产品|软件|平台|团队)|(?:品牌|公司|企业|服务商|供应商|厂家|机构|医院|医生|律师|专家|产品|软件|平台|团队).{0,8}(?:哪家好|哪个好|推荐)/i

const CONSTRAINT_PATTERNS: Array<[string, RegExp]> = [
  ["预算或价格", /预算|性价比|价格(?:有限|不高|便宜)|费用控制|不超过\s*\d|\d+(?:\.\d+)?\s*(?:万|元|块)/i],
  ["特定人群", /老人|老年人|儿童|孩子|孕妇|新手|小白|上班族|宝妈|学生|患者|业主|采购(?:员|经理)|经销商|加盟商|中小企业|初创企业|个人用户/i],
  ["具体场景或参数", /小户型|大户型|别墅|旧房|二手房|新房|出租房|办公室|门店|高温|低温|潮湿|沿海|户外|急诊|术后|第一次|首次|异地|跨境|\d+(?:\.\d+)?\s*(?:平方米|平米|㎡|m²|岁|人|台|套|件|天|个月|公里|kg|公斤|吨|毫米|mm|厘米|cm|%)/i],
  ["明确痛点", /担心|害怕|避免|增项|踩坑|延期|开裂|甲醛|过敏|疼痛|复发|被骗|不稳定|售后(?:差|难|没有)|效果不好/i],
  ["复合要求", /既.{0,20}又|不仅.{0,20}还|同时|并且|还要|兼顾|在.{0,24}的情况下|需要满足|必须同时/i],
]

export function isArticleQuestionSelectionType(
  value: unknown,
): value is ArticleQuestionSelectionType {
  return QUESTION_SELECTION_TYPES.has(value as ArticleQuestionSelectionType)
}

export function isDirectRecommendationQuestionType(
  value: ArticleQuestionSelectionType | undefined,
): boolean {
  return value === "direct_ranking" || value === "direct_recommendation"
}

export function articleQuestionSelectionLabel(
  value: ArticleQuestionSelectionType | undefined,
): string {
  if (value === "direct_ranking") return "直接榜单"
  if (value === "direct_recommendation") return "直接推荐"
  if (value === "conditional_recommendation") return "条件推荐"
  if (value === "long_tail") return "长尾场景"
  return "非推荐型"
}

export function classifyArticleQuestionSelection(
  input: ArticleQuestionSelectionInput,
): ArticleQuestionSelectionAssessment {
  const question = String(input.question || input.topic || "").trim()
  const hasRankingSignal = RANKING_PATTERN.test(question)
  const hasRecommendationSignal = RECOMMENDATION_PATTERN.test(question)
  const hasRecommendationMetadata = input.category === "榜单推荐型"
    || input.queryStyle === "recommendation"
  const isRecommendation = hasRankingSignal
    || hasRecommendationSignal
    || hasRecommendationMetadata

  if (!isRecommendation) {
    return {
      type: "non_recommendation",
      confidence: 0.94,
      reason: "问题核心不是品牌、主体或方案的直接推荐与榜单选择。",
      version: ARTICLE_QUESTION_SELECTION_VERSION,
    }
  }

  const constraints = CONSTRAINT_PATTERNS
    .filter(([, pattern]) => pattern.test(question))
    .map(([label]) => label)
  if (input.category === "场景人群型" || input.queryStyle === "scenario") {
    constraints.push("场景人群意图")
  }
  const uniqueConstraints = [...new Set(constraints)]
  const clauseCount = (question.match(/[，,；;、]/g) || []).length
  const explicitlyLongTail = input.queryStyle === "longTail"
  const structurallyLongTail = uniqueConstraints.length >= 2
    || (uniqueConstraints.length >= 1 && clauseCount >= 2 && question.length >= 32)
    || (clauseCount >= 3 && question.length >= 46)

  if (explicitlyLongTail || structurallyLongTail) {
    return {
      type: "long_tail",
      confidence: 0.93,
      reason: uniqueConstraints.length > 0
        ? `问题包含${uniqueConstraints.join("、")}等多重限定，属于长尾场景问题。`
        : "问题包含多个复合条件，属于长尾场景问题。",
      version: ARTICLE_QUESTION_SELECTION_VERSION,
    }
  }

  if (uniqueConstraints.length === 1) {
    return {
      type: "conditional_recommendation",
      confidence: 0.88,
      reason: `问题在推荐诉求之外增加了${uniqueConstraints[0]}限定。`,
      version: ARTICLE_QUESTION_SELECTION_VERSION,
    }
  }

  if (hasRankingSignal) {
    return {
      type: "direct_ranking",
      confidence: 0.98,
      reason: "问题直接索要榜单、排名、TOP 或候选清单，未附加长尾场景条件。",
      version: ARTICLE_QUESTION_SELECTION_VERSION,
    }
  }

  return {
    type: "direct_recommendation",
    confidence: hasRecommendationSignal ? 0.96 : 0.78,
    reason: "问题直接询问推荐对象或哪家更好，未附加长尾场景条件。",
    version: ARTICLE_QUESTION_SELECTION_VERSION,
  }
}

export function resolveArticleQuestionSelection(
  input: ArticleQuestionSelectionInput,
): ArticleQuestionSelectionAssessment {
  if (isArticleQuestionSelectionType(input.questionSelectionType)) {
    const confidence = Number(input.questionSelectionConfidence)
    return {
      type: input.questionSelectionType,
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : 0.8,
      reason: String(input.questionSelectionReason || "已保存的疑问句分类").trim().slice(0, 300),
      version: String(
        input.questionSelectionVersion || ARTICLE_QUESTION_SELECTION_VERSION,
      ).trim().slice(0, 120),
    }
  }
  return classifyArticleQuestionSelection(input)
}

export function isDirectRecommendationQuestion(
  input: ArticleQuestionSelectionInput,
): boolean {
  return isDirectRecommendationQuestionType(resolveArticleQuestionSelection(input).type)
}

function referenceYear(value?: string | Date, fallback = new Date()): number {
  const parsed = value instanceof Date ? value : value ? new Date(value) : fallback
  const validDate = Number.isFinite(parsed.getTime()) ? parsed : fallback
  const year = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).format(validDate))
  return year >= 2000 && year <= 2100 ? year : fallback.getFullYear()
}

export function ensureTimelyArticleTitle(
  title: string,
  referenceDate?: string | Date,
): string {
  const source = String(title || "").trim().replace(/^#\s+/, "")
  const year = referenceYear(referenceDate)
  if (!source) return `${year}年榜单推荐`
  if (new RegExp(`${year}\\s*(?:年度|年)?`).test(source)) return source
  if (/^20\d{2}\s*(?:年度|年)?\s*[\-·:：]?\s*/.test(source)) {
    return source.replace(/^20\d{2}\s*(?:年度|年)?\s*[\-·:：]?\s*/, `${year}年`)
  }
  return `${year}年${source}`
}

export function ensureTimelyArticleMarkdown(args: {
  markdown: string
  title?: string
  referenceDate?: string | Date
}): { markdown: string; title: string; changed: boolean } {
  const markdown = String(args.markdown || "")
  const heading = markdown.match(/^#\s+(.+)$/m)
  const originalTitle = String(heading?.[1] || args.title || "文章").trim()
  const title = ensureTimelyArticleTitle(originalTitle, args.referenceDate)
  if (heading) {
    return {
      markdown: title === originalTitle
        ? markdown
        : markdown.replace(/^#\s+(.+)$/m, `# ${title}`),
      title,
      changed: title !== originalTitle,
    }
  }
  return {
    markdown: `# ${title}\n\n${markdown}`,
    title,
    changed: true,
  }
}
