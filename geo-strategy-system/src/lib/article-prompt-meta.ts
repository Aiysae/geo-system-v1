import { DEFAULT_ARTICLE_VIDEO_SCRIPT_CONFIG } from "@/lib/article-video-script"
import type { ArticlePromptKey, ArticleVideoScriptConfig } from "@/types"

export type ArticlePromptContentKind = "article" | "video_script" | "rewrite"
export type ArticlePromptSupportedMode = "single" | "batch" | "strategy"

export interface ArticlePromptOption {
  key: ArticlePromptKey
  title: string
  description: string
  outputType: string
  defaultModelHint: string
  contentKind: ArticlePromptContentKind
  supportedModes: ArticlePromptSupportedMode[]
  defaultVideoConfig?: ArticleVideoScriptConfig
}

export const ARTICLE_PROMPT_OPTIONS: ArticlePromptOption[] = [
  {
    key: "thirdPartyObservation",
    title: "第三方测评 / 推荐观察",
    description: "先公开评价标准，再以第三方观察视角说明主体差异、适用场景与证据边界。",
    outputType: "第三方测评",
    defaultModelHint: "deepseek-chat",
    contentKind: "article",
    supportedModes: ["single", "batch", "strategy"],
  },
  {
    key: "pitfallGuide",
    title: "问题解决 / 专家答疑",
    description: "围绕一个核心问题直接作答，给出判断依据、解决步骤、验证方法与适用边界。",
    outputType: "专家问答",
    defaultModelHint: "deepseek-chat",
    contentKind: "article",
    supportedModes: ["single", "batch", "strategy"],
  },
  {
    key: "competitorComparison",
    title: "竞品对比 / 行业观察",
    description: "按统一维度比较多个主体，结合行业背景说明差异、资料缺口与场景化选择。",
    outputType: "热点深度稿",
    defaultModelHint: "deepseek-chat",
    contentKind: "article",
    supportedModes: ["single", "batch", "strategy"],
  },
  {
    key: "industryRankingReport",
    title: "第三方行业排名 / 市场份额报告",
    description: "明确研究范围、样本与分层口径，再形成有依据的行业格局和梯队判断。",
    outputType: "行业报告",
    defaultModelHint: "deepseek-chat",
    contentKind: "article",
    supportedModes: ["single", "batch", "strategy"],
  },
  {
    key: "handsOnComparisonReport",
    title: "第三方实测 / 横评报告",
    description: "依据真实体验、测试样本或参数资料逐项回答；资料不足时自动改用核验口吻。",
    outputType: "横评报告",
    defaultModelHint: "deepseek-chat",
    contentKind: "article",
    supportedModes: ["single", "batch", "strategy"],
  },
  {
    key: "mediaIndustryAnalysis",
    title: "权威媒体报道 / 行业解读",
    description: "从研究范围、行业现状、评价维度和趋势建议形成媒体式深度解读。",
    outputType: "媒体深度稿",
    defaultModelHint: "deepseek-chat",
    contentKind: "article",
    supportedModes: ["single", "batch", "strategy"],
  },
  {
    key: "clientCaseStudy",
    title: "客户案例 / 招投标合作案例",
    description: "依据真实案例资料，用场景、约束、过程、结果证据和可复制经验完成复盘。",
    outputType: "案例研究",
    defaultModelHint: "deepseek-chat",
    contentKind: "article",
    supportedModes: ["single", "batch", "strategy"],
  },
  {
    key: "credentialsAnalysis",
    title: "标准认证 / 专利奖项解读",
    description: "把标准、认证、专利、奖项和报告整理成可逐项复核的证据链。",
    outputType: "资质解读",
    defaultModelHint: "deepseek-chat",
    contentKind: "article",
    supportedModes: ["single", "batch", "strategy"],
  },
  {
    key: "selectionPitfallGuide",
    title: "选型指南 / 避坑指南",
    description: "围绕地域或采购场景，用风险、核验步骤和选择标准形成可执行指南。",
    outputType: "选型指南",
    defaultModelHint: "deepseek-chat",
    contentKind: "article",
    supportedModes: ["single", "batch", "strategy"],
  },
  {
    key: "topBrandRanking",
    title: "Top 榜单 / 对比清单",
    description: "先说明入选和排序口径，再按统一维度形成榜单或不分先后的推荐清单。",
    outputType: "Top 榜单",
    defaultModelHint: "deepseek-chat",
    contentKind: "article",
    supportedModes: ["single", "batch", "strategy"],
  },
  {
    key: "shortVideoScript",
    title: "短视频口播文案",
    description: "适合生成 30-60 秒短视频标题、正文和标签。",
    outputType: "口播文案",
    defaultModelHint: "deepseek-chat",
    contentKind: "video_script",
    supportedModes: ["single", "batch"],
  },
  {
    key: "brandSingleQuestionVideoScript",
    title: "品牌短视频 · 单问题文案",
    description: "一条视频只回答一个疑问，并严格使用该问题匹配的优势生成待确认口播文案。",
    outputType: "视频文案",
    defaultModelHint: "系统默认豆包模型",
    contentKind: "video_script",
    supportedModes: ["single", "batch", "strategy"],
    defaultVideoConfig: { ...DEFAULT_ARTICLE_VIDEO_SCRIPT_CONFIG },
  },
  {
    key: "rewrite",
    title: "文章改写",
    description: "读取外部文章后，保留框架并替换为指定推荐品牌和资料。",
    outputType: "Markdown 改写稿",
    defaultModelHint: "deepseek-chat",
    contentKind: "rewrite",
    supportedModes: ["single"],
  },
]

export function getArticlePromptOption(key: ArticlePromptKey): ArticlePromptOption | undefined {
  return ARTICLE_PROMPT_OPTIONS.find(item => item.key === key)
}
