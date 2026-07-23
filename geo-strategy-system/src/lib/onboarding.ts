import "server-only"

import { kv } from "@/lib/kv"
import type {
  OnboardingAction,
  OnboardingState,
} from "@/types/onboarding"
import type { AnalysisSubjectType } from "@/types"

const ONBOARDING_VERSION = 1 as const
export const ONBOARDING_LAST_STEP = 7
const DEFAULT_ROLLOUT_AT = "2026-07-23T00:00:00+08:00"

const onboardingKey = (userId: string) => `geo:onboarding:v1:${userId}`

function defaultState(): OnboardingState {
  return {
    version: ONBOARDING_VERSION,
    status: "not_started",
    currentStep: 0,
    subjectType: "brand",
  }
}

function safeStep(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(ONBOARDING_LAST_STEP, Math.floor(numeric)))
}

function safeSubjectType(value: unknown): AnalysisSubjectType {
  return value === "person" ? "person" : "brand"
}

function normalizeState(value: unknown): OnboardingState {
  if (!value || typeof value !== "object") return defaultState()
  const record = value as Partial<OnboardingState>
  const allowedStatuses = new Set<OnboardingState["status"]>([
    "not_started",
    "in_progress",
    "completed",
    "dismissed",
  ])
  return {
    version: ONBOARDING_VERSION,
    status: record.status && allowedStatuses.has(record.status)
      ? record.status
      : "not_started",
    currentStep: safeStep(record.currentStep),
    subjectType: safeSubjectType(record.subjectType),
    startedAt: typeof record.startedAt === "string" ? record.startedAt : undefined,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    completedAt: typeof record.completedAt === "string" ? record.completedAt : undefined,
    dismissedAt: typeof record.dismissedAt === "string" ? record.dismissedAt : undefined,
  }
}

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  return normalizeState(await kv.get<unknown>(onboardingKey(userId)))
}

export async function updateOnboardingState(input: {
  userId: string
  action: OnboardingAction
  currentStep?: number
  subjectType?: AnalysisSubjectType
}): Promise<OnboardingState> {
  const current = await getOnboardingState(input.userId)
  const now = new Date().toISOString()
  const subjectType = safeSubjectType(input.subjectType ?? current.subjectType)
  let next: OnboardingState

  if (input.action === "complete") {
    next = {
      ...current,
      status: "completed",
      currentStep: ONBOARDING_LAST_STEP,
      subjectType,
      startedAt: current.startedAt || now,
      updatedAt: now,
      completedAt: now,
      dismissedAt: undefined,
    }
  } else if (input.action === "dismiss") {
    next = {
      ...current,
      status: "dismissed",
      subjectType,
      updatedAt: now,
      dismissedAt: now,
    }
  } else if (input.action === "reset") {
    next = {
      version: ONBOARDING_VERSION,
      status: "in_progress",
      currentStep: 0,
      subjectType,
      startedAt: now,
      updatedAt: now,
    }
  } else if (current.status === "completed" || current.status === "dismissed") {
    // Manual replay remains local so it cannot re-enable the first-login redirect.
    return current
  } else {
    next = {
      ...current,
      status: "in_progress",
      currentStep: input.action === "progress"
        ? safeStep(input.currentStep)
        : current.currentStep,
      subjectType,
      startedAt: current.startedAt || now,
      updatedAt: now,
    }
  }

  await kv.set(onboardingKey(input.userId), next)
  return next
}

export function shouldAutoLaunchOnboarding(input: {
  userCreatedAt: string
  state: OnboardingState
}): boolean {
  if (input.state.status !== "not_started" && input.state.status !== "in_progress") {
    return false
  }
  const createdAt = Date.parse(input.userCreatedAt)
  const rolloutAt = Date.parse(
    process.env.ONBOARDING_AUTOLAUNCH_AFTER || DEFAULT_ROLLOUT_AT,
  )
  if (!Number.isFinite(createdAt) || !Number.isFinite(rolloutAt)) return false
  return createdAt >= rolloutAt
}
