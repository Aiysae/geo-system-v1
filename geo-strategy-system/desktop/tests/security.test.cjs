const assert = require("node:assert/strict")
const test = require("node:test")
const {
  isSafeExternalUrl,
  isTrustedAppUrl,
  normalizeAppUrl,
  resolveDesktopDeepLink,
  safeInternalUrl,
  sanitizeFilename,
  sanitizeNotification,
} = require("../src/security.cjs")

test("production and local development URLs are explicitly constrained", () => {
  assert.equal(normalizeAppUrl("https://shitugeo.top/workspace"), "https://shitugeo.top/workspace")
  assert.equal(
    normalizeAppUrl("http://localhost:3000", { allowLocalhost: true }),
    "http://localhost:3000/",
  )
  assert.throws(() => normalizeAppUrl("http://shitugeo.top"))
  assert.throws(() => normalizeAppUrl("https://shitugeo.top@example.com"))
  assert.throws(() => normalizeAppUrl("https://example.com"))
})

test("internal navigation allows only the configured application", () => {
  const appUrl = "https://shitugeo.top/"
  assert.equal(isTrustedAppUrl("https://www.shitugeo.top/workspace", appUrl), true)
  assert.equal(isTrustedAppUrl("blob:https://shitugeo.top/123", appUrl), true)
  assert.equal(isTrustedAppUrl("https://example.com", appUrl), false)
  assert.equal(safeInternalUrl("/account", appUrl), "https://shitugeo.top/account")
  assert.equal(safeInternalUrl("javascript:alert(1)", appUrl), undefined)
  assert.equal(
    resolveDesktopDeepLink("shitugeo://open?path=%2Fworkspace%3Fmodule%3Dpenetration", appUrl),
    "https://shitugeo.top/workspace?module=penetration",
  )
  assert.equal(resolveDesktopDeepLink("shitugeo://open?url=https%3A%2F%2Fexample.com", appUrl), undefined)
})

test("external links reject executable and credential-bearing URLs", () => {
  assert.equal(isSafeExternalUrl("https://open.alipay.com"), true)
  assert.equal(isSafeExternalUrl("mailto:support@example.com"), true)
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false)
  assert.equal(isSafeExternalUrl("file:///etc/passwd"), false)
  assert.equal(isSafeExternalUrl("https://user:secret@example.com"), false)
})

test("desktop notification payloads are length-limited and same-origin", () => {
  const payload = sanitizeNotification({
    id: "task-1",
    title: "任务已完成",
    body: "报告已生成",
    actionUrl: "/workspace?module=penetration",
  }, "https://shitugeo.top/")
  assert.equal(payload.actionUrl, "https://shitugeo.top/workspace?module=penetration")
  assert.equal(
    sanitizeNotification({ title: "x", body: "y", actionUrl: "https://example.com" }, "https://shitugeo.top/").actionUrl,
    undefined,
  )
  assert.equal(sanitizeNotification({ title: "", body: "missing" }, "https://shitugeo.top/"), null)
})

test("download filenames cannot escape the selected directory", () => {
  assert.equal(sanitizeFilename("../../report:final.pdf"), "..-..-report-final.pdf")
  assert.equal(sanitizeFilename("\u0000"), "势途-GEO-下载文件")
})
