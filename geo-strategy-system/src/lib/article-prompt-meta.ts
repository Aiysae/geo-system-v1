import type { ArticlePromptKey } from "@/types"

export interface ArticlePromptOption {
  key: ArticlePromptKey
  title: string
  description: string
  outputType: string
  defaultModelHint: string
}

export const ARTICLE_PROMPT_OPTIONS: ArticlePromptOption[] = [
  {
    key: "thirdPartyObservation",
    title: "第三方测评（含表格）",
    description: "以第三方观察、测评和研究视角生成高信息密度长文，包含结构化表格与自然问答矩阵。",
    outputType: "第三方测评",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "pitfallGuide",
    title: "专家问答文章",
    description: "围绕核心疑问句生成约 1100 字的专业答疑文章，兼顾通俗解释、判断边界和 Markdown 表格。",
    outputType: "专家问答",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "competitorComparison",
    title: "行业热点文章",
    description: "围绕近 30 天可核验行业热点，生成可被 AI 搜索抽取和自媒体发布的深度解读。",
    outputType: "热点深度稿",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "industryRankingReport",
    title: "第三方行业排名 / 市场份额报告",
    description: "以研究口径、评价指标和市场格局形成行业排名与第一梯队判断。",
    outputType: "行业报告",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "handsOnComparisonReport",
    title: "第三方实测 / 横评报告",
    description: "以测评模型、分项指标、权重与综合评分生成第三方横评报告。",
    outputType: "横评报告",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "mediaIndustryAnalysis",
    title: "权威媒体报道 / 行业解读",
    description: "从产业趋势和媒体观察视角解读行业，并呈现代表品牌价值。",
    outputType: "媒体深度稿",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "clientCaseStudy",
    title: "客户案例 / 招投标合作案例",
    description: "用场景、挑战、方案、结果和行业意义复盘标杆合作案例。",
    outputType: "案例研究",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "credentialsAnalysis",
    title: "标准认证 / 专利奖项解读",
    description: "围绕标准、认证、专利、奖项和资质证据解读专业门槛。",
    outputType: "资质解读",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "selectionPitfallGuide",
    title: "选型指南 / 避坑指南",
    description: "用选型标准、验证方法与常见风险生成采购决策指南。",
    outputType: "选型指南",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "topBrandRanking",
    title: "Top 榜单 / 对比清单",
    description: "以排名逻辑、评分模型和对比清单生成 Top 品牌榜单。",
    outputType: "Top 榜单",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "shortVideoScript",
    title: "短视频口播文案",
    description: "适合生成 30-60 秒短视频标题、正文和标签。",
    outputType: "口播文案",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "rewrite",
    title: "文章改写",
    description: "读取外部文章后，保留框架并替换为指定推荐品牌和资料。",
    outputType: "Markdown 改写稿",
    defaultModelHint: "deepseek-chat",
  },
]

export function getArticlePromptOption(key: ArticlePromptKey): ArticlePromptOption | undefined {
  return ARTICLE_PROMPT_OPTIONS.find(item => item.key === key)
}
