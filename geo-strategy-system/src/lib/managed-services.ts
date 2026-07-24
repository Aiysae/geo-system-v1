import "server-only"

import { randomUUID } from "crypto"
import { isAdminUser } from "@/lib/admin"
import { listUsers } from "@/lib/auth"
import { kv } from "@/lib/kv"
import type { ManagedServicePlan, ManagedServicePlanKey } from "@/lib/managed-service-plans"
import {
  deliverManagedServiceAdminEmail,
  queueManagedServiceAdminNotification,
} from "@/lib/managed-service-notifications"
import type { PaymentOrder, PaymentProvider } from "@/lib/payment-types"
import { createWorkspaceClient, mutateWorkspaceClientLatest } from "@/lib/workspace-store"
import type { AnalysisSubjectType } from "@/types"

export type ManagedServiceStatus =
  | "pending_payment"
  | "paid"
  | "provisioning"
  | "awaiting_intake"
  | "intake_submitted"
  | "active"
  | "paused"
  | "completed"
  | "canceled"
  | "provisioning_failed"

export type ManagedServiceIntake = {
  subjectType: AnalysisSubjectType
  projectName: string
  subjectName: string
  aliases: string[]
  industry: string
  region: string
  website: string
  platformLinks: string[]
  coreOffer: string
  advantages: string
  competitors: string
  goals: string
  prohibitedClaims: string
  contactName: string
  contactPhone: string
  contactWechat: string
  preferredStartDate: string
  notes: string
}

export type ManagedServiceOrder = {
  id: string
  userId: string
  username: string
  email: string
  ownerUserId: string
  planKey: ManagedServicePlanKey
  planName: string
  priceCents: number
  durationMonths: number
  provider: PaymentProvider
  status: ManagedServiceStatus
  paymentOrderId?: string
  paymentOutTradeNo?: string
  workspaceClientId?: string
  intake?: ManagedServiceIntake
  createdAt: number
  updatedAt: number
  paidAt?: number
  provisionedAt?: number
  intakeSubmittedAt?: number
  serviceStartsAt?: number
  serviceEndsAt?: number
  provisioningAttempts?: number
  provisioningError?: string
}

const KEY_ORDER = (id: string) => `managed_services:orders:${id}`
const KEY_PAYMENT = (paymentOrderId: string) => `managed_services:payment:${paymentOrderId}`
const KEY_USER = (userId: string) => `managed_services:user:${userId}`
const KEY_OWNER = (ownerUserId: string) => `managed_services:owner:${ownerUserId}`
const KEY_ALL = "managed_services:all"
const KEY_FULFILLED = (paymentOrderId: string) => `managed_services:fulfilled:${paymentOrderId}`
const KEY_FULFILL_LOCK = (paymentOrderId: string) => `managed_services:fulfill-lock:${paymentOrderId}`

function clean(value: unknown, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength)
}

function cleanList(value: unknown, maxItems = 30, maxLength = 500): string[] {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\n,，]/)
  return [...new Set(items.map(item => clean(item, maxLength)).filter(Boolean))].slice(0, maxItems)
}

function projectClientId(orderId: string): string {
  return `managed_${orderId}`.slice(0, 128)
}

async function saveOrder(order: ManagedServiceOrder): Promise<void> {
  await kv.set(KEY_ORDER(order.id), order)
  await kv.sadd(KEY_USER(order.userId), order.id)
  await kv.sadd(KEY_OWNER(order.ownerUserId), order.id)
  await kv.sadd(KEY_ALL, order.id)
  if (order.paymentOrderId) await kv.set(KEY_PAYMENT(order.paymentOrderId), order.id)
}

async function ordersFromIds(ids: string[], limit: number): Promise<ManagedServiceOrder[]> {
  const orders = await Promise.all(ids.map(id => kv.get<ManagedServiceOrder>(KEY_ORDER(id))))
  return orders
    .filter((order): order is ManagedServiceOrder => Boolean(order))
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, limit)
}

export async function resolveManagedServiceOwnerUserId(): Promise<string> {
  const configured = clean(process.env.MANAGED_SERVICE_OWNER_USER_ID, 160)
  if (configured) return configured
  const admins = (await listUsers()).filter(isAdminUser)
  if (!admins.length) throw new Error("未配置代运营项目管理员")
  return admins[0].id
}

export async function createManagedServiceOrder(input: {
  userId: string
  username: string
  email: string
  ownerUserId: string
  plan: ManagedServicePlan
  provider: PaymentProvider
}): Promise<ManagedServiceOrder> {
  const now = Date.now()
  const order: ManagedServiceOrder = {
    id: `ms_${now.toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    userId: input.userId,
    username: clean(input.username, 120),
    email: clean(input.email, 240),
    ownerUserId: input.ownerUserId,
    planKey: input.plan.key,
    planName: input.plan.name,
    priceCents: input.plan.priceCents,
    durationMonths: input.plan.durationMonths,
    provider: input.provider,
    status: "pending_payment",
    createdAt: now,
    updatedAt: now,
  }
  await saveOrder(order)
  return order
}

export async function linkManagedServicePayment(
  managedServiceOrderId: string,
  paymentOrder: Pick<PaymentOrder, "id" | "outTradeNo">,
): Promise<ManagedServiceOrder> {
  const order = await getManagedServiceOrder(managedServiceOrderId)
  if (!order) throw new Error("代运营订单不存在")
  const updated: ManagedServiceOrder = {
    ...order,
    paymentOrderId: paymentOrder.id,
    paymentOutTradeNo: paymentOrder.outTradeNo,
    updatedAt: Date.now(),
  }
  await saveOrder(updated)
  return updated
}

export async function markManagedServiceCheckoutFailed(
  orderId: string,
  reason: string,
): Promise<void> {
  const order = await getManagedServiceOrder(orderId)
  if (!order || order.paidAt) return
  await saveOrder({
    ...order,
    status: "canceled",
    provisioningError: clean(reason, 500) || "支付订单创建失败",
    updatedAt: Date.now(),
  })
}

export async function getManagedServiceOrder(id: string): Promise<ManagedServiceOrder | null> {
  return id ? await kv.get<ManagedServiceOrder>(KEY_ORDER(id)) : null
}

export async function getManagedServiceOrderByPayment(paymentOrderId: string) {
  const id = await kv.get<string>(KEY_PAYMENT(paymentOrderId))
  return id ? getManagedServiceOrder(id) : null
}

export async function listManagedServiceOrdersForUser(userId: string, limit = 100) {
  const ids = await kv.smembers<string[]>(KEY_USER(userId))
  return ordersFromIds(ids || [], Math.max(1, Math.min(500, limit)))
}

export async function listManagedServiceOrdersForOwner(ownerUserId: string, limit = 500) {
  const ids = await kv.smembers<string[]>(KEY_OWNER(ownerUserId))
  return ordersFromIds(ids || [], Math.max(1, Math.min(1_000, limit)))
}

export async function listAllManagedServiceOrders(limit = 1_000) {
  const ids = await kv.smembers<string[]>(KEY_ALL)
  return ordersFromIds(ids || [], Math.max(1, Math.min(2_000, limit)))
}

export function canAccessManagedServiceOrder(order: ManagedServiceOrder, userId: string): boolean {
  return order.userId === userId || order.ownerUserId === userId
}

export async function fulfillManagedServicePaymentOrder(paymentOrder: PaymentOrder): Promise<{
  order: ManagedServiceOrder | null
  fulfilledNow: boolean
}> {
  if (paymentOrder.productType !== "managed_service" || !paymentOrder.managedServiceOrderId) {
    return { order: null, fulfilledNow: false }
  }
  const existing = await getManagedServiceOrder(paymentOrder.managedServiceOrderId)
  if (!existing) return { order: null, fulfilledNow: false }
  if (existing.workspaceClientId && await kv.get(KEY_FULFILLED(paymentOrder.id))) {
    return { order: existing, fulfilledNow: false }
  }
  const lock = await kv.set(KEY_FULFILL_LOCK(paymentOrder.id), "locked", { nx: true, ex: 90 })
  if (!lock) return { order: await getManagedServiceOrder(existing.id), fulfilledNow: false }

  const paidAt = paymentOrder.paidAt || Date.now()
  let working: ManagedServiceOrder = {
    ...existing,
    paymentOrderId: paymentOrder.id,
    paymentOutTradeNo: paymentOrder.outTradeNo,
    provider: paymentOrder.provider,
    status: "provisioning",
    paidAt,
    provisioningAttempts: (existing.provisioningAttempts || 0) + 1,
    provisioningError: undefined,
    updatedAt: Date.now(),
  }
  await saveOrder(working)
  const paymentNotification = await queueManagedServiceAdminNotification(working, "payment_received")
  void deliverManagedServiceAdminEmail(paymentNotification)
  try {
    const clientId = working.workspaceClientId || projectClientId(working.id)
    await createWorkspaceClient(working.ownerUserId, {
      id: clientId,
      name: `代运营项目 · 待完善资料 · ${working.id.slice(-6).toUpperCase()}`,
      subjectType: "brand",
      ourBrand: "",
      industry: "",
      website: "",
      questions: [],
      competitors: [],
      selectedModels: [],
      createdAt: new Date(paidAt).toISOString(),
      updatedAt: new Date().toISOString(),
    })
    working = {
      ...working,
      workspaceClientId: clientId,
      status: working.intake ? "intake_submitted" : "awaiting_intake",
      provisionedAt: Date.now(),
      updatedAt: Date.now(),
    }
    await saveOrder(working)
    await kv.set(KEY_FULFILLED(paymentOrder.id), working.id)
    return { order: working, fulfilledNow: true }
  } catch (error) {
    working = {
      ...working,
      status: "provisioning_failed",
      provisioningError: error instanceof Error ? error.message.slice(0, 500) : "项目创建失败",
      updatedAt: Date.now(),
    }
    await saveOrder(working)
    return { order: working, fulfilledNow: false }
  } finally {
    await kv.del(KEY_FULFILL_LOCK(paymentOrder.id))
  }
}

export function normalizeManagedServiceIntake(value: unknown): ManagedServiceIntake {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const subjectType: AnalysisSubjectType = input.subjectType === "person" ? "person" : "brand"
  const subjectName = clean(input.subjectName, 300)
  if (!subjectName) throw new Error(subjectType === "person" ? "请填写个人 IP 姓名" : "请填写品牌或公司名称")
  return {
    subjectType,
    projectName: clean(input.projectName, 160) || `${subjectName} GEO 代运营`,
    subjectName,
    aliases: cleanList(input.aliases, 50, 300),
    industry: clean(input.industry, 300),
    region: clean(input.region, 200),
    website: clean(input.website, 2_000),
    platformLinks: cleanList(input.platformLinks, 50, 2_000),
    coreOffer: clean(input.coreOffer, 5_000),
    advantages: clean(input.advantages, 10_000),
    competitors: clean(input.competitors, 5_000),
    goals: clean(input.goals, 5_000),
    prohibitedClaims: clean(input.prohibitedClaims, 5_000),
    contactName: clean(input.contactName, 120),
    contactPhone: clean(input.contactPhone, 80),
    contactWechat: clean(input.contactWechat, 120),
    preferredStartDate: clean(input.preferredStartDate, 40),
    notes: clean(input.notes, 10_000),
  }
}

export async function submitManagedServiceIntake(orderId: string, value: unknown) {
  const order = await getManagedServiceOrder(orderId)
  if (!order) throw new Error("代运营订单不存在")
  if (!order.paidAt) throw new Error("订单尚未确认付款")
  if (!order.workspaceClientId) throw new Error("项目正在创建，请稍后重试")
  const intake = normalizeManagedServiceIntake(value)
  await mutateWorkspaceClientLatest({
    userId: order.ownerUserId,
    clientId: order.workspaceClientId,
    mutate: () => ({
      patch: {
        name: intake.projectName,
        subjectType: intake.subjectType,
        ourBrand: intake.subjectName,
        brandAliases: intake.aliases,
        industry: intake.industry,
        website: intake.website,
        competitors: cleanList(intake.competitors, 1_000, 500),
      },
    }),
  })
  const updated: ManagedServiceOrder = {
    ...order,
    intake,
    status: "intake_submitted",
    intakeSubmittedAt: Date.now(),
    updatedAt: Date.now(),
  }
  await saveOrder(updated)
  const notification = await queueManagedServiceAdminNotification(updated, "intake_submitted")
  void deliverManagedServiceAdminEmail(notification)
  return updated
}

export async function updateManagedServiceStatus(input: {
  orderId: string
  status: Extract<ManagedServiceStatus, "active" | "paused" | "completed" | "canceled">
  serviceStartsAt?: number
}) {
  const order = await getManagedServiceOrder(input.orderId)
  if (!order) throw new Error("代运营订单不存在")
  const start = input.status === "active"
    ? input.serviceStartsAt || order.serviceStartsAt || Date.now()
    : order.serviceStartsAt
  const end = start
    ? new Date(new Date(start).setMonth(new Date(start).getMonth() + order.durationMonths)).getTime()
    : order.serviceEndsAt
  const updated: ManagedServiceOrder = {
    ...order,
    status: input.status,
    serviceStartsAt: start,
    serviceEndsAt: end,
    updatedAt: Date.now(),
  }
  await saveOrder(updated)
  return updated
}
