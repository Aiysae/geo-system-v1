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

function penetrationAutomationNotificationId(
  type: "penetration_automation_alert" | "penetration_automation_attention",
  executionId: string,
): string {
  return `notice_${type}_${executionId}`.slice(0, 220)
}

function feedbackAutomationNotificationId(
  type: "feedback_report_sent" | "feedback_report_attention",
  executionId: string,
  userId: string,
): string {
  return `notice_${type}_${executionId}_${createHash("sha256").update(userId).digest("hex").slice(0, 12)}`.slice(0, 220)
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
    accessMode: "personal" | "team"
    canEdit: boolean
    teamId?: string
    teamName?: string
  }>
}): Promise<UserNotification> {
  const first = input.clients.find(client => client.canEdit) || input.clients[0]
  const names = input.clients.slice(0, 3).map(client => client.clientName)
  const remainder = Math.max(0, input.clients.length - names.length)
  const canEdit = input.clients.some(client => client.canEdit)
  const body = input.clients.length === 1
    ? canEdit
      ? `${names[0]}今天还没有动作记录，请及时完善执行反馈。`
      : `${names[0]}今天还没有动作记录，可进入执行反馈查看当前进度。`
    : `今天还有 ${input.clients.length} 个客户没有动作记录：${names.join("、")}${remainder > 0 ? `，另有 ${remainder} 个客户` : ""}。`
  const params = new URLSearchParams({ module: "feedback" })
  if (first?.clientId) params.set("clientId", first.clientId)
  if (first?.teamId) params.set("teamId", first.teamId)

  return await saveUserNotification({
    id: feedbackReminderNotificationId(input.userId, input.date),
    userId: input.userId,
    type: "feedback_action_reminder",
    title: canEdit ? "今晚的执行动作还未录完" : "客户执行动作尚未录入",
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
      teamIds: [...new Set(input.clients.map(client => client.teamId).filter(Boolean))],
      editableClientCount: input.clients.filter(client => client.canEdit).length,
      canEdit,
    },
  })
}

export async function notifyPenetrationAutomationAlert(input: {
  userId: string
  executionId: string
  clientId: string
  clientName: string
  historyRecordId: string
  baselineRate: number
  currentRate: number
  relativeDropPct: number
  absoluteDropPoints: number
}): Promise<UserNotification> {
  return await saveUserNotification({
    id: penetrationAutomationNotificationId("penetration_automation_alert", input.executionId),
    userId: input.userId,
    type: "penetration_automation_alert",
    title: `${input.clientName}渗透率下降提醒`,
    body: `由 ${(input.baselineRate * 100).toFixed(1)}% 降至 ${(input.currentRate * 100).toFixed(1)}%，相对下降 ${input.relativeDropPct.toFixed(1)}%。`,
    actionUrl: `/workspace/results/penetration/${encodeURIComponent(input.historyRecordId)}`,
    entityType: "penetration_automation_execution",
    entityId: input.executionId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 180 * 24 * 60 * 60 * 1000,
    metadata: {
      clientId: input.clientId,
      historyRecordId: input.historyRecordId,
      baselineRate: input.baselineRate,
      currentRate: input.currentRate,
      relativeDropPct: input.relativeDropPct,
      absoluteDropPoints: input.absoluteDropPoints,
    },
  })
}

export async function notifyPenetrationAutomationAttention(input: {
  userId: string
  executionId: string
  clientId: string
  clientName: string
  message: string
}): Promise<UserNotification> {
  const params = new URLSearchParams({ clientId: input.clientId, module: "penetration" })
  return await saveUserNotification({
    id: penetrationAutomationNotificationId("penetration_automation_attention", input.executionId),
    userId: input.userId,
    type: "penetration_automation_attention",
    title: `${input.clientName}自动检测需要处理`,
    body: input.message,
    actionUrl: `/workspace?${params.toString()}`,
    entityType: "penetration_automation_execution",
    entityId: input.executionId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
    metadata: { clientId: input.clientId },
  })
}

export async function notifyFeedbackAutomationResult(input: {
  userId: string
  executionId: string
  clientId: string
  clientName: string
  reportCount: number
  sharePath?: string
}): Promise<UserNotification> {
  const actionUrl = input.sharePath
    || `/workspace?${new URLSearchParams({ clientId: input.clientId, module: "feedback" })}`
  return await saveUserNotification({
    id: feedbackAutomationNotificationId("feedback_report_sent", input.executionId, input.userId),
    userId: input.userId,
    type: "feedback_report_sent",
    title: `${input.clientName}反馈报告已自动报送`,
    body: `本次已生成并发送 ${input.reportCount} 份周报/月报。`,
    actionUrl,
    entityType: "client_feedback_automation_execution",
    entityId: input.executionId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 180 * 24 * 60 * 60 * 1000,
    metadata: { clientId: input.clientId, reportCount: input.reportCount },
  })
}

export async function notifyFeedbackAutomationAttention(input: {
  userId: string
  executionId: string
  clientId: string
  clientName: string
  message: string
}): Promise<UserNotification> {
  const params = new URLSearchParams({ clientId: input.clientId, module: "feedback" })
  return await saveUserNotification({
    id: feedbackAutomationNotificationId("feedback_report_attention", input.executionId, input.userId),
    userId: input.userId,
    type: "feedback_report_attention",
    title: `${input.clientName}自动报送需要处理`,
    body: input.message,
    actionUrl: `/workspace?${params.toString()}`,
    entityType: "client_feedback_automation_execution",
    entityId: input.executionId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
    metadata: { clientId: input.clientId },
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
