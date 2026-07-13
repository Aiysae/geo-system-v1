import "server-only"

import { readFileSync } from "node:fs"

function envFlag(name: string, fallback = false): boolean {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  return /^(1|true|yes|on)$/i.test(raw)
}

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function secretEnvOrFile(envName: string, fileEnvName: string, multiline = false): string {
  const inline = String(process.env[envName] || "").trim()
  if (inline) return multiline ? inline.replace(/\\n/g, "\n") : inline

  const filePath = String(process.env[fileEnvName] || "").trim()
  if (!filePath) throw new Error(`${envName} or ${fileEnvName} is required`)
  try {
    return readFileSync(filePath, "utf8").trim()
  } catch (error) {
    throw new Error(`Unable to read ${fileEnvName}: ${error instanceof Error ? error.message : "unknown error"}`)
  }
}

function httpsBaseUrl(name: string, fallback: string): string {
  const value = String(process.env[name] || fallback).trim().replace(/\/+$/, "")
  if (!/^https:\/\//i.test(value)) throw new Error(`${name} must use HTTPS`)
  return value
}

export function publicAppUrl(): string {
  const configured = String(
    process.env.PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || "https://shitugeo.top",
  ).trim().replace(/\/+$/, "")
  if (!/^https:\/\//i.test(configured) && process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_APP_URL must use HTTPS in production")
  }
  return configured
}

export function alipayFeatureEnabled(): boolean {
  return envFlag("PAYMENT_ALIPAY_ENABLED")
}

export function wechatFeatureEnabled(): boolean {
  return envFlag("PAYMENT_WECHAT_ENABLED")
}

export function wechatNativeFeatureEnabled(): boolean {
  return wechatFeatureEnabled() && envFlag("PAYMENT_WECHAT_NATIVE_ENABLED", true)
}

export function wechatH5FeatureEnabled(): boolean {
  return wechatFeatureEnabled() && envFlag("PAYMENT_WECHAT_H5_ENABLED")
}

export type AlipayPaymentConfig = {
  appId: string
  privateKey: string
  alipayPublicKey: string
  keyType: "PKCS1" | "PKCS8"
  gateway: string
  sellerId?: string
  notifyUrl: string
  returnUrl: string
}

export function alipayPaymentConfig(): AlipayPaymentConfig {
  const keyType = String(process.env.ALIPAY_KEY_TYPE || "PKCS8").trim().toUpperCase()
  if (keyType !== "PKCS1" && keyType !== "PKCS8") {
    throw new Error("ALIPAY_KEY_TYPE must be PKCS1 or PKCS8")
  }
  const baseUrl = publicAppUrl()
  return {
    appId: requiredEnv("ALIPAY_APP_ID"),
    privateKey: secretEnvOrFile("ALIPAY_PRIVATE_KEY", "ALIPAY_PRIVATE_KEY_FILE", true),
    alipayPublicKey: secretEnvOrFile("ALIPAY_PUBLIC_KEY", "ALIPAY_PUBLIC_KEY_FILE", true),
    keyType,
    gateway: String(process.env.ALIPAY_GATEWAY || "https://openapi.alipay.com/gateway.do").trim(),
    sellerId: String(process.env.ALIPAY_SELLER_ID || "").trim() || undefined,
    notifyUrl: `${baseUrl}/api/recharge/payments/alipay/notify`,
    returnUrl: `${baseUrl}/workspace?payment_return=alipay`,
  }
}

export type WechatPaymentConfig = {
  appId: string
  mchId: string
  merchantCertificateSerial: string
  merchantPrivateKey: string
  apiV3Key: string
  wechatPayPublicKey: string
  wechatPayPublicKeyId: string
  apiBaseUrl: string
  backupApiBaseUrl: string
  notifyUrl: string
}

export function wechatPaymentConfig(): WechatPaymentConfig {
  const apiV3Key = secretEnvOrFile("WECHAT_PAY_API_V3_KEY", "WECHAT_PAY_API_V3_KEY_FILE")
  if (Buffer.byteLength(apiV3Key, "utf8") !== 32) {
    throw new Error("WECHAT_PAY_API_V3_KEY must be exactly 32 bytes")
  }

  return {
    appId: requiredEnv("WECHAT_PAY_APP_ID"),
    mchId: requiredEnv("WECHAT_PAY_MCH_ID"),
    merchantCertificateSerial: requiredEnv("WECHAT_PAY_MERCHANT_CERT_SERIAL").toUpperCase(),
    merchantPrivateKey: secretEnvOrFile(
      "WECHAT_PAY_MERCHANT_PRIVATE_KEY",
      "WECHAT_PAY_MERCHANT_PRIVATE_KEY_FILE",
      true,
    ),
    apiV3Key,
    wechatPayPublicKey: secretEnvOrFile(
      "WECHAT_PAY_PUBLIC_KEY",
      "WECHAT_PAY_PUBLIC_KEY_FILE",
      true,
    ),
    wechatPayPublicKeyId: requiredEnv("WECHAT_PAY_PUBLIC_KEY_ID"),
    apiBaseUrl: httpsBaseUrl("WECHAT_PAY_API_BASE", "https://api.mch.weixin.qq.com"),
    backupApiBaseUrl: httpsBaseUrl("WECHAT_PAY_API_BACKUP_BASE", "https://api2.mch.weixin.qq.com"),
    notifyUrl: `${publicAppUrl()}/api/recharge/payments/wechat/notify`,
  }
}

export function publicPaymentOptions() {
  const wechatNative = wechatNativeFeatureEnabled()
  const wechatH5 = wechatH5FeatureEnabled()
  return {
    alipay: alipayFeatureEnabled(),
    wechat: {
      enabled: wechatNative || wechatH5,
      native: wechatNative,
      h5: wechatH5,
    },
    manualTransfer: true,
  }
}
