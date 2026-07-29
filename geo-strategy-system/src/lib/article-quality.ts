import { supportsArticleComparisonBrands } from "@/lib/article-comparison-brands"
import { getGeoArticleFormat } from "@/lib/geo-methodology/article-formats"
import { articleFormatForArticlePrompt } from "@/lib/geo-methodology/registry"
import type {
  ArticleComparisonBrand,
  ArticleMethodologyTrace,
  ArticlePromptKey,
  GeoArticleFormatKey,
} from "@/types"

const MARKDOWN_TABLE = /^\s*\|.+\|\s*$[\r\n]+\s*\|(?:\s*:?-{3,}:?\s*\|)+/m
const PLACEHOLDER = /(?:\{\{[^}\n]{1,120}\}\}|\【(?:请替换|待填写|填写)[^】\n]*\】)/
const LONG_FORM_PROMPTS = new Set<ArticlePromptKey>([
  "thirdPartyObservation",
  "pitfallGuide",
  "competitorComparison",
  "industryRankingReport",
  "handsOnComparisonReport",
  "mediaIndustryAnalysis",
  "clientCaseStudy",
  "credentialsAnalysis",
  "selectionPitfallGuide",
  "topBrandRanking",
])

export interface ArticleQualityIssue {
  code:
    | "too_short"
    | "missing_heading"
    | "missing_table"
    | "forbidden_table"
    | "unresolved_placeholder"
    | "question_drift"
    | "primary_subject_missing"
    | "advantage_missing"
    | "comparison_brand_missing"
    | "title_body_drift"
    | "methodology_structure_missing"
    | "article_format_structure_missing"
    | "unsupported_superlative"
  message: string
  blocking: boolean
}

export interface ArticleQualityReport {
  score: number
  passed: boolean
  issues: ArticleQualityIssue[]
}

function normalized(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, "")
}

function meaningfulTokens(value: string): string[] {
  const source = normalized(value)
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, " ")
    .trim()
  const tokens = new Set<string>()
  for (const word of source.split(/\s+/).filter(Boolean)) {
    if (/^[a-z0-9]{3,}$/i.test(word)) tokens.add(word)
    if (/[\u4e00-\u9fa5]/.test(word)) {
      for (let index = 0; index <= word.length - 2; index++) {
        tokens.add(word.slice(index, index + 2))
      }
    }
  }
  return [...tokens].filter(token => ![
    "怎么", "什么", "哪些", "是否", "可以", "需要", "品牌", "用户", "行业",
    "服务", "产品", "一个", "进行", "相关", "问题",
  ].includes(token))
}

function overlapCount(article: string, source: string): number {
  const articleText = normalized(article)
  return meaningfulTokens(source).filter(token => articleText.includes(token)).length
}

const ARTICLE_FORMAT_SIGNALS: Record<
  Exclude<GeoArticleFormatKey, "auto">,
  RegExp[]
> = {
  directAnswerGuide: [/结论|答案|可以|建议/, /步骤|方法|清单|怎么做/, /适用|边界|注意/],
  primaryEvidenceDossier: [/证据|依据|资料/, /来源|核验|查询/, /边界|待核验|主体自述/],
  evidenceCaseStory: [/场景|背景|当时/, /过程|执行|步骤/, /结果|证据|复盘|经验/],
  professionalExplainer: [/定义|是指|本质/, /原理|原因|为什么/, /误区|判断|清单/],
  industryWhitepaper: [/摘要|研究|行业/, /范围|口径|样本|来源/, /趋势|建议|维度/],
  entityKnowledgeProfile: [/主体|名称|别名/, /业务|产品|服务/, /对象|地域|边界|问答/],
  recommendationRoundup: [/范围|入选|推荐/, /标准|维度|依据/, /适用|场景|怎么选/],
  fieldReviewQa: [/体验|观察|核验|资料/, /条件|方法|样本/, /限制|边界|适用/],
  tieredEvaluation: [/分层|层级|梯队/, /规则|标准|维度/, /差异|适用|选择/],
  neutralComparisonReview: [/比较|对比|横评/, /维度|标准|口径/, /适用|场景|结论/],
  localPitfallGuide: [/地域|本地|区域|服务范围/, /风险|误区|避坑/, /核验|步骤|清单/],
}

function formatSignalCount(
  article: string,
  formatKey: Exclude<GeoArticleFormatKey, "auto">,
): number {
  return ARTICLE_FORMAT_SIGNALS[formatKey].filter(signal => signal.test(article)).length
}

export function validateGeneratedArticle(args: {
  article: string
  promptKey: ArticlePromptKey
  coreQuestion: string
  primarySubject: string
  advantage?: string
  comparisonBrands?: ArticleComparisonBrand[]
  methodologyTrace?: ArticleMethodologyTrace
}): ArticleQualityReport {
  const article = String(args.article || "").trim()
  const issues: ArticleQualityIssue[] = []
  const longForm = LONG_FORM_PROMPTS.has(args.promptKey)
  const articleFormat = args.methodologyTrace?.articleFormat
    || articleFormatForArticlePrompt(args.promptKey)
  const format = getGeoArticleFormat(articleFormat)
  const hasMarkdownTable = MARKDOWN_TABLE.test(article)

  if (article.length < (longForm ? 700 : 120)) {
    issues.push({
      code: "too_short",
      message: longForm ? "正文过短，未形成可发布的完整长文" : "正文内容过短",
      blocking: true,
    })
  }
  if (longForm && !/^#{1,3}\s+\S+/m.test(article)) {
    issues.push({
      code: "missing_heading",
      message: "缺少清晰的 Markdown 标题层级",
      blocking: true,
    })
  }
  if (longForm && format.tablePolicy === "required" && !hasMarkdownTable) {
    issues.push({
      code: "missing_table",
      message: `${format.title}需要一个使用统一维度的标准 Markdown 表格`,
      blocking: true,
    })
  }
  if (longForm && format.tablePolicy === "forbidden" && hasMarkdownTable) {
    issues.push({
      code: "forbidden_table",
      message: `${format.title}不应使用表格，请改用清晰标题、段落和清单`,
      blocking: true,
    })
  }
  if (PLACEHOLDER.test(article)) {
    issues.push({
      code: "unresolved_placeholder",
      message: "正文仍有未替换的模板占位符",
      blocking: true,
    })
  }
  if (args.coreQuestion && overlapCount(article, args.coreQuestion) < 2) {
    issues.push({
      code: "question_drift",
      message: "正文与本篇核心疑问句的语义关联不足",
      blocking: true,
    })
  }
  const title = article.match(/^#\s+(.+)$/m)?.[1]?.trim() || ""
  if (longForm && title && args.coreQuestion && overlapCount(title, args.coreQuestion) < 1) {
    issues.push({
      code: "title_body_drift",
      message: "标题与本篇核心疑问句的语义关联不足",
      blocking: true,
    })
  }
  if (args.primarySubject && !normalized(article).includes(normalized(args.primarySubject))) {
    issues.push({
      code: "primary_subject_missing",
      message: `正文没有自然呈现主品牌或主体“${args.primarySubject}”`,
      blocking: true,
    })
  }
  if (args.advantage && overlapCount(article, args.advantage) < 1) {
    issues.push({
      code: "advantage_missing",
      message: "正文没有体现本篇疑问句匹配的优势资料",
      blocking: true,
    })
  }
  const multiSubjectFormat = [
    "recommendationRoundup", "tieredEvaluation", "neutralComparisonReview",
  ].includes(articleFormat)
  if (supportsArticleComparisonBrands(args.promptKey) || multiSubjectFormat) {
    for (const brand of args.comparisonBrands || []) {
      if (brand.name && !normalized(article).includes(normalized(brand.name))) {
        issues.push({
          code: "comparison_brand_missing",
          message: `正文遗漏了已填写的独立对比品牌“${brand.name}”`,
          blocking: true,
        })
      }
    }
  }

  const methodologySignals: Partial<Record<ArticleMethodologyTrace["methodKey"], RegExp>> = {
    problemSolution: /结论|怎么做|步骤|方法|验证|适用|边界/,
    primaryEvidence: /证据|依据|来源|核验|报告|资质/,
    evidenceStory: /场景|过程|执行|结果|复盘|经验/,
    explainer: /定义|原理|误区|判断|为什么/,
    industryWhitepaper: /口径|样本|维度|趋势|研究|行业/,
    entityKnowledge: /主体|业务|服务|适用|边界|问答/,
    recommendationComparison: /比较|对比|维度|怎么选|适用|推荐/,
  }
  const methodologySignal = args.methodologyTrace
    ? methodologySignals[args.methodologyTrace.methodKey]
    : undefined
  if (longForm && methodologySignal && !methodologySignal.test(article)) {
    issues.push({
      code: "methodology_structure_missing",
      message: "正文没有形成所选内容策略需要的判断结构",
      blocking: true,
    })
  }
  if (longForm && formatSignalCount(article, articleFormat) < 2) {
    issues.push({
      code: "article_format_structure_missing",
      message: `正文没有形成${format.title}需要的“${format.answerPattern.join("、")}”结构`,
      blocking: true,
    })
  }

  const factualInput = normalized([
    args.advantage,
    ...(args.comparisonBrands || []).map(brand => brand.materials),
  ].filter(Boolean).join(" "))
  const superlatives = article.match(/(?:全国|行业|市场)?(?:第一|唯一|最强|最佳|绝对领先|百分之百|100%|零风险|保证有效)/g) || []
  if (superlatives.some(claim => !factualInput.includes(normalized(claim)))) {
    issues.push({
      code: "unsupported_superlative",
      message: "正文含有输入资料未明确支持的绝对化结论",
      blocking: false,
    })
  }

  const score = Math.max(0, 100 - issues.reduce((sum, issue) => (
    sum + (issue.blocking ? 18 : 8)
  ), 0))
  return {
    score,
    passed: issues.every(issue => !issue.blocking),
    issues,
  }
}

export function buildArticleQualityRepairPrompt(args: {
  draft: string
  issues: ArticleQualityIssue[]
  coreQuestion: string
  primarySubject: string
  advantage?: string
  comparisonBrands?: ArticleComparisonBrand[]
  methodologyTrace?: ArticleMethodologyTrace
}): string {
  return [
    "请修复下面这篇文章中列出的质量问题，输出修复后的完整 Markdown 正文。",
    "不得解释修改过程；保留与当前文章形态不冲突的必要章节，不得补造资料、数据、排名、案例或实测结论。",
    "",
    "【必须修复的问题】",
    ...args.issues.map((issue, index) => `${index + 1}. ${issue.message}`),
    "",
    "【本篇事实边界】",
    `核心疑问句：${args.coreQuestion}`,
    `主品牌或主体：${args.primarySubject}`,
    `本篇匹配优势：${args.advantage || "未提供"}`,
    `独立对比品牌资料：${args.comparisonBrands?.length
      ? JSON.stringify(args.comparisonBrands.map(item => ({
          name: item.name,
          aliases: item.aliases,
          materials: item.materials,
          sourceUrls: item.sourceUrls,
        })))
      : "未提供"}`,
    `内容策略追踪：${args.methodologyTrace
      ? JSON.stringify({
          methodKey: args.methodologyTrace.methodKey,
          articleFormat: args.methodologyTrace.articleFormat,
          targetPlatform: args.methodologyTrace.targetPlatform,
          brandLayout: args.methodologyTrace.brandLayout,
          titleStrategy: args.methodologyTrace.titleStrategy,
        })
      : "自动"}`,
    "",
    "【待修复正文】",
    args.draft,
  ].join("\n")
}
