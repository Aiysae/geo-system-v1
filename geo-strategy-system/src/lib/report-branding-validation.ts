import { DEFAULT_REPORT_BRANDING } from "@/lib/report-branding"
import type { ReportBrandingSettings } from "@/types"

const MAX_LOGO_BYTES = 600 * 1024
const MAX_LOGO_DIMENSION = 2_400
const MIN_LOGO_DIMENSION = 16

export class ReportBrandingValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReportBrandingValidationError"
  }
}

function cleanCompanyName(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 120)
    : ""
}

function normalizedWebsite(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().slice(0, 2_000) : ""
  if (!raw) return ""
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol")
    }
    parsed.username = ""
    parsed.password = ""
    return parsed.toString()
  } catch {
    throw new ReportBrandingValidationError("公司官网格式不正确，请填写可访问的网址")
  }
}

function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2
      continue
    }
    if (offset + 4 > buffer.length) return null
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2 || offset + 2 + length > buffer.length) return null
    if (startOfFrame.has(marker) && length >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      }
    }
    offset += 2 + length
  }
  return null
}

function validatedLogoDataUrl(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return undefined
  const match = raw.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!match) throw new ReportBrandingValidationError("Logo 仅支持 PNG 或 JPG 图片")
  const buffer = Buffer.from(match[2], "base64")
  if (buffer.length === 0 || buffer.length > MAX_LOGO_BYTES) {
    throw new ReportBrandingValidationError("Logo 处理后不能超过 600KB")
  }
  const dimensions = match[1] === "image/png" ? pngDimensions(buffer) : jpegDimensions(buffer)
  if (!dimensions) throw new ReportBrandingValidationError("Logo 图片内容损坏或格式不受支持")
  if (
    dimensions.width < MIN_LOGO_DIMENSION
    || dimensions.height < MIN_LOGO_DIMENSION
    || dimensions.width > MAX_LOGO_DIMENSION
    || dimensions.height > MAX_LOGO_DIMENSION
  ) {
    throw new ReportBrandingValidationError("Logo 尺寸应在 16×16 至 2400×2400 像素之间")
  }
  return `data:${match[1]};base64,${buffer.toString("base64")}`
}

export function validateReportBranding(value: unknown): ReportBrandingSettings {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  if (source.mode !== "custom") return { ...DEFAULT_REPORT_BRANDING }
  const companyName = cleanCompanyName(source.companyName)
  if (!companyName) throw new ReportBrandingValidationError("请填写报告出品方的公司名称")
  return {
    mode: "custom",
    companyName,
    website: normalizedWebsite(source.website),
    logoDataUrl: validatedLogoDataUrl(source.logoDataUrl),
  }
}
