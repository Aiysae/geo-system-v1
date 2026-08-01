import type {
  KeywordStrategyState,
  QuestionJobProgress,
  QuestionJobRecord,
  ToolStep,
} from "@/types/geo-strategy"

export type QuestionWorkspacePhase = "active" | "succeeded" | "failed" | "cancelled"

function progressFromJob(job: QuestionJobRecord): QuestionJobProgress {
  return {
    completedCount: job.completedCount,
    totalCount: job.totalCount,
    currentBatch: job.currentBatch,
    totalBatches: job.totalBatches,
  }
}

function actionableWarnings(warnings: string[]): string {
  return warnings
    .filter(message => /\u5931\u8d25|\u4e0d\u8db3|\u5f02\u5e38|\u8df3\u8fc7|\u8d85\u65f6|\u672c\u5730.*\u8865\u9f50|\u4e0d\u5b8c\u6574/.test(message))
    .join("\uff1b")
}

function withoutActiveJob(state: KeywordStrategyState): KeywordStrategyState {
  const next = { ...state }
  delete next.questionJobId
  return next
}

function isCurrentJob(state: KeywordStrategyState, job: QuestionJobRecord): boolean {
  if (state.questionJobId && state.questionJobId !== job.id) return false
  if (!state.questionJobId && state.questionResultJobId && state.questionResultJobId !== job.id) {
    const previousCompletedAt = Date.parse(state.questionGeneratedAt || "")
    const currentCreatedAt = Date.parse(job.createdAt)
    if (Number.isFinite(previousCompletedAt) && Number.isFinite(currentCreatedAt)) {
      return currentCreatedAt >= previousCompletedAt
    }
    return false
  }
  return true
}

export function applyQuestionJobToKeywordStrategy(
  state: KeywordStrategyState,
  job: QuestionJobRecord,
  phase: QuestionWorkspacePhase,
): KeywordStrategyState | null {
  const progress = progressFromJob(job)

  if (phase === "active") {
    return {
      ...state,
      questionStatus: "generating",
      questionError: "",
      questionJobId: job.id,
      questionJobProgress: progress,
    }
  }

  if (!isCurrentJob(state, job)) return null

  if (phase === "succeeded") {
    const completedSteps = Array.from(new Set<ToolStep>([
      ...state.completedSteps,
      "questions",
    ]))
    return {
      ...withoutActiveJob(state),
      strategyPlan: job.researchAudit && state.strategyPlan
        ? { ...state.strategyPlan, keyword_research: job.researchAudit }
        : state.strategyPlan,
      questions: job.questions,
      questionError: actionableWarnings(job.warnings),
      questionStatus: "done",
      questionJobProgress: progress,
      questionResultJobId: job.id,
      questionGeneratedAt: job.finishedAt || job.updatedAt,
      completedSteps,
    }
  }

  if (phase === "cancelled") {
    const retainedQuestions = job.questions.length > 0 ? job.questions : state.questions
    return {
      ...withoutActiveJob(state),
      questions: retainedQuestions,
      questionError: retainedQuestions.length > 0
        ? `\u5df2\u505c\u6b62\u751f\u6210\uff0c\u5df2\u4fdd\u7559\u5f53\u524d ${retainedQuestions.length} \u6761\u7591\u95ee\u53e5\u3002`
        : "\u5df2\u505c\u6b62\u751f\u6210\u3002",
      questionStatus: "idle",
      questionJobProgress: undefined,
    }
  }

  return {
    ...withoutActiveJob(state),
    questions: job.questions.length > 0 ? job.questions : state.questions,
    questionError: job.error || "\u7591\u95ee\u53e5\u540e\u53f0\u4efb\u52a1\u5931\u8d25",
    questionStatus: "error",
    questionJobProgress: undefined,
  }
}
