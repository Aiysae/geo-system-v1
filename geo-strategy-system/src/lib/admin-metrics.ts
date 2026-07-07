import "server-only"

import { listUsers } from "@/lib/auth"
import { getCredits } from "@/lib/credits"
import {
  listAllCreditLedger,
  type CreditLedgerEntry,
} from "@/lib/credit-ledger"
import {
  FEATURE_PRICES,
  getFeaturePrice,
  type FeaturePriceKey,
} from "@/lib/pricing"
import { listAllRequests, type RechargeRequest } from "@/lib/recharge"

const METRICS_TIME_ZONE = "Asia/Shanghai"
const DAILY_WINDOW_DAYS = 14

type FeatureMetricKey = FeaturePriceKey | "unknown"

export type DailyOperationsMetric = {
  date: string
  usageGross: number
  usageRefund: number
  usageNet: number
  usageCount: number
  rechargeCredits: number
  rechargeAmountCents: number
  approvedRechargeCount: number
  pendingRechargeCount: number
  activeUserCount: number
}

export type FeatureOperationsMetric = {
  key: FeatureMetricKey
  label: string
  usageGross: number
  usageRefund: number
  usageNet: number
  usageCount: number
  latestAt?: number
}

export type UserOperationsMetric = {
  userId: string
  name: string
  email: string
  role: "admin" | "user"
  status: "active" | "disabled"
  balance: number
  usageGross: number
  usageRefund: number
  usageNet: number
  usageCount: number
  rechargeCredits: number
  rechargeAmountCents: number
  approvedRechargeCount: number
  lastActivityAt?: number
}

export type AdminOperationsMetrics = {
  generatedAt: string
  todayKey: string
  totals: {
    users: number
    activeUsers: number
    disabledUsers: number
    currentOutstandingCredits: number
    usageGross: number
    usageRefund: number
    usageNet: number
    usageCount: number
    rechargeCredits: number
    rechargeAmountCents: number
    approvedRechargeCount: number
    pendingRechargeCount: number
    rejectedRechargeCount: number
  }
  today: DailyOperationsMetric
  last7Days: {
    usageNet: number
    usageCount: number
    rechargeCredits: number
    rechargeAmountCents: number
    approvedRechargeCount: number
    activeUserCount: number
  }
  daily: DailyOperationsMetric[]
  features: FeatureOperationsMetric[]
  users: UserOperationsMetric[]
  pendingRecharges: RechargeRequest[]
  latestLedger: CreditLedgerEntry[]
}

function dateKey(value: number | string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: METRICS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function recentDateKeys(days: number): string[] {
  const keys: string[] = []
  const now = Date.now()
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(dateKey(now - offset * 24 * 60 * 60 * 1000))
  }
  return keys
}

function emptyDailyMetric(date: string): DailyOperationsMetric {
  return {
    date,
    usageGross: 0,
    usageRefund: 0,
    usageNet: 0,
    usageCount: 0,
    rechargeCredits: 0,
    rechargeAmountCents: 0,
    approvedRechargeCount: 0,
    pendingRechargeCount: 0,
    activeUserCount: 0,
  }
}

function addUsageToDaily(metric: DailyOperationsMetric, gross: number, refund: number, count: number) {
  metric.usageGross += gross
  metric.usageRefund += refund
  metric.usageCount += count
  metric.usageNet = metric.usageGross - metric.usageRefund
}

function isUsageDebit(entry: CreditLedgerEntry): boolean {
  return entry.type === "usage_reserved" || entry.type === "usage_extra"
}

function isUsageRefund(entry: CreditLedgerEntry): boolean {
  return entry.type === "usage_refund"
}

function featureKeyOf(entry: CreditLedgerEntry): FeatureMetricKey {
  const key = entry.featureKey
  return key && Object.prototype.hasOwnProperty.call(FEATURE_PRICES, key) ? key : "unknown"
}

function featureLabel(key: FeatureMetricKey): string {
  if (key === "unknown") return "未标记功能"
  return getFeaturePrice(key).label
}

function moneyCentsOf(record: RechargeRequest): number {
  return record.priceCents || 0
}

export async function getAdminOperationsMetrics(): Promise<AdminOperationsMetrics> {
  const [ledger, recharges, users] = await Promise.all([
    listAllCreditLedger(10000),
    listAllRequests(5000),
    listUsers(),
  ])
  const balances = await Promise.all(users.map(user => getCredits(user.id)))
  const balanceByUserId = new Map(users.map((user, index) => [user.id, balances[index] || 0]))
  const userMetrics = new Map<string, UserOperationsMetric>()
  const featureMetrics = new Map<FeatureMetricKey, FeatureOperationsMetric>()
  const dateKeys = recentDateKeys(DAILY_WINDOW_DAYS)
  const dailyMetrics = new Map(dateKeys.map(key => [key, emptyDailyMetric(key)]))
  const dailyActiveUsers = new Map(dateKeys.map(key => [key, new Set<string>()]))

  for (const user of users) {
    userMetrics.set(user.id, {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      balance: balanceByUserId.get(user.id) || 0,
      usageGross: 0,
      usageRefund: 0,
      usageNet: 0,
      usageCount: 0,
      rechargeCredits: 0,
      rechargeAmountCents: 0,
      approvedRechargeCount: 0,
    })
  }

  let usageGross = 0
  let usageRefund = 0
  let usageCount = 0

  for (const entry of ledger) {
    const key = dateKey(entry.createdAt)
    const daily = dailyMetrics.get(key)
    const user = userMetrics.get(entry.userId)

    if (isUsageDebit(entry)) {
      const amount = Math.abs(entry.delta)
      usageGross += amount
      if (entry.type === "usage_reserved") usageCount += 1

      if (daily) {
        addUsageToDaily(daily, amount, 0, entry.type === "usage_reserved" ? 1 : 0)
        dailyActiveUsers.get(key)?.add(entry.userId)
      }

      if (user) {
        user.usageGross += amount
        if (entry.type === "usage_reserved") user.usageCount += 1
        user.usageNet = user.usageGross - user.usageRefund
        user.lastActivityAt = Math.max(user.lastActivityAt || 0, entry.createdAt)
      }

      const featureKey = featureKeyOf(entry)
      const feature = featureMetrics.get(featureKey) || {
        key: featureKey,
        label: featureLabel(featureKey),
        usageGross: 0,
        usageRefund: 0,
        usageNet: 0,
        usageCount: 0,
      }
      feature.usageGross += amount
      if (entry.type === "usage_reserved") feature.usageCount += 1
      feature.usageNet = feature.usageGross - feature.usageRefund
      feature.latestAt = Math.max(feature.latestAt || 0, entry.createdAt)
      featureMetrics.set(featureKey, feature)
    } else if (isUsageRefund(entry)) {
      const amount = Math.abs(entry.delta)
      usageRefund += amount

      if (daily) addUsageToDaily(daily, 0, amount, 0)

      if (user) {
        user.usageRefund += amount
        user.usageNet = user.usageGross - user.usageRefund
        user.lastActivityAt = Math.max(user.lastActivityAt || 0, entry.createdAt)
      }

      const featureKey = featureKeyOf(entry)
      const feature = featureMetrics.get(featureKey) || {
        key: featureKey,
        label: featureLabel(featureKey),
        usageGross: 0,
        usageRefund: 0,
        usageNet: 0,
        usageCount: 0,
      }
      feature.usageRefund += amount
      feature.usageNet = feature.usageGross - feature.usageRefund
      feature.latestAt = Math.max(feature.latestAt || 0, entry.createdAt)
      featureMetrics.set(featureKey, feature)
    }
  }

  let rechargeCredits = 0
  let rechargeAmountCents = 0
  let approvedRechargeCount = 0
  let pendingRechargeCount = 0
  let rejectedRechargeCount = 0

  for (const record of recharges) {
    if (record.status === "pending") {
      pendingRechargeCount += 1
      const daily = dailyMetrics.get(dateKey(record.createdAt))
      if (daily) daily.pendingRechargeCount += 1
      continue
    }
    if (record.status === "rejected") {
      rejectedRechargeCount += 1
      continue
    }

    approvedRechargeCount += 1
    const credits = record.credits ?? record.amount
    const amountCents = moneyCentsOf(record)
    rechargeCredits += credits
    rechargeAmountCents += amountCents

    const daily = dailyMetrics.get(dateKey(record.processedAt || record.createdAt))
    if (daily) {
      daily.rechargeCredits += credits
      daily.rechargeAmountCents += amountCents
      daily.approvedRechargeCount += 1
    }

    const user = userMetrics.get(record.userId)
    if (user) {
      user.rechargeCredits += credits
      user.rechargeAmountCents += amountCents
      user.approvedRechargeCount += 1
      user.lastActivityAt = Math.max(user.lastActivityAt || 0, record.processedAt || record.createdAt)
    }
  }

  const daily = dateKeys.map(key => {
    const metric = dailyMetrics.get(key) || emptyDailyMetric(key)
    metric.activeUserCount = dailyActiveUsers.get(key)?.size || 0
    return metric
  })
  const todayKey = dateKey(Date.now())
  const today = dailyMetrics.get(todayKey) || emptyDailyMetric(todayKey)
  today.activeUserCount = dailyActiveUsers.get(todayKey)?.size || 0
  const last7DaysSlice = daily.slice(-7)
  const last7UserIds = new Set<string>()
  for (const key of dateKeys.slice(-7)) {
    for (const userId of dailyActiveUsers.get(key) || []) last7UserIds.add(userId)
  }

  return {
    generatedAt: new Date().toISOString(),
    todayKey,
    totals: {
      users: users.length,
      activeUsers: users.filter(user => user.status === "active").length,
      disabledUsers: users.filter(user => user.status === "disabled").length,
      currentOutstandingCredits: balances.reduce((sum, value) => sum + value, 0),
      usageGross,
      usageRefund,
      usageNet: usageGross - usageRefund,
      usageCount,
      rechargeCredits,
      rechargeAmountCents,
      approvedRechargeCount,
      pendingRechargeCount,
      rejectedRechargeCount,
    },
    today,
    last7Days: {
      usageNet: last7DaysSlice.reduce((sum, item) => sum + item.usageNet, 0),
      usageCount: last7DaysSlice.reduce((sum, item) => sum + item.usageCount, 0),
      rechargeCredits: last7DaysSlice.reduce((sum, item) => sum + item.rechargeCredits, 0),
      rechargeAmountCents: last7DaysSlice.reduce((sum, item) => sum + item.rechargeAmountCents, 0),
      approvedRechargeCount: last7DaysSlice.reduce((sum, item) => sum + item.approvedRechargeCount, 0),
      activeUserCount: last7UserIds.size,
    },
    daily,
    features: Array.from(featureMetrics.values())
      .sort((a, b) => b.usageNet - a.usageNet || b.usageCount - a.usageCount),
    users: Array.from(userMetrics.values())
      .sort((a, b) => b.usageNet - a.usageNet || b.rechargeCredits - a.rechargeCredits)
      .slice(0, 20),
    pendingRecharges: recharges
      .filter(record => record.status === "pending")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10),
    latestLedger: ledger.slice(0, 10),
  }
}
