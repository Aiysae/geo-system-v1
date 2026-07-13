import type { ReportBrandingSettings } from "@/types"

export const SHITU_REPORT_WEBSITE = "https://shitugeo.top"

export const DEFAULT_REPORT_BRANDING: ReportBrandingSettings = {
  mode: "shitu",
  companyName: "杭州势途数字科技有限公司",
  website: SHITU_REPORT_WEBSITE,
}

export function resolveReportBranding(value?: Partial<ReportBrandingSettings> | null): ReportBrandingSettings {
  if (value?.mode !== "custom") return { ...DEFAULT_REPORT_BRANDING }
  const companyName = String(value.companyName || "").trim()
  if (!companyName) return { ...DEFAULT_REPORT_BRANDING }
  const website = String(value.website || "").trim()
  const logoDataUrl = String(value.logoDataUrl || "").trim()
  return {
    mode: "custom",
    companyName,
    website,
    logoDataUrl: logoDataUrl || undefined,
  }
}

export function reportPublisherLabel(branding: ReportBrandingSettings): string {
  return branding.mode === "shitu" ? "势途 GEO" : branding.companyName
}
