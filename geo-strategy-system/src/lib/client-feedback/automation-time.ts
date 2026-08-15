import type {
  ClientExecutionPeriodMode,
  ClientFeedbackAutomationPeriod,
  ClientFeedbackReportType,
} from "@/types/client-feedback"

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

function dateToUtc(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function dateFromUtc(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function normalizeFeedbackAutomationDate(value: unknown, label: string): string {
  const input = String(value || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || dateFromUtc(dateToUtc(input)) !== input) {
    throw new Error(`${label}无效`)
  }
  return input
}

export function normalizeFeedbackAutomationTime(value: unknown): string {
  const input = String(value || "").trim()
  const match = input.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!match) throw new Error("自动报送时间无效")
  return `${match[1]}:${match[2]}`
}

export function addFeedbackDays(value: string, count: number): string {
  const date = dateToUtc(value)
  date.setUTCDate(date.getUTCDate() + count)
  return dateFromUtc(date)
}

export function addFeedbackAnchoredMonths(value: string, count: number): string {
  const source = dateToUtc(value)
  const first = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + count, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(source.getUTCDate(), lastDay))
  return dateFromUtc(first)
}

function mondayOf(value: string): string {
  const date = dateToUtc(value)
  const weekday = date.getUTCDay() || 7
  return addFeedbackDays(value, 1 - weekday)
}

function endOfMonth(value: string): string {
  const date = dateToUtc(value)
  return dateFromUtc(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)))
}

function minDate(left: string, right: string): string {
  return left <= right ? left : right
}

export function feedbackAutomationDueAt(periodEnd: string, timeLocal: string): string {
  const nextDay = addFeedbackDays(periodEnd, 1)
  const [year, month, day] = nextDay.split("-").map(Number)
  const [hour, minute] = normalizeFeedbackAutomationTime(timeLocal).split(":").map(Number)
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - SHANGHAI_OFFSET_MS).toISOString()
}

function servicePeriods(input: {
  startDate: string
  endDate: string
  type: ClientFeedbackReportType
  timeLocal: string
}): ClientFeedbackAutomationPeriod[] {
  const periods: ClientFeedbackAutomationPeriod[] = []
  let start = input.startDate
  let index = 1
  while (start <= input.endDate && index <= 1_200) {
    const nextStart = input.type === "weekly"
      ? addFeedbackDays(start, 7)
      : addFeedbackAnchoredMonths(input.startDate, index)
    const naturalEnd = addFeedbackDays(nextStart, -1)
    const end = minDate(naturalEnd, input.endDate)
    periods.push({
      type: input.type,
      index,
      start,
      end,
      label: `服务第 ${index} ${input.type === "weekly" ? "周" : "月"}`,
      dueAt: feedbackAutomationDueAt(end, input.timeLocal),
      final: end === input.endDate && end < naturalEnd,
    })
    start = nextStart
    index += 1
  }
  return periods
}

function calendarPeriods(input: {
  startDate: string
  endDate: string
  type: ClientFeedbackReportType
  timeLocal: string
}): ClientFeedbackAutomationPeriod[] {
  const periods: ClientFeedbackAutomationPeriod[] = []
  let start = input.startDate
  let index = 1
  while (start <= input.endDate && index <= 1_200) {
    const naturalEnd = input.type === "weekly"
      ? addFeedbackDays(mondayOf(start), 6)
      : endOfMonth(start)
    const end = minDate(naturalEnd, input.endDate)
    periods.push({
      type: input.type,
      index,
      start,
      end,
      label: `第 ${index} ${input.type === "weekly" ? "周" : "月"}`,
      dueAt: feedbackAutomationDueAt(end, input.timeLocal),
      final: end === input.endDate && end < naturalEnd,
    })
    start = addFeedbackDays(end, 1)
    index += 1
  }
  return periods
}

export function buildFeedbackAutomationPeriods(input: {
  startDate: string
  endDate: string
  periodMode: ClientExecutionPeriodMode
  type: ClientFeedbackReportType
  timeLocal: string
}): ClientFeedbackAutomationPeriod[] {
  const startDate = normalizeFeedbackAutomationDate(input.startDate, "正式开始日期")
  const endDate = normalizeFeedbackAutomationDate(input.endDate, "正式结束日期")
  if (endDate < startDate) throw new Error("正式结束日期不能早于开始日期")
  const normalized = { ...input, startDate, endDate, timeLocal: normalizeFeedbackAutomationTime(input.timeLocal) }
  return input.periodMode === "calendar"
    ? calendarPeriods(normalized)
    : servicePeriods(normalized)
}

export function nextFeedbackAutomationRunAt(input: {
  startDate: string
  endDate: string
  periodMode: ClientExecutionPeriodMode
  timeLocal: string
  weeklyEnabled: boolean
  monthlyEnabled: boolean
  finalReportEnabled?: boolean
  lastWeeklyPeriodEnd?: string
  lastMonthlyPeriodEnd?: string
}): string | undefined {
  const periods = [
    ...(input.weeklyEnabled
      ? buildFeedbackAutomationPeriods({ ...input, type: "weekly" })
        .filter(period => input.finalReportEnabled !== false || !period.final)
        .filter(period => !input.lastWeeklyPeriodEnd || period.end > input.lastWeeklyPeriodEnd)
      : []),
    ...(input.monthlyEnabled
      ? buildFeedbackAutomationPeriods({ ...input, type: "monthly" })
        .filter(period => input.finalReportEnabled !== false || !period.final)
        .filter(period => !input.lastMonthlyPeriodEnd || period.end > input.lastMonthlyPeriodEnd)
      : []),
  ]
  return periods.sort((left, right) => left.dueAt.localeCompare(right.dueAt))[0]?.dueAt
}

export function dueFeedbackAutomationPeriods(input: {
  startDate: string
  endDate: string
  periodMode: ClientExecutionPeriodMode
  timeLocal: string
  weeklyEnabled: boolean
  monthlyEnabled: boolean
  finalReportEnabled: boolean
  lastWeeklyPeriodEnd?: string
  lastMonthlyPeriodEnd?: string
  now?: Date
  limit?: number
}): ClientFeedbackAutomationPeriod[] {
  const now = (input.now || new Date()).toISOString()
  const limit = Math.max(1, Math.min(24, Math.floor(input.limit || 24)))
  return [
    ...(input.weeklyEnabled
      ? buildFeedbackAutomationPeriods({ ...input, type: "weekly" })
        .filter(period => !input.lastWeeklyPeriodEnd || period.end > input.lastWeeklyPeriodEnd)
      : []),
    ...(input.monthlyEnabled
      ? buildFeedbackAutomationPeriods({ ...input, type: "monthly" })
        .filter(period => !input.lastMonthlyPeriodEnd || period.end > input.lastMonthlyPeriodEnd)
      : []),
  ]
    .filter(period => input.finalReportEnabled || !period.final)
    .filter(period => period.dueAt <= now)
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt) || left.type.localeCompare(right.type))
    .slice(0, limit)
}
