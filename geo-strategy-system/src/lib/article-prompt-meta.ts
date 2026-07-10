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
    title: "第三方观察长文",
    description: "适合生成行业观察、方案横评、场景拆解类 GEO 长文。",
    outputType: "Markdown 长文",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "pitfallGuide",
    title: "避坑指南文章",
    description: "适合生成中立决策、风险提示、品牌样本比较类文章。",
    outputType: "避坑文章",
    defaultModelHint: "deepseek-chat",
  },
  {
    key: "competitorComparison",
    title: "竞品对比推荐文章",
    description: "按统一维度对比真实品牌，自然优先展开主推品牌的媒体平台长文。",
    outputType: "Markdown 对比长文",
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
