import "server-only"

import { sendSystemEmail } from "@/lib/auth-email"
import { kv } from "@/lib/kv"
import { getAdminNotificationEmails } from "@/lib/recharge-notification-email"
import type { ManagedServiceOrder } from "@/lib/managed-services"

export type ManagedServiceNotificationType =
  | "manual_payment_review"
  | "payment_received"
  | "intake_submitted"

export type ManagedServiceNotification = {
  id: string
  orderId: string
  type: ManagedServiceNotificationType
  username: string
  email: string
  planName: string
  projectName?: string
  priceCents: number
  createdAt: number
}

export type ManagedServiceNotificationSnapshot = {
  unreadCount: number
  unread: ManagedServiceNotification[]
}

type DeliveryState = {
  status: "queued" | "sent" | "failed"
  attempts: number
  updatedAt: number
  nextAttemptAt?: number
  sentAt?: number
  error?: string
}

const KEY_EVENT = (id: string) => `managed_services:notifications:${id}`
const KEY_ALL = "managed_services:notifications:all"
const KEY_SEEN = (adminId: string) => `managed_services:notifications:seen:${adminId}`
const KEY_DELIVERY = (id: string) => `managed_services:notifications:email:${id}`
const KEY_LOCK = (id: string) => `managed_services:notifications:email-lock:${id}`
const RETRY_MS = [0, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]

function eventId(order: ManagedServiceOrder, type: ManagedServiceNotificationType): string {
  const suffix = type === "intake_submitted" ? String(order.intakeSubmittedAt || order.updatedAt) : type
  return `ms_notice_${order.id}_${suffix}`.slice(0, 220)
}

export async function queueManagedServiceAdminNotification(
  order: ManagedServiceOrder,
  type: ManagedServiceNotificationType,
): Promise<ManagedServiceNotification> {
  const id = eventId(order, type)
  const existing = await kv.get<ManagedServiceNotification>(KEY_EVENT(id))
  if (existing) return existing
  const event: ManagedServiceNotification = {
    id,
    orderId: order.id,
    type,
    username: order.username,
    email: order.email,
    planName: order.planName,
    projectName: order.intake?.projectName,
    priceCents: order.priceCents,
    createdAt: Date.now(),
  }
  await kv.set(KEY_EVENT(id), event, { nx: true })
  await kv.sadd(KEY_ALL, id)
  await kv.set(KEY_DELIVERY(id), {
    status: "queued",
    attempts: 0,
    updatedAt: Date.now(),
    nextAttemptAt: Date.now(),
  } satisfies DeliveryState, { nx: true })
  return event
}

async function listNotifications(limit = 100): Promise<ManagedServiceNotification[]> {
  const ids = await kv.smembers<string[]>(KEY_ALL)
  const events = await Promise.all((ids || []).map(id => kv.get<ManagedServiceNotification>(KEY_EVENT(id))))
  return events
    .filter((event): event is ManagedServiceNotification => Boolean(event))
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, limit)
}

export async function getManagedServiceNotificationSnapshot(adminId: string) {
  const [events, seenIds] = await Promise.all([
    listNotifications(),
    kv.smembers<string[]>(KEY_SEEN(adminId)),
  ])
  const seen = new Set(seenIds || [])
  const unread = events.filter(event => !seen.has(event.id))
  return { unreadCount: unread.length, unread } satisfies ManagedServiceNotificationSnapshot
}

export async function markManagedServiceNotificationsSeen(adminId: string, eventIds: string[]) {
  const safe = [...new Set(eventIds)]
    .map(String)
    .filter(id => id.startsWith("ms_notice_") && id.length <= 220)
    .slice(0, 100)
  if (safe.length) await kv.sadd(KEY_SEEN(adminId), ...safe)
}

export async function deliverManagedServiceAdminEmail(event: ManagedServiceNotification): Promise<void> {
  const now = Date.now()
  const current = await kv.get<DeliveryState>(KEY_DELIVERY(event.id)) || {
    status: "queued" as const,
    attempts: 0,
    updatedAt: now,
    nextAttemptAt: now,
  }
  if (current.status === "sent" || current.attempts >= 6 || (current.nextAttemptAt || 0) > now) return
  const lock = await kv.set(KEY_LOCK(event.id), "locked", { nx: true, ex: 120 })
  if (!lock) return
  const attempts = current.attempts + 1
  try {
    const recipients = getAdminNotificationEmails()
    if (!recipients.length) throw new Error("未配置管理员通知邮箱")
    const title = notificationTitle(event.type)
    const reviewUrl = `${appUrl()}/admin/managed-services#managed-service-${encodeURIComponent(event.orderId)}`
    const amount = `¥${(event.priceCents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`
    const text = [title, `用户：${event.username}（${event.email}）`, `套餐：${event.planName}`, `金额：${amount}`, `服务单：${event.orderId}`, `后台处理：${reviewUrl}`].join("\n")
    await sendSystemEmail({
      to: recipients,
      subject: `【代运营】${title} · ${amount}`,
      text,
      html: `<div style="font-family:Arial,sans-serif;background:#f3f7fc;padding:28px"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #d8e7f8;border-radius:10px;overflow:hidden"><div style="height:6px;background:linear-gradient(90deg,#1677ff,#00c8ff)"></div><div style="padding:26px"><div style="font-size:13px;color:#1677ff;font-weight:700">势途 GEO 代运营通知</div><h1 style="font-size:22px;color:#071a38">${escapeHtml(title)}</h1><p style="font-size:14px;line-height:1.8;color:#66768d">${escapeHtml(event.username)} · ${escapeHtml(event.email)}<br>${escapeHtml(event.planName)} · ${escapeHtml(amount)}<br>服务单：${escapeHtml(event.orderId)}</p><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;margin-top:14px;background:#1677ff;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:13px;font-weight:700">进入后台处理</a></div></div></div>`,
    })
    await kv.set(KEY_DELIVERY(event.id), {
      status: "sent",
      attempts,
      updatedAt: Date.now(),
      sentAt: Date.now(),
    } satisfies DeliveryState)
  } catch (error) {
    const failedAt = Date.now()
    const delay = RETRY_MS[Math.min(attempts, RETRY_MS.length - 1)] || 0
    await kv.set(KEY_DELIVERY(event.id), {
      status: "failed",
      attempts,
      updatedAt: failedAt,
      nextAttemptAt: failedAt + delay,
      error: error instanceof Error ? error.message.slice(0, 300) : "邮件发送失败",
    } satisfies DeliveryState)
    console.error("[managed-service-notification] email failed", event.id)
  } finally {
    await kv.del(KEY_LOCK(event.id))
  }
}

export async function retryManagedServiceNotificationEmails(limit = 20) {
  await Promise.all((await listNotifications(limit)).map(deliverManagedServiceAdminEmail))
}

function notificationTitle(type: ManagedServiceNotificationType): string {
  if (type === "manual_payment_review") return "新的银行转账订单待核对"
  if (type === "intake_submitted") return "客户已提交代运营项目资料"
  return "代运营订单支付成功"
}

function appUrl() {
  return String(process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://shitugeo.top").trim().replace(/\/+$/, "")
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(String.fromCharCode(34), "&quot;")
    .replaceAll(String.fromCharCode(39), "&#39;")
}
