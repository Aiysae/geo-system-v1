import { resolve } from "node:path"
import { existsSync } from "node:fs"
import type { AiCredentialVendor } from "../src/types/ai-credentials"

const VENDOR_BY_PLATFORM: Record<string, AiCredentialVendor> = {
  腾讯混元: "hunyuan",
  MiniMax: "minimax",
  智谱AI: "zhipu",
  "阿里千问（通义千问）": "qwen",
  DeepSeek: "deepseek",
  百度文心一言: "ernie",
  "Kimi（月之暗面）": "kimi",
  "豆包（字节跳动）": "doubao",
}

function argument(name: string): string {
  const index = process.argv.indexOf(name)
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : ""
}

function cell(value: unknown): string {
  return String(value || "").trim()
}

function modelNames(values: unknown[]): string[] {
  const models = values
    .flatMap(value => cell(value).split(/[、,，]+/))
    .map(value => value.trim())
    .filter(value =>
      value
      && !/暂无|内置|多模态能力|原生支持|全模态|视觉API|多模态API/.test(value))
  return [...new Set(models)]
}

function accountNumber(label: string): number {
  const match = label.match(/(\d+)/)
  return match ? Math.max(1, Number(match[1])) : 1
}

function chatPathForBase(baseUrl: string, fallback: string): string {
  try {
    const pathname = new URL(baseUrl).pathname.replace(/\/+$/, "")
    if (/\/(?:v1|v2|v3|v4|compatible-mode\/v1)$/i.test(pathname)) {
      return fallback.replace(/^\/(?:v1|v2|v3|v4)/i, "") || "/chat/completions"
    }
  } catch {
    // saveAiCredential performs the authoritative URL validation.
  }
  return fallback
}

const { listAiCredentialsPublic, saveAiCredential } = await import(
  "../src/lib/ai-credential-store"
)
const { AI_CREDENTIAL_PRESET_BY_VENDOR } = await import("../src/lib/ai-credential-presets")
const { readFirstXlsxWorksheet } = await import("./lib/read-xlsx-table")

const workbookPath = resolve(argument("--file"))
const apply = process.argv.includes("--apply")
if (!argument("--file") || !existsSync(workbookPath)) {
  throw new Error("请通过 --file 指定存在的 Excel 文件")
}

const rows = await readFirstXlsxWorksheet(workbookPath)
const candidates: Array<{
  vendor: AiCredentialVendor
  accountLabel: string
  apiKey: string
  baseUrl: string
  models: string[]
}> = []
let currentPlatform = ""
let currentBaseUrl = ""
let currentModels: string[] = []

for (const row of rows.slice(1)) {
  const platform = cell(row[0])
  if (platform) {
    currentPlatform = platform
    currentBaseUrl = cell(row[1])
    currentModels = modelNames([row[2], row[3], row[4]])
  }
  const vendor = VENDOR_BY_PLATFORM[currentPlatform]
  const apiKey = cell(row[5])
  const accountLabel = cell(row[6])
  if (!vendor || !apiKey || !accountLabel) continue
  candidates.push({
    vendor,
    accountLabel,
    apiKey,
    baseUrl: currentBaseUrl,
    models: currentModels,
  })
}

const summary = candidates.reduce<Record<string, number>>((result, item) => {
  result[item.vendor] = (result[item.vendor] || 0) + 1
  return result
}, {})
console.log(JSON.stringify({
  mode: apply ? "apply" : "preview",
  credentials: candidates.length,
  providers: summary,
}, null, 2))

if (!apply) {
  console.log("预览完成：加上 --apply 后才会加密导入，且所有新账号默认停用。")
  process.exit(0)
}

const existing = await listAiCredentialsPublic()
let imported = 0
for (const candidate of candidates) {
  const preset = AI_CREDENTIAL_PRESET_BY_VENDOR.get(candidate.vendor)
  if (!preset) continue
  const accountNo = accountNumber(candidate.accountLabel)
  const previous = existing.find(item =>
    item.vendor === candidate.vendor
    && item.accountLabel === candidate.accountLabel)
  await saveAiCredential({
    id: previous?.id,
    vendor: candidate.vendor,
    name: `${preset.label} · ${candidate.accountLabel}`,
    accountLabel: candidate.accountLabel,
    quotaGroup: `${candidate.vendor}-account-${accountNo}`,
    baseUrl: candidate.baseUrl || preset.baseUrl,
    chatPath: chatPathForBase(candidate.baseUrl || preset.baseUrl, preset.chatPath),
    apiKey: candidate.apiKey,
    enabled: false,
    priority: 100,
    weight: 100,
    maxConcurrency: preset.defaultConcurrency,
    quotaGroupMaxConcurrency: preset.defaultConcurrency,
    allowedModels: [...new Set([
      ...(candidate.models.length > 0 ? candidate.models : preset.defaultModels),
      ...preset.defaultModels,
    ])],
    allowedModules: preset.allowedModules,
    declaredCapabilities: preset.declaredCapabilities,
  }, "xlsx-import")
  imported += 1
}

console.log(JSON.stringify({
  imported,
  enabled: 0,
  message: "导入完成；请逐个执行能力检测后再启用。",
}, null, 2))
