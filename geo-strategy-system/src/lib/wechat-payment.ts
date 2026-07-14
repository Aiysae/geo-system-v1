import "server-only"

import {
  createDecipheriv,
  randomBytes,
  sign,
  verify,
} from "node:crypto"
import { isIP } from "node:net"
import { publicAppUrl, wechatPaymentConfig, type WechatPaymentConfig } from "@/lib/payment-config"
import { ONLINE_PAYMENT_ORDER_TTL_MS } from "@/lib/payment-lifecycle"
import type { PaymentOrder } from "@/lib/payment-types"

const REQUEST_TIMEOUT_MS = 8_000
const CALLBACK_CLOCK_SKEW_SECONDS = 5 * 60

export type WechatPaymentChannel = "native" | "h5"

export type WechatSignatureHeaders = {
  timestamp: string
  nonce: string
  signature: string
  serial: string
}

export type WechatEncryptedResource = {
  original_type: string
  algorithm: string
  ciphertext: string
  associated_data?: string
  nonce: string
}

export type WechatNotificationEnvelope = {
  id: string
  create_time?: string
  resource_type?: string
  event_type: string
  summary?: string
  resource: WechatEncryptedResource
}

export type WechatTransaction = {
  appid?: string
  mchid?: string
  out_trade_no?: string
  transaction_id?: string
  trade_type?: string
  trade_state?: string
  trade_state_desc?: string
  bank_type?: string
  attach?: string
  success_time?: string
  amount?: {
    total?: number
    payer_total?: number
    currency?: string
    payer_currency?: string
  }
}

class WechatApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = "WechatApiError"
  }

  get retryable(): boolean {
    return !this.status || this.status >= 500
  }
}

function requestMessage(
  method: string,
  pathWithQuery: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return `${method.toUpperCase()}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`
}

export function createWechatAuthorization(input: {
  method: string
  pathWithQuery: string
  body?: string
  mchId: string
  certificateSerial: string
  privateKey: string
  timestamp?: string
  nonce?: string
}): { authorization: string; timestamp: string; nonce: string; message: string } {
  const timestamp = input.timestamp || Math.floor(Date.now() / 1000).toString()
  const nonce = input.nonce || randomBytes(16).toString("hex")
  const message = requestMessage(
    input.method,
    input.pathWithQuery,
    timestamp,
    nonce,
    input.body || "",
  )
  const signature = sign("RSA-SHA256", Buffer.from(message, "utf8"), input.privateKey).toString("base64")
  const authorization = [
    `mchid="${input.mchId}"`,
    `nonce_str="${nonce}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${input.certificateSerial}"`,
    `signature="${signature}"`,
  ].join(",")

  return {
    authorization: `WECHATPAY2-SHA256-RSA2048 ${authorization}`,
    timestamp,
    nonce,
    message,
  }
}

export function verifyWechatSignature(input: {
  timestamp: string
  nonce: string
  body: string
  signature: string
  publicKey: string
}): boolean {
  const message = `${input.timestamp}\n${input.nonce}\n${input.body}\n`
  try {
    return verify(
      "RSA-SHA256",
      Buffer.from(message, "utf8"),
      input.publicKey,
      Buffer.from(input.signature, "base64"),
    )
  } catch {
    return false
  }
}

export function readWechatSignatureHeaders(headers: Headers): WechatSignatureHeaders {
  const values = {
    timestamp: headers.get("wechatpay-timestamp") || "",
    nonce: headers.get("wechatpay-nonce") || "",
    signature: headers.get("wechatpay-signature") || "",
    serial: headers.get("wechatpay-serial") || "",
  }
  if (!values.timestamp || !values.nonce || !values.signature || !values.serial) {
    throw new Error("微信支付签名请求头不完整")
  }
  return values
}

export function assertWechatSignedPayload(input: {
  headers: Headers
  body: string
  publicKey: string
  publicKeyId: string
  enforceFreshTimestamp?: boolean
  nowSeconds?: number
}): WechatSignatureHeaders {
  const headers = readWechatSignatureHeaders(input.headers)
  if (headers.serial !== input.publicKeyId) {
    throw new Error("微信支付签名公钥不匹配")
  }
  if (input.enforceFreshTimestamp) {
    const timestamp = Number(headers.timestamp)
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
    if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > CALLBACK_CLOCK_SKEW_SECONDS) {
      throw new Error("微信支付回调时间戳无效")
    }
  }
  if (!verifyWechatSignature({
    timestamp: headers.timestamp,
    nonce: headers.nonce,
    body: input.body,
    signature: headers.signature,
    publicKey: input.publicKey,
  })) {
    throw new Error("微信支付签名验证失败")
  }
  return headers
}

export function decryptWechatResource(
  resource: WechatEncryptedResource,
  apiV3Key: string,
): string {
  if (resource.algorithm !== "AEAD_AES_256_GCM") {
    throw new Error("微信支付回调加密算法不支持")
  }
  if (Buffer.byteLength(apiV3Key, "utf8") !== 32) {
    throw new Error("微信支付 APIv3 密钥长度无效")
  }
  const encrypted = Buffer.from(resource.ciphertext, "base64")
  if (encrypted.length <= 16) throw new Error("微信支付回调密文无效")

  const ciphertext = encrypted.subarray(0, encrypted.length - 16)
  const authTag = encrypted.subarray(encrypted.length - 16)
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(apiV3Key, "utf8"),
    Buffer.from(resource.nonce, "utf8"),
  )
  decipher.setAAD(Buffer.from(resource.associated_data || "", "utf8"))
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}

export function parseWechatNotification(rawBody: string): WechatNotificationEnvelope {
  const parsed = parseJsonObject(rawBody) as Partial<WechatNotificationEnvelope>
  if (!parsed.id || !parsed.event_type || !parsed.resource) {
    throw new Error("微信支付回调报文不完整")
  }
  return parsed as WechatNotificationEnvelope
}

export function parseWechatTransaction(raw: string): WechatTransaction {
  return parseJsonObject(raw) as WechatTransaction
}

export function assertWechatTransactionIdentity(
  transaction: WechatTransaction,
  order: PaymentOrder,
  config: Pick<WechatPaymentConfig, "appId" | "mchId">,
): void {
  if (transaction.appid !== config.appId) throw new Error("微信支付回调 AppID 不匹配")
  if (transaction.mchid !== config.mchId) throw new Error("微信支付回调商户号不匹配")
  if (transaction.out_trade_no !== order.outTradeNo) throw new Error("微信支付回调订单号不匹配")
  if (transaction.attach && transaction.attach !== order.id) throw new Error("微信支付回调订单附加数据不匹配")
  if (transaction.amount?.total !== order.priceCents) throw new Error("微信支付回调金额不匹配")
  if (transaction.amount?.currency && transaction.amount.currency !== "CNY") {
    throw new Error("微信支付回调币种不匹配")
  }
}

export function sanitizeWechatTransaction(transaction: WechatTransaction): Record<string, unknown> {
  return {
    appid: transaction.appid,
    mchid: transaction.mchid,
    outTradeNo: transaction.out_trade_no,
    transactionId: transaction.transaction_id,
    tradeType: transaction.trade_type,
    tradeState: transaction.trade_state,
    tradeStateDescription: transaction.trade_state_desc,
    bankType: transaction.bank_type,
    attach: transaction.attach,
    successTime: transaction.success_time,
    amount: transaction.amount ? {
      total: transaction.amount.total,
      payerTotal: transaction.amount.payer_total,
      currency: transaction.amount.currency,
      payerCurrency: transaction.amount.payer_currency,
    } : undefined,
  }
}

export function normalizeWechatClientIp(value: string): string | null {
  const candidate = String(value || "").trim().replace(/^::ffff:/, "")
  return isIP(candidate) ? candidate : null
}

export function wechatH5Type(userAgent: string): "iOS" | "Android" | "Wap" {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS"
  if (/Android/i.test(userAgent)) return "Android"
  return "Wap"
}

export async function createWechatNativeOrder(
  order: PaymentOrder,
  clientIp?: string,
): Promise<{ codeUrl: string; expiresAt: number }> {
  const config = wechatPaymentConfig()
  const expiresAt = order.createdAt + ONLINE_PAYMENT_ORDER_TTL_MS
  const ip = clientIp ? normalizeWechatClientIp(clientIp) : null
  const payload = baseOrderPayload(order, expiresAt, config)
  const result = await wechatApiRequest<{ code_url?: string }>(
    "POST",
    "/v3/pay/transactions/native",
    {
      ...payload,
      scene_info: ip ? { payer_client_ip: ip } : undefined,
    },
    config,
  )
  const codeUrl = String(result.code_url || "")
  if (!codeUrl) throw new Error("微信支付下单未返回二维码链接")
  return { codeUrl, expiresAt }
}

export async function createWechatH5Order(input: {
  order: PaymentOrder
  clientIp: string
  userAgent: string
}): Promise<{ h5Url: string; expiresAt: number }> {
  const config = wechatPaymentConfig()
  const ip = normalizeWechatClientIp(input.clientIp)
  if (!ip) throw new Error("无法识别微信 H5 支付的用户 IP")
  const expiresAt = input.order.createdAt + ONLINE_PAYMENT_ORDER_TTL_MS
  const result = await wechatApiRequest<{ h5_url?: string }>(
    "POST",
    "/v3/pay/transactions/h5",
    {
      ...baseOrderPayload(input.order, expiresAt, config),
      scene_info: {
        payer_client_ip: ip,
        h5_info: {
          type: wechatH5Type(input.userAgent),
          app_name: "势途 GEO",
          app_url: publicAppUrl(),
        },
      },
    },
    config,
  )
  const h5Url = String(result.h5_url || "")
  if (!/^https:\/\//i.test(h5Url)) throw new Error("微信 H5 支付未返回有效链接")
  const returnUrl = `${publicAppUrl()}/workspace?payment_return=wechat&order_id=${encodeURIComponent(input.order.id)}`
  return {
    h5Url: `${h5Url}${h5Url.includes("?") ? "&" : "?"}redirect_url=${encodeURIComponent(returnUrl)}`,
    expiresAt,
  }
}

export async function queryWechatOrder(outTradeNo: string): Promise<WechatTransaction> {
  const config = wechatPaymentConfig()
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(config.mchId)}`
  try {
    return await wechatApiRequest<WechatTransaction>("GET", path, undefined, config)
  } catch (error) {
    if (!(error instanceof WechatApiError) || !error.retryable) throw error
    return await wechatApiRequest<WechatTransaction>("GET", path, undefined, config, true)
  }
}

function baseOrderPayload(order: PaymentOrder, expiresAt: number, config: WechatPaymentConfig) {
  return {
    appid: config.appId,
    mchid: config.mchId,
    description: `势途 GEO ${order.packageName}`.slice(0, 120),
    out_trade_no: order.outTradeNo,
    time_expire: formatWechatTimestamp(expiresAt),
    attach: order.id,
    notify_url: config.notifyUrl,
    amount: {
      total: order.priceCents,
      currency: "CNY",
    },
  }
}

function formatWechatTimestamp(epochMs: number): string {
  const eastEight = new Date(epochMs + 8 * 60 * 60 * 1000)
  return `${eastEight.toISOString().slice(0, 19)}+08:00`
}

async function wechatApiRequest<T>(
  method: "GET" | "POST",
  pathWithQuery: string,
  payload: Record<string, unknown> | undefined,
  config: WechatPaymentConfig,
  useBackup = false,
): Promise<T> {
  const body = payload ? JSON.stringify(payload) : ""
  const authorization = createWechatAuthorization({
    method,
    pathWithQuery,
    body,
    mchId: config.mchId,
    certificateSerial: config.merchantCertificateSerial,
    privateKey: config.merchantPrivateKey,
  })
  const baseUrl = useBackup ? config.backupApiBaseUrl : config.apiBaseUrl

  let response: Response
  try {
    response = await fetch(`${baseUrl}${pathWithQuery}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        Authorization: authorization.authorization,
        "Wechatpay-Serial": config.wechatPayPublicKeyId,
        "User-Agent": "shitu-geo-payment/1.0",
      },
      body: body || undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new WechatApiError(
      `微信支付网络请求失败：${error instanceof Error ? error.message : "unknown error"}`,
    )
  }

  const rawBody = await response.text()
  assertWechatSignedPayload({
    headers: response.headers,
    body: rawBody,
    publicKey: config.wechatPayPublicKey,
    publicKeyId: config.wechatPayPublicKeyId,
  })

  const parsed = rawBody ? parseJsonObject(rawBody) : {}
  if (!response.ok) {
    const code = typeof parsed.code === "string" ? parsed.code : undefined
    const message = typeof parsed.message === "string" ? parsed.message : "微信支付接口请求失败"
    throw new WechatApiError(message, response.status, code)
  }
  return parsed as T
}

function parseJsonObject(raw: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("微信支付返回了无效 JSON")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("微信支付返回数据格式无效")
  }
  return parsed as Record<string, unknown>
}
