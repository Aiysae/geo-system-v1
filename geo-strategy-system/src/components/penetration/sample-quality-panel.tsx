"use client"

import {
  PENETRATION_QUESTION_CATEGORY_LABELS,
} from "@/lib/penetration/sample-design"
import type { PenetrationAggregated } from "@/types"

function percent(value: number | undefined): string {
  return `${Math.round(Math.max(0, value || 0) * 100)}%`
}

const CONFIDENCE_TONES = {
  high: {
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    bar: "bg-emerald-500",
  },
  medium: {
    badge: "border-amber-200 bg-amber-50 text-amber-700",
    bar: "bg-amber-500",
  },
  low: {
    badge: "border-rose-200 bg-rose-50 text-rose-700",
    bar: "bg-rose-500",
  },
} as const

export default function PenetrationSampleQualityPanel({
  aggregated,
  compact = false,
}: {
  aggregated: PenetrationAggregated
  compact?: boolean
}) {
  const quality = aggregated.sampleQuality
  if (!quality) return null
  const tone = CONFIDENCE_TONES[quality.confidence]
  const source = quality.sourceDiversity
  const maxCategoryCount = Math.max(
    1,
    ...quality.categoryCounts.map(item => item.questionCount),
  )

  return (
    <section className="overflow-hidden rounded-lg border border-[#CFE1F5] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E5EEF8] bg-[#F7FBFF] px-4 py-3">
        <div>
          <h3 className="text-xs font-semibold text-[#17324D]">检测可信度</h3>
          <p className="mt-0.5 text-[10px] leading-4 text-[#70869C]">
            综合问题覆盖、完成度和来源分布，避免相似问题或重复来源放大结果。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {quality.scopeMode === "focused" ? (
            <span className="rounded-full border border-[#91CAFF] bg-[#E6F4FF] px-2.5 py-1 text-[10px] font-semibold text-[#0958D9]">
              专项意图检测
            </span>
          ) : (
            <span className="rounded-full border border-[#B7E3D0] bg-[#F0FFF8] px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
              综合意图检测
            </span>
          )}
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${tone.badge}`}>
            {quality.confidenceLabel} · {quality.score} 分
          </span>
        </div>
      </div>

      <div className={`grid divide-x divide-y divide-[#EAF1F8] sm:divide-y-0 ${compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 lg:grid-cols-5"}`}>
        <Metric label="品牌被提及率" value={percent(aggregated.penetrationRate)} />
        <Metric label="问题覆盖质量" value={percent(aggregated.intentBalancedRate)} />
        <Metric label="问题类型均衡度" value={percent(aggregated.categoryBalancedRate)} />
        <Metric
          label="检测完成度"
          value={percent(aggregated.completionRate)}
          note={`${quality.completedSlots}/${quality.plannedSlots}`}
        />
        {!compact ? (
          <Metric
            label="有效问题类型 / 问题总数"
            value={`${quality.semanticIntentCount}/${quality.questionCount}`}
            note={`覆盖 ${quality.categoryCoverageCount}/7 类`}
          />
        ) : null}
      </div>

      {!compact ? (
        <div className="grid gap-4 border-t border-[#EAF1F8] px-4 py-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(240px,.65fr)]">
          <div>
            <div className="mb-2 text-[10px] font-semibold text-[#526A83]">七类问题分布</div>
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {quality.categoryCounts.map(item => (
                <div key={item.category} className="grid grid-cols-[78px_minmax(0,1fr)_28px] items-center gap-2">
                  <span className="truncate text-[9px] text-[#60758A]">
                    {PENETRATION_QUESTION_CATEGORY_LABELS[item.category]}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-sm bg-[#EAF2FB]">
                    <span
                      className={`block h-full rounded-sm ${tone.bar}`}
                      style={{ width: `${(item.questionCount / maxCategoryCount) * 100}%` }}
                    />
                  </span>
                  <span className="text-right text-[9px] tabular-nums text-[#60758A]">{item.questionCount}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[10px] font-semibold text-[#526A83]">信源多样性</div>
            <div className="grid grid-cols-3 gap-2">
              <MiniMetric label="引用次数" value={source?.citationEvents || 0} />
              <MiniMetric label="不同网址" value={source?.uniqueUrlCount || 0} />
              <MiniMetric label="不同网站" value={source?.uniqueDomainCount || 0} />
            </div>
            {source && source.citationEvents > 0 ? (
              <div className="mt-2 text-[9px] leading-4 text-[#70869C]">
                重复引用占比 {percent(source.duplicateCitationRate)}
                {source.topDomain ? ` · 引用最多的网站 ${source.topDomain}（${percent(source.topDomainShare)}）` : ""}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {quality.warnings.length > 0 ? (
        <div className="border-t border-amber-100 bg-amber-50/70 px-4 py-2.5 text-[10px] leading-5 text-amber-800">
          {quality.warnings.slice(0, compact ? 1 : 3).join(" ")}
        </div>
      ) : null}
    </section>
  )
}

function Metric({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string
}) {
  return (
    <div className="min-w-0 px-3 py-3 text-center">
      <div className="text-[9px] text-[#7A8EA3]">{label}</div>
      <div className="mt-1 truncate text-base font-bold tabular-nums text-[#17324D]">{value}</div>
      {note ? <div className="mt-0.5 text-[9px] text-[#91A2B4]">{note}</div> : null}
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-[#F5FAFF] px-2 py-2 text-center">
      <div className="text-sm font-bold tabular-nums text-[#0958D9]">{value}</div>
      <div className="mt-0.5 text-[9px] text-[#7A8EA3]">{label}</div>
    </div>
  )
}
