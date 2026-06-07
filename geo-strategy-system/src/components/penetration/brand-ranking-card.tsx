"use client"

import { Trophy, TrendingDown } from "lucide-react"
import { MODEL_LABELS } from "@/lib/llm"
import ModelAvatar from "@/components/model-avatar"
import type { PerModelRate } from "@/types"

interface Props {
  ranking: number | null
  totalBrands: number
  perModelRate: PerModelRate[]
  topCompetitors: string[]
}

export default function BrandRankingCard({
  ranking,
  totalBrands,
  perModelRate,
  topCompetitors,
}: Props) {
  const inIndustry = ranking != null
  return (
    <div className="space-y-4">
      <div className="text-center py-3">
        {inIndustry ? (
          <>
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500 mb-1">
              <Trophy className="h-3.5 w-3.5" /> 行业实时排位
            </div>
            <div className="text-5xl font-bold text-[#004B73]">
              第 {ranking} <span className="text-2xl text-slate-400">/ {totalBrands}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2 text-xs text-amber-600 mb-1">
              <TrendingDown className="h-3.5 w-3.5" /> 未进入行业推荐
            </div>
            <div className="text-3xl font-bold text-slate-400">未上榜</div>
          </>
        )}
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-2">
          各模型提及率
        </div>
        <div className="space-y-1.5">
          {perModelRate.map(p => {
            const pct = Math.round(p.rate * 1000) / 10
            return (
              <div key={p.model} className="flex items-center gap-2 text-xs">
                <span className="flex w-20 items-center gap-1.5 text-slate-600">
                  <ModelAvatar model={p.model} size="xs" />
                  <span className="truncate">{MODEL_LABELS[p.model]}</span>
                </span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#004B73] rounded-full"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <span className="w-12 text-right tabular-nums text-slate-700 font-medium">
                  {pct}%
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {topCompetitors.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-2">
            主要竞品 Top {topCompetitors.length}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {topCompetitors.map(c => (
              <span
                key={c}
                className="text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
