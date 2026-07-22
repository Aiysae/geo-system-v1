import assert from "node:assert/strict"
import fs from "node:fs/promises"

const requestIdModule = await import("../src/lib/background-job-client") as typeof import("../src/lib/background-job-client") & {
  default?: typeof import("../src/lib/background-job-client")
}
const { createBackgroundRequestId } = requestIdModule.default || requestIdModule

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto")

function replaceCrypto(value: unknown): void {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value,
  })
}

try {
  replaceCrypto(undefined)
  assert.match(
    createBackgroundRequestId("report"),
    /^report_\d+_[a-z0-9]+$/,
    "the request id must fall back when Web Crypto is unavailable",
  )

  replaceCrypto({ randomUUID: undefined })
  assert.match(
    createBackgroundRequestId("report"),
    /^report_\d+_[a-z0-9]+$/,
    "the request id must fall back when randomUUID is unavailable",
  )

  replaceCrypto({ randomUUID: () => "12345678-1234-1234-1234-123456789abc" })
  assert.equal(
    createBackgroundRequestId("report"),
    "report_12345678123412341234123456789abc",
  )
} finally {
  if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto)
  else Reflect.deleteProperty(globalThis, "crypto")
}

const reportDialogSource = await fs.readFile(
  new URL("../src/components/reports/report-export-dialog.tsx", import.meta.url),
  "utf8",
)

assert.match(reportDialogSource, /createBackgroundRequestId\("report"\)/)
assert.doesNotMatch(reportDialogSource, /crypto\.randomUUID\(/)
