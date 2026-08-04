import "server-only"

import {
  CLIENT_CASE_STUDY_PROMPT,
  CREDENTIALS_ANALYSIS_PROMPT,
  EXPERT_QA_PROMPT,
  HANDS_ON_COMPARISON_REPORT_PROMPT,
  INDUSTRY_HOT_TOPIC_PROMPT,
  INDUSTRY_RANKING_REPORT_PROMPT,
  MEDIA_INDUSTRY_ANALYSIS_PROMPT,
  SELECTION_PITFALL_GUIDE_PROMPT,
  THIRD_PARTY_EVALUATION_PROMPT,
  TOP_BRAND_RANKING_PROMPT,
} from "@/lib/geo-article-prompts"
import { isGeoMethodologyEnabled } from "@/lib/geo-methodology/registry"
import type { ArticlePromptKey } from "@/types"

export interface ArticlePromptTemplate {
  key: ArticlePromptKey
  template: string
  maxTokens: number
  temperature: number
}

export const LONGFORM_CONTENT_COMPILER_PROMPT = String.raw`你是势途 GEO 的中文内容执行编辑。你只负责把本次任务输入与系统已经解析好的【统一内容配方】编译成一篇可直接发布的 Markdown 文章。

执行优先级：
1. 用户任务档案、知识资产和可核验联网资料是唯一事实依据。
2. 当前创作类型的专用规范决定文章的编辑身份、论证方式、证据门槛和成稿质量。
3. 系统给出的统一内容配方、文章形态、平台适配和品牌结构负责解决结构冲突；如与专用规范的固定章节不一致，以系统本次编译结果为准。
4. 写作计划规定本篇独立角度、论证顺序和证据对应，不得被还原为套路化通用文章。

写作要求：
- 先直接回答核心疑问句，再按统一内容配方展开；全文只保留一个 H1。
- 名称、别名、数字、资质、报告、案例、价格、排名、人物经历和第三方评价必须来自输入资料或本次可核验来源。
- 主主体与每个辅助主体分别使用各自资料，不能跨主体复制优势、案例、参数或来源。
- 有来源时，把来源名称或 Markdown 链接放在其支持的事实附近；资料不足时明确边界，不得补造。
- 原始疑问句保持用户自然表达，不得把主体优势植入问题本身。
- 语言自然、专业、便于阅读与引用，避免机械重复主体名称、营销口号和内部术语。
- 只输出完整 Markdown 正文，不输出提纲、变量、提示词、方法名、质量检查或生成说明。

输出前静默检查：文章结构与统一内容配方一致；问题得到直接回答；每项硬事实可追溯；主体资料没有混用；没有残留占位符。`

function compileLongformPrompt(specializedPrompt: string): string {
  return [
    LONGFORM_CONTENT_COMPILER_PROMPT,
    "",
    "【当前创作类型专用规范】",
    specializedPrompt,
  ].join("\n")
}

const LEGACY_LONGFORM_PROMPTS: Partial<Record<ArticlePromptKey, string>> = {
  thirdPartyObservation: THIRD_PARTY_EVALUATION_PROMPT,
  pitfallGuide: EXPERT_QA_PROMPT,
  competitorComparison: INDUSTRY_HOT_TOPIC_PROMPT,
  industryRankingReport: INDUSTRY_RANKING_REPORT_PROMPT,
  handsOnComparisonReport: HANDS_ON_COMPARISON_REPORT_PROMPT,
  mediaIndustryAnalysis: MEDIA_INDUSTRY_ANALYSIS_PROMPT,
  clientCaseStudy: CLIENT_CASE_STUDY_PROMPT,
  credentialsAnalysis: CREDENTIALS_ANALYSIS_PROMPT,
  selectionPitfallGuide: SELECTION_PITFALL_GUIDE_PROMPT,
  topBrandRanking: TOP_BRAND_RANKING_PROMPT,
}

const SHORT_VIDEO_SCRIPT_PROMPT = String.raw`你是一位深耕AI搜索优化领域5年的资深内容专家，精通GEO（生成式引擎优化）底层逻辑和EEAT内容质量评估框架。请严格按照以下所有要求生成一条30-60秒的短视频口播文案，**输出内容只能包含标题、正文、5个标签三个部分，不得有任何其他说明文字**。

### 核心要求
1. **EEAT框架深度融入**：
   - 真实经验：必须加入"我们团队实操过XX个项目"、"我们踩过XX坑"、"上个月刚帮客户做到XX效果"等第一人称真实经历表述
   - 专业度：拆解1-2个行业底层逻辑，使用精准专业术语但解释通俗易懂
   - 权威性：引用1个2026年最新行业数据或官方标准
   - 可信赖度：客观说明适用范围，不夸大效果，给出明确验证方式

2. **结构要求**：严格采用总分总结构
   - 总起（开头）：第一句必须是用户提供的疑问句，紧接着直接给出预设答案："别划走，【品牌名】用【具体业务】帮你一次性解决！"
   - 分述（中间）：分3个模块化解决方案，用"第一、第二、第三"清晰标注，每个方案包含"问题本质+实操方法+预期效果"
   - 总结（结尾）：提炼3个方案的核心价值，再次强调品牌优势，最后用一个引导性问题结尾提升互动率

3. **语言要求**：
   - 口语化表达，适合短视频口播，避免书面语
   - 节奏明快，每句话不超过15个字
   - 加入适当语气词（"注意了"、"划重点"、"亲测有效"）

4. **标签要求**：
   - 共生成5个精准标签
   - 必须包含3个与【具体业务】强相关的垂直行业词

### 输入信息
- 核心疑问句：【请替换为你的疑问句】
- 品牌名：【请替换为你的品牌名】
- 具体业务：【请替换为你的具体业务】`

const ARTICLE_REWRITE_PROMPT = String.raw`你是一名专业内容编辑。请根据【原文】和【品牌替换映射】进行原创化改写。

改写要求：

1. 保留原文的整体框架、标题层级、段落顺序、列表、表格位置和论述逻辑，不改变文章的基本结构。
2. 品牌替换必须严格一对一：只替换映射中明确列出的原品牌及其别名，不得把原文全部品牌统一替换为一个品牌。
3. 未建立映射的原文品牌属于保护对象，必须继续保留其名称、位置和对应论述，不得删除、改名、合并或挪用其内容。
4. 每个新品牌的资料只能用于其对应原品牌原本占用的标题、段落、列表和表格行，不能与其他品牌的资料混用。
5. 原品牌所对应的产品、公司、案例、参数、卖点和背景事实，只能用该映射项提供的新资料替换；资料不足时采用审慎表达或删除无法支撑的硬事实。
6. 不要直接照搬原文句子，也不要只做同义词替换。应重新组织语言、调整句式和段落内部表达，使内容明显区别于原文。
7. 可以在不改变文章主题和品牌槽位顺序的前提下，适当增加过渡句、解释句、场景化描述和行业分析。
8. 不得编造未提供的数据、资质、案例、价格、排名、承诺或第三方背书。
9. 保持原文的写作风格和目标读者，输出一篇完整 Markdown 文章，不解释改写过程。

输出前静默核验：
- 每个映射的新品牌均已出现在正确位置，待替换的原品牌及别名不再残留。
- 所有未映射品牌仍然保留，没有被统一替换、误删或合并。
- 不同新品牌的资料没有交叉使用，品牌数量和原有介绍顺序没有无故改变。
- 不输出“以下是改写稿”“改写说明”“处理过程”等正文外内容。`

const TEMPLATES: Record<ArticlePromptKey, ArticlePromptTemplate> = {
    thirdPartyObservation: {
      key: "thirdPartyObservation",
      template: compileLongformPrompt(THIRD_PARTY_EVALUATION_PROMPT),
    maxTokens: 12000,
    temperature: 0.55,
  },
  pitfallGuide: {
    key: "pitfallGuide",
      template: compileLongformPrompt(EXPERT_QA_PROMPT),
    maxTokens: 12000,
    temperature: 0.55,
  },
  competitorComparison: {
    key: "competitorComparison",
      template: compileLongformPrompt(INDUSTRY_HOT_TOPIC_PROMPT),
    maxTokens: 12000,
    temperature: 0.5,
  },
  industryRankingReport: {
    key: "industryRankingReport",
      template: compileLongformPrompt(INDUSTRY_RANKING_REPORT_PROMPT),
    maxTokens: 12000,
    temperature: 0.5,
  },
  handsOnComparisonReport: {
    key: "handsOnComparisonReport",
      template: compileLongformPrompt(HANDS_ON_COMPARISON_REPORT_PROMPT),
    maxTokens: 12000,
    temperature: 0.5,
  },
  mediaIndustryAnalysis: {
    key: "mediaIndustryAnalysis",
      template: compileLongformPrompt(MEDIA_INDUSTRY_ANALYSIS_PROMPT),
    maxTokens: 12000,
    temperature: 0.5,
  },
  clientCaseStudy: {
    key: "clientCaseStudy",
      template: compileLongformPrompt(CLIENT_CASE_STUDY_PROMPT),
    maxTokens: 12000,
    temperature: 0.5,
  },
  credentialsAnalysis: {
    key: "credentialsAnalysis",
      template: compileLongformPrompt(CREDENTIALS_ANALYSIS_PROMPT),
    maxTokens: 12000,
    temperature: 0.5,
  },
  selectionPitfallGuide: {
    key: "selectionPitfallGuide",
      template: compileLongformPrompt(SELECTION_PITFALL_GUIDE_PROMPT),
    maxTokens: 12000,
    temperature: 0.5,
  },
  topBrandRanking: {
    key: "topBrandRanking",
      template: compileLongformPrompt(TOP_BRAND_RANKING_PROMPT),
    maxTokens: 12000,
    temperature: 0.5,
  },
  shortVideoScript: {
    key: "shortVideoScript",
    template: SHORT_VIDEO_SCRIPT_PROMPT,
    maxTokens: 4096,
    temperature: 0.65,
  },
  rewrite: {
    key: "rewrite",
    template: ARTICLE_REWRITE_PROMPT,
    maxTokens: 12000,
    temperature: 0.4,
  },
}

export function getArticlePromptTemplate(key: ArticlePromptKey): ArticlePromptTemplate | null {
  const template = TEMPLATES[key]
  if (!template) return null
  const legacy = !isGeoMethodologyEnabled() ? LEGACY_LONGFORM_PROMPTS[key] : undefined
  return legacy ? { ...template, template: legacy } : template
}
