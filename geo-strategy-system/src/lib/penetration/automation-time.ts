import { PENETRATION_AUTOMATION_TIMEZONE } from "@/lib/penetration/automation-types"

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export function normalizeAutomationIntervalDays(value: unknown): number {
  const interval = Math.floor(Number(value))
  if (!Number.isFinite(interval) || interval < 1 || interval > 7) {
    throw new Error("自动检测间隔必须在 1–7 天之间")
  }
  return interval
}

export function normalizeAutomationTimeLocal(value: unknown): string {
  const input = String(value || "").trim()
  const match = input.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!match) throw new Error("自动检测时间格式无效")
  return `${match[1]}:${match[2]}`
}

export function normalizeAutomationDate(value: unknown): string {
  const input = String(value || "").trim()
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error("首次执行日期格式无效")
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const validation = new Date(Date.UTC(year, month - 1, day))
  if (
    validation.getUTCFullYear() !== year
    || validation.getUTCMonth() !== month - 1
    || validation.getUTCDate() !== day
  ) {
    throw new Error("首次执行日期无效")
  }
  return input
}

export function shanghaiDateOnly(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PENETRATION_AUTOMATION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value)
}

export function shanghaiMonthRange(value = new Date()): { start: string; end: string } {
  const [year, month] = shanghaiDateOnly(value).split("-").map(Number)
  const start = new Date(Date.UTC(year, month - 1, 1) - SHANGHAI_OFFSET_MS)
  const end = new Date(Date.UTC(year, month, 1) - SHANGHAI_OFFSET_MS)
  return { start: start.toISOString(), end: end.toISOString() }
}

export function shanghaiLocalDateTime(date: string, timeLocal: string): Date {
  const normalizedDate = normalizeAutomationDate(date)
  const normalizedTime = normalizeAutomationTimeLocal(timeLocal)
  const [year, month, day] = normalizedDate.split("-").map(Number)
  const [hour, minute] = normalizedTime.split(":").map(Number)
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - SHANGHAI_OFFSET_MS)
}

export function nextPenetrationAutomationRun(input: {
  startDate: string
  timeLocal: string
  intervalDays: number
  after?: Date
}): string {
  const first = shanghaiLocalDateTime(input.startDate, input.timeLocal)
  const intervalMs = normalizeAutomationIntervalDays(input.intervalDays) * DAY_MS
  const afterMs = (input.after || new Date()).getTime()
  if (first.getTime() > afterMs) return first.toISOString()
  const elapsed = Math.floor((afterMs - first.getTime()) / intervalMs) + 1
  return new Date(first.getTime() + elapsed * intervalMs).toISOString()
}

export function normalizeAutomationThreshold(value: unknown, fallback = 20): number {
  const threshold = value === "" || value === undefined || value === null
    ? fallback
    : Number(value)
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) {
    throw new Error("下降提醒阈值必须在 1%–100% 之间")
  }
  return Math.round(threshold * 100) / 100
}

export function normalizeMinimumAbsoluteDrop(value: unknown, fallback = 3): number {
  const threshold = value === "" || value === undefined || value === null
    ? fallback
    : Number(value)
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error("最低下降百分点必须在 0–100 之间")
  }
  return Math.round(threshold * 100) / 100
}

export function normalizeMonthlyCreditLimit(value: unknown): number | undefined {
  if (value === "" || value === undefined || value === null) return undefined
  const limit = Math.floor(Number(value))
  if (!Number.isFinite(limit) || limit < 1 || limit > 1_000_000) {
    throw new Error("每月积分上限必须在 1–1,000,000 之间")
  }
  return limit
}
