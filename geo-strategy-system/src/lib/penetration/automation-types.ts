import type {
  AnalysisSubjectType,
  ModelKey,
  PenetrationQuestionIntentHint,
  PersonSubjectProfile,
} from "@/types"

export const PENETRATION_AUTOMATION_TIMEZONE = "Asia/Shanghai" as const

export type PenetrationAutomationScheduleStatus = "active" | "paused"
export type PenetrationAutomationTrigger = "scheduled" | "manual"
export type PenetrationAutomationExecutionStatus =
  | "pending"
  | "submitted"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "skipped"
  | "cancelled"

export interface PenetrationAutomationSchedule {
  id: string
  ownerUserId: string
  clientId: string
  clientName: string
  createdByUserId: string
  actorUserId: string
  billingUserId: string
  teamId?: string
  status: PenetrationAutomationScheduleStatus
  intervalDays: number
  timeLocal: string
  timezone: typeof PENETRATION_AUTOMATION_TIMEZONE
  startDate: string
  relativeDropThresholdPct: number
  minimumAbsoluteDropPoints: number
  inAppEnabled: boolean
  emailEnabled: boolean
  monthlyCreditLimit?: number
  nextRunAt?: string
  lastScheduledFor?: string
  lastStartedAt?: string
  lastCompletedAt?: string
  lastExecutionId?: string
  lastJobId?: string
  lastHistoryRecordId?: string
  consecutiveFailures: number
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface PenetrationAutomationInputSnapshot {
  subjectType: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  ourBrand: string
  brandAliases: string[]
  industry: string
  website?: string
  competitors: string[]
  questions: string[]
  questionIntents: PenetrationQuestionIntentHint[]
  requestedModels: ModelKey[]
  activeModels: ModelKey[]
  questionCount: number
  modelCount: number
  slotCount: number
  estimatedCredits: number
  comparisonSignature: string
  relativeDropThresholdPct: number
  minimumAbsoluteDropPoints: number
}

export interface PenetrationAutomationExecution {
  id: string
  scheduleId: string
  ownerUserId: string
  clientId: string
  clientName: string
  actorUserId: string
  billingUserId: string
  teamId?: string
  trigger: PenetrationAutomationTrigger
  scheduledFor: string
  status: PenetrationAutomationExecutionStatus
  attemptCount: number
  nextAttemptAt?: string
  jobId?: string
  historyRecordId?: string
  inputSnapshot?: PenetrationAutomationInputSnapshot
  estimatedCredits: number
  usedCredits?: number
  baselineHistoryRecordId?: string
  baselineRate?: number
  currentRate?: number
  absoluteDropPoints?: number
  relativeDropPct?: number
  comparable?: boolean
  comparisonReason?: string
  alertTriggered: boolean
  alertSentAt?: string
  error?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  updatedAt: string
}

export interface PenetrationAutomationSnapshot {
  schedule: PenetrationAutomationSchedule | null
  executions: PenetrationAutomationExecution[]
}

export interface PenetrationAutomationScheduleInput {
  intervalDays: number
  timeLocal: string
  startDate: string
  relativeDropThresholdPct: number
  minimumAbsoluteDropPoints: number
  inAppEnabled: boolean
  emailEnabled: boolean
  monthlyCreditLimit?: number
}
