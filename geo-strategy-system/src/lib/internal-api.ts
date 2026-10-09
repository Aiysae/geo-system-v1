import "server-only"

import { createHmac, timingSafeEqual } from "crypto"

export const INTERNAL_API_TOKEN_HEADER = "x-geo-internal-token"
export const INTERNAL_API_USER_HEADER = "x-geo-internal-user"

const TOKEN_VERSION = "v2"
// Tokens are minted immediately before each internal request, so a short
// lifetime only needs to cover dispatch latency and small clock skew between
// the web and worker processes.
const TOKEN_TTL_MS = 5 * 60 * 1000
const CLOCK_SKEW_MS = 60 * 1000
const MAX_USER_ID_LENGTH = 160

function getInternalSecret(): string {
  const secret =
    process.env.GEO_INTERNAL_TOKEN_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.CLERK_SECRET_KEY

  if (secret) return secret

  if (process.env.NODE_ENV !== "production") {
    return "dev-only-geo-internal-secret"
  }

  throw new Error("GEO_INTERNAL_TOKEN_SECRET or AUTH_SECRET is not configured")
}

function normalizeUserId(userId: unknown): string {
  return String(userId || "").trim()
}

function signature(scope: string, userId: string, expiresAt: number): string {
  return createHmac("sha256", getInternalSecret())
    .update(`geo-internal:${TOKEN_VERSION}:${scope}:${userId}:${expiresAt}`)
    .digest("base64url")
}

/**
 * Creates a short-lived token bound to the scope and the impersonated user, so
 * a leaked header cannot be replayed later or reused for another account.
 */
export function createInternalApiToken(scope: string, userId = ""): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS
  return `${TOKEN_VERSION}.${expiresAt}.${signature(scope, normalizeUserId(userId), expiresAt)}`
}

export function createInternalApiHeaders(scope: string, userId?: string): Record<string, string> {
  const normalizedUserId = normalizeUserId(userId)
  return {
    [INTERNAL_API_TOKEN_HEADER]: createInternalApiToken(scope, normalizedUserId),
    ...(normalizedUserId ? { [INTERNAL_API_USER_HEADER]: normalizedUserId } : {}),
  }
}

export function isInternalApiRequest(request: Request, scope: string): boolean {
  const actual = request.headers.get(INTERNAL_API_TOKEN_HEADER)
  if (!actual) return false

  const [version, expiresText, actualSignature, ...extra] = actual.split(".")
  if (version !== TOKEN_VERSION || !expiresText || !actualSignature || extra.length > 0) return false
  if (!/^\d{1,16}$/.test(expiresText)) return false
  const expiresAt = Number(expiresText)
  const now = Date.now()
  if (expiresAt <= now || expiresAt > now + TOKEN_TTL_MS + CLOCK_SKEW_MS) return false

  const userId = normalizeUserId(request.headers.get(INTERNAL_API_USER_HEADER))
  if (userId.length > MAX_USER_ID_LENGTH) return false
  const actualBytes = Buffer.from(actualSignature)
  const expectedBytes = Buffer.from(signature(scope, userId, expiresAt))
  if (actualBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(actualBytes, expectedBytes)
}

export function getInternalApiUserId(request: Request, scope: string): string | null {
  if (!isInternalApiRequest(request, scope)) return null
  const userId = normalizeUserId(request.headers.get(INTERNAL_API_USER_HEADER))
  return userId || null
}
