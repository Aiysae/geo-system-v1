import type {
  ArticleGenerationState,
  BackgroundJobKind,
  BackgroundJobRecord,
  BackgroundJobRef,
  Client,
  CompetitorCompareResult,
  Diagnosis,
  ResearchResult,
} from "@/types"
import type {
  ExtractedItem,
  ExtractedProfile,
  GeoStrategyPlan,
  ToolStep,
} from "@/types/geo-strategy"
import { mergeExtractedProfileIntoKnowledgeBase } from "@/lib/client-knowledge-base"
import { normalizeExtractedProfileForJob } from "@/lib/geo-strategy/extracted-profile-normalizer"
import {
  arePenetrationQuestionsSemanticallySimilar,
  inferPenetrationQuestionCategory,
  normalizePenetrationQuestionIntentHints,
  questionIdentityKey,
} from "@/lib/penetration/sample-design"

export type BackgroundWorkspacePhase = "succeeded" | "failed" | "cancelled"

const WORKSPACE_RESULT_KINDS = new Set<BackgroundJobKind>([
  "articleGeneration",
  "queryGeneration",
  "research",
  "diagnosis",
  "competitorCompare",
  "keywordExtract",
  "keywordAdvantages",
  "keywordStrategy",
  "keywordWebsitePrompt",
])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function backgroundJobMatches(ref: BackgroundJobRef | undefined, job: BackgroundJobRecord): boolean {
  if (!ref) return false
  return ref.jobId === job.id || ref.requestId === job.requestId
}

type TerminalJobState = Pick<Client, "backgroundJobs" | "backgroundResultJobs">

function terminalJobState(
  client: Client,
  job: BackgroundJobRecord,
): TerminalJobState | null {
  const current = client.backgroundJobs?.[job.kind]
  if (current && !backgroundJobMatches(current, job)) return null

  const previous = client.backgroundResultJobs?.[job.kind]
  if (previous && previous.jobId !== job.id) {
    const previousCreatedAt = Date.parse(previous.createdAt)
    const currentCreatedAt = Date.parse(job.createdAt)
    if (Number.isFinite(previousCreatedAt) && Number.isFinite(currentCreatedAt)) {
      if (previousCreatedAt > currentCreatedAt) return null
    } else {
      return null
    }
  }

  const backgroundJobs = { ...(client.backgroundJobs || {}) }
  if (current) delete backgroundJobs[job.kind]
  return {
    backgroundJobs,
    backgroundResultJobs: {
      ...(client.backgroundResultJobs || {}),
      [job.kind]: {
        jobId: job.id,
        requestId: job.requestId,
        status: job.status,
        createdAt: job.createdAt,
        completedAt: job.finishedAt || job.updatedAt,
      },
    },
  }
}

function completedSteps(current: ToolStep[], step: ToolStep): ToolStep[] {
  return Array.from(new Set<ToolStep>([...current, step]))
}

function failedMessage(job: BackgroundJobRecord): string {
  return job.error || (job.status === "cancelled" ? "\u4efb\u52a1\u5df2\u505c\u6b62" : "\u540e\u53f0\u4efb\u52a1\u5931\u8d25")
}

export function supportsBackgroundWorkspacePersistence(kind: BackgroundJobKind): boolean {
  return WORKSPACE_RESULT_KINDS.has(kind)
}

function failedModulePatch(
  client: Client,
  job: BackgroundJobRecord,
  jobState: TerminalJobState,
): Partial<Client> {
  const message = failedMessage(job)
  if (job.kind === "articleGeneration" && client.articleGeneration) {
    return {
      ...jobState,
      articleGeneration: { ...client.articleGeneration, status: "error", error: message },
    }
  }
  if (client.keywordStrategy) {
    if (job.kind === "keywordExtract") {
      return {
        ...jobState,
        keywordStrategy: { ...client.keywordStrategy, extracting: false, extractionError: message },
      }
    }
    if (job.kind === "keywordAdvantages") {
      return {
        ...jobState,
        keywordStrategy: { ...client.keywordStrategy, advantageStatus: "error", advantageError: message },
      }
    }
    if (job.kind === "keywordStrategy") {
      return {
        ...jobState,
        keywordStrategy: { ...client.keywordStrategy, strategyStatus: "error", strategyError: message },
      }
    }
  }
  return jobState
}

export function applyBackgroundJobToClient(
  client: Client,
  job: BackgroundJobRecord,
  phase: BackgroundWorkspacePhase,
  payload?: unknown,
): Partial<Client> | null {
  if (!supportsBackgroundWorkspacePersistence(job.kind)) return null
  const jobState = terminalJobState(client, job)
  if (!jobState) return null
  if (phase !== "succeeded") return failedModulePatch(client, job, jobState)

  const result = record(job.result)
  if (job.kind === "research" && typeof result.generatedAt === "string") {
    return { ...jobState, research: job.result as ResearchResult }
  }
  if (job.kind === "competitorCompare" && typeof result.generatedAt === "string") {
    return { ...jobState, competitorCompare: job.result as CompetitorCompareResult }
  }
  if (job.kind === "diagnosis" && typeof result.generatedAt === "string") {
    return { ...jobState, diagnosis: job.result as Diagnosis }
  }
  if (job.kind === "articleGeneration" && client.articleGeneration) {
    const article = typeof result.article === "string" ? result.article.trim() : ""
    if (!article) return failedModulePatch(client, { ...job, error: "\u6587\u7ae0\u5185\u5bb9\u751f\u6210\u4e0d\u5b8c\u6574\uff0c\u8bf7\u91cd\u65b0\u751f\u6210\u3002" }, jobState)
    const current = client.articleGeneration
    const next: ArticleGenerationState = {
      ...current,
      promptKey: (result.promptKey || current.promptKey) as ArticleGenerationState["promptKey"],
      modelProvider: (result.modelProvider || current.modelProvider) as ArticleGenerationState["modelProvider"],
      model: typeof result.model === "string" ? result.model : current.model,
      output: article,
      rewriteAudit: (result.rewriteAudit || current.rewriteAudit) as ArticleGenerationState["rewriteAudit"],
      methodologyTrace: (result.methodologyTrace || current.methodologyTrace) as ArticleGenerationState["methodologyTrace"],
      lineage: (result.lineage || current.lineage) as ArticleGenerationState["lineage"],
      connectivity: result.connectivity as ArticleGenerationState["connectivity"],
      generatedAt: typeof result.generatedAt === "string" ? result.generatedAt : job.finishedAt || job.updatedAt,
      status: "done",
      error: undefined,
    }
    return { ...jobState, articleGeneration: next }
  }
  if (job.kind === "queryGeneration") {
    const generated = Array.isArray(result.questions)
      ? result.questions.map(value => String(value || "").trim()).filter(Boolean)
      : []
    if (generated.length === 0) {
      return jobState
    }
    const generatedItems = normalizePenetrationQuestionIntentHints(result.questionItems, generated)
    const generatedCategoryByQuestion = new Map(
      generatedItems.map(item => [questionIdentityKey(item.question), item.category]),
    )
    const existing = client.questions || []
    const existingHints = normalizePenetrationQuestionIntentHints(client.questionIntentHints, existing)
    const existingCategoryByQuestion = new Map(
      existingHints.map(item => [questionIdentityKey(item.question), item.category]),
    )
    const questions = [...existing]
    for (const value of generated) {
      const category = generatedCategoryByQuestion.get(questionIdentityKey(value))
        || inferPenetrationQuestionCategory(value)
      const duplicate = questions.some(previous => (
        (existingCategoryByQuestion.get(questionIdentityKey(previous))
          || inferPenetrationQuestionCategory(previous)) === category
        && arePenetrationQuestionsSemanticallySimilar(previous, value)
      ))
      if (!duplicate) questions.push(value)
    }
    return {
      ...jobState,
      questions,
      questionIntentHints: normalizePenetrationQuestionIntentHints(
        [...existingHints, ...generatedItems],
        questions,
      ),
    }
  }

  const keyword = client.keywordStrategy
  if (!keyword) return jobState
  if (job.kind === "keywordExtract" && typeof result.project_name === "string") {
    const profile = normalizeExtractedProfileForJob(job.result as ExtractedProfile, job.id)
    const nextKeyword = {
      ...keyword,
      extracting: false,
      extractionError: "",
      extractedProfile: profile,
      step: "extraction" as const,
      completedSteps: completedSteps(keyword.completedSteps, "extraction"),
    }
    return {
      ...jobState,
      keywordStrategy: nextKeyword,
      knowledgeBase: mergeExtractedProfileIntoKnowledgeBase({
        current: client.knowledgeBase,
        profile,
        subjectType: client.subjectType,
        subjectName: client.ourBrand || keyword.projectName || client.name,
        aliases: client.brandAliases,
        updatedAt: job.finishedAt || job.updatedAt,
      }),
    }
  }
  if (job.kind === "keywordAdvantages" && keyword.extractedProfile) {
    const generated = (Array.isArray(result.advantages) ? result.advantages : [])
      .map((value, index) => {
        const item = record(value)
        const text = String(item.text || "").trim()
        if (!text) return null
        return {
          id: `adv_${job.id}_${index + 1}`,
          text,
          enabled: item.enabled !== false,
          confidence: item.confidence === "high" || item.confidence === "low"
            ? item.confidence
            : "medium",
        } satisfies ExtractedItem
      })
      .filter((item): item is ExtractedItem => Boolean(item))
    const existing = keyword.extractedProfile.advantages || []
    const seen = new Set(existing.map(item => item.text.trim()))
    const advantages = [...existing, ...generated.filter(item => {
      if (seen.has(item.text)) return false
      seen.add(item.text)
      return true
    })]
    return {
      ...jobState,
      keywordStrategy: {
        ...keyword,
        extractedProfile: { ...keyword.extractedProfile, advantages },
        advantageStatus: "done",
        advantageError: "",
      },
    }
  }
  if (job.kind === "keywordStrategy" && typeof result.project_name === "string") {
    return {
      ...jobState,
      keywordStrategy: {
        ...keyword,
        strategyPlan: job.result as GeoStrategyPlan,
        strategyStatus: "done",
        strategyError: "",
        step: "strategy",
        completedSteps: completedSteps(keyword.completedSteps, "strategy"),
      },
    }
  }
  if (job.kind === "keywordWebsitePrompt" && keyword.strategyPlan) {
    const prompt = typeof result.prompt === "string" ? result.prompt.trim() : ""
    if (!prompt) return failedModulePatch(client, { ...job, error: "\u5efa\u7ad9\u6307\u4ee4\u751f\u6210\u4e0d\u5b8c\u6574\uff0c\u8bf7\u91cd\u65b0\u751f\u6210\u3002" }, jobState)
    const request = record(payload)
    const currentPrompts = keyword.strategyPlan.website_prompts || {}
    const isThirdParty = request.kind === "third-party" && Number.isInteger(request.siteIndex)
    const websitePrompts = isThirdParty
      ? {
          ...currentPrompts,
          third_party: {
            ...(currentPrompts.third_party || {}),
            [String(request.siteIndex)]: prompt,
          },
          updated_at: job.finishedAt || job.updatedAt,
        }
      : { ...currentPrompts, official: prompt, updated_at: job.finishedAt || job.updatedAt }
    return {
      ...jobState,
      keywordStrategy: {
        ...keyword,
        strategyPlan: { ...keyword.strategyPlan, website_prompts: websitePrompts },
      },
    }
  }

  return failedModulePatch(client, { ...job, error: "\u4efb\u52a1\u7ed3\u679c\u4e0d\u5b8c\u6574\uff0c\u8bf7\u91cd\u65b0\u751f\u6210\u3002" }, jobState)
}
