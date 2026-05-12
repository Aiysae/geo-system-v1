"use client"

interface Props {
  score: number
}

export default function GemScorePanel({ score }: Props) {
  const tier =
    score >= 80 ? { label: "优秀", color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" }
    : score >= 60 ? { label: "良好", color: "text-[#004B73]", bg: "bg-[#004B73]/5", border: "border-[#004B73]/20" }
    : score >= 40 ? { label: "及格", color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" }
    : { label: "待提升", color: "text-red-600", bg: "bg-red-50", border: "border-red-200" }

  return (
    <div className={`rounded-2xl border ${tier.border} ${tier.bg} p-6 text-center`}>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
        GEM Score · 全局预估分
      </div>
      <div className={`text-6xl font-bold ${tier.color} leading-none`}>{score}</div>
      <div className="text-slate-400 text-xs mt-1">/ 100</div>
      <div className={`inline-block mt-3 px-2.5 py-0.5 text-xs font-medium rounded-full ${tier.color} bg-white border ${tier.border}`}>
        {tier.label}
      </div>
    </div>
  )
}
