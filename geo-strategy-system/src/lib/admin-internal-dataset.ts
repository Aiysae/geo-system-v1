import "server-only"

import type { PublicUser } from "@/lib/auth"
import type { CreditLedgerEntry, CreditLedgerType } from "@/lib/credit-ledger"
import {
  MEMBERSHIP_LEVELS,
  membershipLevelForTier,
} from "@/lib/membership-catalog"
import {
  PRICING_VERSION,
  getFeaturePrice,
  getRechargePackage,
  type FeaturePriceKey,
  type RechargePackageKey,
} from "@/lib/pricing"
import type { RechargeRequest } from "@/lib/recharge"
import type { MembershipSnapshot, MembershipTier } from "@/types"

const DAY_MS = 24 * 60 * 60 * 1000
const INITIAL_CREDITS = 50
const INTERNAL_USER_PREFIX = "internal_user_"

export const ADMIN_INTERNAL_DATASET_NOTICE =
  "当前管理后台合并展示内部测试数据，用于系统演示与功能验收。内部数据不具备登录权限，不会触发支付、邮件或真实积分操作；财务导出仍仅包含真实业务记录。"

const INTERNAL_NAMES = [
  "林致远",
  "顾清和",
  "沈知行",
  "许明川",
  "苏念安",
  "方景舟",
  "周若宁",
  "程亦凡",
  "赵嘉禾",
  "梁思远",
  "韩清越",
  "蒋书航",
  "郑予成",
  "唐星遥",
  "魏南乔",
  "罗启明",
  "孟知夏",
  "谢云川",
  "周总·杭州整装",
  "陈总·苏州智造",
  "徐院长·康复医学",
  "何律师·深圳企业法务",
  "孙总·宁波外贸",
  "叶老师·家庭教育",
  "郭总·成都餐饮供应链",
  "陆医生·运动康复",
  "蔡总·佛山家居",
  "章总·温州汽配",
  "宁波森屿家居",
  "苏州澄明口腔",
  "青岛海岚文旅",
  "武汉云拓智造",
  "成都川味供应链",
  "杭州知序教育",
  "深圳乾衡法律",
  "厦门屿见婚礼",
  "南京星桥母婴",
  "合肥新锐新能源",
  "重庆山城餐饮",
  "绍兴兰亭酒业",
  "华东工业品增长组",
  "大湾区品牌运营中心",
  "西南医疗内容团队",
  "京津冀企业服务组",
  "长三角家装增长团队",
  "跨境电商品牌实验室",
  "新消费品牌策略组",
  "律师 IP 增长工作室",
  "医生 IP 内容运营中心",
  "智造出海项目组",
] as const

const FEATURE_ROTATION: FeaturePriceKey[] = [
  "penetrationSlot",
  "researchAi",
  "competitorCompareUnit",
  "keywordQuestionUnit",
  "articleThirdPartyObservation",
  "articleTopBrandRanking",
  "articleRewrite",
  "reportCustomBranding",
]

type InternalEvent = {
  createdAt: number
  type: CreditLedgerType
  delta: number
  source: string
  sourceId: string
  featureKey?: FeaturePriceKey
  description: string
}

export type AdminInternalUserRecord = {
  user: PublicUser
  credits: number
  membership: MembershipSnapshot
  recharges: RechargeRequest[]
  ledger: CreditLedgerEntry[]
}

export type AdminInternalDataset = {
  generatedAt: number
  users: AdminInternalUserRecord[]
  recharges: RechargeRequest[]
  ledger: CreditLedgerEntry[]
  totals: {
    paidCents: number
    purchasedCredits: number
    issuedCredits: number
    currentCredits: number
    usageGross: number
    usageRefund: number
  }
}

function datasetEnabled(): boolean {
  return !/^(0|false|off|no)$/i.test(String(process.env.ADMIN_INTERNAL_DATASET_ENABLED || "true"))
}

function anchorDay(value: number): number {
  const date = new Date(value)
  date.setMinutes(0, 0, 0)
  return date.getTime()
}

function internalEmail(number: string): string {
  return `member${number}@users.shitugeo.test`
}

function packagesForUser(index: number): RechargePackageKey[] {
  if (index < 14) return []
  if (index < 22) return ["trial_990"]
  if (index < 34) return ["trial_990", "standard_128"]
  if (index < 40) return ["trial_990", "team_598"]
  if (index < 45) return ["trial_990", "enterprise_1298"]
  if (index < 48) return ["trial_990", "enterprise_1298", "team_598"]
  if (index === 48) return ["trial_990", "full_cycle_3666"]
  return ["trial_990", "full_cycle_3666", "full_cycle_3666", "full_cycle_3666"]
}

function membershipFor(
  paidCents: number,
  orderCount: number,
  sourceOrderId?: string,
  activatedAt?: number,
): MembershipSnapshot {
  const definition = [...MEMBERSHIP_LEVELS]
    .reverse()
    .find(level => paidCents >= level.minPaidCents)
  const tier: MembershipTier = definition?.tier || "free"
  const next = MEMBERSHIP_LEVELS.find(level => level.minPaidCents > paidCents)
  return {
    tier,
    active: tier !== "free",
    source: tier === "free" ? undefined : "payment",
    sourceOrderId: tier === "free" ? undefined : sourceOrderId,
    activatedAt: tier === "free" ? undefined : activatedAt,
    paidCents,
    qualifyingOrderCount: orderCount,
    nextTier: next?.tier,
    nextTierPaidCents: next?.minPaidCents,
    amountToNextTierCents: next ? Math.max(0, next.minPaidCents - paidCents) : 0,
    clientAccountLimit: membershipLevelForTier(tier)?.clientAccountLimit || 0,
  }
}

function splitAmount(total: number, count: number, seed: number): number[] {
  const safeTotal = Math.max(count, Math.floor(total))
  const weights = Array.from({ length: count }, (_, index) => 2 + ((seed + index * 5) % 7))
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  const values = weights.map(weight => Math.max(1, Math.floor((safeTotal * weight) / weightTotal)))
  let difference = safeTotal - values.reduce((sum, value) => sum + value, 0)
  let cursor = 0
  while (difference !== 0) {
    const direction = difference > 0 ? 1 : -1
    if (direction > 0 || values[cursor] > 1) {
      values[cursor] += direction
      difference -= direction
    }
    cursor = (cursor + 1) % values.length
  }
  return values
}

function createUserRecord(index: number, anchor: number): AdminInternalUserRecord {
  const number = String(index + 1).padStart(3, "0")
  const userId = `${INTERNAL_USER_PREFIX}${number}`
  const createdAtMs = anchor - (160 - index * 2) * DAY_MS - ((index * 37) % 8) * 60 * 60 * 1000
  const packageKeys = packagesForUser(index)
  const paymentBaseAgeDays = 1 + ((index * 5) % 28)
  const recharges: RechargeRequest[] = packageKeys.map((key, orderIndex) => {
    const pkg = getRechargePackage(key)
    if (!pkg) throw new Error(`内部测试套餐不存在：${key}`)
    const ageDays = paymentBaseAgeDays + (packageKeys.length - orderIndex - 1) * 7
    const processedAt = anchor - ageDays * DAY_MS - ((index + orderIndex) % 7) * 60 * 60 * 1000
    const id = `internal_recharge_${number}_${String(orderIndex + 1).padStart(2, "0")}`
    const paymentMethods = ["wechat", "alipay", "manual_transfer"] as const
    return {
      id,
      userId,
      username: INTERNAL_NAMES[index],
      email: internalEmail(number),
      packageKey: pkg.key,
      packageName: pkg.name,
      priceCents: pkg.priceCents,
      credits: pkg.credits,
      amount: pkg.credits,
      paymentOrderId: `internal_order_${number}_${orderIndex + 1}`,
      paymentOutTradeNo: `ST${new Date(processedAt).toISOString().slice(0, 10).replace(/-/g, "")}${number}${orderIndex + 1}`,
      paymentMethod: paymentMethods[(index + orderIndex) % paymentMethods.length],
      status: "approved",
      createdAt: processedAt - 2 * 60 * 60 * 1000,
      processedAt,
      processedBy: "internal-dataset",
    }
  })

  const purchasedCredits = recharges.reduce((sum, item) => sum + (item.credits || 0), 0)
  const issuedCredits = INITIAL_CREDITS + purchasedCredits
  const paidCents = recharges.reduce((sum, item) => sum + (item.priceCents || 0), 0)
  const targetUsageRatio = packageKeys.length === 0
    ? 0.2 + ((index * 7) % 55) / 100
    : 0.18 + ((index * 13) % 48) / 100
  const netUsage = Math.min(issuedCredits - 5, Math.max(4, Math.floor(issuedCredits * targetUsageRatio)))
  const refund = index % 6 === 0 ? Math.max(1, Math.floor(netUsage * 0.04)) : 0
  const debitAmounts = splitAmount(netUsage + refund, packageKeys.length === 0 ? 3 : 6, index + 11)
  const latestPaymentAt = recharges.reduce((latest, item) => Math.max(latest, item.processedAt || 0), 0)
  const usageStart = Math.max(createdAtMs + DAY_MS, latestPaymentAt + 3 * 60 * 60 * 1000)
  const availableWindow = Math.max(6 * 60 * 60 * 1000, anchor - usageStart)

  const events: InternalEvent[] = [
    {
      createdAt: createdAtMs + 60 * 60 * 1000,
      type: "trial_grant",
      delta: INITIAL_CREDITS,
      source: "internal-dataset",
      sourceId: userId,
      description: "新用户注册体验积分",
    },
    ...recharges.map(record => ({
      createdAt: record.processedAt || record.createdAt,
      type: "recharge_approved" as const,
      delta: record.credits || record.amount,
      source: "internal-dataset",
      sourceId: record.id,
      description: `${record.packageName}到账`,
    })),
  ]

  debitAmounts.forEach((amount, debitIndex) => {
    const featureKey = FEATURE_ROTATION[(index + debitIndex) % FEATURE_ROTATION.length]
    events.push({
      createdAt: Math.min(
        anchor - 20 * 60 * 1000,
        usageStart + Math.floor((availableWindow * (debitIndex + 1)) / (debitAmounts.length + 1)),
      ),
      type: "usage_reserved",
      delta: -amount,
      source: "internal-dataset",
      sourceId: `${userId}_usage_${debitIndex + 1}`,
      featureKey,
      description: getFeaturePrice(featureKey).label,
    })
  })

  if (refund > 0) {
    events.push({
      createdAt: Math.min(anchor - 10 * 60 * 1000, usageStart + Math.floor(availableWindow * 0.72)),
      type: "usage_refund",
      delta: refund,
      source: "internal-dataset",
      sourceId: `${userId}_refund`,
      featureKey: FEATURE_ROTATION[index % FEATURE_ROTATION.length],
      description: "任务未完成，积分自动退回",
    })
  }

  events.sort((left, right) => left.createdAt - right.createdAt || left.sourceId.localeCompare(right.sourceId))
  let balance = 0
  const ledger = events.map((event, eventIndex): CreditLedgerEntry => {
    balance += event.delta
    return {
      id: `ledger_internal_${number}_${String(eventIndex + 1).padStart(2, "0")}`,
      userId,
      type: event.type,
      delta: event.delta,
      balanceAfter: balance,
      source: event.source,
      sourceId: event.sourceId,
      featureKey: event.featureKey,
      description: event.description,
      metadata: { internalDataset: true },
      pricingVersion: PRICING_VERSION,
      createdAt: event.createdAt,
    }
  })

  const user: PublicUser = {
    id: userId,
    name: INTERNAL_NAMES[index],
    email: internalEmail(number),
    role: "user",
    status: "active",
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(anchor).toISOString(),
    lastLoginAt: new Date(Math.min(anchor - 5 * 60 * 1000, ledger.at(-1)?.createdAt || createdAtMs)).toISOString(),
    termsAcceptedAt: new Date(createdAtMs).toISOString(),
    emailVerifiedAt: new Date(createdAtMs).toISOString(),
  }

  return {
    user,
    credits: balance,
    membership: membershipFor(
      paidCents,
      recharges.length,
      recharges[0]?.paymentOrderId,
      recharges[0]?.processedAt,
    ),
    recharges: recharges.sort((left, right) => right.createdAt - left.createdAt),
    ledger: ledger.sort((left, right) => right.createdAt - left.createdAt),
  }
}

export function isAdminInternalUserId(userId: string): boolean {
  return userId.startsWith(INTERNAL_USER_PREFIX)
}

export function getAdminInternalDataset(now = Date.now()): AdminInternalDataset {
  if (!datasetEnabled()) {
    return {
      generatedAt: now,
      users: [],
      recharges: [],
      ledger: [],
      totals: {
        paidCents: 0,
        purchasedCredits: 0,
        issuedCredits: 0,
        currentCredits: 0,
        usageGross: 0,
        usageRefund: 0,
      },
    }
  }
  const generatedAt = anchorDay(now)
  const users = INTERNAL_NAMES.map((_, index) => createUserRecord(index, generatedAt))
  const recharges = users.flatMap(item => item.recharges).sort((a, b) => b.createdAt - a.createdAt)
  const ledger = users.flatMap(item => item.ledger).sort((a, b) => b.createdAt - a.createdAt)
  const purchasedCredits = recharges.reduce((sum, item) => sum + (item.credits || item.amount), 0)
  const usageGross = ledger
    .filter(item => item.type === "usage_reserved" || item.type === "usage_extra")
    .reduce((sum, item) => sum + Math.abs(item.delta), 0)
  const usageRefund = ledger
    .filter(item => item.type === "usage_refund")
    .reduce((sum, item) => sum + Math.abs(item.delta), 0)
  return {
    generatedAt,
    users,
    recharges,
    ledger,
    totals: {
      paidCents: recharges.reduce((sum, item) => sum + (item.priceCents || 0), 0),
      purchasedCredits,
      issuedCredits: purchasedCredits + users.length * INITIAL_CREDITS,
      currentCredits: users.reduce((sum, item) => sum + item.credits, 0),
      usageGross,
      usageRefund,
    },
  }
}

export function getAdminInternalUser(
  userId: string,
  now = Date.now(),
): AdminInternalUserRecord | null {
  if (!isAdminInternalUserId(userId)) return null
  return getAdminInternalDataset(now).users.find(item => item.user.id === userId) || null
}
