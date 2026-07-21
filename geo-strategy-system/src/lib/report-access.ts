import "server-only"

import { isAdminUser } from "@/lib/admin"
import { getUserById } from "@/lib/auth"
import {
  getMembershipWithPaymentRepair,
} from "@/lib/membership"
import { getFeaturePrice } from "@/lib/pricing"
import type { ReportBrandingAccess } from "@/types"

export type { ReportBrandingAccess } from "@/types"

export async function getReportBrandingAccess(userId: string): Promise<ReportBrandingAccess> {
  const [user, membership] = await Promise.all([
    getUserById(userId),
    getMembershipWithPaymentRepair(userId),
  ])
  const admin = isAdminUser(user)
  return {
    membership,
    canUseCustomBranding: admin || membership.active,
    accessSource: admin ? "admin" : membership.active ? "membership" : "none",
    customReportCredits: admin ? 0 : getFeaturePrice("reportCustomBranding").credits,
  }
}
