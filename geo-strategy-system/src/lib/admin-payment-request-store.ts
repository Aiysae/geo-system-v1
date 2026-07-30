import "server-only"

import { kv } from "@/lib/kv"
import {
  ensurePaymentSchema,
  paymentStoreBackend,
  paymentStorePool,
} from "@/lib/payment-store"
import type {
  AdminPaymentRequest,
  UserNotification,
} from "@/lib/admin-payment-request-types"

const KEY_REQUEST = (id: string) => `admin_payment_requests:${id}`
const KEY_IDEMPOTENCY = (key: string) => `admin_payment_requests:idempotency:${key}`
const KEY_USER_REQUESTS = (userId: string) => `admin_payment_requests:user:${userId}`
const KEY_ALL_REQUESTS = "admin_payment_requests:all"
const KEY_REQUEST_LOCK = (id: string) => `admin_payment_requests:lock:${id}`
const KEY_IDEMPOTENCY_LOCK = (key: string) => `admin_payment_requests:idempotency-lock:${key}`

const KEY_NOTIFICATION = (id: string) => `user_notifications:${id}`
const KEY_USER_NOTIFICATIONS = (userId: string) => `user_notifications:user:${userId}`

type PaymentRequestRow = {
  id: string
  user_id: string
  username: string
  email: string
  title: string
  note: string | null
  price_cents: number
  credits: number
  status: AdminPaymentRequest["status"]
  created_by: string
  created_at: string | number
  updated_at: string | number
  expires_at: string | number
  idempotency_key: string
  selected_provider: AdminPaymentRequest["selectedProvider"] | null
  active_payment_order_id: string | null
  settlement_payment_order_id: string | null
  checkout_kind: AdminPaymentRequest["checkoutKind"] | null
  checkout_url: string | null
  checkout_expires_at: string | number | null
  payer_name: string | null
  payment_reference: string | null
  contact: string | null
  transfer_submitted_at: string | number | null
  paid_at: string | number | null
  credited_at: string | number | null
  canceled_at: string | number | null
  canceled_by: string | null
  cancel_reason: string | null
  email_status: AdminPaymentRequest["emailStatus"]
  email_attempts: number
  email_updated_at: string | number
  email_sent_at: string | number | null
  email_error: string | null
}

type NotificationRow = {
  id: string
  user_id: string
  type: UserNotification["type"]
  title: string
  body: string
  action_url: string | null
  entity_type: UserNotification["entityType"] | null
  entity_id: string | null
  created_at: string | number
  read_at: string | number | null
  expires_at: string | number | null
  metadata: Record<string, unknown> | null
}

function nullableNumber(value: string | number | null): number | undefined {
  return value === null ? undefined : Number(value)
}

function requestFromRow(row: PaymentRequestRow): AdminPaymentRequest {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    email: row.email,
    title: row.title,
    note: row.note || undefined,
    priceCents: Number(row.price_cents),
    credits: Number(row.credits),
    status: row.status,
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    expiresAt: Number(row.expires_at),
    idempotencyKey: row.idempotency_key,
    selectedProvider: row.selected_provider || undefined,
    activePaymentOrderId: row.active_payment_order_id || undefined,
    settlementPaymentOrderId: row.settlement_payment_order_id || undefined,
    checkoutKind: row.checkout_kind || undefined,
    checkoutUrl: row.checkout_url || undefined,
    checkoutExpiresAt: nullableNumber(row.checkout_expires_at),
    payerName: row.payer_name || undefined,
    paymentReference: row.payment_reference || undefined,
    contact: row.contact || undefined,
    transferSubmittedAt: nullableNumber(row.transfer_submitted_at),
    paidAt: nullableNumber(row.paid_at),
    creditedAt: nullableNumber(row.credited_at),
    canceledAt: nullableNumber(row.canceled_at),
    canceledBy: row.canceled_by || undefined,
    cancelReason: row.cancel_reason || undefined,
    emailStatus: row.email_status,
    emailAttempts: Number(row.email_attempts),
    emailUpdatedAt: Number(row.email_updated_at),
    emailSentAt: nullableNumber(row.email_sent_at),
    emailError: row.email_error || undefined,
  }
}

function notificationFromRow(row: NotificationRow): UserNotification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    actionUrl: row.action_url || undefined,
    entityType: row.entity_type || undefined,
    entityId: row.entity_id || undefined,
    createdAt: Number(row.created_at),
    readAt: nullableNumber(row.read_at),
    expiresAt: nullableNumber(row.expires_at),
    metadata: row.metadata || undefined,
  }
}

function effectiveRequest(record: AdminPaymentRequest, at = Date.now()): AdminPaymentRequest {
  if (record.status === "pending" && record.expiresAt <= at) {
    return { ...record, status: "expired" }
  }
  return record
}

async function saveKvRequest(record: AdminPaymentRequest): Promise<void> {
  await kv.set(KEY_REQUEST(record.id), record)
  await kv.set(KEY_IDEMPOTENCY(record.idempotencyKey), record.id)
  await kv.sadd(KEY_USER_REQUESTS(record.userId), record.id)
  await kv.sadd(KEY_ALL_REQUESTS, record.id)
}

async function savePostgresRequest(record: AdminPaymentRequest): Promise<AdminPaymentRequest> {
  await ensurePaymentSchema()
  const result = await paymentStorePool().query<PaymentRequestRow>(
    `INSERT INTO geo_admin_payment_requests (
       id, user_id, username, email, title, note, price_cents, credits, status,
       created_by, created_at, updated_at, expires_at, idempotency_key,
       selected_provider, active_payment_order_id, settlement_payment_order_id,
       checkout_kind, checkout_url, checkout_expires_at, payer_name,
       payment_reference, contact, transfer_submitted_at, paid_at, credited_at,
       canceled_at, canceled_by, cancel_reason, email_status, email_attempts,
       email_updated_at, email_sent_at, email_error
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
     )
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       email = EXCLUDED.email,
       title = EXCLUDED.title,
       note = EXCLUDED.note,
       price_cents = EXCLUDED.price_cents,
       credits = EXCLUDED.credits,
       status = EXCLUDED.status,
       updated_at = EXCLUDED.updated_at,
       expires_at = EXCLUDED.expires_at,
       selected_provider = EXCLUDED.selected_provider,
       active_payment_order_id = EXCLUDED.active_payment_order_id,
       settlement_payment_order_id = EXCLUDED.settlement_payment_order_id,
       checkout_kind = EXCLUDED.checkout_kind,
       checkout_url = EXCLUDED.checkout_url,
       checkout_expires_at = EXCLUDED.checkout_expires_at,
       payer_name = EXCLUDED.payer_name,
       payment_reference = EXCLUDED.payment_reference,
       contact = EXCLUDED.contact,
       transfer_submitted_at = EXCLUDED.transfer_submitted_at,
       paid_at = EXCLUDED.paid_at,
       credited_at = EXCLUDED.credited_at,
       canceled_at = EXCLUDED.canceled_at,
       canceled_by = EXCLUDED.canceled_by,
       cancel_reason = EXCLUDED.cancel_reason,
       email_status = EXCLUDED.email_status,
       email_attempts = EXCLUDED.email_attempts,
       email_updated_at = EXCLUDED.email_updated_at,
       email_sent_at = EXCLUDED.email_sent_at,
       email_error = EXCLUDED.email_error
     RETURNING *`,
    requestParams(record),
  )
  return requestFromRow(result.rows[0])
}

async function insertPostgresRequest(record: AdminPaymentRequest): Promise<AdminPaymentRequest> {
  await ensurePaymentSchema()
  const result = await paymentStorePool().query<PaymentRequestRow>(
    `INSERT INTO geo_admin_payment_requests (
       id, user_id, username, email, title, note, price_cents, credits, status,
       created_by, created_at, updated_at, expires_at, idempotency_key,
       selected_provider, active_payment_order_id, settlement_payment_order_id,
       checkout_kind, checkout_url, checkout_expires_at, payer_name,
       payment_reference, contact, transfer_submitted_at, paid_at, credited_at,
       canceled_at, canceled_by, cancel_reason, email_status, email_attempts,
       email_updated_at, email_sent_at, email_error
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
     )
     ON CONFLICT (idempotency_key) DO UPDATE SET
       idempotency_key = EXCLUDED.idempotency_key
     RETURNING *`,
    requestParams(record),
  )
  return requestFromRow(result.rows[0])
}

function requestParams(record: AdminPaymentRequest): unknown[] {
  return [
    record.id,
    record.userId,
    record.username,
    record.email,
    record.title,
    record.note,
    record.priceCents,
    record.credits,
    record.status,
    record.createdBy,
    record.createdAt,
    record.updatedAt,
    record.expiresAt,
    record.idempotencyKey,
    record.selectedProvider,
    record.activePaymentOrderId,
    record.settlementPaymentOrderId,
    record.checkoutKind,
    record.checkoutUrl,
    record.checkoutExpiresAt,
    record.payerName,
    record.paymentReference,
    record.contact,
    record.transferSubmittedAt,
    record.paidAt,
    record.creditedAt,
    record.canceledAt,
    record.canceledBy,
    record.cancelReason,
    record.emailStatus,
    record.emailAttempts,
    record.emailUpdatedAt,
    record.emailSentAt,
    record.emailError,
  ]
}

export async function insertAdminPaymentRequestRecord(
  record: AdminPaymentRequest,
): Promise<AdminPaymentRequest> {
  const release = await acquireLock(KEY_IDEMPOTENCY_LOCK(record.idempotencyKey))
  try {
    let saved: AdminPaymentRequest
    if (paymentStoreBackend() === "postgres") {
      saved = await insertPostgresRequest(record)
    } else {
      const existingId = await kv.get<string>(KEY_IDEMPOTENCY(record.idempotencyKey))
      saved = existingId
        ? await getRawRequest(existingId) || record
        : record
    }
    await saveKvRequest(saved)
    return effectiveRequest(saved)
  } finally {
    await release()
  }
}

export async function saveAdminPaymentRequestRecord(
  record: AdminPaymentRequest,
): Promise<AdminPaymentRequest> {
  let saved = record
  if (paymentStoreBackend() === "postgres") saved = await savePostgresRequest(record)
  try {
    await saveKvRequest(saved)
  } catch (error) {
    if (paymentStoreBackend() !== "postgres") throw error
    console.warn("[admin-payment-request] KV shadow write failed", record.id, error)
  }
  return effectiveRequest(saved)
}

async function getRawRequest(id: string): Promise<AdminPaymentRequest | null> {
  if (!id) return null
  if (paymentStoreBackend() === "postgres") {
    await ensurePaymentSchema()
    const result = await paymentStorePool().query<PaymentRequestRow>(
      "SELECT * FROM geo_admin_payment_requests WHERE id = $1 LIMIT 1",
      [id],
    )
    if (result.rows[0]) return requestFromRow(result.rows[0])
  }
  return await kv.get<AdminPaymentRequest>(KEY_REQUEST(id))
}

export async function getAdminPaymentRequestRecord(
  id: string,
): Promise<AdminPaymentRequest | null> {
  const record = await getRawRequest(id)
  return record ? effectiveRequest(record) : null
}

export async function listAdminPaymentRequestRecords(
  limit = 300,
): Promise<AdminPaymentRequest[]> {
  const safeLimit = Math.max(1, Math.min(2_000, Math.floor(limit)))
  const primary = paymentStoreBackend() === "postgres"
    ? await listPostgresRequests("", [], safeLimit)
    : []
  const ids = await kv.smembers<string[]>(KEY_ALL_REQUESTS)
  const fallback = await Promise.all((ids || []).map(id => kv.get<AdminPaymentRequest>(KEY_REQUEST(id))))
  return mergeRequests(primary, fallback, safeLimit)
}

export async function listAdminPaymentRequestRecordsForUser(
  userId: string,
  limit = 100,
): Promise<AdminPaymentRequest[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
  const primary = paymentStoreBackend() === "postgres"
    ? await listPostgresRequests("WHERE user_id = $1", [userId], safeLimit)
    : []
  const ids = await kv.smembers<string[]>(KEY_USER_REQUESTS(userId))
  const fallback = await Promise.all((ids || []).map(id => kv.get<AdminPaymentRequest>(KEY_REQUEST(id))))
  return mergeRequests(primary, fallback, safeLimit)
}

async function listPostgresRequests(
  where: string,
  params: unknown[],
  limit: number,
): Promise<AdminPaymentRequest[]> {
  await ensurePaymentSchema()
  const result = await paymentStorePool().query<PaymentRequestRow>(
    `SELECT * FROM geo_admin_payment_requests ${where}
     ORDER BY created_at DESC LIMIT $${params.length + 1}`,
    [...params, limit],
  )
  return result.rows.map(requestFromRow)
}

function mergeRequests(
  primary: AdminPaymentRequest[],
  fallback: Array<AdminPaymentRequest | null>,
  limit: number,
): AdminPaymentRequest[] {
  const records = new Map(primary.map(record => [record.id, record]))
  for (const record of fallback) {
    if (record && !records.has(record.id)) records.set(record.id, record)
  }
  return [...records.values()]
    .map(record => effectiveRequest(record))
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, limit)
}

export async function mutateAdminPaymentRequestRecord(
  id: string,
  updater: (current: AdminPaymentRequest) => AdminPaymentRequest | Promise<AdminPaymentRequest>,
): Promise<AdminPaymentRequest | null> {
  const release = await acquireLock(KEY_REQUEST_LOCK(id))
  try {
    const current = await getRawRequest(id)
    if (!current) return null
    const next = await updater(current)
    return await saveAdminPaymentRequestRecord(next)
  } finally {
    await release()
  }
}

export async function saveUserNotification(
  notification: UserNotification,
): Promise<UserNotification> {
  let saved = notification
  if (paymentStoreBackend() === "postgres") {
    await ensurePaymentSchema()
    const result = await paymentStorePool().query<NotificationRow>(
      `INSERT INTO geo_user_notifications (
         id, user_id, type, title, body, action_url, entity_type, entity_id,
         created_at, read_at, expires_at, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         body = EXCLUDED.body,
         action_url = EXCLUDED.action_url,
         expires_at = EXCLUDED.expires_at,
         metadata = geo_user_notifications.metadata || EXCLUDED.metadata,
         read_at = COALESCE(geo_user_notifications.read_at, EXCLUDED.read_at)
       RETURNING *`,
      [
        notification.id,
        notification.userId,
        notification.type,
        notification.title,
        notification.body,
        notification.actionUrl,
        notification.entityType,
        notification.entityId,
        notification.createdAt,
        notification.readAt,
        notification.expiresAt,
        JSON.stringify(notification.metadata || {}),
      ],
    )
    saved = notificationFromRow(result.rows[0])
  } else {
    const existing = await kv.get<UserNotification>(KEY_NOTIFICATION(notification.id))
    if (existing) {
      saved = {
        ...existing,
        ...notification,
        readAt: existing.readAt || notification.readAt,
        metadata: { ...existing.metadata, ...notification.metadata },
      }
    }
  }
  await kv.set(KEY_NOTIFICATION(saved.id), saved)
  await kv.sadd(KEY_USER_NOTIFICATIONS(saved.userId), saved.id)
  return saved
}

export async function listUserNotifications(
  userId: string,
  limit = 30,
): Promise<UserNotification[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)))
  const primary = paymentStoreBackend() === "postgres"
    ? await listPostgresNotifications(userId, safeLimit)
    : []
  const ids = await kv.smembers<string[]>(KEY_USER_NOTIFICATIONS(userId))
  const fallback = await Promise.all((ids || []).map(id => kv.get<UserNotification>(KEY_NOTIFICATION(id))))
  const records = new Map(primary.map(record => [record.id, record]))
  for (const record of fallback) {
    if (record && !records.has(record.id)) records.set(record.id, record)
  }
  const now = Date.now()
  return [...records.values()]
    .filter(record => !record.expiresAt || record.expiresAt > now)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, safeLimit)
}

async function listPostgresNotifications(
  userId: string,
  limit: number,
): Promise<UserNotification[]> {
  await ensurePaymentSchema()
  const result = await paymentStorePool().query<NotificationRow>(
    `SELECT * FROM geo_user_notifications
     WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > $2)
     ORDER BY created_at DESC LIMIT $3`,
    [userId, Date.now(), limit],
  )
  return result.rows.map(notificationFromRow)
}

export async function markUserNotificationsRead(
  userId: string,
  ids: string[],
): Promise<void> {
  const safeIds = [...new Set(ids.map(String))]
    .filter(id => id.startsWith("notice_") && id.length <= 220)
    .slice(0, 100)
  if (!safeIds.length) return
  const readAt = Date.now()
  if (paymentStoreBackend() === "postgres") {
    await ensurePaymentSchema()
    await paymentStorePool().query(
      `UPDATE geo_user_notifications
       SET read_at = COALESCE(read_at, $1)
       WHERE user_id = $2 AND id = ANY($3::text[])`,
      [readAt, userId, safeIds],
    )
  }
  await Promise.all(safeIds.map(async id => {
    const current = await kv.get<UserNotification>(KEY_NOTIFICATION(id))
    if (current?.userId === userId && !current.readAt) {
      await kv.set(KEY_NOTIFICATION(id), { ...current, readAt })
    }
  }))
}

async function acquireLock(key: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const locked = await kv.set(key, "locked", { nx: true, ex: 30 })
    if (locked) return async () => {
      await kv.del(key)
    }
    await new Promise(resolve => setTimeout(resolve, 50 + attempt * 10))
  }
  throw new Error("订单正在处理中，请稍后重试")
}
