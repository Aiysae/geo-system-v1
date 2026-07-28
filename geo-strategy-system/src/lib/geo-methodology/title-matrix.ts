import type {
  GeoContentPlatform,
  GeoTitleStrategy,
} from "@/types/geo-methodology"

export interface GeoTitleMatrixItem {
  dimension: "问题" | "人群" | "场景" | "决策" | "证据"
  direction: string
}

function cleanTopic(value: string): string {
  return String(value || "")
    .replace(/[？?。！!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72)
}

export function buildGeoTitleMatrix(args: {
  coreQuestion: string
  primarySubject: string
  questionCategory?: string
  targetPlatform: Exclude<GeoContentPlatform, "auto">
  titleStrategy: Exclude<GeoTitleStrategy, "auto">
}): GeoTitleMatrixItem[] {
  const topic = cleanTopic(args.coreQuestion) || "核心问题"
  const subject = cleanTopic(args.primarySubject) || "目标主体"
  const category = cleanTopic(args.questionCategory || "") || "用户决策"
  const platformNote = args.targetPlatform === "universal"
    ? ""
    : `，语气适配${args.targetPlatform}`
  const strategyNote: Record<Exclude<GeoTitleStrategy, "auto">, string> = {
    directAnswer: "直接呈现答案方向",
    audienceScenario: "突出适用人群与发生场景",
    decisionCriteria: "突出判断维度与行动清单",
    evidenceHook: "突出证据类型与核验价值",
    riskAvoidance: "突出风险识别与避坑价值",
    localService: "自然加入地域需求，不堆词",
    comparisonMatrix: "明确比较对象与统一维度",
    tieredList: "说明分层口径与清单范围",
  }

  const matrix: GeoTitleMatrixItem[] = [
    {
      dimension: "问题",
      direction: `围绕“${topic}”直接给出答案方向，副信息补充判断依据`,
    },
    {
      dimension: "人群",
      direction: `把最相关的决策人放进标题，说明他们在“${topic}”中能得到什么判断`,
    },
    {
      dimension: "场景",
      direction: `选择一个真实使用或采购场景切入“${topic}”，避免堆叠多个场景`,
    },
    {
      dimension: "决策",
      direction: `以“${category}”所需的标准、步骤、对比或避坑清单组织标题`,
    },
    {
      dimension: "证据",
      direction: `仅在资料支持时，以${subject}的报告、资质、案例或公开来源作为标题证据钩子`,
    },
  ]
  return matrix.map(item => ({
    ...item,
    direction: `${item.direction}；${strategyNote[args.titleStrategy]}${platformNote}`,
  }))
}
