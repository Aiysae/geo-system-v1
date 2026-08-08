import "server-only"

import { createHash } from "crypto"

import {
  listUserNotifications,
  markUserNotificationsRead,
  saveUserNotification,
} from "@/lib/admin-payment-request-store"
import type {
  AdminPaymentRequest,
  UserNotification,
  UserNotificationSnapshot,
  UserNotificationType,
} from "@/lib/admin-payment-request-types"

function requestUrl(requestId: string): string {
  return `/account/payment-requests/${encodeURIComponent(requestId)}`
}

function notificationId(
  type: UserNotificationType,
  requestId: string,
): string {
  return `notice_${type}_${requestId}`.slice(0, 220)
}

function feedbackReminderNotificationId(userId: string, date: string): string {
  const digest = createHash("sha256")
    .update(`${userId}\u0000${date}`)
    .digest("hex")
    .slice(0, 32)
  return `notice_feedback_action_reminder_${digest}`
}

export async function notifyPaymentRequestCreated(
  request: AdminPaymentRequest,
): Promise<UserNotification> {
  return await saveUserNotification({
    id: notificationId("payment_request", request.id),
    userId: request.userId,
    type: "payment_request",
    title: "您有一笔新的待付款订单",
    body: `${request.title} · ¥${(request.priceCents / 100).toFixed(2)} · ${request.credits} 积分`,
    actionUrl: requestUrl(request.id),
    entityType: "admin_payment_request",
    entityId: request.id,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt + 30 * 24 * 60 * 60 * 1000,
    metadata: {
      priceCents: request.priceCents,
      credits: request.credits,
      status: request.status,
    },
  })
}

export async function notifyPaymentRequestReminder(
  request: AdminPaymentRequest,
): Promise<UserNotification> {
  const sequence = Math.max(1, request.emailAttempts + 1)
  return await saveUserNotification({
    id: `${notificationId("payment_request", request.id)}_reminder_${sequence}`.slice(0, 220),
    userId: request.userId,
    type: "payment_request",
    title: "待付款订单提醒",
    body: `${request.title} · ¥${(request.priceCents / 100).toFixed(2)} · 请在有效期内完成付款`,
    actionUrl: requestUrl(request.id),
    entityType: "admin_payment_request",
    entityId: request.id,
    createdAt: Date.now(),
    expiresAt: request.expiresAt + 30 * 24 * 60 * 60 * 1000,
    metadata: {
      priceCents: request.priceCents,
      credits: request.credits,
      status: request.status,
      reminder: true,
    },
  })
}

export async function notifyPaymentRequestCredited(
  request: AdminPaymentRequest,
): Promise<UserNotification> {
  return await saveUserNotification({
    id: notificationId("payment_request_credited", request.id),
    userId: request.userId,
    type: "payment_request_credited",
    title: "付款成功，积分已到账",
    body: `${request.title} · ${request.credits} 积分已加入账户`,
    actionUrl: requestUrl(request.id),
    entityType: "admin_payment_request",
    entityId: request.id,
    createdAt: request.creditedAt || Date.now(),
    metadata: {
      priceCents: request.priceCents,
      credits: request.credits,
      status: "credited",
    },
  })
}

export async function notifyPaymentRequestCanceled(
  request: AdminPaymentRequest,
): Promise<UserNotification> {
  return await saveUserNotification({
    id: notificationId("payment_request_canceled", request.id),
    userId: request.userId,
    type: "payment_request_canceled",
    title: "付款订单已取消",
    body: `${request.title} 已由管理员取消，无需继续付款`,
    actionUrl: requestUrl(request.id),
    entityType: "admin_payment_request",
    entityId: request.id,
    createdAt: request.canceledAt || Date.now(),
    metadata: {
      priceCents: request.priceCents,
      credits: request.credits,
      status: "canceled",
    },
  })
}

export async function notifyFeedbackActionReminder(input: {
  userId: string
  date: string
  clients: Array<{
    clientId: string
    clientName: string
    dataOwnerUserId: string
  }>
}): Promise<UserNotification> {
  const first = input.clients[0]
  const names = input.clients.slice(0, 3).map(client => client.clientName)
  const remainder = Math.max(0, input.clients.length - names.length)
  const body = input.clients.length === 1
    ? `${names[0]}今天还没有动作记录，请及时完善执行反馈。`
    : `今天还有 ${input.clients.length} 个客户待录入：${names.join("、")}${remainder > 0 ? `，另有 ${remainder} 个客户` : ""}。`
  const params = new URLSearchParams({ module: "feedback" })
  if (first?.clientId) params.set("clientId", first.clientId)

  return await saveUserNotification({
    id: feedbackReminderNotificationId(input.userId, input.date),
    userId: input.userId,
    type: "feedback_action_reminder",
    title: "今晚的执行动作还未录完",
    body,
    actionUrl: `/workspace?${params.toString()}`,
    entityType: "client_feedback_reminder",
    entityId: input.date,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    metadata: {
      date: input.date,
      missingClientCount: input.clients.length,
      clientIds: input.clients.map(client => client.clientId),
      dataOwnerUserIds: input.clients.map(client => client.dataOwnerUserId),
    },
  })
}

export async function getUserNotificationSnapshot(
  userId: string,
  limit = 30,
): Promise<UserNotificationSnapshot> {
  const notifications = await listUserNotifications(userId, limit)
  return {
    unreadCount: notifications.filter(notification => !notification.readAt).length,
    notifications,
  }
}

export async function markNotificationsRead(
  userId: string,
  ids: string[],
): Promise<void> {
  await markUserNotificationsRead(userId, ids)
}
