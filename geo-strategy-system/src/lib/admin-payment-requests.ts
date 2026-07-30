import "server-only"

import { randomUUID } from "node:crypto"
import {
  getAdminPaymentRequestRecord,
  insertAdminPaymentRequestRecord,
  listAdminPaymentRequestRecords,
  listAdminPaymentRequestRecordsForUser,
  mutateAdminPaymentRequestRecord,
} from "@/lib/admin-payment-request-store"
import type {
  AdminPaymentRequest,
  PaymentCheckoutKind,
} from "@/lib/admin-payment-request-types"
import {
  getUserByEmail,
  getUserById,
  type PublicUser,
} from "@/lib/auth"
import { kv } from "@/lib/kv"
import {
  cancelPaymentOrder,
  createPaymentOrder,
  failPaymentOrder,
  getPaymentOrder,
  updatePaymentOrderPayerDetails,
} from "@/lib/payment-orders"
import { ONLINE_PAYMENT_ORDER_TTL_MS } from "@/lib/payment-lifecycle"
import type { PaymentOrder, PaymentProvider } from "@/lib/payment-types"
import {
  createOrUpdatePaymentRequestRechargeReview,
  rejectRequest,
  type RechargeRequest,
} from "@/lib/recharge"
import {
  notifyPaymentRequestCanceled,
  notifyPaymentRequestCreated,
} from "@/lib/user-notifications"

const REQUEST_TTL_DAY_MS = 24 * 60 * 60 * 1000
const CHECKOUT_LOCK = (id: string) => `admin_payment_requests:checkout:${id}`

export const ADMIN_PAYMENT_REQUEST_LIMITS = {
  minPriceCents: 100,
  maxPriceCents: 100_000_000,
  minCredits: 1,
  maxCredits: 10_000_000,
  minExpiryDays: 1,
  maxExpiryDays: 30,
} as const

function cleanText(value: unknown, maxLength: number): string {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength)
}

function cleanMultiline(value: unknown, maxLength: number): string | undefined {
  const text = String(value || "").trim().replace(/\r\n?/g, "\n").slice(0, maxLength)
  return text || undefined
}

function requestId(): string {
  return `apr_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 14)}`
}

export async function findPaymentRequestTarget(account: string): Promise<PublicUser> {
  const normalized = cleanText(account, 180)
  if (!normalized) throw new Error("请输入收款账号的邮箱或用户 ID")
  const user = normalized.includes("@")
    ? await getUserByEmail(normalized)
    : await getUserById(normalized)
  if (!user) throw new Error("未找到该账号，请核对邮箱或用户 ID")
  if (user.status !== "active") throw new Error("该账号已停用，不能接收付款订单")
  return user
}

export async function createAdminPaymentRequest(input: {
  targetAccount: string
  title?: string
  note?: string
  priceCents: number
  credits: number
  expiryDays?: number
  createdBy: string
  idempotencyKey: string
}): Promise<AdminPaymentRequest> {
  const user = await findPaymentRequestTarget(input.targetAccount)
  const priceCents = Math.floor(Number(input.priceCents))
  const credits = Math.floor(Number(input.credits))
  const expiryDays = Math.floor(Number(input.expiryDays ?? 7))
  const idempotencyKey = cleanText(input.idempotencyKey, 120)
  const title = cleanText(input.title, 80) || "专属积分充值订单"

  if (
    !Number.isFinite(priceCents)
    || priceCents < ADMIN_PAYMENT_REQUEST_LIMITS.minPriceCents
    || priceCents > ADMIN_PAYMENT_REQUEST_LIMITS.maxPriceCents
  ) {
    throw new Error("订单金额需在 1 元至 100 万元之间")
  }
  if (
    !Number.isFinite(credits)
    || credits < ADMIN_PAYMENT_REQUEST_LIMITS.minCredits
    || credits > ADMIN_PAYMENT_REQUEST_LIMITS.maxCredits
  ) {
    throw new Error("订单积分需在 1 至 1000 万之间")
  }
  if (
    !Number.isFinite(expiryDays)
    || expiryDays < ADMIN_PAYMENT_REQUEST_LIMITS.minExpiryDays
    || expiryDays > ADMIN_PAYMENT_REQUEST_LIMITS.maxExpiryDays
  ) {
    throw new Error("有效期需在 1 至 30 天之间")
  }
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(idempotencyKey)) {
    throw new Error("订单防重标识无效，请刷新页面后重试")
  }

  const now = Date.now()
  const record = await insertAdminPaymentRequestRecord({
    id: requestId(),
    userId: user.id,
    username: user.name,
    email: user.email,
    title,
    note: cleanMultiline(input.note, 500),
    priceCents,
    credits,
    status: "pending",
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + expiryDays * REQUEST_TTL_DAY_MS,
    idempotencyKey,
    emailStatus: "queued",
    emailAttempts: 0,
    emailUpdatedAt: now,
  })
  await notifyPaymentRequestCreated(record)
  return record
}

export async function getAdminPaymentRequest(
  id: string,
): Promise<AdminPaymentRequest | null> {
  return await getAdminPaymentRequestRecord(id)
}

export async function getAdminPaymentRequestForUser(
  id: string,
  userId: string,
): Promise<AdminPaymentRequest | null> {
  const record = await getAdminPaymentRequestRecord(id)
  return record?.userId === userId ? record : null
}

export async function listAllAdminPaymentRequests(
  limit = 300,
): Promise<AdminPaymentRequest[]> {
  return await listAdminPaymentRequestRecords(limit)
}

export async function listAdminPaymentRequestsForUser(
  userId: string,
  limit = 100,
): Promise<AdminPaymentRequest[]> {
  return await listAdminPaymentRequestRecordsForUser(userId, limit)
}

export async function prepareAdminPaymentRequestOrder(input: {
  requestId: string
  userId: string
  provider: Exclude<PaymentProvider, "other">
}): Promise<{ request: AdminPaymentRequest; order: PaymentOrder }> {
  const provider = input.provider
  if (!["manual_transfer", "wechat", "alipay"].includes(provider)) {
    throw new Error("请选择有效的付款方式")
  }
  const release = await acquireCheckoutLock(input.requestId)
  try {
    const claimed = await mutateAdminPaymentRequestRecord(input.requestId, current => {
      if (current.userId !== input.userId) throw new Error("付款订单不存在")
      if (current.status === "canceled") throw new Error("该付款订单已取消")
      if (current.status === "credited" || current.status === "paid") {
        throw new Error("该付款订单已支付")
      }
      if (current.expiresAt <= Date.now()) {
        return {
          ...current,
          status: "expired",
          updatedAt: Date.now(),
        }
      }
      if (current.selectedProvider && current.selectedProvider !== provider) {
        throw new Error("付款方式已确认，如需更换请联系管理员重新发单")
      }
      return {
        ...current,
        selectedProvider: provider,
        status: "pending",
        updatedAt: Date.now(),
      }
    })
    if (!claimed) throw new Error("付款订单不存在")
    if (claimed.status === "expired") throw new Error("该付款订单已过期，请联系管理员重新发单")

    let activeOrder = claimed.activePaymentOrderId
      ? await getPaymentOrder(claimed.activePaymentOrderId)
      : null
    const reusable = activeOrder
      && activeOrder.userId === input.userId
      && activeOrder.provider === provider
      && !["canceled", "failed", "refunded"].includes(activeOrder.status)
      && (
        provider === "manual_transfer"
        || activeOrder.status !== "pending"
        || activeOrder.createdAt + ONLINE_PAYMENT_ORDER_TTL_MS > Date.now()
      )
    if (reusable && activeOrder) return { request: claimed, order: activeOrder }

    if (activeOrder && activeOrder.status === "pending") {
      await failPaymentOrder(activeOrder.id, "支付时限已结束，已创建新的支付单")
    }
    activeOrder = await createPaymentOrder({
      userId: claimed.userId,
      username: claimed.username,
      email: claimed.email,
      origin: "admin_request",
      adminPaymentRequestId: claimed.id,
      packageName: claimed.title,
      priceCents: claimed.priceCents,
      credits: claimed.credits,
      provider,
      note: claimed.note,
    })
    const updated = await mutateAdminPaymentRequestRecord(claimed.id, current => ({
      ...current,
      activePaymentOrderId: activeOrder?.id,
      checkoutKind: undefined,
      checkoutUrl: undefined,
      checkoutExpiresAt: undefined,
      updatedAt: Date.now(),
    }))
    if (!updated || !activeOrder) throw new Error("支付订单创建失败")
    return { request: updated, order: activeOrder }
  } finally {
    await release()
  }
}

export async function saveAdminPaymentCheckout(input: {
  requestId: string
  orderId: string
  kind: PaymentCheckoutKind
  url: string
  expiresAt: number
}): Promise<AdminPaymentRequest> {
  const updated = await mutateAdminPaymentRequestRecord(input.requestId, current => {
    if (current.activePaymentOrderId !== input.orderId) {
      throw new Error("支付订单已更新，请重新发起")
    }
    return {
      ...current,
      checkoutKind: input.kind,
      checkoutUrl: input.url,
      checkoutExpiresAt: input.expiresAt,
      updatedAt: Date.now(),
    }
  })
  if (!updated) throw new Error("付款订单不存在")
  return updated
}

export async function submitAdminPaymentBankTransfer(input: {
  requestId: string
  userId: string
  payerName: string
  paymentReference: string
  contact?: string
}): Promise<{ request: AdminPaymentRequest; review: RechargeRequest }> {
  const prepared = await prepareAdminPaymentRequestOrder({
    requestId: input.requestId,
    userId: input.userId,
    provider: "manual_transfer",
  })
  const payerName = cleanText(input.payerName, 80)
  const paymentReference = cleanText(input.paymentReference, 120)
  const contact = cleanText(input.contact, 120) || undefined
  if (!payerName) throw new Error("请填写付款人或付款企业名称")
  if (!paymentReference) throw new Error("请填写银行流水号或付款凭证编号")

  await updatePaymentOrderPayerDetails(prepared.order.id, {
    payerName,
    paymentReference,
    contact,
  })
  const updated = await mutateAdminPaymentRequestRecord(input.requestId, current => ({
    ...current,
    payerName,
    paymentReference,
    contact,
    transferSubmittedAt: Date.now(),
    updatedAt: Date.now(),
  }))
  if (!updated) throw new Error("付款订单不存在")
  const review = await createOrUpdatePaymentRequestRechargeReview(updated, prepared.order.id)
  return { request: updated, review }
}

export async function cancelAdminPaymentRequest(input: {
  requestId: string
  adminUserId: string
  reason?: string
}): Promise<AdminPaymentRequest> {
  const reason = cleanText(input.reason, 200) || "管理员取消付款订单"
  const updated = await mutateAdminPaymentRequestRecord(input.requestId, current => {
    if (current.status === "credited" || current.status === "paid") {
      throw new Error("订单已付款，不能取消")
    }
    if (current.status === "canceled") return current
    const now = Date.now()
    return {
      ...current,
      status: "canceled",
      canceledAt: now,
      canceledBy: input.adminUserId,
      cancelReason: reason,
      updatedAt: now,
    }
  })
  if (!updated) throw new Error("付款订单不存在")
  if (updated.activePaymentOrderId) {
    await cancelPaymentOrder(updated.activePaymentOrderId, reason)
  }
  await rejectRequest(`req_payreq_${updated.id}`, input.adminUserId).catch(() => undefined)
  await notifyPaymentRequestCanceled(updated)
  return updated
}

async function acquireCheckoutLock(id: string): Promise<() => Promise<void>> {
  const key = CHECKOUT_LOCK(id)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const locked = await kv.set(key, "locked", { nx: true, ex: 30 })
    if (locked) return async () => {
      await kv.del(key)
    }
    await new Promise(resolve => setTimeout(resolve, 50 + attempt * 10))
  }
  throw new Error("支付订单正在处理中，请稍后重试")
}
