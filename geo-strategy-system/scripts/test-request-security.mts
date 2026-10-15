import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-request-security-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")

const { getClientIp } = await import("../src/lib/rate-limit")
const {
  createInternalApiHeaders,
  getInternalApiUserId,
  isInternalApiRequest,
  INTERNAL_API_TOKEN_HEADER,
  INTERNAL_API_USER_HEADER,
} = await import("../src/lib/internal-api")
const { validatePublicHttpUrl } = await import("../src/lib/safe-web-fetch")
const { acquireJobSettlementLock } = await import("../src/lib/distributed-concurrency")

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/test", { method: "POST", headers })
}

// Client IP: a spoofed leftmost X-Forwarded-For entry must not be trusted.
assert.equal(getClientIp(request({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1, 203.0.113.9" })), "203.0.113.9")
assert.equal(getClientIp(request({ "x-forwarded-for": "1.1.1.1, 198.51.100.7" })), "198.51.100.7")
assert.equal(getClientIp(request({})), "unknown")

// Internal tokens are bound to scope and user, and expire.
const headers = createInternalApiHeaders("background-job", "user-a")
assert.equal(headers[INTERNAL_API_USER_HEADER], "user-a")
assert.equal(getInternalApiUserId(request(headers), "background-job"), "user-a")
assert.equal(isInternalApiRequest(request(headers), "penetration-job"), false, "scope is bound")
assert.equal(
  getInternalApiUserId(request({ ...headers, [INTERNAL_API_USER_HEADER]: "user-b" }), "background-job"),
  null,
  "a token for one user cannot impersonate another",
)
const [version, expiresAt, signature] = headers[INTERNAL_API_TOKEN_HEADER].split(".")
assert.equal(
  isInternalApiRequest(request({ ...headers, [INTERNAL_API_TOKEN_HEADER]: `${version}.${Number(expiresAt) + 1}.${signature}` }), "background-job"),
  false,
  "expiry is covered by the signature",
)
const scopeOnly = createInternalApiHeaders("penetration-job")
assert.equal(scopeOnly[INTERNAL_API_USER_HEADER], undefined)
assert.equal(isInternalApiRequest(request(scopeOnly), "penetration-job"), true)
const originalNow = Date.now
try {
  Date.now = () => originalNow() + 10 * 60 * 1000
  assert.equal(isInternalApiRequest(request(headers), "background-job"), false, "tokens expire")
} finally {
  Date.now = originalNow
}
assert.equal(isInternalApiRequest(request({ [INTERNAL_API_TOKEN_HEADER]: "static-token" }), "background-job"), false)

// Reserved and internal address forms are rejected before any connection.
for (const url of [
  "http://127.0.0.1/",
  "http://10.0.0.8/",
  "http://100.100.100.200/latest/meta-data",
  "http://169.254.169.254/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::7f00:1]/",
  "http://[64:ff9b::a9fe:a9fe]/",
  "http://[2002:7f00:1::]/",
  "http://[fe80::1]/",
  "http://[fec0::1]/",
]) {
  await assert.rejects(() => validatePublicHttpUrl(url), /内网或保留地址/, url)
}
assert.equal((await validatePublicHttpUrl("http://[2002:808:808::]/")).hostname, "[2002:808:808::]")

// Settlement locks are mutually exclusive until released.
const release = await acquireJobSettlementLock("test", "job-1")
let secondAcquired = false
const second = acquireJobSettlementLock("test", "job-1").then(releaseSecond => {
  secondAcquired = true
  return releaseSecond
})
await new Promise(resolve => setTimeout(resolve, 200))
assert.equal(secondAcquired, false, "a second settlement waits for the first")
await release()
await (await second)()
assert.equal(secondAcquired, true)

fs.rmSync(tempDir, { recursive: true, force: true })
console.log("request security tests passed")
