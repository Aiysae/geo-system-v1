import "server-only"

import { createHmac, timingSafeEqual } from "crypto"

export const INTERNAL_API_TOKEN_HEADER = "x-geo-internal-token"

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

export function createInternalApiToken(scope: string): string {
  return createHmac("sha256", getInternalSecret())
    .update(`geo-internal:${scope}`)
    .digest("base64url")
}

export function createInternalApiHeaders(scope: string): Record<string, string> {
  return {
    [INTERNAL_API_TOKEN_HEADER]: createInternalApiToken(scope),
  }
}

export function isInternalApiRequest(request: Request, scope: string): boolean {
  const actual = request.headers.get(INTERNAL_API_TOKEN_HEADER)
  if (!actual) return false

  const expected = createInternalApiToken(scope)
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  if (actualBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(actualBytes, expectedBytes)
}
