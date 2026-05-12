"use client"

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts"

interface Props {
  rate: number
  mentions: number
  totalSlots: number
}

export default function PenetrationDonut({ rate, mentions, totalSlots }: Props) {
  const pct = Math.round(rate * 1000) / 10
  const data = [
    { name: "mentioned", value: mentions },
    { name: "missed", value: Math.max(totalSlots - mentions, 0) },
  ]
  // 防止 totalSlots=0 时图形塌掉
  const safeData = totalSlots === 0 ? [{ name: "empty", value: 1 }] : data

  return (
    <div className="relative w-full h-52 min-h-[208px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <defs>
            <linearGradient id="donutMentioned" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#004B73" />
              <stop offset="45%" stopColor="#0077B6" />
              <stop offset="80%" stopColor="#00B4D8" />
              <stop offset="100%" stopColor="#48cae4" />
            </linearGradient>
            <linearGradient id="donutMissed" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#e2e8f0" />
              <stop offset="100%" stopColor="#f1f5f9" />
            </linearGradient>
            <radialGradient id="donutGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00B4D8" stopOpacity={0.35} />
              <stop offset="60%" stopColor="#0077B6" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#004B73" stopOpacity={0} />
            </radialGradient>
            <filter id="donutShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>

          {/* 中心光晕 */}
          <Pie
            data={[{ value: 1 }]}
            innerRadius={0}
            outerRadius={56}
            dataKey="value"
            stroke="none"
            isAnimationActive={false}
            fill="url(#donutGlow)"
          />

          {/* 外圈装饰细环 */}
          <Pie
            data={[{ value: 1 }]}
            innerRadius={88}
            outerRadius={92}
            dataKey="value"
            stroke="none"
            isAnimationActive={false}
            fill="rgba(0, 119, 182, 0.08)"
          />

          {/* 主环 */}
          <Pie
            data={safeData}
            innerRadius={62}
            outerRadius={86}
            startAngle={90}
            endAngle={-270}
            dataKey="value"
            stroke="#ffffff"
            strokeWidth={2}
            paddingAngle={totalSlots === 0 ? 0 : 1}
            cornerRadius={6}
            isAnimationActive
            animationDuration={900}
          >
            {totalSlots === 0 ? (
              <Cell fill="url(#donutMissed)" />
            ) : (
              <>
                <Cell fill="url(#donutMentioned)" />
                <Cell fill="url(#donutMissed)" />
              </>
            )}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-4xl font-extrabold bg-gradient-to-r from-[#004B73] via-[#0077B6] to-[#00B4D8] bg-clip-text text-transparent tabular-nums tracking-tight">
          {pct}%
        </div>
        <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#0077B6] to-[#00B4D8]"></span>
          <span className="tabular-nums font-medium text-slate-700">{mentions}</span>
          <span className="text-slate-400">/ {totalSlots} 次提及</span>
        </div>
      </div>
    </div>
  )
}
