"use client"

import { Sparkles } from "lucide-react"
import { estimateFeatureCredits, getFeaturePrice, type FeaturePriceKey } from "@/lib/pricing"

type CreditCostBadgeProps = {
  featureKey: FeaturePriceKey
  units?: number
  label?: string
  className?: string
}

export function CreditCostBadge({
  featureKey,
  units = 1,
  label = "预计消耗",
  className = "",
}: CreditCostBadgeProps) {
  const price = getFeaturePrice(featureKey)
  const credits = estimateFeatureCredits(featureKey, units)

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 ${className}`}
      title={`${price.label}：${price.credits} 积分/${price.unitLabel}`}
    >
      <Sparkles className="h-3 w-3" />
      {label} {credits} 积分
    </span>
  )
}
