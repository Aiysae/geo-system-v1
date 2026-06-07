import { createHmac, timingSafeEqual } from "crypto"

export const AUTH_COOKIE_NAME = "geo_session"

function getAuthSecret(): string {
  const secret =
    process.env.AUTH_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.CLERK_SECRET_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

  if (secret) return secret

  if (process.env.NODE_ENV !== "production") {
    return "dev-only-geo-session-secret"
  }

  throw new Error("AUTH_SECRET is not configured")
}

function sign(value: string): string {
  return createHmac("sha256", getAuthSecret()).update(value).digest("base64url")
}

export function createSessionCookieValue(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`
}

export function verifySessionCookieValue(value: string | undefined): string | null {
  if (!value) return null
  const [sessionId, signature, ...extra] = value.split(".")
  if (!sessionId || !signature || extra.length > 0) return null

  const expected = sign(sessionId)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null

  return timingSafeEqual(a, b) ? sessionId : null
}
