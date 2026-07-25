import type {
  AiCredentialPublic,
  AiCredentialVendor,
} from "../src/types/ai-credentials"

const enablePassed = process.argv.includes("--enable-passed")
const verifyStrictWeb = process.argv.includes("--strict-web")
const includeEnabled = process.argv.includes("--all")

const {
  listAiCredentialsPublic,
  setAiCredentialEnabled,
} = await import("../src/lib/ai-credential-store")
const { verifyAiCredentialChat } = await import("../src/lib/ai-credential-verification")
const { verifyAiCredentialWeb } = await import("../src/lib/ai-credential-web-verification")

type VerificationState = "passed" | "failed" | "skipped"

interface VerificationRow {
  vendor: AiCredentialVendor
  account: string
  basic: VerificationState
  strictWeb: VerificationState
  enabled: boolean
  error?: string
}

function supportsStrictWeb(credential: AiCredentialPublic): boolean {
  return credential.declaredCapabilities.includes("native_web")
    && credential.declaredCapabilities.includes("auditable_sources")
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "检测失败"))
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._/-]{12,}/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .slice(0, 220)
}

const credentials = (await listAiCredentialsPublic())
  .filter(credential => includeEnabled || !credential.enabled)
const rows: VerificationRow[] = []

for (const credential of credentials) {
  const row: VerificationRow = {
    vendor: credential.vendor,
    account: credential.accountLabel,
    basic: "skipped",
    strictWeb: "skipped",
    enabled: credential.enabled,
  }
  try {
    await verifyAiCredentialChat(credential.id)
    row.basic = "passed"
    if (enablePassed && !credential.enabled) {
      await setAiCredentialEnabled(credential.id, true, "credential-verification-script")
      row.enabled = true
    }

    if (verifyStrictWeb && supportsStrictWeb(credential)) {
      try {
        await verifyAiCredentialWeb(credential.id)
        row.strictWeb = "passed"
      } catch (error) {
        row.strictWeb = "failed"
        row.error = safeError(error)
      }
    }
  } catch (error) {
    row.basic = "failed"
    row.error = safeError(error)
    if (enablePassed && credential.enabled) {
      await setAiCredentialEnabled(credential.id, false, "credential-verification-script")
      row.enabled = false
    }
  }
  rows.push(row)
  console.log(JSON.stringify(row))
}

const summary = rows.reduce<Record<string, {
  total: number
  basicPassed: number
  strictWebPassed: number
  enabled: number
}>>((result, row) => {
  const current = result[row.vendor] || {
    total: 0,
    basicPassed: 0,
    strictWebPassed: 0,
    enabled: 0,
  }
  current.total += 1
  if (row.basic === "passed") current.basicPassed += 1
  if (row.strictWeb === "passed") current.strictWebPassed += 1
  if (row.enabled) current.enabled += 1
  result[row.vendor] = current
  return result
}, {})

console.log(JSON.stringify({
  checked: rows.length,
  enablePassed,
  verifyStrictWeb,
  providers: summary,
}, null, 2))
