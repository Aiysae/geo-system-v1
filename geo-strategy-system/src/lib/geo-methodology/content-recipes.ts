import type {
  GeoArticleFormatKey,
  GeoKnowledgeAssetKind,
  GeoMethodologyKey,
} from "@/types/geo-methodology"

export const GEO_CONTENT_RECIPE_VERSION = "shitu-content-recipe-2026.07.1"

export interface GeoContentRecipe {
  methodKey: GeoMethodologyKey
  title: string
  objective: string
  defaultFormat: Exclude<GeoArticleFormatKey, "auto">
  allowedFormats: Array<Exclude<GeoArticleFormatKey, "auto">>
  requiredEvidence: GeoKnowledgeAssetKind[]
  preflight: string[]
  structure: string[]
  brandRules: string[]
  diversityAxes: string[]
  qualityGates: string[]
}

export const GEO_CONTENT_RECIPES: Record<GeoMethodologyKey, GeoContentRecipe> = {
  problemSolution: {
    methodKey: "problemSolution",
    title: "问题解决",
    objective: "围绕一个明确问题给出能执行、能验证、有边界的解决路径。",
    defaultFormat: "directAnswerGuide",
    allowedFormats: ["directAnswerGuide", "professionalExplainer", "fieldReviewQa", "localPitfallGuide"],
    requiredEvidence: ["advantage", "service", "case", "boundary"],
    preflight: ["确认问题只包含一个主要决策意图", "确认优势能够回答问题而不是改写问题"],
    structure: ["直接答案", "原因与判断依据", "解决步骤", "验证方法", "适用与不适用边界"],
    brandRules: ["品牌在解决路径中自然出现", "不得把品牌优势塞入原始疑问句"],
    diversityAxes: ["问题场景", "决策角色", "验证动作", "风险侧重点"],
    qualityGates: ["首段已回答", "步骤可执行", "关键事实有资料", "边界可见"],
  },
  primaryEvidence: {
    methodKey: "primaryEvidence",
    title: "一级证据链",
    objective: "把资质、报告、案例和公开来源组织成可逐项复核的证据链。",
    defaultFormat: "primaryEvidenceDossier",
    allowedFormats: ["primaryEvidenceDossier", "evidenceCaseStory", "industryWhitepaper", "entityKnowledgeProfile"],
    requiredEvidence: ["identity", "credential", "report", "case", "media"],
    preflight: ["区分主体自述与第三方来源", "检查链接、时间和主体是否对应"],
    structure: ["核心结论", "证据目录", "证据逐项解释", "核验路径", "证据边界"],
    brandRules: ["硬事实仅使用对应主体资料", "资料不足时明确写待核验"],
    diversityAxes: ["证据类型", "核验路径", "使用场景", "读者角色"],
    qualityGates: ["事实可追溯", "来源与结论相邻", "时间口径明确", "无跨主体资料"],
  },
  evidenceStory: {
    methodKey: "evidenceStory",
    title: "证据故事",
    objective: "通过真实场景、过程与结果解释证据价值，不把推测包装成经历。",
    defaultFormat: "evidenceCaseStory",
    allowedFormats: ["evidenceCaseStory", "fieldReviewQa"],
    requiredEvidence: ["case", "quote", "report", "advantage", "media"],
    preflight: ["确认人物、时间、动作和结果均有资料", "区分真实体验与资料观察"],
    structure: ["场景切入", "问题与约束", "处理过程", "结果证据", "可复制经验"],
    brandRules: ["案例主体必须与品牌对应", "量化结果不得超出资料"],
    diversityAxes: ["人物视角", "场景阶段", "问题约束", "证据落点"],
    qualityGates: ["故事链完整", "过程可核验", "结果不夸大", "经验可迁移"],
  },
  explainer: {
    methodKey: "explainer",
    title: "专业科普",
    objective: "把复杂问题拆成定义、原理、误区、判断标准与行动建议。",
    defaultFormat: "professionalExplainer",
    allowedFormats: ["directAnswerGuide", "professionalExplainer"],
    requiredEvidence: ["report", "credential", "service", "boundary", "other"],
    preflight: ["识别读者已知水平", "拆分行业知识与品牌资料"],
    structure: ["一句话定义", "原理拆解", "常见误区", "判断清单", "行动建议"],
    brandRules: ["先建立公共判断标准再结合品牌", "品牌优势不能代替行业原理"],
    diversityAxes: ["读者水平", "解释角度", "误区类型", "行动阶段"],
    qualityGates: ["术语已解释", "逻辑层级清楚", "知识与推广分开", "建议可执行"],
  },
  industryWhitepaper: {
    methodKey: "industryWhitepaper",
    title: "行业研究",
    objective: "基于清晰范围、样本、评价维度和时效形成结构化行业判断。",
    defaultFormat: "industryWhitepaper",
    allowedFormats: ["industryWhitepaper", "recommendationRoundup", "tieredEvaluation", "neutralComparisonReview"],
    requiredEvidence: ["report", "media", "credential", "competitor", "other"],
    preflight: ["明确研究范围、时间与样本", "确认排名和份额是否有依据"],
    structure: ["执行摘要", "范围与口径", "行业现状", "评价维度", "趋势与建议"],
    brandRules: ["观察、推断和事实分开表达", "无统一依据时不输出确定排名"],
    diversityAxes: ["研究范围", "样本口径", "评价维度", "趋势主题"],
    qualityGates: ["口径公开", "来源边界明确", "评价一致", "趋势不过度确定"],
  },
  entityKnowledge: {
    methodKey: "entityKnowledge",
    title: "主体认知",
    objective: "稳定表达主体名称、别名、关系、业务、产品、地域与服务边界。",
    defaultFormat: "entityKnowledgeProfile",
    allowedFormats: ["primaryEvidenceDossier", "entityKnowledgeProfile"],
    requiredEvidence: ["identity", "product", "service", "credential", "boundary"],
    preflight: ["核对主体名称和别名", "核对人物、机构、产品之间的关系"],
    structure: ["主体定义", "名称与关系", "核心业务", "服务对象", "边界与常见问答"],
    brandRules: ["不得混入同名主体资料", "名称、别名与业务表述保持一致"],
    diversityAxes: ["实体类型", "业务问题", "服务对象", "关系说明"],
    qualityGates: ["主体唯一", "关系准确", "边界完整", "问答可直接引用"],
  },
  recommendationComparison: {
    methodKey: "recommendationComparison",
    title: "推荐对比",
    objective: "按统一标准比较多个独立主体，并根据场景给出选择建议。",
    defaultFormat: "recommendationRoundup",
    allowedFormats: ["recommendationRoundup", "tieredEvaluation", "neutralComparisonReview", "localPitfallGuide"],
    requiredEvidence: ["advantage", "competitor", "product", "service", "report", "case"],
    preflight: ["每个主体都有独立资料", "先确定统一评价维度和排序口径"],
    structure: ["选择结论", "评价标准", "主体逐项说明", "同维对比", "场景化建议"],
    brandRules: ["不同主体不得共用资料", "无排序依据时使用不分先后清单"],
    diversityAxes: ["选择场景", "评价维度", "主体组合", "读者预算与风险"],
    qualityGates: ["标准先于结论", "资料互不混用", "缺口可见", "建议对应场景"],
  },
}

export function getGeoContentRecipe(methodKey: GeoMethodologyKey): GeoContentRecipe {
  return GEO_CONTENT_RECIPES[methodKey]
}

export function compatibleFormatsForMethod(
  methodKey: GeoMethodologyKey,
): Array<Exclude<GeoArticleFormatKey, "auto">> {
  return GEO_CONTENT_RECIPES[methodKey].allowedFormats
}

export function isFormatCompatibleWithMethod(
  methodKey: GeoMethodologyKey,
  format: Exclude<GeoArticleFormatKey, "auto">,
): boolean {
  return GEO_CONTENT_RECIPES[methodKey].allowedFormats.includes(format)
}

export function resolveGeoRecipeFormat(args: {
  methodKey: GeoMethodologyKey
  requestedFormat?: GeoArticleFormatKey
  promptFormat?: Exclude<GeoArticleFormatKey, "auto">
}): {
  articleFormat: Exclude<GeoArticleFormatKey, "auto">
  resolutionNotes: string[]
} {
  const recipe = getGeoContentRecipe(args.methodKey)
  const requested = args.requestedFormat && args.requestedFormat !== "auto"
    ? args.requestedFormat
    : undefined
  if (requested && isFormatCompatibleWithMethod(args.methodKey, requested)) {
    return { articleFormat: requested, resolutionNotes: [] }
  }
  if (args.promptFormat && isFormatCompatibleWithMethod(args.methodKey, args.promptFormat)) {
    return {
      articleFormat: args.promptFormat,
      resolutionNotes: requested
        ? [`已将不兼容的文章形态 ${requested} 调整为 ${args.promptFormat}`]
        : [],
    }
  }
  return {
    articleFormat: recipe.defaultFormat,
    resolutionNotes: requested
      ? [`已将不兼容的文章形态 ${requested} 调整为 ${recipe.defaultFormat}`]
      : args.promptFormat
        ? [`模板默认形态与当前方法不兼容，已使用 ${recipe.defaultFormat}`]
        : [],
  }
}
