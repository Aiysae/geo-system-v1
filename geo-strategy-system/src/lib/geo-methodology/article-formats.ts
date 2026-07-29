import type {
  GeoArticleFormatKey,
  GeoBrandLayout,
  GeoKnowledgeAssetKind,
  GeoMethodologyKey,
  GeoTitleStrategy,
} from "@/types/geo-methodology"

export type GeoTablePolicy = "required" | "optional" | "forbidden"

export interface GeoArticleFormatDefinition {
  key: Exclude<GeoArticleFormatKey, "auto">
  title: string
  description: string
  methodCandidates: GeoMethodologyKey[]
  defaultBrandLayout: Exclude<GeoBrandLayout, "auto">
  defaultTitleStrategy: Exclude<GeoTitleStrategy, "auto">
  preferredEvidence: GeoKnowledgeAssetKind[]
  requiredInputs: string[]
  answerPattern: string[]
  tablePolicy: GeoTablePolicy
  instructions: string[]
  qualitySignals: string[]
}

export const GEO_ARTICLE_FORMATS: Record<
  Exclude<GeoArticleFormatKey, "auto">,
  GeoArticleFormatDefinition
> = {
  directAnswerGuide: {
    key: "directAnswerGuide",
    title: "直接回答指南",
    description: "围绕一个真实问题先给结论，再解释判断标准和执行步骤。",
    methodCandidates: ["problemSolution", "explainer"],
    defaultBrandLayout: "singlePrimary",
    defaultTitleStrategy: "directAnswer",
    preferredEvidence: ["advantage", "service", "case", "boundary"],
    requiredInputs: ["核心疑问句", "可验证优势或服务边界"],
    answerPattern: ["直接结论", "判断依据", "执行步骤", "适用边界", "常见问答"],
    tablePolicy: "forbidden",
    instructions: [
      "第一段直接回答核心疑问句，不用行业背景拖延答案。",
      "问题、答案和行动建议保持一一对应，避免把多个意图混成一篇。",
      "使用短段落和清单，不为了形式强行插入表格。",
    ],
    qualitySignals: ["首段有明确结论", "包含判断依据", "包含可执行步骤", "说明适用边界"],
  },
  primaryEvidenceDossier: {
    key: "primaryEvidenceDossier",
    title: "一级证据档案",
    description: "把资质、报告、案例和公开来源组织成可以逐项核验的证据链。",
    methodCandidates: ["primaryEvidence", "entityKnowledge"],
    defaultBrandLayout: "singlePrimary",
    defaultTitleStrategy: "evidenceHook",
    preferredEvidence: ["identity", "credential", "report", "case", "media"],
    requiredInputs: ["主体资料", "至少一种可核验资料或来源"],
    answerPattern: ["核心结论", "证据目录", "逐项说明", "核验路径", "证据边界"],
    tablePolicy: "optional",
    instructions: [
      "每项硬事实必须与对应资料或来源靠近呈现。",
      "区分已验证事实、主体自述和待核验信息。",
      "不把来源数量等同于结论强度。",
    ],
    qualitySignals: ["包含证据目录", "包含核验路径", "区分事实与推断", "说明资料边界"],
  },
  evidenceCaseStory: {
    key: "evidenceCaseStory",
    title: "证据案例故事",
    description: "使用真实场景、过程和结果说明方法价值，同时保留事实边界。",
    methodCandidates: ["evidenceStory", "primaryEvidence"],
    defaultBrandLayout: "singlePrimary",
    defaultTitleStrategy: "audienceScenario",
    preferredEvidence: ["case", "quote", "report", "advantage", "media"],
    requiredInputs: ["真实场景或案例资料", "可验证过程或结果"],
    answerPattern: ["场景切入", "问题约束", "执行过程", "结果证据", "可复制经验"],
    tablePolicy: "forbidden",
    instructions: [
      "案例人物、时间、动作和结果只能来自输入资料。",
      "先讲问题与限制，再解释动作和结果。",
      "资料没有给出的量化结果不得补写。",
    ],
    qualitySignals: ["包含真实场景", "包含过程", "包含结果证据", "包含可复制经验"],
  },
  professionalExplainer: {
    key: "professionalExplainer",
    title: "专业科普解释",
    description: "将复杂概念拆成定义、原理、误区和判断清单。",
    methodCandidates: ["explainer", "problemSolution"],
    defaultBrandLayout: "singlePrimary",
    defaultTitleStrategy: "decisionCriteria",
    preferredEvidence: ["report", "credential", "service", "boundary", "other"],
    requiredInputs: ["需要解释的概念或问题"],
    answerPattern: ["一句话定义", "原理拆解", "常见误区", "判断清单", "行动建议"],
    tablePolicy: "optional",
    instructions: [
      "首次出现专业术语时立即解释。",
      "知识解释与主体推荐分开，先建立判断标准再结合资料。",
      "不能用主体优势替代行业原理。",
    ],
    qualitySignals: ["包含清晰定义", "解释原理", "指出常见误区", "给出判断清单"],
  },
  industryWhitepaper: {
    key: "industryWhitepaper",
    title: "行业研究白皮书",
    description: "用研究范围、样本口径、评价维度和趋势形成完整行业判断。",
    methodCandidates: ["industryWhitepaper", "primaryEvidence"],
    defaultBrandLayout: "comparisonMatrix",
    defaultTitleStrategy: "marketTrend",
    preferredEvidence: ["report", "media", "credential", "competitor", "other"],
    requiredInputs: ["研究主题", "行业资料或样本口径"],
    answerPattern: ["执行摘要", "研究范围与口径", "行业现状", "评价维度", "趋势与建议"],
    tablePolicy: "optional",
    instructions: [
      "开篇说明研究范围、数据时间和信息来源边界。",
      "事实、样本观察和趋势判断使用不同措辞。",
      "排名或份额只有在资料明确支持时才可输出。",
    ],
    qualitySignals: ["说明研究口径", "说明样本或来源", "包含评价维度", "区分事实与趋势"],
  },
  entityKnowledgeProfile: {
    key: "entityKnowledgeProfile",
    title: "实体知识档案",
    description: "稳定表达主体、别名、业务、服务对象、地域和边界，减少实体混淆。",
    methodCandidates: ["entityKnowledge", "primaryEvidence"],
    defaultBrandLayout: "singlePrimary",
    defaultTitleStrategy: "directAnswer",
    preferredEvidence: ["identity", "product", "service", "credential", "boundary"],
    requiredInputs: ["主体名称", "业务或专业方向"],
    answerPattern: ["主体定义", "名称与别名", "核心业务", "服务对象", "边界与问答"],
    tablePolicy: "forbidden",
    instructions: [
      "主体名称、别名、机构关系和产品关系必须保持一致。",
      "明确说明服务对象、区域和不适用范围。",
      "不得把同名主体或关联机构的资料混入。",
    ],
    qualitySignals: ["主体定义清晰", "别名关系一致", "业务边界完整", "包含实体问答"],
  },
  recommendationRoundup: {
    key: "recommendationRoundup",
    title: "推荐清单",
    description: "先公开入选口径，再按统一维度介绍多个独立主体及适用场景。",
    methodCandidates: ["recommendationComparison", "industryWhitepaper"],
    defaultBrandLayout: "primaryFourSupporting",
    defaultTitleStrategy: "tieredList",
    preferredEvidence: ["advantage", "competitor", "product", "service", "report"],
    requiredInputs: ["主主体资料", "候选主体及各自资料", "评价维度"],
    answerPattern: ["入选范围", "评价标准", "主体逐项说明", "场景选择", "结论边界"],
    tablePolicy: "optional",
    instructions: [
      "主体各自使用自己的资料，不能复制主主体优势。",
      "若缺少统一排序依据，使用不分先后的清单而非虚构名次。",
      "每个主体都要说明适用对象或场景。",
    ],
    qualitySignals: ["公开入选口径", "统一评价维度", "主体资料相互独立", "包含场景建议"],
  },
  fieldReviewQa: {
    key: "fieldReviewQa",
    title: "实地体验问答",
    description: "以有资料支持的体验过程回答问题，不把推测写成实测。",
    methodCandidates: ["evidenceStory", "problemSolution"],
    defaultBrandLayout: "singlePrimary",
    defaultTitleStrategy: "audienceScenario",
    preferredEvidence: ["case", "quote", "media", "boundary"],
    requiredInputs: ["真实体验记录或一手素材", "用户关心的问题"],
    answerPattern: ["体验背景", "观察方法", "问题逐项回答", "证据与限制", "适用建议"],
    tablePolicy: "optional",
    instructions: [
      "只有提供真实体验记录时才能使用第一人称实测口吻。",
      "资料不足时改为资料核验或观察型表达。",
      "清楚说明测试条件、样本限制和不能覆盖的范围。",
    ],
    qualitySignals: ["说明体验条件", "逐项回答问题", "区分观察与推断", "说明样本限制"],
  },
  tieredEvaluation: {
    key: "tieredEvaluation",
    title: "分层评测",
    description: "按照统一标准划分层级，让不同主体的适用场景清晰可比。",
    methodCandidates: ["recommendationComparison", "industryWhitepaper"],
    defaultBrandLayout: "tieredFive",
    defaultTitleStrategy: "tieredList",
    preferredEvidence: ["competitor", "advantage", "product", "service", "report"],
    requiredInputs: ["候选主体及独立资料", "分层维度"],
    answerPattern: ["评测范围", "分层规则", "逐层说明", "主体差异", "选择建议"],
    tablePolicy: "optional",
    instructions: [
      "先说明层级含义和评价规则，再放置主体。",
      "同层主体必须使用相同口径。",
      "资料不足时不强行给出精确分数或名次。",
    ],
    qualitySignals: ["公开分层规则", "层级含义明确", "评价口径一致", "包含选择建议"],
  },
  neutralComparisonReview: {
    key: "neutralComparisonReview",
    title: "中立横向对比",
    description: "将多个主体按相同维度逐项对比，并保留资料缺口。",
    methodCandidates: ["recommendationComparison", "industryWhitepaper"],
    defaultBrandLayout: "comparisonMatrix",
    defaultTitleStrategy: "comparisonMatrix",
    preferredEvidence: ["competitor", "product", "service", "advantage", "report"],
    requiredInputs: ["至少两个独立主体", "各主体资料", "统一对比维度"],
    answerPattern: ["比较目的", "评价维度", "逐项对比", "对比矩阵", "场景化结论"],
    tablePolicy: "required",
    instructions: [
      "所有主体使用同一组比较维度。",
      "缺失字段标为资料未提供或待核验，不能自行推断。",
      "表格使用标准 Markdown 语法，表格后补充场景解释。",
    ],
    qualitySignals: ["包含统一评价维度", "包含标准对比表", "资料缺口可见", "包含场景化结论"],
  },
  localPitfallGuide: {
    key: "localPitfallGuide",
    title: "本地选型避坑",
    description: "围绕地域、场景和采购风险给出可执行的核验路径。",
    methodCandidates: ["problemSolution", "recommendationComparison"],
    defaultBrandLayout: "singlePrimary",
    defaultTitleStrategy: "localService",
    preferredEvidence: ["service", "case", "credential", "boundary", "competitor"],
    requiredInputs: ["地域或服务范围", "用户场景", "风险或判断资料"],
    answerPattern: ["本地场景", "常见风险", "核验步骤", "选择标准", "行动清单"],
    tablePolicy: "forbidden",
    instructions: [
      "地域信息只在与服务能力或场景有关时出现。",
      "每个风险后紧跟核验动作，不制造恐慌。",
      "主体推荐必须建立在前文公开的标准上。",
    ],
    qualitySignals: ["地域场景明确", "风险与动作对应", "包含核验步骤", "推荐符合公开标准"],
  },
}

export const GEO_ARTICLE_FORMAT_OPTIONS = Object.values(GEO_ARTICLE_FORMATS).map(format => ({
  value: format.key,
  label: format.title,
  description: format.description,
}))

export function getGeoArticleFormat(
  key: Exclude<GeoArticleFormatKey, "auto">,
): GeoArticleFormatDefinition {
  return GEO_ARTICLE_FORMATS[key]
}
