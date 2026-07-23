import type { AnalysisSubjectType } from "@/types"

export type OnboardingStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "dismissed"

export interface OnboardingState {
  version: 1
  status: OnboardingStatus
  currentStep: number
  subjectType: AnalysisSubjectType
  startedAt?: string
  updatedAt?: string
  completedAt?: string
  dismissedAt?: string
}

export interface OnboardingSummary {
  state: OnboardingState
  autoLaunch: boolean
}

export type OnboardingAction =
  | "start"
  | "progress"
  | "complete"
  | "dismiss"
  | "reset"
