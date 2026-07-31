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
  directAnswerGuide: [
    /结论|結論|答案|可以|建议|建議/,
    /步骤|步驟|方法|清单|清單|怎么做|怎麼做/,
    /适用|適用|边界|邊界|注意/,
  ],
  primaryEvidenceDossier: [
    /证据|證據|依据|依據|资料|資料/,
    /来源|來源|核验|核驗|查询|查詢/,
    /边界|邊界|待核验|待核驗|主体自述|主體自述/,
  ],
  evidenceCaseStory: [
    /场景|場景|背景|当时|當時/,
    /过程|過程|执行|執行|步骤|步驟/,
    /结果|結果|证据|證據|复盘|復盤|经验|經驗/,
  ],
  professionalExplainer: [
    /定义|定義|是指|本质|本質/,
    /原理|原因|为什么|為什麼/,
    /误区|誤區|判断|判斷|清单|清單/,
  ],
  industryWhitepaper: [
    /摘要|研究|行业|行業/,
    /范围|範圍|口径|口徑|样本|樣本|来源|來源/,
    /趋势|趨勢|建议|建議|维度|維度/,
  ],
  entityKnowledgeProfile: [
    /主体|主體|名称|名稱|别名|別名/,
    /业务|業務|产品|產品|服务|服務/,
    /对象|對象|地域|边界|邊界|问答|問答/,
  ],
  recommendationRoundup: [
    /范围|範圍|入选|入選|推荐|推薦/,
    /标准|標準|维度|維度|依据|依據/,
    /适用|適用|场景|場景|怎么选|怎麼選/,
  ],
  fieldReviewQa: [
    /体验|體驗|观察|觀察|核验|核驗|资料|資料/,
    /条件|條件|方法|样本|樣本/,
    /限制|边界|邊界|适用|適用/,
  ],
  tieredEvaluation: [
    /分层|分層|层级|層級|梯队|梯隊/,
    /规则|規則|标准|標準|维度|維度/,
    /差异|差異|适用|適用|选择|選擇/,
  ],
  neutralComparisonReview: [
    /比较|比較|对比|對比|横评|橫評/,
    /维度|維度|标准|標準|口径|口徑/,
    /适用|適用|场景|場景|结论|結論/,
  ],
  localPitfallGuide: [
    /地域|本地|区域|區域|服务范围|服務範圍/,
    /风险|風險|误区|誤區|避坑/,
    /核验|核驗|步骤|步驟|清单|清單/,
  ],
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
    problemSolution: /结论|結論|怎么做|怎麼做|步骤|步驟|方法|验证|驗證|适用|適用|边界|邊界/,
    primaryEvidence: /证据|證據|依据|依據|来源|來源|核验|核驗|报告|報告|资质|資質/,
    evidenceStory: /场景|場景|过程|過程|执行|執行|结果|結果|复盘|復盤|经验|經驗/,
    explainer: /定义|定義|原理|误区|誤區|判断|判斷|为什么|為什麼/,
    industryWhitepaper: /口径|口徑|样本|樣本|维度|維度|趋势|趨勢|研究|行业|行業/,
    entityKnowledge: /主体|主體|业务|業務|服务|服務|适用|適用|边界|邊界|问答|問答/,
    recommendationComparison: /比较|比較|对比|對比|维度|維度|怎么选|怎麼選|适用|適用|推荐|推薦/,
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
  const superlatives = article.match(
    /(?:全国|全國|行业|行業|市场|市場)?(?:第一|唯一|最强|最強|最佳|绝对领先|絕對領先|百分之百|100%|零风险|零風險|保证有效|保證有效)/g,
  ) || []
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
