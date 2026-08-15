import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

function encryptionKey(): Buffer {
  const secret = String(
    process.env.REPORT_DELIVERY_ENCRYPTION_KEY
      || process.env.AUTH_SECRET
      || "",
  ).trim()
  if (!secret) throw new Error("服务器缺少 REPORT_DELIVERY_ENCRYPTION_KEY，暂时不能保存报送邮箱")
  return createHash("sha256").update(secret, "utf8").digest()
}

export function encryptSensitiveData(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":")
}

export function decryptSensitiveData(value: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(":")
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("报送邮箱密文格式无效，请重新保存自动报送设置")
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"))
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    throw new Error("报送邮箱无法解密，请重新保存自动报送设置")
  }
}
