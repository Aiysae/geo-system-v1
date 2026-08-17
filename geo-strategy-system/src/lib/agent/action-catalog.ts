import "server-only"

import * as z from "zod/v4"
import { estimateBackgroundJob, isBackgroundJobKind } from "@/lib/background-jobs"
import { estimateQuestionJobCredits } from "@/lib/geo-strategy/question-jobs"
import { moduleForBackgroundJob } from "@/lib/team-job-modules"
import {
  ARTICLE_PROMPT_PRICE_KEYS,
  estimateFeatureCredits,
  type FeaturePriceKey,
} from "@/lib/pricing"
import { isBrandVideoScriptPrompt } from "@/lib/article-video-script"
import type {
  AgentActionName,
  AgentModuleKey,
  AgentScope,
  BackgroundJobKind,
} from "@/types"
import type { TaskCenterSource } from "@/types/task-center"

type JsonSchema = Record<string, unknown>

export type AgentActionDefinition = {
  name: AgentActionName
  mcpTool?: string
  title: string
  description: string
  module: AgentModuleKey
  taskSource?: TaskCenterSource
  idempotent: true
  requiredScope: AgentScope | "dynamic"
  billable: boolean
  deprecated?: boolean
  readOnly?: boolean
  destructive?: boolean
  inputSchema: JsonSchema
}

type AgentActionRegistryEntry = Omit<AgentActionDefinition, "name" | "inputSchema"> & {
  schema: z.ZodType
  operationScope?: AgentScope
}

export type AgentActionEstimate = {
  credits: number
  units: number
  label: string
  scope: AgentScope
  clientId: string
  teamId?: string
  requestId: string
}

const requestIdSchema = z.string()
  .regex(/^[A-Za-z0-9_-]{16,160}$/)
  .describe("稳定的幂等请求编号；相同编号重试不会重复创建或扣费")
const clientContextShape = {
  clientId: z.string().min(1).max(200).describe("通过客户列表获取的客户 ID"),
  teamId: z.string().min(1).max(200).optional().describe("团队共享客户对应的团队 ID"),
  requestId: requestIdSchema,
  dryRun: z.boolean().optional().default(false).describe("仅检查参数、权限和预计积分，不创建任务"),
}
const modelSchema = z.enum(["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"])

const penetrationSchema = z.looseObject({
  ...clientContextShape,
  ourBrand: z.string().min(1).max(200).describe("目标品牌或人物姓名"),
  subjectType: z.enum(["brand", "person"]).optional().default("brand"),
  personProfile: z.looseObject({
    role: z.string().optional(),
    organization: z.string().optional(),
    specialty: z.string().optional(),
    location: z.string().optional(),
  }).optional(),
  brandAliases: z.array(z.string().min(1)).max(100).optional().default([]),
  industry: z.string().max(500).optional().default(""),
  competitors: z.array(z.string().min(1)).max(200).optional().default([]),
  questions: z.array(z.string().min(1)).min(1).max(600),
  questionIntents: z.array(z.string()).max(600).optional(),
  models: z.array(modelSchema).min(1).max(6),
  operation: z.enum(["replace", "append"]).optional().default("replace"),
  slotSelection: z.array(z.object({
    model: modelSchema,
    questionIndex: z.number().int().min(0),
  })).optional(),
})

const penetrationQuestionCategorySchema = z.enum([
  "recommendation",
  "pain_solution",
  "comparison",
  "purchase_decision",
  "scenario_audience",
  "brand_cognition",
  "risk_concern",
])

const penetrationQuestionGenerationSchema = z.looseObject({
  ...clientContextShape,
  industry: z.string().min(1).max(500),
  brand: z.string().min(1).max(300),
  subjectType: z.enum(["brand", "person"]).optional().default("brand"),
  personProfile: z.record(z.string(), z.unknown()).optional(),
  count: z.number().int().min(1).max(84).optional().default(28),
  keywords: z.string().max(3_000).optional().default(""),
  allocationMode: z.enum(["balanced", "custom"]).optional().default("balanced"),
  categories: z.array(penetrationQuestionCategorySchema).min(1).max(7).optional(),
  categoryCounts: z.partialRecord(
    penetrationQuestionCategorySchema,
    z.number().int().min(0).max(84),
  ).optional(),
})

const penetrationReanalyzeSchema = z.looseObject({
  ...clientContextShape,
})

const penetrationAutomationScheduleIdShape = {
  ...clientContextShape,
  scheduleId: z.string().min(1).max(240),
}

const penetrationAutomationGetSchema = z.looseObject({
  ...clientContextShape,
})

const penetrationAutomationSaveSchema = z.looseObject({
  ...clientContextShape,
  intervalDays: z.number().int().min(1).max(7),
  timeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  relativeDropThresholdPct: z.number().min(1).max(100).optional().default(20),
  minimumAbsoluteDropPoints: z.number().min(0).max(100).optional().default(3),
  inAppEnabled: z.boolean().optional().default(true),
  emailEnabled: z.boolean().optional().default(true),
  monthlyCreditLimit: z.number().int().min(1).max(1_000_000).optional(),
  status: z.enum(["active", "paused"]).optional().default("active"),
})

const penetrationAutomationStatusSchema = z.looseObject({
  ...penetrationAutomationScheduleIdShape,
  status: z.enum(["active", "paused"]),
})

const penetrationAutomationRunSchema = z.looseObject({
  ...penetrationAutomationScheduleIdShape,
})

const penetrationAutomationDeleteSchema = z.looseObject({
  ...penetrationAutomationScheduleIdShape,
})

const difficultySchema = z.looseObject({
  ...clientContextShape,
  model: z.union([z.literal("auto"), modelSchema]).optional().default("auto"),
  mode: z.enum(["industry", "brand"]),
  subjectType: z.enum(["brand", "person"]).optional().default("brand"),
  industry: z.string().min(1).max(500),
  region: z.string().max(240).optional().default("全国"),
  scope: z.enum(["city", "province", "region", "national"]).optional().default("national"),
  targetBrand: z.string().max(300).optional(),
  website: z.string().max(2_000).optional(),
  commercial: z.object({
    averageOrderValue: z.number().positive().optional(),
    grossMarginRate: z.number().positive().optional(),
    annualRepeatPurchases: z.number().positive().optional(),
    riskLevel: z.enum(["auto", "standard", "high_trust", "regulated", "strict"]).optional().default("auto"),
  }).optional(),
})

const backgroundSchema = z.looseObject({
  ...clientContextShape,
  kind: z.enum([
    "articleGeneration",
    "queryGeneration",
    "research",
    "diagnosis",
    "competitorCompare",
    "keywordExtract",
    "knowledgeImport",
    "keywordAdvantages",
    "keywordStrategy",
    "keywordWebsitePrompt",
  ]),
  payload: z.record(z.string(), z.unknown()).describe("兼容旧版后台任务参数；新接入应优先使用对应的专用动作"),
})

const articleQuestionTaskSchema = z.looseObject({
  questionId: z.string().optional(),
  materialId: z.string().optional(),
  question: z.string().min(1).max(500),
  matchedAdvantage: z.string().max(3_000).optional(),
  intent: z.string().max(300).optional(),
  category: z.string().max(120).optional(),
  promptKey: z.string().min(1),
})

const articleVideoScriptConfigSchema = z.looseObject({
  coreProductService: z.string().max(1_000).optional().default(""),
  outputLanguage: z.string().max(80).optional().default("中文"),
  languageStyle: z.string().max(300).optional().default("自然口语化、专业但不生硬"),
  platform: z.enum([
    "douyin",
    "wechatChannels",
    "xiaohongshu",
    "kuaishou",
    "reels",
    "tiktok",
    "other",
  ]).optional().default("douyin"),
  customPlatform: z.string().max(120).optional().default(""),
  targetDurationSeconds: z.number().int().min(15).max(180).optional().default(60),
  tagCount: z.number().int().min(1).max(30).optional().default(15),
  ctaMode: z.enum(["auto", "required", "disabled"]).optional().default("auto"),
  requiredMaterials: z.string().max(8_000).optional().default(""),
  priorContentSummary: z.string().max(12_000).optional().default(""),
  complianceRequirements: z.string().max(4_000).optional().default(""),
  evidencePolicy: z.enum([
    "clientMaterialsOnly",
    "verifiedPublicSupplement",
  ]).optional().default("clientMaterialsOnly"),
}).describe("品牌短视频·单问题文案配置；仅当 promptKey=brandSingleQuestionVideoScript 时使用")

const articleBatchSchema = z.looseObject({
  ...clientContextShape,
  count: z.number().int().min(1).max(50),
  topicMode: z.enum(["auto", "questions", "custom", "strategy"]),
  customTopics: z.string().max(30_000).optional(),
  questionTasks: z.array(articleQuestionTaskSchema).max(50).optional(),
  similarityRetry: z.boolean().optional().default(true),
  basePayload: z.looseObject({
    promptKey: z.string().min(1),
    modelProvider: z.string().min(1).optional().default("doubao"),
    model: z.string().optional(),
    clientName: z.string().optional(),
    brandName: z.string().optional(),
    subjectType: z.enum(["brand", "person"]).optional(),
    industry: z.string().optional(),
    website: z.string().optional(),
    coreQuestion: z.string().min(1).max(500).optional(),
    keywords: z.string().optional(),
    region: z.string().optional(),
    business: z.string().optional(),
    advantages: z.string().optional(),
    comparisonBrands: z.array(z.unknown()).optional(),
    audience: z.string().optional(),
    extraRequirements: z.string().optional(),
    videoScriptConfig: articleVideoScriptConfigSchema.optional(),
  }),
}).superRefine((value, context) => {
  if (!isBrandVideoScriptPrompt(value.basePayload.promptKey)) return
  const tasks = value.questionTasks || []
  if (value.topicMode === "questions" || value.topicMode === "strategy") {
    tasks.forEach((task, index) => {
      if (!task.matchedAdvantage?.trim()) {
        context.addIssue({
          code: "custom",
          path: ["questionTasks", index, "matchedAdvantage"],
          message: "单问题视频文案的每个疑问句都必须有独立匹配优势",
        })
      }
    })
  } else if (!value.basePayload.advantages?.trim()) {
    context.addIssue({
      code: "custom",
      path: ["basePayload", "advantages"],
      message: "单问题视频文案必须提供匹配优势",
    })
  }
})

const reportSchema = z.looseObject({
  ...clientContextShape,
  input: z.looseObject({
    kind: z.enum(["combined", "penetration", "research", "diagnosis", "difficulty", "keyword"]),
    detail: z.enum(["concise", "full"]),
    branding: z.object({
      mode: z.enum(["shitu", "custom"]),
      companyName: z.string(),
      website: z.string(),
      logoDataUrl: z.string().optional(),
    }).optional(),
    client: z.looseObject({
      id: z.string().min(1),
      name: z.string().min(1),
      ourBrand: z.string(),
      brandAliases: z.array(z.string()),
      industry: z.string(),
      website: z.string(),
    }),
    penetration: z.unknown().optional(),
    research: z.unknown().optional(),
    competitorCompare: z.unknown().optional(),
    diagnosis: z.unknown().optional(),
    difficulty: z.unknown().optional(),
    keyword: z.unknown().optional(),
  }),
})

const subjectShape = {
  subjectType: z.enum(["brand", "person"]).optional().default("brand"),
  personProfile: z.record(z.string(), z.unknown()).optional(),
}

const researchSchema = z.looseObject({
  ...clientContextShape,
  ...subjectShape,
  mode: z.enum(["ai", "hypothesis"]).optional().default("ai"),
  sourceMode: z.enum(["module", "manual"]).optional().default("module"),
  hypothesis: z.string().max(20_000).optional().default(""),
  ourBrand: z.string().min(1).max(300),
  region: z.string().max(300).optional().default(""),
  aliases: z.array(z.string()).max(12).optional().default([]),
  industry: z.string().min(1).max(500),
  website: z.string().max(2_000).optional().default(""),
  competitors: z.array(z.string()).max(20).optional().default([]),
  penetration: z.unknown().optional(),
})

const competitorCompareSchema = z.looseObject({
  ...clientContextShape,
  ...subjectShape,
  ourBrand: z.string().min(1).max(300),
  industry: z.string().min(1).max(500),
  website: z.string().max(2_000).optional().default(""),
  competitors: z.array(z.string()).max(20).optional().default([]),
  selectedCompetitors: z.array(z.string().min(1)).min(1).max(5),
  penetration: z.unknown().optional(),
})

const diagnosisSchema = z.looseObject({
  ...clientContextShape,
  ...subjectShape,
  ourBrand: z.string().min(1).max(300),
  industry: z.string().min(1).max(500),
  website: z.string().url().max(2_000),
  penetration: z.unknown().optional(),
})

const keywordExtractSchema = z.looseObject({
  ...clientContextShape,
  files: z.array(z.object({
    name: z.string().min(1).max(300),
    content: z.string().max(200_000),
    fileType: z.string().max(80).optional(),
  })).max(30).optional().default([]),
  projectInfo: z.record(z.string(), z.string().optional()),
})

const keywordAdvantagesSchema = z.looseObject({
  ...clientContextShape,
  profile: z.record(z.string(), z.unknown()),
  rawInputs: z.record(z.string(), z.unknown()).optional().default({}),
  count: z.number().int().min(4).max(20).optional().default(10),
})

const keywordStrategySchema = z.looseObject({
  ...clientContextShape,
  profile: z.record(z.string(), z.unknown()),
  sourcePlatformContext: z.record(z.string(), z.unknown()).optional(),
  strategySettings: z.object({
    target_region: z.string().optional(),
    language_style: z.string().optional(),
    custom_language_style: z.string().optional(),
    custom_keywords: z.array(z.string()).max(500).optional(),
  }).optional(),
})

const keywordWebsitePromptSchema = z.looseObject({
  ...clientContextShape,
  kind: z.enum(["official", "third-party"]).optional().default("official"),
  plan: z.record(z.string(), z.unknown()),
  site: z.record(z.string(), z.unknown()).optional(),
  siteIndex: z.number().int().min(0).max(100).optional(),
})

const questionCategoryConfigSchema = z.looseObject({
  weaknessesPerWeakness: z.number().int().min(1).max(30).optional().default(10),
  keywordEnabled: z.boolean().optional().default(true),
  weaknessEnabled: z.boolean().optional().default(true),
  painScenarioEnabled: z.boolean().optional().default(true),
  keywordCountMode: z.enum(["system", "custom", "per_keyword"]).optional().default("system"),
  weaknessCountMode: z.enum(["system", "custom"]).optional().default("system"),
  painScenarioCountMode: z.enum(["system", "custom"]).optional().default("system"),
  keywordSource: z.enum(["system", "custom"]).optional().default("system"),
  painScenarioSource: z.enum(["system", "custom"]).optional().default("system"),
  keywordCount: z.number().int().min(0).max(600).optional(),
  keywordQuestionsPerKeyword: z.number().int().min(1).max(30).optional(),
  weaknessCount: z.number().int().min(0).max(600).optional(),
  allocationMode: z.enum(["ratio", "custom"]).optional().default("ratio"),
  coreRatio: z.number().min(0).max(1).optional().default(0.3),
  secondaryRatio: z.number().min(0).max(1).optional().default(0.35),
  coreCount: z.number().int().min(0).max(600).optional(),
  secondaryCount: z.number().int().min(0).max(600).optional(),
  painScenarioCount: z.number().int().min(0).max(600).optional(),
})

const keywordQuestionsSchema = z.looseObject({
  ...clientContextShape,
  clientName: z.string().max(300).optional(),
  strategy: z.record(z.string(), z.unknown()),
  totalCount: z.number().int().min(1).max(600),
  categoryConfig: questionCategoryConfigSchema.optional().default({
    weaknessesPerWeakness: 10,
    keywordEnabled: true,
    weaknessEnabled: true,
    painScenarioEnabled: true,
    keywordCountMode: "system",
    weaknessCountMode: "system",
    painScenarioCountMode: "system",
    keywordSource: "system",
    painScenarioSource: "system",
    allocationMode: "ratio",
    coreRatio: 0.3,
    secondaryRatio: 0.35,
  }),
  questionModelProvider: z.enum(["doubao", "qwen"]).optional().default("doubao"),
  questionModel: z.string().max(200).optional(),
  coreKeywords: z.array(z.string()).max(1_000).optional().default([]),
  customKeywords: z.array(z.string()).max(1_000).optional().default([]),
  painScenarioKeywords: z.array(z.string()).max(1_000).optional().default([]),
  customPainScenarios: z.array(z.string()).max(1_000).optional().default([]),
  allocationOverrides: z.array(z.object({
    category: z.enum(["weakness_spin", "core_keywords", "secondary_keywords", "pain_scenario"]),
    count: z.number().int().min(0).max(600),
    keywords: z.array(z.string()).max(1_000).optional(),
  })).max(20).optional(),
})

const articleGenerationSchema = z.looseObject({
  ...clientContextShape,
  promptKey: z.string().min(1).max(100),
  modelProvider: z.string().min(1).max(100).optional().default("doubao"),
  model: z.string().max(200).optional(),
  clientName: z.string().max(300).optional(),
  brandName: z.string().max(300).optional(),
  ...subjectShape,
  subjectContext: z.string().max(4_000).optional(),
  industry: z.string().max(500).optional(),
  website: z.string().max(2_000).optional(),
  sourceUrl: z.string().max(1_000).optional(),
  sourceTitle: z.string().max(300).optional(),
  sourceMarkdown: z.string().max(60_000).optional(),
  rewriteBrand: z.string().max(500).optional(),
  rewriteMaterials: z.string().max(100_000).optional(),
  rewriteAnalysis: z.unknown().optional(),
  rewriteMappings: z.array(z.unknown()).max(50).optional(),
  coreQuestion: z.string().min(1).max(500),
  keywords: z.string().max(2_000).optional(),
  region: z.string().max(160).optional(),
  business: z.string().max(500).optional(),
  advantages: z.string().max(3_000).optional(),
  comparisonBrands: z.array(z.unknown()).max(50).optional(),
  methodology: z.unknown().optional(),
  knowledgeAssetIds: z.array(z.string().max(140)).max(30).optional(),
  audience: z.string().max(800).optional(),
  extraRequirements: z.string().max(2_000).optional(),
  videoScriptConfig: articleVideoScriptConfigSchema.optional(),
})

const articleRewriteSchema = articleGenerationSchema.extend({
  promptKey: z.literal("rewrite"),
  coreQuestion: z.string().max(500).optional().default(""),
  sourceMarkdown: z.string().min(1).max(60_000),
  rewriteAnalysis: z.looseObject({
    sourceFingerprint: z.string().min(1),
    brands: z.array(z.unknown()).max(20),
    analyzedAt: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
  }),
  rewriteMappings: z.array(z.looseObject({
    sourceBrand: z.string().min(1).max(120),
    sourceAliases: z.array(z.string().max(120)).max(12).optional().default([]),
    targetBrand: z.string().min(1).max(120),
    materials: z.string().max(50_000).optional().default(""),
  })).min(1).max(50),
})

const articleStrategyPlanSchema = z.looseObject({
  ...clientContextShape,
  questionIds: z.array(z.string().min(1).max(200)).max(300).optional().default([]),
  materialIds: z.array(z.string().min(1).max(200)).max(300).optional().default([]),
  modelProvider: z.string().min(1).max(100).optional().default("doubao"),
  model: z.string().max(200).optional(),
  comparisonBrandCount: z.number().int().min(0).max(9).optional().default(0),
  outputTrack: z.enum(["article", "video_script"]).optional().default("article"),
  videoScriptConfig: articleVideoScriptConfigSchema.optional(),
  methodology: z.unknown().optional(),
}).refine(
  value => value.questionIds.length + value.materialIds.length > 0,
  { message: "请至少选择一条疑问句", path: ["questionIds"] },
)

const articleSourceExtractSchema = z.looseObject({
  ...clientContextShape,
  url: z.string().url().max(2_000),
})

const articleBrandsAnalyzeSchema = z.looseObject({
  ...clientContextShape,
  sourceMarkdown: z.string().min(80).max(60_000),
  modelProvider: z.string().min(1).max(100).optional().default("doubao"),
  model: z.string().max(200).optional(),
})

const articleMaterialRowSchema = z.looseObject({
  rowNumber: z.number().int().min(1),
  question: z.string().min(1).max(500),
  matchedAdvantage: z.string().max(3_000).optional(),
  keyword: z.string().max(200).optional(),
  category: z.string().max(120).optional(),
  intent: z.string().max(300).optional(),
  decisionDimension: z.string().max(200).optional(),
  contentAngle: z.string().max(500).optional(),
  geoOptimizationText: z.string().max(2_000).optional(),
})

const articleMaterialsListSchema = z.looseObject({
  ...clientContextShape,
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(500).optional().default(100),
})

const articleMaterialsImportSchema = z.looseObject({
  ...clientContextShape,
  importBatchId: z.string().regex(/^aqi_[A-Za-z0-9_-]{12,110}$/).optional(),
  sourceFileName: z.string().max(180).optional(),
  rows: z.array(articleMaterialRowSchema).min(1).max(1_000),
})

const articleMaterialsDeleteSchema = z.looseObject({
  ...clientContextShape,
  ids: z.array(z.string().min(1).max(200)).max(2_000).optional().default([]),
  importBatchId: z.string().regex(/^aqi_[A-Za-z0-9_-]{12,110}$/).optional(),
}).refine(
  value => value.ids.length > 0 || Boolean(value.importBatchId),
  { message: "请提供要删除的素材 ID 或导入批次 ID", path: ["ids"] },
)

const articleMediaUploadSchema = z.looseObject({
  ...clientContextShape,
  batchId: z.string().min(1).max(240),
  files: z.array(z.object({
    name: z.string().min(1).max(300),
    mimeType: z.string().max(200).optional().default("application/octet-stream"),
    base64: z.string().min(1).max(17_000_000),
  })).min(1).max(3).describe("Agent JSON 单次最多上传 3 张；更多图片请分批调用"),
})

const articleMediaRunSchema = z.looseObject({
  ...clientContextShape,
  batchId: z.string().min(1).max(240),
  itemIds: z.array(z.string().min(1).max(240)).min(1).max(50),
  assetIds: z.array(z.string().min(1).max(240)).min(1).max(30),
  itemAssetMap: z.record(z.string(), z.array(z.string().min(1).max(240)).max(30)).optional(),
  template: z.enum(["opening", "standard", "rich"]).optional().default("standard"),
  mappingMode: z.enum(["round_robin", "same_set", "per_article"]).optional().default("round_robin"),
})

const feedbackCategorySchema = z.enum([
  "penetration_check",
  "content_production",
  "self_media_publish",
  "authority_media_publish",
  "video_publish",
  "website_optimization",
  "strategy_adjustment",
  "client_communication",
  "other",
])

const feedbackActionSchema = z.looseObject({
  ...clientContextShape,
  action: z.looseObject({
    category: feedbackCategorySchema,
    status: z.enum(["planned", "completed"]),
    visibility: z.enum(["client", "internal"]),
    title: z.string().min(1).max(160),
    description: z.string().max(2_000).optional(),
    occurredAt: z.string().min(1),
    quantity: z.number().nonnegative().optional(),
    unit: z.string().max(40).optional(),
    platform: z.string().max(120).optional(),
    evidence: z.array(z.object({
      label: z.string().max(160),
      url: z.string().url().max(1_000),
    })).max(20).optional(),
  }),
})

const feedbackImportSchema = z.looseObject({
  ...clientContextShape,
  importId: z.string().max(200).optional(),
  defaults: z.object({
    category: feedbackCategorySchema.optional(),
    status: z.enum(["planned", "completed"]).optional(),
    visibility: z.enum(["client", "internal"]).optional(),
    occurredDate: z.string().optional(),
    description: z.string().max(2_000).optional(),
  }).optional(),
  rows: z.array(z.object({
    title: z.string().min(1).max(160),
    url: z.string().url().max(1_000),
    platform: z.string().max(120).optional(),
  })).min(1).max(200),
})

const feedbackReportSchema = z.looseObject({
  ...clientContextShape,
  type: z.enum(["weekly", "monthly"]),
  targetDate: z.string().optional(),
  baselineHistoryRecordId: z.string().max(240).optional(),
  currentHistoryRecordId: z.string().max(240).optional(),
  publish: z.boolean().optional().default(false),
})

const feedbackReportOptionsSchema = z.looseObject({
  ...clientContextShape,
  type: z.enum(["weekly", "monthly"]),
  targetDate: z.string().optional(),
})

const feedbackReportManageSchema = z.looseObject({
  ...clientContextShape,
  reportId: z.string().min(1).max(240),
  operation: z.enum(["publish", "revoke-share", "delete"]),
})

const feedbackProfileUpdateSchema = z.looseObject({
  ...clientContextShape,
  patch: z.looseObject({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    periodMode: z.enum(["service", "calendar"]).optional(),
    currentStage: z.enum([
      "baseline",
      "foundation",
      "initial_mention",
      "coverage_growth",
      "stable_mention",
      "continuous_optimization",
    ]).optional(),
    stageProgress: z.number().min(0).max(100).optional(),
    projectOwner: z.string().max(160).optional(),
    expectedDurationDays: z.number().int().min(1).max(3_650).optional(),
    nextPlan: z.array(z.string().max(300)).max(100).optional(),
  }),
})

const feedbackAutomationGetSchema = z.looseObject({
  ...clientContextShape,
})

const feedbackAutomationSaveSchema = z.looseObject({
  ...clientContextShape,
  weeklyEnabled: z.boolean().optional().default(true),
  monthlyEnabled: z.boolean().optional().default(true),
  timeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().default("10:00"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodMode: z.enum(["service", "calendar"]).optional().default("service"),
  recipientEmails: z.array(z.string().email().max(254)).min(1).max(10),
  sendEmptyReports: z.boolean().optional().default(true),
  finalReportEnabled: z.boolean().optional().default(true),
}).refine(
  value => value.weeklyEnabled || value.monthlyEnabled,
  { message: "请至少开启周报或月报", path: ["weeklyEnabled"] },
).refine(
  value => value.endDate >= value.startDate,
  { message: "结束日期不能早于开始日期", path: ["endDate"] },
)

const feedbackAutomationScheduleSchema = z.looseObject({
  ...clientContextShape,
  scheduleId: z.string().min(1).max(240),
})

const feedbackAutomationStatusSchema = z.looseObject({
  ...clientContextShape,
  scheduleId: z.string().min(1).max(240),
  operation: z.enum(["pause", "resume"]),
})

const feedbackAutomationRetrySchema = z.looseObject({
  ...clientContextShape,
  scheduleId: z.string().min(1).max(240),
  executionId: z.string().min(1).max(240),
})

const feedbackVisibilityUpdateSchema = z.looseObject({
  ...clientContextShape,
  mode: z.enum(["default-penetration", "actions"]),
  actionIds: z.array(z.string().min(1).max(240)).max(200).optional().default([]),
  publication: z.enum(["internal", "summary", "full"]),
}).refine(
  value => value.mode === "default-penetration" || value.actionIds.length > 0,
  { message: "请至少选择一条执行动作", path: ["actionIds"] },
)

const feedbackReminderSettingsGetSchema = z.looseObject({
  ...clientContextShape,
})

const feedbackReminderSettingsUpdateSchema = z.looseObject({
  ...clientContextShape,
  emailEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
}).refine(
  value => value.emailEnabled !== undefined || value.inAppEnabled !== undefined,
  { message: "请至少提供一项提醒设置", path: ["emailEnabled"] },
)

const knowledgeImportSchema = z.looseObject({
  ...clientContextShape,
  files: z.array(z.object({
    name: z.string().min(1).max(300),
    mimeType: z.string().max(200).optional().default("application/octet-stream"),
    base64: z.string().min(1).describe("原始文件的 Base64 内容，不要包含 data URL 前缀"),
  })).min(1).max(20),
})

const knowledgeCommitSchema = z.looseObject({
  ...clientContextShape,
  importId: z.string().min(1).max(240),
  candidates: z.array(z.looseObject({
    id: z.string().min(1),
    selected: z.boolean(),
    kind: z.string().optional(),
    evidenceLevel: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    tags: z.array(z.string()).optional(),
    sourceUrls: z.array(z.string()).optional(),
    occurredAt: z.string().optional(),
  })).min(1).max(2_000),
})

export const AGENT_ACTION_REGISTRY = {
  "penetration.run": {
    mcpTool: "shitu_run_penetration",
    title: "运行渗透率情报检测",
    description: "按网页端相同的严格联网、独立采样和品牌裁判规则提交检测任务。",
    module: "penetration",
    taskSource: "penetration",
    idempotent: true,
    requiredScope: "penetration.execute",
    billable: true,
    schema: penetrationSchema,
  },
  "penetration.questions.generate": {
    mcpTool: "shitu_generate_penetration_questions",
    title: "智能生成检测问题",
    description: "按指定问题意图、行业、主体和关键词生成用于渗透率检测的问题。",
    module: "penetration",
    taskSource: "background",
    idempotent: true,
    requiredScope: "penetration.execute",
    billable: true,
    schema: penetrationQuestionGenerationSchema,
  },
  "penetration.brands.reanalyze": {
    mcpTool: "shitu_reanalyze_penetration_brands",
    title: "重新整理检测品牌榜",
    description: "只复用已保存的原始联网回答重新识别品牌或同行，不重新发起联网检测、不重复扣除检测积分。",
    module: "penetration",
    idempotent: true,
    requiredScope: "penetration.execute",
    billable: false,
    schema: penetrationReanalyzeSchema,
  },
  "penetration.automation.get": {
    mcpTool: "shitu_get_penetration_automation",
    title: "读取自动检测计划",
    description: "读取客户的自动渗透率检测计划、最近执行结果和下降提醒状态。",
    module: "penetration",
    idempotent: true,
    requiredScope: "penetration.view",
    billable: false,
    readOnly: true,
    schema: penetrationAutomationGetSchema,
  },
  "penetration.automation.save": {
    mcpTool: "shitu_save_penetration_automation",
    title: "保存自动检测计划",
    description: "创建或更新每天至每 7 天执行一次的渗透率检测计划和下降提醒阈值。",
    module: "penetration",
    idempotent: true,
    requiredScope: "penetration.execute",
    billable: false,
    schema: penetrationAutomationSaveSchema,
  },
  "penetration.automation.set-status": {
    mcpTool: "shitu_set_penetration_automation_status",
    title: "暂停或恢复自动检测计划",
    description: "将自动渗透率检测计划设置为启用或暂停。",
    module: "penetration",
    idempotent: true,
    requiredScope: "penetration.execute",
    billable: false,
    schema: penetrationAutomationStatusSchema,
  },
  "penetration.automation.run": {
    mcpTool: "shitu_run_penetration_automation",
    title: "立即运行自动检测计划",
    description: "立即触发一次计划检测；已有运行中任务时返回现有执行记录。",
    module: "penetration",
    idempotent: true,
    requiredScope: "penetration.execute",
    billable: false,
    schema: penetrationAutomationRunSchema,
  },
  "penetration.automation.delete": {
    mcpTool: "shitu_delete_penetration_automation",
    title: "删除自动检测计划",
    description: "删除指定客户的自动渗透率检测计划。历史检测报告不会被删除。",
    module: "penetration",
    idempotent: true,
    requiredScope: "penetration.execute",
    billable: false,
    destructive: true,
    schema: penetrationAutomationDeleteSchema,
  },
  "difficulty.run": {
    mcpTool: "shitu_run_difficulty",
    title: "运行 GEO 难度测评",
    description: "提交难度、周期、内容数量和执行成本测算任务。",
    module: "difficulty",
    taskSource: "difficulty",
    idempotent: true,
    requiredScope: "difficulty.execute",
    billable: true,
    schema: difficultySchema,
  },
  "research.run": {
    mcpTool: "shitu_run_research",
    title: "运行独立调研",
    description: "使用客户资料和已有检测证据生成独立调研结果。",
    module: "research",
    taskSource: "background",
    idempotent: true,
    requiredScope: "research.execute",
    billable: true,
    schema: researchSchema,
  },
  "research.compare": {
    mcpTool: "shitu_compare_competitors",
    title: "运行竞品对比",
    description: "对目标主体与最多 5 个竞争对手生成可追溯的对比结果。",
    module: "research",
    taskSource: "background",
    idempotent: true,
    requiredScope: "research.execute",
    billable: true,
    schema: competitorCompareSchema,
  },
  "diagnosis.run": {
    mcpTool: "shitu_run_ai_diagnosis",
    title: "运行 AI 网站诊断",
    description: "真实抓取网站并评估 E-E-A-T、标题结构、Q&A、llms.txt 和 robots 等 GEO 要素。",
    module: "diagnosis",
    taskSource: "background",
    idempotent: true,
    requiredScope: "diagnosis.execute",
    billable: true,
    schema: diagnosisSchema,
  },
  "keyword.extract": {
    mcpTool: "shitu_extract_keyword_profile",
    title: "提取客户关键词资料",
    description: "将已解析的文件文本和项目信息提取为结构化客户资料。",
    module: "keyword",
    taskSource: "background",
    idempotent: true,
    requiredScope: "keyword.execute",
    billable: true,
    schema: keywordExtractSchema,
  },
  "keyword.advantages": {
    mcpTool: "shitu_generate_advantages",
    title: "生成核心优势资产",
    description: "基于已抽取的客户资料生成可用于 GEO 内容的优势。",
    module: "keyword",
    taskSource: "background",
    idempotent: true,
    requiredScope: "keyword.execute",
    billable: true,
    schema: keywordAdvantagesSchema,
  },
  "keyword.strategy.run": {
    mcpTool: "shitu_generate_keyword_strategy",
    title: "生成联网关键词策略",
    description: "默认按系统的豆包联网方法论生成完整关键词策略。",
    module: "keyword",
    taskSource: "background",
    idempotent: true,
    requiredScope: "keyword.execute",
    billable: true,
    schema: keywordStrategySchema,
  },
  "keyword.website-prompt.run": {
    mcpTool: "shitu_generate_website_prompt",
    title: "生成第三方网站 Prompt",
    description: "基于客户资料与关键词策略生成第三方网站执行 Prompt。",
    module: "keyword",
    taskSource: "background",
    idempotent: true,
    requiredScope: "keyword.execute",
    billable: true,
    schema: keywordWebsitePromptSchema,
  },
  "keyword.questions.run": {
    mcpTool: "shitu_generate_questions",
    title: "批量生成疑问句池",
    description: "按七类问题、关键词、劣势和痛点场景在后台分批生成疑问句并独立匹配优势。",
    module: "keyword",
    taskSource: "question",
    idempotent: true,
    requiredScope: "keyword.execute",
    billable: true,
    schema: keywordQuestionsSchema,
  },
  "article.generate": {
    mcpTool: "shitu_generate_article",
    title: "生成单篇文章",
    description: "按选定 Prompt、疑问句、优势、客户知识库与质量门禁生成一篇文章或一条品牌短视频文案。",
    module: "article",
    taskSource: "background",
    idempotent: true,
    requiredScope: "article.execute",
    billable: true,
    schema: articleGenerationSchema,
  },
  "article.rewrite": {
    mcpTool: "shitu_rewrite_article",
    title: "改写单篇文章",
    description: "保留原文结构，按顺序映射主要品牌并使用客户资料进行原创化改写。",
    module: "article",
    taskSource: "background",
    idempotent: true,
    requiredScope: "article.execute",
    billable: true,
    schema: articleRewriteSchema,
  },
  "article.strategy.plan": {
    mcpTool: "shitu_plan_strategy_articles",
    title: "规划关键词策略自动成文",
    description: "读取已选疑问句和优势：文章轨道由 AI 裁判分配 Prompt，视频文案轨道为每个问题生成独立单问题任务。",
    module: "article",
    idempotent: true,
    requiredScope: "article.execute",
    billable: false,
    schema: articleStrategyPlanSchema,
  },
  "article.source.extract": {
    mcpTool: "shitu_extract_article_source",
    title: "读取文章链接正文",
    description: "按网页端相同的安全抓取和正文提取规则，将文章链接转换为 Markdown 原文。",
    module: "article",
    idempotent: true,
    requiredScope: "article.execute",
    billable: false,
    schema: articleSourceExtractSchema,
  },
  "article.brands.analyze": {
    mcpTool: "shitu_analyze_article_brands",
    title: "分析原文主要品牌",
    description: "识别文章主要、重点介绍和普通列举的品牌，为按顺序改写建立映射。",
    module: "article",
    idempotent: true,
    requiredScope: "article.execute",
    billable: false,
    schema: articleBrandsAnalyzeSchema,
  },
  "article.materials.list": {
    mcpTool: "shitu_list_article_materials",
    title: "读取疑问句与优势素材",
    description: "读取文章模块已导入的疑问句、匹配优势和分类信息。",
    module: "article",
    idempotent: true,
    requiredScope: "article.view",
    billable: false,
    readOnly: true,
    schema: articleMaterialsListSchema,
  },
  "article.materials.import": {
    mcpTool: "shitu_import_article_materials",
    title: "导入疑问句与优势素材",
    description: "导入最多 1000 条疑问句与优势，保留一问多优势的独立素材行。",
    module: "article",
    idempotent: true,
    requiredScope: "article.execute",
    operationScope: "article.edit",
    billable: false,
    schema: articleMaterialsImportSchema,
  },
  "article.materials.delete": {
    mcpTool: "shitu_delete_article_materials",
    title: "删除疑问句与优势素材",
    description: "按素材 ID 或导入批次删除文章素材，不影响已生成文章。",
    module: "article",
    idempotent: true,
    requiredScope: "article.execute",
    operationScope: "article.edit",
    billable: false,
    destructive: true,
    schema: articleMaterialsDeleteSchema,
  },
  "article.media.upload": {
    mcpTool: "shitu_upload_article_media",
    title: "上传文章配图",
    description: "向指定文章批次上传 JPG、PNG 或 WebP 图片并生成可复用素材。",
    module: "article",
    idempotent: true,
    requiredScope: "article.execute",
    operationScope: "article.edit",
    billable: false,
    schema: articleMediaUploadSchema,
  },
  "article.media.run": {
    mcpTool: "shitu_run_article_media",
    title: "批量插入文章图片",
    description: "按开篇、标准或丰富模板，为选定文章在后台批量插入已上传图片。",
    module: "article",
    taskSource: "articleMedia",
    idempotent: true,
    requiredScope: "article.execute",
    operationScope: "article.edit",
    billable: false,
    schema: articleMediaRunSchema,
  },
  "knowledge.import": {
    mcpTool: "shitu_import_knowledge",
    title: "上传并提炼客户资料",
    description: "上传 Word、PDF、Excel、图片或文本文件，在后台解析并生成待审核的知识候选项。",
    module: "client",
    taskSource: "background",
    idempotent: true,
    requiredScope: "knowledge.import",
    operationScope: "client.edit",
    billable: true,
    schema: knowledgeImportSchema,
  },
  "knowledge.commit": {
    mcpTool: "shitu_commit_knowledge",
    title: "审核并写入客户资料库",
    description: "将人工确认的资料候选项写入客户专属知识库。",
    module: "client",
    idempotent: true,
    requiredScope: "knowledge.import",
    operationScope: "client.edit",
    billable: false,
    schema: knowledgeCommitSchema,
  },
  "background.run": {
    title: "运行后台业务任务",
    description: "兼容旧版后台任务；新 Agent 应优先使用独立调研、AI 诊断、关键词策略等专用动作。",
    module: "article",
    taskSource: "background",
    idempotent: true,
    requiredScope: "dynamic",
    billable: true,
    deprecated: true,
    schema: backgroundSchema,
  },
  "article.batch.run": {
    mcpTool: "shitu_generate_article_batch",
    title: "批量生成文章",
    description: "按网页端相同的内容方法论、知识库和质量门禁创建独立文章或品牌短视频文案任务。",
    module: "article",
    taskSource: "articleBatch",
    idempotent: true,
    requiredScope: "article.execute",
    billable: true,
    schema: articleBatchSchema,
  },
  "feedback.action.create": {
    mcpTool: "shitu_create_feedback_action",
    title: "记录单个执行动作",
    description: "向指定客户的执行日历中记录一个动作和证据。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.edit",
    billable: false,
    schema: feedbackActionSchema,
  },
  "feedback.actions.import": {
    mcpTool: "shitu_import_feedback_actions",
    title: "批量导入执行证据",
    description: "批量导入标题、证据网址和平台，并生成执行动作记录。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.edit",
    billable: false,
    schema: feedbackImportSchema,
  },
  "feedback.report.create": {
    mcpTool: "shitu_create_feedback_report",
    title: "生成周报或月报",
    description: "基于执行日历、动作证据和历史结果生成客户反馈报告。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.edit",
    billable: false,
    schema: feedbackReportSchema,
  },
  "feedback.report.options": {
    mcpTool: "shitu_get_feedback_report_options",
    title: "读取反馈报告可选基线",
    description: "读取周报或月报覆盖时段、动作明细及可作为起始和当前对比的历史检测记录。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.edit",
    billable: false,
    readOnly: true,
    schema: feedbackReportOptionsSchema,
  },
  "feedback.report.manage": {
    mcpTool: "shitu_manage_feedback_report",
    title: "发布、停止分享或删除反馈报告",
    description: "管理周报和月报的客户链接；已发布报告需先停止分享且不能删除交付记录。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.manage",
    billable: false,
    destructive: true,
    schema: feedbackReportManageSchema,
  },
  "feedback.profile.update": {
    mcpTool: "shitu_update_feedback_profile",
    title: "更新客户执行计划",
    description: "更新正式执行日期、当前阶段、进度、负责人和下一步计划。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.edit",
    billable: false,
    schema: feedbackProfileUpdateSchema,
  },
  "feedback.visibility.update": {
    mcpTool: "shitu_update_feedback_visibility",
    title: "更新客户动作可见范围",
    description: "设置自动检测动作的默认展示级别，或批量设置具体动作对客户隐藏、摘要或完整展示。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.manage",
    billable: false,
    schema: feedbackVisibilityUpdateSchema,
  },
  "feedback.automation.get": {
    mcpTool: "shitu_get_feedback_automation",
    title: "读取反馈报告自动报送计划",
    description: "读取指定客户的周报、月报自动报送设置和最近运行记录。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.manage",
    billable: false,
    readOnly: true,
    schema: feedbackAutomationGetSchema,
  },
  "feedback.automation.save": {
    mcpTool: "shitu_save_feedback_automation",
    title: "保存周报与月报自动报送计划",
    description: "设置客户执行周期、周报或月报频率、发送时间和收件邮箱。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.manage",
    billable: false,
    schema: feedbackAutomationSaveSchema,
  },
  "feedback.automation.set-status": {
    mcpTool: "shitu_set_feedback_automation_status",
    title: "暂停或恢复反馈报告自动报送",
    description: "暂停或恢复指定客户的周报、月报自动报送计划。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.manage",
    billable: false,
    schema: feedbackAutomationStatusSchema,
  },
  "feedback.automation.run": {
    mcpTool: "shitu_run_feedback_automation",
    title: "立即生成并报送当前反馈报告",
    description: "立即按当前周期生成私密周报或月报链接，并发送到计划中的邮箱。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.manage",
    billable: false,
    schema: feedbackAutomationScheduleSchema,
  },
  "feedback.automation.retry": {
    mcpTool: "shitu_retry_feedback_automation",
    title: "重试失败的反馈报告报送",
    description: "重试失败或部分发送的报告任务，已成功送达的收件人不会重复发送。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.manage",
    billable: false,
    schema: feedbackAutomationRetrySchema,
  },
  "feedback.automation.delete": {
    mcpTool: "shitu_delete_feedback_automation",
    title: "删除反馈报告自动报送计划",
    description: "删除指定客户的自动报送计划，已生成的历史报告仍会保留。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.manage",
    billable: false,
    destructive: true,
    schema: feedbackAutomationScheduleSchema,
  },
  "feedback.reminder-settings.get": {
    mcpTool: "shitu_get_feedback_reminder_settings",
    title: "读取动作录入提醒设置",
    description: "读取当前账号每天 22:00 的邮件和站内动作录入提醒开关。clientId 仅用于校验执行反馈查看权限。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.view",
    billable: false,
    readOnly: true,
    schema: feedbackReminderSettingsGetSchema,
  },
  "feedback.reminder-settings.update": {
    mcpTool: "shitu_update_feedback_reminder_settings",
    title: "更新动作录入提醒设置",
    description: "更新当前账号每天 22:00 的邮件或站内动作录入提醒开关。clientId 仅用于校验执行反馈编辑权限。",
    module: "feedback",
    idempotent: true,
    requiredScope: "feedback.edit",
    billable: false,
    schema: feedbackReminderSettingsUpdateSchema,
  },
  "report.create": {
    mcpTool: "shitu_create_professional_report",
    title: "生成专业报告",
    description: "生成单模块或全链路 PDF 报告，支持默认品牌和已解锁的白标报告。",
    module: "report",
    taskSource: "report",
    idempotent: true,
    requiredScope: "report.execute",
    billable: true,
    schema: reportSchema,
  },
} as const satisfies Record<AgentActionName, AgentActionRegistryEntry>

function jsonSchema(schema: z.ZodType): JsonSchema {
  const converted = z.toJSONSchema(schema, { target: "draft-2020-12" }) as JsonSchema
  delete converted.$schema
  return converted
}

export const AGENT_ACTIONS: readonly AgentActionDefinition[] = Object.entries(AGENT_ACTION_REGISTRY)
  .map(([name, entry]) => ({
    name: name as AgentActionName,
    ...("mcpTool" in entry && entry.mcpTool ? { mcpTool: entry.mcpTool } : {}),
    title: entry.title,
    description: entry.description,
    module: entry.module,
    ...("taskSource" in entry ? { taskSource: entry.taskSource } : {}),
    idempotent: entry.idempotent,
    requiredScope: entry.requiredScope,
    billable: entry.billable,
    ...("deprecated" in entry && entry.deprecated ? { deprecated: true } : {}),
    ...("readOnly" in entry && entry.readOnly ? { readOnly: true } : {}),
    ...("destructive" in entry && entry.destructive ? { destructive: true } : {}),
    inputSchema: jsonSchema(entry.schema),
  }))

export function agentActionInputSchema(action: AgentActionName): z.ZodType {
  return AGENT_ACTION_REGISTRY[action].schema
}

export function parseAgentActionInput(
  action: AgentActionName,
  value: unknown,
): Record<string, unknown> {
  const result = agentActionInputSchema(action).safeParse(value)
  if (result.success) return result.data as Record<string, unknown>
  const issue = result.error.issues[0]
  const field = issue?.path.length ? issue.path.join(".") : "request"
  throw new Error(`Agent 动作参数无效：${field} ${issue?.message || "格式不正确"}`)
}

export function assertAgentActionInput(action: AgentActionName, value: unknown): void {
  parseAgentActionInput(action, value)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item || "").trim()).filter(Boolean) : []
}

const MODEL_KEYS = new Set(["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"])

function requestId(value: unknown): string {
  const id = String(value || "").trim()
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(id)) {
    throw new Error("requestId 必须是 16 到 160 位字母、数字、下划线或连字符")
  }
  return id
}

function clientContext(input: Record<string, unknown>): {
  clientId: string
  teamId?: string
  requestId: string
} {
  const clientId = String(input.clientId || "").trim().slice(0, 200)
  if (!clientId) throw new Error("clientId 不能为空")
  const teamId = String(input.teamId || "").trim().slice(0, 200) || undefined
  return { clientId, teamId, requestId: requestId(input.requestId) }
}

function articlePriceKey(value: unknown): FeaturePriceKey {
  const key = String(value || "") as keyof typeof ARTICLE_PROMPT_PRICE_KEYS
  const priceKey = ARTICLE_PROMPT_PRICE_KEYS[key]
  if (!priceKey) throw new Error("文章 Prompt 无效")
  return priceKey
}

function withoutAgentContext(input: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...input }
  delete payload.clientId
  delete payload.teamId
  delete payload.requestId
  delete payload.dryRun
  return payload
}

function dedicatedBackgroundEstimate(
  context: ReturnType<typeof clientContext>,
  input: Record<string, unknown>,
  kind: BackgroundJobKind,
  scope: AgentScope,
): AgentActionEstimate {
  const estimate = estimateBackgroundJob(kind, withoutAgentContext(input))
  return {
    ...context,
    scope,
    units: estimate.units,
    credits: estimate.credits,
    label: estimate.label,
  }
}

function estimateArticleBatch(input: Record<string, unknown>): {
  credits: number
  units: number
  label: string
} {
  const base = record(input.basePayload)
  const count = Math.floor(Number(input.count))
  const minimum = input.topicMode === "strategy" ? 1 : 2
  if (!Number.isFinite(count) || count < minimum || count > 50) {
    throw new Error(input.topicMode === "strategy"
      ? "策略自动成文数量必须在 1 到 50 篇之间"
      : "批量生成数量必须在 2 到 50 篇之间")
  }
  const questionTasks = Array.isArray(input.questionTasks) ? input.questionTasks.map(record) : []
  const videoScriptBatch = isBrandVideoScriptPrompt(base.promptKey)
  if (!String(base.coreQuestion || "").trim() && !questionTasks.some(task => String(task.question || "").trim())) {
    throw new Error("批量生成必须提供核心问题或至少一个疑问句任务")
  }
  if (input.topicMode === "strategy" && Array.isArray(input.questionTasks)) {
    const tasks = input.questionTasks.slice(0, 50).map(record)
    if (tasks.length !== count) throw new Error("策略文章任务数量与 count 不一致")
    const credits = tasks.reduce((sum, task) => (
      sum + estimateFeatureCredits(articlePriceKey(task.promptKey || base.promptKey))
    ), 0)
    return {
      credits,
      units: count,
      label: videoScriptBatch ? `批量品牌短视频文案 × ${count}` : `批量文章 × ${count}`,
    }
  }
  const featureKey = articlePriceKey(base.promptKey)
  return {
    credits: estimateFeatureCredits(featureKey, count),
    units: count,
    label: videoScriptBatch ? `批量品牌短视频文案 × ${count}` : `批量文章 × ${count}`,
  }
}

export function isAgentActionName(value: unknown): value is AgentActionName {
  return Object.prototype.hasOwnProperty.call(AGENT_ACTION_REGISTRY, String(value || ""))
}

export function estimateAgentAction(
  action: AgentActionName,
  value: unknown,
): AgentActionEstimate {
  const input = record(value)
  const context = clientContext(input)

  switch (action) {
    case "penetration.run": {
      const questions = strings(input.questions)
      const models = Array.from(new Set(strings(input.models)))
      if (questions.length === 0 || models.length === 0) {
        throw new Error("渗透率检测至少需要一个问题和一个模型")
      }
      if (questions.length > 600) throw new Error("渗透率检测单次最多支持 600 个问题")
      if (models.length > 6) throw new Error("渗透率检测单次最多支持 6 个模型")
      if (models.some(model => !MODEL_KEYS.has(model))) throw new Error("渗透率检测包含不支持的模型")
      const units = questions.length * models.length
      return {
        ...context,
        scope: "penetration.execute",
        units,
        credits: estimateFeatureCredits("penetrationSlot", units),
        label: `渗透率检测 ${questions.length} 问题 × ${models.length} 模型`,
      }
    }
    case "penetration.questions.generate":
      return dedicatedBackgroundEstimate(
        context,
        input,
        "queryGeneration",
        "penetration.execute",
      )
    case "penetration.brands.reanalyze":
      return {
        ...context,
        scope: "penetration.execute",
        units: 1,
        credits: 0,
        label: "重新整理检测品牌榜",
      }
    case "penetration.automation.get":
      return { ...context, scope: "penetration.view", units: 1, credits: 0, label: "读取自动检测计划" }
    case "penetration.automation.save":
      return { ...context, scope: "penetration.execute", units: 1, credits: 0, label: "保存自动检测计划" }
    case "penetration.automation.set-status":
      return { ...context, scope: "penetration.execute", units: 1, credits: 0, label: "更新自动检测状态" }
    case "penetration.automation.run":
      return { ...context, scope: "penetration.execute", units: 1, credits: 0, label: "立即运行自动检测" }
    case "penetration.automation.delete":
      return { ...context, scope: "penetration.execute", units: 1, credits: 0, label: "删除自动检测计划" }
    case "difficulty.run": {
      const mode = String(input.mode || "industry")
      const industry = String(input.industry || "").trim()
      if (mode !== "industry" && mode !== "brand") throw new Error("难度测评模式无效")
      if (!industry) throw new Error("难度测评行业不能为空")
      if (mode === "brand" && !String(input.targetBrand || input.brandName || "").trim()) {
        throw new Error("品牌难度测评必须提供目标品牌或人物名称")
      }
      return {
        ...context,
        scope: "difficulty.execute",
        units: 1,
        credits: estimateFeatureCredits("difficultyAssessment"),
        label: "GEO 难度测评",
      }
    }
    case "research.run":
      return dedicatedBackgroundEstimate(context, input, "research", "research.execute")
    case "research.compare":
      return dedicatedBackgroundEstimate(context, input, "competitorCompare", "research.execute")
    case "diagnosis.run":
      return dedicatedBackgroundEstimate(context, input, "diagnosis", "diagnosis.execute")
    case "keyword.extract":
      return dedicatedBackgroundEstimate(context, input, "keywordExtract", "keyword.execute")
    case "keyword.advantages":
      return dedicatedBackgroundEstimate(context, input, "keywordAdvantages", "keyword.execute")
    case "keyword.strategy.run":
      return dedicatedBackgroundEstimate(context, input, "keywordStrategy", "keyword.execute")
    case "keyword.website-prompt.run":
      return dedicatedBackgroundEstimate(context, input, "keywordWebsitePrompt", "keyword.execute")
    case "article.generate":
      if (
        isBrandVideoScriptPrompt(input.promptKey)
        && !String(input.advantages || "").trim()
      ) {
        throw new Error("品牌短视频·单问题文案必须提供当前疑问句的匹配优势")
      }
      return dedicatedBackgroundEstimate(context, input, "articleGeneration", "article.execute")
    case "article.rewrite":
      return dedicatedBackgroundEstimate(context, input, "articleGeneration", "article.execute")
    case "article.strategy.plan":
      return {
        ...context,
        scope: "article.execute",
        units: 1,
        credits: 0,
        label: input.outputTrack === "video_script" ? "规划策略视频文案" : "规划策略文章",
      }
    case "article.source.extract":
      return { ...context, scope: "article.execute", units: 1, credits: 0, label: "读取文章原文" }
    case "article.brands.analyze":
      return { ...context, scope: "article.execute", units: 1, credits: 0, label: "分析原文品牌" }
    case "article.materials.list":
      return { ...context, scope: "article.view", units: 1, credits: 0, label: "读取文章素材" }
    case "article.materials.import": {
      const units = Array.isArray(input.rows) ? input.rows.length : 0
      return { ...context, scope: "article.execute", units, credits: 0, label: `导入文章素材 × ${units}` }
    }
    case "article.materials.delete": {
      const units = Array.isArray(input.ids) ? Math.max(1, input.ids.length) : 1
      return { ...context, scope: "article.execute", units, credits: 0, label: "删除文章素材" }
    }
    case "article.media.upload": {
      const units = Array.isArray(input.files) ? input.files.length : 0
      return { ...context, scope: "article.execute", units, credits: 0, label: `上传文章配图 × ${units}` }
    }
    case "article.media.run": {
      const units = Array.isArray(input.itemIds) ? input.itemIds.length : 0
      return { ...context, scope: "article.execute", units, credits: 0, label: `批量插图 × ${units}` }
    }
    case "knowledge.import":
      return dedicatedBackgroundEstimate(context, input, "knowledgeImport", "knowledge.import")
    case "knowledge.commit":
      return { ...context, scope: "knowledge.import", units: 1, credits: 0, label: "审核资料入库" }
    case "keyword.questions.run": {
      const units = estimateQuestionJobCredits(input)
      return {
        ...context,
        scope: "keyword.execute",
        units,
        credits: estimateFeatureCredits("keywordQuestionUnit", units),
        label: `疑问句池生成 × ${units}`,
      }
    }
    case "feedback.action.create":
      return { ...context, scope: "feedback.edit", units: 1, credits: 0, label: "记录执行动作" }
    case "feedback.actions.import": {
      const units = Array.isArray(input.rows) ? input.rows.length : 0
      return { ...context, scope: "feedback.edit", units, credits: 0, label: `批量导入执行证据 × ${units}` }
    }
    case "feedback.report.create":
      return {
        ...context,
        scope: input.publish === true ? "feedback.manage" : "feedback.edit",
        units: 1,
        credits: 0,
        label: input.publish === true ? "生成并发布执行反馈报告" : "生成执行反馈报告",
      }
    case "feedback.report.options":
      return { ...context, scope: "feedback.edit", units: 1, credits: 0, label: "读取反馈报告选项" }
    case "feedback.report.manage":
      return { ...context, scope: "feedback.manage", units: 1, credits: 0, label: "管理反馈报告" }
    case "feedback.profile.update":
      return { ...context, scope: "feedback.edit", units: 1, credits: 0, label: "更新客户执行计划" }
    case "feedback.visibility.update":
      return { ...context, scope: "feedback.manage", units: 1, credits: 0, label: "更新客户动作可见范围" }
    case "feedback.automation.get":
      return { ...context, scope: "feedback.manage", units: 1, credits: 0, label: "读取反馈报告自动报送计划" }
    case "feedback.automation.save":
      return { ...context, scope: "feedback.manage", units: 1, credits: 0, label: "保存反馈报告自动报送计划" }
    case "feedback.automation.set-status":
      return { ...context, scope: "feedback.manage", units: 1, credits: 0, label: "更新反馈报告自动报送状态" }
    case "feedback.automation.run":
      return { ...context, scope: "feedback.manage", units: 1, credits: 0, label: "立即报送当前反馈报告" }
    case "feedback.automation.retry":
      return { ...context, scope: "feedback.manage", units: 1, credits: 0, label: "重试失败的反馈报告报送" }
    case "feedback.automation.delete":
      return { ...context, scope: "feedback.manage", units: 1, credits: 0, label: "删除反馈报告自动报送计划" }
    case "feedback.reminder-settings.get":
      return { ...context, scope: "feedback.view", units: 1, credits: 0, label: "读取动作录入提醒设置" }
    case "feedback.reminder-settings.update":
      return { ...context, scope: "feedback.edit", units: 1, credits: 0, label: "更新动作录入提醒设置" }
    case "background.run": {
      const kind = input.kind
      if (!isBackgroundJobKind(kind)) throw new Error("后台任务 kind 无效")
      const estimate = estimateBackgroundJob(kind, input.payload)
      return {
        ...context,
        scope: `${moduleForBackgroundJob(kind as BackgroundJobKind)}.execute`,
        units: estimate.units,
        credits: estimate.credits,
        label: estimate.label,
      }
    }
    case "article.batch.run": {
      const estimate = estimateArticleBatch(input)
      return {
        ...context,
        scope: "article.execute",
        ...estimate,
      }
    }
    case "report.create": {
      const reportInput = record(input.input)
      const reportClient = record(reportInput.client)
      if (String(reportClient.id || "").trim() !== context.clientId) {
        throw new Error("报告 input.client.id 必须与已授权的 clientId 一致")
      }
      const branding = record(reportInput.branding)
      const credits = branding.mode === "custom"
        ? estimateFeatureCredits("reportCustomBranding")
        : 0
      return {
        ...context,
        scope: "report.execute",
        units: 1,
        credits,
        label: branding.mode === "custom" ? "白标专业报告" : "专业报告",
      }
    }
  }
}
