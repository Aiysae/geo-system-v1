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
              <stop offset="0%" stopColor="#087F9C" />
              <stop offset="100%" stopColor="#0D9879" />
            </linearGradient>
            <linearGradient id="donutMissed" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#dce5e4" />
              <stop offset="100%" stopColor="#eef3f2" />
            </linearGradient>
            <radialGradient id="donutGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0D9879" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#081C24" stopOpacity={0} />
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
            fill="rgba(8, 127, 156, 0.08)"
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
            {safeData.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={totalSlots === 0 || index === 1 ? "#DCE5E4" : "#087F9C"}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="geo-data-number text-4xl font-bold text-[#0B5967]">
          {pct}%
        </div>
        <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="h-1.5 w-1.5 rounded-full bg-[#C79A3B]"></span>
          <span className="tabular-nums font-medium text-slate-700">{mentions}</span>
          <span className="text-slate-400">/ {totalSlots} 次提及</span>
        </div>
      </div>
    </div>
  )
}
