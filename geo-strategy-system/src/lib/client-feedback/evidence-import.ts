import type { ClientEvidenceImportRowInput } from "@/types/client-feedback"
import {
  resolveSourcePlatformByName,
  resolveSourcePlatformByUrl,
} from "@/lib/source-platform-registry"

export const MAX_EVIDENCE_IMPORT_ROWS = 200
export const MAX_EVIDENCE_TITLE_LENGTH = 160
export const MAX_EVIDENCE_URL_LENGTH = 1_000
export const MAX_EVIDENCE_PLATFORM_LENGTH = 120

export type EvidenceImportRowDraft = ClientEvidenceImportRowInput & {
  rowNumber: number
  normalizedUrl: string
  inferredPlatform: string
  inferredPlatformKey: string
  error?: string
}

const TRACKING_PARAM_PATTERN = /^(utm_.+|spm|from|from_source|share_token|track|source|ref)$/i
const URL_TOKEN_PATTERN = /https?:\/\/[^\s|，]+/gi

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts.every(part => part === 0)
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  const isIpv6 = host.includes(":")
  return host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host === "::1"
    || (isIpv6 && (
      host.startsWith("fc")
      || host.startsWith("fd")
      || host.startsWith("fe80:")
    ))
    || isPrivateIpv4(host)
}

function cleanPastedUrl(value: string): string {
  return value
    .trim()
    .replace(/^[<（(\[]+/, "")
    .replace(/[>）)\]，。,；;、]+$/g, "")
}

export function normalizeExecutionEvidenceUrl(rawUrl: string): string | null {
  const value = cleanPastedUrl(rawUrl)
  if (!value || value.length > MAX_EVIDENCE_URL_LENGTH) return null
  try {
    const parsed = new URL(value)
    if (!["http:", "https:"].includes(parsed.protocol)) return null
    if (parsed.username || parsed.password || isPrivateHostname(parsed.hostname)) return null
    parsed.hash = ""
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (TRACKING_PARAM_PATTERN.test(key)) parsed.searchParams.delete(key)
    }
    parsed.searchParams.sort()
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "")
    return parsed.toString()
  } catch {
    return null
  }
}

export function inferEvidencePlatform(rawUrl: string): string {
  const normalizedUrl = normalizeExecutionEvidenceUrl(rawUrl)
  if (!normalizedUrl) return ""
  return resolveSourcePlatformByUrl(normalizedUrl)?.name || ""
}

export function inferEvidencePlatformKey(rawUrl: string): string {
  const normalizedUrl = normalizeExecutionEvidenceUrl(rawUrl)
  if (!normalizedUrl) return ""
  return resolveSourcePlatformByUrl(normalizedUrl)?.key || ""
}

function rowError(row: ClientEvidenceImportRowInput): string | undefined {
  const title = String(row.title || "").normalize("NFKC").trim()
  const url = String(row.url || "").trim()
  const platform = String(row.platform || "").normalize("NFKC").trim()
  if (!title) return "请填写标题"
  if (title.length > MAX_EVIDENCE_TITLE_LENGTH) {
    return `标题不能超过 ${MAX_EVIDENCE_TITLE_LENGTH} 个字符`
  }
  if (!url) return "请填写证据网址"
  if (url.length > MAX_EVIDENCE_URL_LENGTH) {
    return `网址不能超过 ${MAX_EVIDENCE_URL_LENGTH} 个字符`
  }
  if (!normalizeExecutionEvidenceUrl(url)) return "请填写客户可访问的 http/https 公网网址"
  if (platform.length > MAX_EVIDENCE_PLATFORM_LENGTH) {
    return `平台名称不能超过 ${MAX_EVIDENCE_PLATFORM_LENGTH} 个字符`
  }
  return undefined
}

export function validateEvidenceImportRows(
  rows: ClientEvidenceImportRowInput[],
): EvidenceImportRowDraft[] {
  const seen = new Map<string, number>()
  return rows.map((row, index) => {
    const rowNumber = index + 1
    const title = String(row.title || "").normalize("NFKC").trim()
    const rawUrl = String(row.url || "").trim()
    const normalizedUrl = normalizeExecutionEvidenceUrl(rawUrl) || ""
    const resolution = resolveSourcePlatformByUrl(normalizedUrl)
    const inferredPlatform = resolution?.name || ""
    const inferredPlatformKey = resolution?.key || ""
    const requestedPlatform = String(row.platform || inferredPlatform).normalize("NFKC").trim()
    const requestedDefinition = resolveSourcePlatformByName(requestedPlatform)
    let error = rowError({ ...row, title, url: rawUrl })
    if (!error && normalizedUrl) {
      const duplicateRow = seen.get(normalizedUrl)
      if (duplicateRow) error = `与第 ${duplicateRow} 行网址重复`
      else seen.set(normalizedUrl, rowNumber)
    }
    return {
      rowNumber,
      title,
      url: rawUrl,
      normalizedUrl,
      inferredPlatform,
      inferredPlatformKey,
      platform: requestedDefinition?.name || requestedPlatform,
      platformKey: String(row.platformKey || requestedDefinition?.key || inferredPlatformKey).trim(),
      error,
    }
  })
}

export function parseEvidenceImportText(rawText: string): EvidenceImportRowDraft[] {
  const rows: ClientEvidenceImportRowInput[] = []
  const multipleUrlRows = new Set<number>()
  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const matches = Array.from(line.matchAll(URL_TOKEN_PATTERN))
    const firstUrl = matches[0]?.[0] || ""
    const title = firstUrl
      ? line
          .replace(firstUrl, "")
          .replace(/^[\s\t|｜,，:：;；\-—]+|[\s\t|｜,，:：;；\-—]+$/g, "")
      : line
    rows.push({
      title,
      url: firstUrl,
      platform: firstUrl ? inferEvidencePlatform(firstUrl) : "",
    })
    if (matches.length > 1) multipleUrlRows.add(rows.length - 1)
  }
  const overflowCount = Math.max(0, rows.length - MAX_EVIDENCE_IMPORT_ROWS)
  const acceptedRows = rows.slice(0, MAX_EVIDENCE_IMPORT_ROWS)
  const validated = validateEvidenceImportRows(acceptedRows).map((row, index) => (
    multipleUrlRows.has(index) ? { ...row, error: "每行只能填写一个网址" } : row
  ))
  if (overflowCount > 0) {
    validated.push({
      rowNumber: MAX_EVIDENCE_IMPORT_ROWS + 1,
      title: `其余 ${overflowCount} 条未载入`,
      url: "",
      normalizedUrl: "",
      inferredPlatform: "",
      inferredPlatformKey: "",
      platformKey: "",
      platform: "",
      error: `单次最多导入 ${MAX_EVIDENCE_IMPORT_ROWS} 条，请分批导入剩余内容`,
    })
  }
  return validated
}
