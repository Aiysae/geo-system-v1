"use client"

import { Trophy, TrendingDown } from "lucide-react"
import { MODEL_LABELS } from "@/lib/model-labels"
import ModelAvatar from "@/components/model-avatar"
import type { AnalysisSubjectType, PerModelRate } from "@/types"

interface Props {
  ranking: number | null
  totalBrands: number
  perModelRate: PerModelRate[]
  topCompetitors: string[]
  subjectType?: AnalysisSubjectType
}

const MODEL_BAR: Record<string, string> = {
  doubao: "bg-gradient-to-r from-sky-400 to-cyan-300",
  deepseek: "bg-gradient-to-r from-indigo-500 to-violet-400",
  qwen: "bg-gradient-to-r from-fuchsia-500 to-pink-400",
  kimi: "bg-gradient-to-r from-slate-500 to-slate-400",
  ernie: "bg-gradient-to-r from-emerald-500 to-teal-400",
  hunyuan: "bg-gradient-to-r from-rose-500 to-orange-400",
}

export default function BrandRankingCard({
  ranking,
  totalBrands,
  perModelRate,
  topCompetitors,
  subjectType = "brand",
}: Props) {
  const inIndustry = ranking != null
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-gradient-to-br from-[#001D66] via-[#002c70] to-[#003EB3] px-4 py-4 text-center text-white">
        {inIndustry ? (
          <>
            <div className="flex items-center justify-center gap-2 text-xs text-cyan-100/70 mb-1">
              <Trophy className="h-3.5 w-3.5" />
              {subjectType === "person" ? "同行人物实时排位" : "行业实时排位"}
            </div>
            <div className="text-5xl font-bold text-white">
              第 {ranking} <span className="text-2xl text-cyan-100/45">/ {totalBrands}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2 text-xs text-amber-600 mb-1">
              <TrendingDown className="h-3.5 w-3.5" />
              {subjectType === "person" ? "未进入同行人物推荐" : "未进入行业推荐"}
            </div>
            <div className="text-3xl font-bold text-white/60">未上榜</div>
          </>
        )}
      </div>

      <div>
        <div className="geo-section-kicker mb-2">
          各模型提及率
        </div>
        <div className="space-y-1.5">
          {perModelRate.map(p => {
            const pct = Math.round(p.rate * 1000) / 10
            const hasValidAnswer = p.total > 0
            return (
              <div key={p.model} className="flex items-center gap-2 text-xs">
                <span className="flex w-20 items-center gap-1.5 text-slate-600">
                  <ModelAvatar model={p.model} size="xs" />
                  <span className="truncate">{MODEL_LABELS[p.model]}</span>
                </span>
                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden ring-1 ring-slate-200/70">
                  <div
                    className={`h-full rounded-full ${MODEL_BAR[p.model] || "bg-gradient-to-r from-[#1677FF] to-[#00C8FF]"}`}
                    style={{ width: `${hasValidAnswer ? Math.min(pct, 100) : 0}%` }}
                  />
                </div>
                <span
                  className={`w-20 text-right tabular-nums font-medium ${
                    hasValidAnswer ? "text-slate-700" : "text-red-500"
                  }`}
                >
                  {hasValidAnswer ? `${p.mentions}/${p.total} · ${pct}%` : "调用失败"}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {topCompetitors.length > 0 && (
        <div>
          <div className="geo-section-kicker mb-2">
            {subjectType === "person" ? "主要同行人物" : "主要竞品"} Top {topCompetitors.length}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {topCompetitors.map(c => (
              <span
                key={c}
                className="text-xs px-2 py-0.5 bg-gradient-to-r from-slate-100 to-cyan-50 text-slate-700 rounded-md ring-1 ring-slate-200/70"
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
