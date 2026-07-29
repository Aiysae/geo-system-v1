import type {
  AiCredentialPublic,
  AiCredentialVendor,
} from "../src/types/ai-credentials"

function readArg(name: string): string {
  const inline = process.argv.find(value => value.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1).trim()
  const index = process.argv.indexOf(name)
  if (index < 0) return ""
  const value = process.argv[index + 1] || ""
  return value.startsWith("--") ? "" : value.trim()
}

const supportedVendors = new Set<AiCredentialVendor>([
  "doubao",
  "qwen",
  "hunyuan",
  "deepseek",
  "kimi",
  "ernie",
  "minimax",
  "zhipu",
])
const enablePassed = process.argv.includes("--enable-passed")
const verifyStrictWeb = process.argv.includes("--strict-web")
const includeEnabled = process.argv.includes("--all")
const verifyAllModels = process.argv.includes("--all-models")
const strictOnly = process.argv.includes("--strict-only")
const vendorValue = readArg("--vendor")
const accountFilter = readArg("--account").toLocaleLowerCase()
const modelFilter = readArg("--model")
if (vendorValue && !supportedVendors.has(vendorValue as AiCredentialVendor)) {
  throw new Error(`不支持的供应商筛选：${vendorValue}`)
}
if (strictOnly && !verifyStrictWeb) {
  throw new Error("--strict-only 必须与 --strict-web 一起使用")
}
const vendorFilter = vendorValue as AiCredentialVendor | ""

const {
  closeAiCredentialStoreConnection,
  listAiCredentialsPublic,
  setAiCredentialEnabled,
} = await import("../src/lib/ai-credential-store")
const { closeKvConnection } = await import("../src/lib/kv")
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
  models?: {
    basic?: Array<{
      model: string
      status: string
      latencyMs: number
      capabilities: string[]
      error?: string
    }>
    strictWeb?: Array<{
      model: string
      status: string
      latencyMs: number
      capabilities: string[]
      error?: string
    }>
  }
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
  .filter(credential => !vendorFilter || credential.vendor === vendorFilter)
  .filter(credential => {
    if (!accountFilter) return true
    return [
      credential.id,
      credential.name,
      credential.accountLabel,
      credential.quotaGroup,
    ].some(value => value.toLocaleLowerCase().includes(accountFilter))
  })
  .filter(credential => !modelFilter || credential.allowedModels.includes(modelFilter))
const rows: VerificationRow[] = []
if (credentials.length === 0) {
  throw new Error("没有找到符合筛选条件的模型账号，未执行任何验证")
}

for (const credential of credentials) {
  const row: VerificationRow = {
    vendor: credential.vendor,
    account: credential.accountLabel,
    basic: "skipped",
    strictWeb: "skipped",
    enabled: credential.enabled,
  }
  try {
    const basic = strictOnly ? null : await verifyAiCredentialChat(credential.id, {
      allModels: verifyAllModels,
    })
    if (basic) {
      row.basic = "passed"
      row.models = { basic: basic.models }
    }
    if (enablePassed && !credential.enabled && !verifyStrictWeb) {
      await setAiCredentialEnabled(credential.id, true, "credential-verification-script")
      row.enabled = true
    }

    if (verifyStrictWeb && supportsStrictWeb(credential)) {
      try {
        const strictWeb = await verifyAiCredentialWeb(credential.id, {
          allModels: modelFilter ? false : verifyAllModels,
          model: modelFilter || undefined,
        })
        row.strictWeb = "passed"
        row.models = {
          ...row.models,
          strictWeb: strictWeb.models,
        }
        if (enablePassed && !credential.enabled) {
          await setAiCredentialEnabled(credential.id, true, "credential-verification-script")
          row.enabled = true
        }
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
  verifyAllModels,
  strictOnly,
  filters: {
    vendor: vendorFilter || undefined,
    account: accountFilter || undefined,
    model: modelFilter || undefined,
  },
  providers: summary,
}, null, 2))

await Promise.allSettled([
  closeAiCredentialStoreConnection(),
  closeKvConnection(),
])
