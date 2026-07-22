import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto"

function encryptionKey(): Buffer {
  const secret = String(
    process.env.AI_CONFIG_ENCRYPTION_KEY
      || process.env.AUTH_SECRET
      || "",
  ).trim()
  if (!secret) {
    throw new Error("服务器缺少 AI_CONFIG_ENCRYPTION_KEY，暂时不能保存模型密钥")
  }
  return createHash("sha256").update(secret, "utf8").digest()
}

export function encryptAiSecret(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":")
}

export function decryptAiSecret(value: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(":")
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("模型密钥格式无效，请重新保存 API Key")
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"))
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    throw new Error("模型密钥无法解密，请重新保存 API Key")
  }
}

export function maskAiSecret(value: string): string {
  return value ? `••••${value.slice(-4)}` : ""
}

export function sanitizeAiUpstreamMessage(value: unknown, max = 300): string {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_.-]{6,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer ***")
    .replace(/x-api-key["':=\s]+[A-Za-z0-9._~-]+/gi, "x-api-key: ***")
    .replace(/([?&]key=)[^&\s]+/gi, "$1***")
    .replace(/\s+/g, " ")
    .slice(0, max)
}
