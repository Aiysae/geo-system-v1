import { supportsArticleComparisonBrands } from "@/lib/article-comparison-brands"
import type { ArticleComparisonBrand, ArticlePromptKey } from "@/types"

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
    | "unresolved_placeholder"
    | "question_drift"
    | "primary_subject_missing"
    | "advantage_missing"
    | "comparison_brand_missing"
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

export function validateGeneratedArticle(args: {
  article: string
  promptKey: ArticlePromptKey
  coreQuestion: string
  primarySubject: string
  advantage?: string
  comparisonBrands?: ArticleComparisonBrand[]
}): ArticleQualityReport {
  const article = String(args.article || "").trim()
  const issues: ArticleQualityIssue[] = []
  const longForm = LONG_FORM_PROMPTS.has(args.promptKey)

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
  if (longForm && !MARKDOWN_TABLE.test(article)) {
    issues.push({
      code: "missing_table",
      message: "缺少模板要求的标准 Markdown 表格",
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
  if (supportsArticleComparisonBrands(args.promptKey)) {
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
}): string {
  return [
    "请修复下面这篇文章中列出的质量问题，输出修复后的完整 Markdown 正文。",
    "不得解释修改过程，不得删除原模板要求的章节，不得补造资料、数据、排名、案例或实测结论。",
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
    "",
    "【待修复正文】",
    args.draft,
  ].join("\n")
}
