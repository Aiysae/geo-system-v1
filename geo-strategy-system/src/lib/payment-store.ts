import "server-only"

import { Pool } from "pg"
import { kv } from "@/lib/kv"
import { PAYMENT_SCHEMA_SQL } from "@/lib/payment-schema"
import type { PaymentEvent, PaymentOrder } from "@/lib/payment-types"

const KEY_ORDER = (id: string) => `payment_orders:${id}`
const KEY_OUT_TRADE_NO = (outTradeNo: string) => `payment_orders:out_trade_no:${outTradeNo}`
const KEY_USER_INDEX = (userId: string) => `payment_orders:user:${userId}`
const KEY_ALL = "payment_orders:all"

const paymentGlobal = globalThis as typeof globalThis & {
  __geoPaymentPool?: Pool
  __geoPaymentSchemaPromise?: Promise<void>
}

function backend(): "postgres" | "kv" {
  const configured = String(process.env.PAYMENT_STORE || "").trim().toLowerCase()
  if (configured === "postgres" || configured === "kv") return configured
  if (configured) throw new Error(`Unsupported PAYMENT_STORE: ${configured}`)
  return process.env.DATABASE_URL ? "postgres" : "kv"
}

export function paymentStoreBackend(): "postgres" | "kv" {
  return backend()
}

function pool(): Pool {
  if (paymentGlobal.__geoPaymentPool) return paymentGlobal.__geoPaymentPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required when PAYMENT_STORE=postgres")
  const configuredPoolMax = Number(process.env.PAYMENT_DB_POOL_MAX || 4)
  const poolMax = Number.isFinite(configuredPoolMax)
    ? Math.max(2, Math.min(8, Math.floor(configuredPoolMax)))
    : 4
  paymentGlobal.__geoPaymentPool = new Pool({
    connectionString,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  })
  paymentGlobal.__geoPaymentPool.on("error", error => {
    console.error(`[payment-db] ${error.message}`)
  })
  return paymentGlobal.__geoPaymentPool
}

export function paymentStorePool(): Pool {
  return pool()
}

export async function ensurePaymentSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!paymentGlobal.__geoPaymentSchemaPromise) {
    paymentGlobal.__geoPaymentSchemaPromise = pool().query(PAYMENT_SCHEMA_SQL)
      .then(() => undefined)
      .catch(error => {
        paymentGlobal.__geoPaymentSchemaPromise = undefined
        throw error
      })
  }
  await paymentGlobal.__geoPaymentSchemaPromise
}

export async function savePaymentOrderRecord(order: PaymentOrder): Promise<void> {
  if (backend() === "postgres") {
    await savePostgresOrder(order)
    try {
      await saveKvOrder(order)
    } catch (error) {
      console.warn("[payment-store] legacy KV shadow write failed", order.id, error)
    }
    return
  }
  await saveKvOrder(order)
}

export async function getPaymentOrderRecord(id: string): Promise<PaymentOrder | null> {
  if (!id) return null
  if (backend() === "postgres") {
    const order = await getPostgresOrderBy("id", id)
    if (order) return order
  }
  return await kv.get<PaymentOrder>(KEY_ORDER(id))
}

export async function getPaymentOrderRecordByOutTradeNo(outTradeNo: string): Promise<PaymentOrder | null> {
  if (!outTradeNo) return null
  if (backend() === "postgres") {
    const order = await getPostgresOrderBy("out_trade_no", outTradeNo)
    if (order) return order
  }
  const id = await kv.get<string>(KEY_OUT_TRADE_NO(outTradeNo))
  return id ? await kv.get<PaymentOrder>(KEY_ORDER(id)) : null
}

export async function listPaymentOrderRecordsForUser(userId: string, limit = 100): Promise<PaymentOrder[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
  const postgresOrders = backend() === "postgres"
    ? await listPostgresOrders("WHERE user_id = $1", [userId], safeLimit)
    : []
  const ids = await kv.smembers<string[]>(KEY_USER_INDEX(userId))
  const kvOrders = await Promise.all((ids || []).map(id => kv.get<PaymentOrder>(KEY_ORDER(id))))
  return mergeOrders(postgresOrders, kvOrders, safeLimit)
}

export async function listAllPaymentOrderRecords(limit = 500): Promise<PaymentOrder[]> {
  const safeLimit = Math.max(1, Math.min(2_000, Math.floor(limit)))
  const postgresOrders = backend() === "postgres"
    ? await listPostgresOrders("", [], safeLimit)
    : []
  const ids = await kv.smembers<string[]>(KEY_ALL)
  const kvOrders = await Promise.all((ids || []).map(id => kv.get<PaymentOrder>(KEY_ORDER(id))))
  return mergeOrders(postgresOrders, kvOrders, safeLimit)
}

export async function savePaymentEvent(event: PaymentEvent): Promise<PaymentEvent> {
  if (backend() !== "postgres") {
    const key = `payment_events:${event.provider}:${event.providerEventId}`
    const existing = await kv.get<PaymentEvent>(key)
    const merged = existing ? mergePaymentEvent(existing, event) : event
    await kv.set(key, merged)
    return merged
  }
  await ensurePaymentSchema()
  const result = await pool().query<PaymentEventRow>(
    `INSERT INTO geo_payment_events (
       id, provider, provider_event_id, event_type, status, signature_verified,
       out_trade_no, provider_trade_id, payload, error, received_at, processed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
     ON CONFLICT (provider, provider_event_id) DO UPDATE SET
       status = CASE
         WHEN geo_payment_events.status = 'processed' THEN geo_payment_events.status
         WHEN EXCLUDED.status = 'processed' THEN EXCLUDED.status
         WHEN EXCLUDED.status = 'received' THEN geo_payment_events.status
         ELSE EXCLUDED.status
       END,
       signature_verified = geo_payment_events.signature_verified OR EXCLUDED.signature_verified,
       out_trade_no = COALESCE(EXCLUDED.out_trade_no, geo_payment_events.out_trade_no),
       provider_trade_id = COALESCE(EXCLUDED.provider_trade_id, geo_payment_events.provider_trade_id),
       payload = geo_payment_events.payload || EXCLUDED.payload,
       error = CASE
         WHEN EXCLUDED.status = 'processed' THEN NULL
         ELSE COALESCE(EXCLUDED.error, geo_payment_events.error)
       END,
       processed_at = COALESCE(EXCLUDED.processed_at, geo_payment_events.processed_at)
     RETURNING *`,
    [
      event.id,
      event.provider,
      event.providerEventId,
      event.eventType,
      event.status,
      event.signatureVerified,
      event.outTradeNo,
      event.providerTradeId,
      JSON.stringify(event.payload),
      event.error,
      event.receivedAt,
      event.processedAt,
    ],
  )
  return eventFromRow(result.rows[0])
}

async function saveKvOrder(order: PaymentOrder): Promise<void> {
  await kv.set(KEY_ORDER(order.id), order)
  await kv.set(KEY_OUT_TRADE_NO(order.outTradeNo), order.id)
  await kv.sadd(KEY_USER_INDEX(order.userId), order.id)
  await kv.sadd(KEY_ALL, order.id)
}

async function savePostgresOrder(order: PaymentOrder): Promise<void> {
  await ensurePaymentSchema()
  await pool().query(
    `INSERT INTO geo_payment_orders (
       id, out_trade_no, user_id, username, email, recharge_request_id,
       origin, admin_payment_request_id, product_type, managed_service_order_id,
       package_key, package_name,
       price_cents, credits, provider, status,
       payer_name, payment_reference, contact, note, provider_trade_id,
       paid_cents, failure_reason, created_at, updated_at, paid_at,
       credited_at, canceled_at, refunded_at, credited_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
     )
     ON CONFLICT (id) DO UPDATE SET
       out_trade_no = EXCLUDED.out_trade_no,
       user_id = EXCLUDED.user_id,
       username = EXCLUDED.username,
       email = EXCLUDED.email,
       recharge_request_id = EXCLUDED.recharge_request_id,
       origin = EXCLUDED.origin,
       admin_payment_request_id = EXCLUDED.admin_payment_request_id,
       product_type = EXCLUDED.product_type,
       managed_service_order_id = EXCLUDED.managed_service_order_id,
       package_key = EXCLUDED.package_key,
       package_name = EXCLUDED.package_name,
       price_cents = EXCLUDED.price_cents,
       credits = EXCLUDED.credits,
       provider = EXCLUDED.provider,
       status = EXCLUDED.status,
       payer_name = EXCLUDED.payer_name,
       payment_reference = EXCLUDED.payment_reference,
       contact = EXCLUDED.contact,
       note = EXCLUDED.note,
       provider_trade_id = EXCLUDED.provider_trade_id,
       paid_cents = EXCLUDED.paid_cents,
       failure_reason = EXCLUDED.failure_reason,
       updated_at = EXCLUDED.updated_at,
       paid_at = EXCLUDED.paid_at,
       credited_at = EXCLUDED.credited_at,
       canceled_at = EXCLUDED.canceled_at,
       refunded_at = EXCLUDED.refunded_at,
       credited_by = EXCLUDED.credited_by`,
    orderParams(order),
  )
}

type PaymentOrderRow = {
  id: string
  out_trade_no: string
  user_id: string
  username: string
  email: string
  recharge_request_id: string | null
  origin: PaymentOrder["origin"] | null
  admin_payment_request_id: string | null
  product_type: PaymentOrder["productType"] | null
  managed_service_order_id: string | null
  package_key: PaymentOrder["packageKey"] | null
  package_name: string
  price_cents: number
  credits: number
  provider: PaymentOrder["provider"]
  status: PaymentOrder["status"]
  payer_name: string | null
  payment_reference: string | null
  contact: string | null
  note: string | null
  provider_trade_id: string | null
  paid_cents: number | null
  failure_reason: string | null
  created_at: string | number
  updated_at: string | number
  paid_at: string | number | null
  credited_at: string | number | null
  canceled_at: string | number | null
  refunded_at: string | number | null
  credited_by: string | null
}

type PaymentEventRow = {
  id: string
  provider: PaymentEvent["provider"]
  provider_event_id: string
  event_type: string
  status: PaymentEvent["status"]
  signature_verified: boolean
  out_trade_no: string | null
  provider_trade_id: string | null
  payload: Record<string, unknown>
  error: string | null
  received_at: string | number
  processed_at: string | number | null
}

async function getPostgresOrderBy(column: "id" | "out_trade_no", value: string): Promise<PaymentOrder | null> {
  await ensurePaymentSchema()
  const result = await pool().query<PaymentOrderRow>(
    `SELECT * FROM geo_payment_orders WHERE ${column} = $1 LIMIT 1`,
    [value],
  )
  return result.rows[0] ? orderFromRow(result.rows[0]) : null
}

async function listPostgresOrders(where: string, params: unknown[], limit: number): Promise<PaymentOrder[]> {
  await ensurePaymentSchema()
  const result = await pool().query<PaymentOrderRow>(
    `SELECT * FROM geo_payment_orders ${where} ORDER BY created_at DESC LIMIT $${params.length + 1}`,
    [...params, limit],
  )
  return result.rows.map(orderFromRow)
}

function orderParams(order: PaymentOrder): unknown[] {
  return [
    order.id,
    order.outTradeNo,
    order.userId,
    order.username,
    order.email,
    order.rechargeRequestId,
    order.origin || "self_checkout",
    order.adminPaymentRequestId,
    order.productType || "credits",
    order.managedServiceOrderId,
    order.packageKey,
    order.packageName,
    order.priceCents,
    order.credits,
    order.provider,
    order.status,
    order.payerName,
    order.paymentReference,
    order.contact,
    order.note,
    order.providerTradeId,
    order.paidCents,
    order.failureReason,
    order.createdAt,
    order.updatedAt,
    order.paidAt,
    order.creditedAt,
    order.canceledAt,
    order.refundedAt,
    order.creditedBy,
  ]
}

function orderFromRow(row: PaymentOrderRow): PaymentOrder {
  return {
    id: row.id,
    outTradeNo: row.out_trade_no,
    userId: row.user_id,
    username: row.username,
    email: row.email,
    rechargeRequestId: row.recharge_request_id || undefined,
    origin: row.origin || "self_checkout",
    adminPaymentRequestId: row.admin_payment_request_id || undefined,
    productType: row.product_type || "credits",
    managedServiceOrderId: row.managed_service_order_id || undefined,
    packageKey: row.package_key || undefined,
    packageName: row.package_name,
    priceCents: Number(row.price_cents),
    credits: Number(row.credits),
    provider: row.provider,
    status: row.status,
    payerName: row.payer_name || undefined,
    paymentReference: row.payment_reference || undefined,
    contact: row.contact || undefined,
    note: row.note || undefined,
    providerTradeId: row.provider_trade_id || undefined,
    paidCents: nullableNumber(row.paid_cents),
    failureReason: row.failure_reason || undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    paidAt: nullableNumber(row.paid_at),
    creditedAt: nullableNumber(row.credited_at),
    canceledAt: nullableNumber(row.canceled_at),
    refundedAt: nullableNumber(row.refunded_at),
    creditedBy: row.credited_by || undefined,
  }
}

function eventFromRow(row: PaymentEventRow): PaymentEvent {
  return {
    id: row.id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    eventType: row.event_type,
    status: row.status,
    signatureVerified: row.signature_verified,
    outTradeNo: row.out_trade_no || undefined,
    providerTradeId: row.provider_trade_id || undefined,
    payload: row.payload || {},
    error: row.error || undefined,
    receivedAt: Number(row.received_at),
    processedAt: nullableNumber(row.processed_at),
  }
}

function nullableNumber(value: string | number | null): number | undefined {
  return value === null ? undefined : Number(value)
}

function mergeOrders(
  primary: PaymentOrder[],
  fallback: Array<PaymentOrder | null>,
  limit: number,
): PaymentOrder[] {
  const byId = new Map(primary.map(order => [order.id, order]))
  for (const order of fallback) {
    if (order && !byId.has(order.id)) byId.set(order.id, order)
  }
  return [...byId.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

function mergePaymentEvent(existing: PaymentEvent, incoming: PaymentEvent): PaymentEvent {
  const status = existing.status === "processed" || incoming.status === "received"
    ? existing.status
    : incoming.status
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    status,
    signatureVerified: existing.signatureVerified || incoming.signatureVerified,
    outTradeNo: incoming.outTradeNo || existing.outTradeNo,
    providerTradeId: incoming.providerTradeId || existing.providerTradeId,
    payload: { ...existing.payload, ...incoming.payload },
    error: status === "processed" ? undefined : incoming.error || existing.error,
    receivedAt: Math.min(existing.receivedAt, incoming.receivedAt),
    processedAt: incoming.processedAt || existing.processedAt,
  }
}
