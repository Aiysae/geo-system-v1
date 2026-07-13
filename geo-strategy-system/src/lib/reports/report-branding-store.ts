import "server-only"

import { kv } from "@/lib/kv"
import { DEFAULT_REPORT_BRANDING } from "@/lib/report-branding"
import { validateReportBranding } from "@/lib/report-branding-validation"
import type { ReportBrandingSettings } from "@/types"

type StoredReportBranding = ReportBrandingSettings & { updatedAt: string }

export { ReportBrandingValidationError, validateReportBranding } from "@/lib/report-branding-validation"

function brandingKey(userId: string): string {
  return `geo:report-branding:${userId}`
}

export async function getReportBranding(userId: string): Promise<ReportBrandingSettings> {
  const stored = await kv.get<StoredReportBranding>(brandingKey(userId))
  if (!stored) return { ...DEFAULT_REPORT_BRANDING }
  try {
    return validateReportBranding(stored)
  } catch {
    return { ...DEFAULT_REPORT_BRANDING }
  }
}

export async function saveReportBranding(
  userId: string,
  value: unknown,
): Promise<ReportBrandingSettings> {
  const branding = validateReportBranding(value)
  await kv.set(brandingKey(userId), { ...branding, updatedAt: new Date().toISOString() })
  return branding
}
