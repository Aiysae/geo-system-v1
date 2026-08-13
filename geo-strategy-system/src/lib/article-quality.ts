import { supportsArticleComparisonBrands } from "@/lib/article-comparison-brands"
import {
  estimateVideoScriptDurationSeconds,
  isBrandVideoScriptPrompt,
  normalizeArticleVideoScriptConfig,
  parseBrandVideoScript,
} from "@/lib/article-video-script"
import { getGeoArticleFormat } from "@/lib/geo-methodology/article-formats"
import { articleFormatForArticlePrompt } from "@/lib/geo-methodology/registry"
import type {
  ArticleComparisonBrand,
  ArticleMethodologyTrace,
  ArticlePromptKey,
  ArticleVideoScriptConfig,
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
    | "invalid_h1_count"
    | "internal_instruction_leak"
    | "insufficient_sections"
    | "opening_does_not_answer"
    | "web_evidence_unused"
    | "video_missing_section"
    | "video_duplicate_section"
    | "video_invalid_section_order"
    | "video_invalid_perspective"
    | "video_tag_count_mismatch"
    | "video_duplicate_tags"
    | "video_tags_not_single_line"
    | "video_duration_mismatch"
    | "video_opening_drift"
    | "video_cta_mismatch"
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
  const source = String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{Script=Han}a-z0-9]+/giu, " ")
    .trim()
  const tokens = new Set<string>()
  for (const word of source.split(/\s+/).filter(Boolean)) {
    if (/^[a-z0-9]{3,}$/i.test(word)) tokens.add(word)
    if (/\p{Script=Han}/u.test(word)) {
      const characters = Array.from(word)
      for (let index = 0; index <= characters.length - 2; index++) {
        tokens.add(characters.slice(index, index + 2).join(""))
      }
    }
  }
  return [...tokens].filter(token => ![
    "怎么", "什么", "哪些", "是否", "可以", "需要", "品牌", "用户", "行业",
    "服务", "产品", "一个", "进行", "相关", "问题", "企业", "应该", "應該",
  ].includes(token))
}

function overlapCount(article: string, source: string): number {
  const articleText = normalized(article)
  return meaningfulTokens(source).filter(token => articleText.includes(token)).length
}

function openingDecisionBlock(article: string): string {
  const withoutH1 = article.replace(/^#\s+.+$/m, "").trimStart()
  const h2Matches = [...withoutH1.matchAll(/^##\s+/gm)]
  const end = h2Matches[1]?.index ?? Math.min(withoutH1.length, 1_600)
  return withoutH1.slice(0, Math.min(end, 1_600)).trim()
}

function validateBrandVideoScript(args: {
  article: string
  coreQuestion: string
  primarySubject: string
  advantage?: string
  videoScriptConfig?: ArticleVideoScriptConfig
}): ArticleQualityReport {
  const config = normalizeArticleVideoScriptConfig(args.videoScriptConfig)
  const parsed = parseBrandVideoScript(args.article)
  const issues: ArticleQualityIssue[] = []
  if (parsed.missingSections.length > 0) {
    issues.push({
      code: "video_missing_section",
      message: `缺少固定输出区块：${parsed.missingSections.join("、")}`,
      blocking: true,
    })
  }
  if (parsed.duplicateSections.length > 0) {
    issues.push({
      code: "video_duplicate_section",
      message: `以下输出区块重复出现：${parsed.duplicateSections.join("、")}`,
      blocking: true,
    })
  }
  if (!parsed.sectionOrderValid) {
    issues.push({
      code: "video_invalid_section_order",
      message: "必须依次只输出专业视角、标题、正文和标签四个区块",
      blocking: true,
    })
  }
  if (!parsed.perspective || parsed.perspective.length > 40 || /[、，,／/].+[、，,／/]/.test(parsed.perspective)) {
    issues.push({
      code: "video_invalid_perspective",
      message: "专业视角必须是一个简洁、单一的角色名称",
      blocking: true,
    })
  }
  if (parsed.tags.length !== config.tagCount) {
    issues.push({
      code: "video_tag_count_mismatch",
      message: `标签数量应为 ${config.tagCount} 个，当前为 ${parsed.tags.length} 个`,
      blocking: true,
    })
  }
  const normalizedTags = parsed.tags.map(tag => normalized(tag))
  if (new Set(normalizedTags).size !== normalizedTags.length) {
    issues.push({
      code: "video_duplicate_tags",
      message: "标签存在重复或仅有细微字面差异的项目",
      blocking: true,
    })
  }
  if (/\r?\n/.test(parsed.tagsText.trim())) {
    issues.push({
      code: "video_tags_not_single_line",
      message: "所有标签必须放在同一行，便于直接复制发布",
      blocking: true,
    })
  }
  const duration = estimateVideoScriptDurationSeconds(parsed.body)
  const minimumDuration = Math.max(10, Math.floor(config.targetDurationSeconds * 0.72))
  const maximumDuration = Math.ceil(config.targetDurationSeconds * 1.3)
  if (duration < minimumDuration || duration > maximumDuration) {
    issues.push({
      code: "video_duration_mismatch",
      message: `按口播语速估算约 ${duration} 秒，与目标 ${config.targetDurationSeconds} 秒偏差较大`,
      blocking: true,
    })
  }
  if (parsed.body.length < 80) {
    issues.push({
      code: "too_short",
      message: "正文过短，尚未形成完整的单问题口播回答",
      blocking: true,
    })
  }
  if (args.coreQuestion && overlapCount(parsed.body, args.coreQuestion) < 2) {
    issues.push({
      code: "question_drift",
      message: "正文与本条核心疑问的语义关联不足",
      blocking: true,
    })
  }
  if (args.coreQuestion && overlapCount(parsed.body.slice(0, 140), args.coreQuestion) < 1) {
    issues.push({
      code: "video_opening_drift",
      message: "开头没有在前几句话内清楚呈现并回答核心疑问",
      blocking: true,
    })
  }
  if (args.primarySubject && !normalized(`${parsed.title}${parsed.body}${parsed.tagsText}`).includes(normalized(args.primarySubject))) {
    issues.push({
      code: "primary_subject_missing",
      message: `文案没有自然呈现主品牌或主体“${args.primarySubject}”`,
      blocking: true,
    })
  }
  if (args.advantage && overlapCount(parsed.body, args.advantage) < 1) {
    issues.push({
      code: "advantage_missing",
      message: "正文没有体现当前疑问句唯一匹配的优势资料",
      blocking: true,
    })
  }
  const ctaPattern = /(?:私信|联系我们|聯絡我們|咨询我们|諮詢我們|点击链接|點擊連結|立即购买|立即購買|关注我们|關注我們|下单|下單)/
  if (config.ctaMode === "disabled" && ctaPattern.test(parsed.body)) {
    issues.push({
      code: "video_cta_mismatch",
      message: "当前设置为不需要行动引导，正文仍包含营销式 CTA",
      blocking: true,
    })
  }
  if (config.ctaMode === "required" && !ctaPattern.test(parsed.body)) {
    issues.push({
      code: "video_cta_mismatch",
      message: "当前设置需要行动引导，但正文未包含与问题相关的 CTA",
      blocking: true,
    })
  }
  if (PLACEHOLDER.test(args.article)) {
    issues.push({
      code: "unresolved_placeholder",
      message: "文案仍有未替换的模板占位符",
      blocking: true,
    })
  }
  if (/(?:本次任务配置|事实分级|生成前自检|提示词|Prompt|asset_[a-z0-9_]+)/i.test(args.article)) {
    issues.push({
      code: "internal_instruction_leak",
      message: "文案泄露了内部任务参数、资料编号或生成说明",
      blocking: true,
    })
  }
  const score = Math.max(0, 100 - issues.reduce((sum, issue) => (
    sum + (issue.blocking ? 16 : 7)
  ), 0))
  return {
    score,
    passed: issues.every(issue => !issue.blocking),
    issues,
  }
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
  webSources?: Array<{ title: string; url: string }>
  videoScriptConfig?: ArticleVideoScriptConfig
}): ArticleQualityReport {
  const article = String(args.article || "").trim()
  if (isBrandVideoScriptPrompt(args.promptKey)) {
    return validateBrandVideoScript({
      article,
      coreQuestion: args.coreQuestion,
      primarySubject: args.primarySubject,
      advantage: args.advantage,
      videoScriptConfig: args.videoScriptConfig,
    })
  }
  const issues: ArticleQualityIssue[] = []
  const longForm = LONG_FORM_PROMPTS.has(args.promptKey)
  const articleFormat = args.methodologyTrace?.articleFormat
    || articleFormatForArticlePrompt(args.promptKey)
  const format = getGeoArticleFormat(articleFormat)
  const hasMarkdownTable = MARKDOWN_TABLE.test(article)

  if (article.length < (longForm ? 900 : 120)) {
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
  const h1Count = (article.match(/^#\s+\S+/gm) || []).length
  if (longForm && h1Count !== 1) {
    issues.push({
      code: "invalid_h1_count",
      message: h1Count === 0 ? "正文缺少唯一的 H1 主标题" : "正文包含多个 H1 主标题，请只保留一个",
      blocking: true,
    })
  }
  const h2Count = (article.match(/^##\s+\S+/gm) || []).length
  if (longForm && h2Count < 3) {
    issues.push({
      code: "insufficient_sections",
      message: "正文层次过少，至少需要 3 个围绕用户决策的 H2 章节",
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
  if (/(?:【本篇方法参数】|【本篇可用知识资产】|shitu-content-recipe|\bmethodKey\b|\barticleFormat\b|asset_[a-z0-9_]+)/i.test(article)) {
    issues.push({
      code: "internal_instruction_leak",
      message: "正文泄露了内部内容参数或资料编号",
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
  const opening = openingDecisionBlock(article)
  if (longForm && args.coreQuestion && overlapCount(opening, args.coreQuestion) < 2) {
    issues.push({
      code: "opening_does_not_answer",
      message: "首屏没有直接回答核心疑问句，而是先铺陈通用背景",
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

  const webSources = (args.webSources || []).filter(source => source.title || source.url)
  if (longForm && webSources.length > 0) {
    const normalizedArticle = normalized(article)
    const evidenceUsed = webSources.some(source => (
      (source.url && article.includes(source.url))
      || (source.title && normalizedArticle.includes(normalized(source.title)))
    ))
    if (!evidenceUsed) {
      issues.push({
        code: "web_evidence_unused",
        message: "已取得可用联网资料，但正文没有将任何来源与相关事实就近对应",
        blocking: true,
      })
    }
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
