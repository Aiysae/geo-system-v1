"use client"

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import type { DiagnosisDimensions } from "@/types"

const DIM_LABELS: Record<keyof DiagnosisDimensions, string> = {
  authority: "信源权威性",
  structure: "内容结构化",
  traceability: "信息可追溯",
  coverage: "关键词覆盖",
  sentiment: "情感倾向",
}

// 行业基线（参考分），用于双层雷达视觉对比
const BASELINE = 60

interface Props {
  dimensions: DiagnosisDimensions
}

export default function RadarFiveDim({ dimensions }: Props) {
  const data = (Object.keys(DIM_LABELS) as Array<keyof DiagnosisDimensions>).map(k => ({
    subject: DIM_LABELS[k],
    score: dimensions[k],
    baseline: BASELINE,
    fullMark: 100,
  }))

  return (
    <div className="w-full h-80 min-h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} margin={{ top: 16, right: 36, bottom: 16, left: 36 }}>
          <defs>
            <linearGradient id="radarMainFill" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00B4D8" stopOpacity={0.55} />
              <stop offset="60%" stopColor="#0077B6" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#004B73" stopOpacity={0.4} />
            </linearGradient>
            <linearGradient id="radarMainStroke" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0077B6" />
              <stop offset="100%" stopColor="#00B4D8" />
            </linearGradient>
            <radialGradient id="radarBgGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00B4D8" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#0077B6" stopOpacity={0} />
            </radialGradient>
          </defs>

          {/* 背景光晕 */}
          <PolarGrid stroke="#e2e8f0" strokeDasharray="3 3" />

          <PolarAngleAxis
            dataKey="subject"
            tick={{ fontSize: 12, fill: "#334155", fontWeight: 500 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            stroke="#cbd5e1"
            tickCount={5}
            axisLine={false}
          />

          {/* 基线层（行业 60 分参考） */}
          <Radar
            name="行业基线"
            dataKey="baseline"
            stroke="#cbd5e1"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            fill="#f1f5f9"
            fillOpacity={0.4}
            isAnimationActive={false}
          />

          {/* 当前品牌得分层 */}
          <Radar
            name="我方得分"
            dataKey="score"
            stroke="url(#radarMainStroke)"
            strokeWidth={2.5}
            fill="url(#radarMainFill)"
            fillOpacity={0.6}
            dot={{ fill: "#fbbf24", stroke: "#fff", strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, fill: "#f59e0b", stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive
            animationDuration={900}
          />

          <Tooltip
            contentStyle={{
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              fontSize: 12,
              padding: "8px 12px",
              boxShadow: "0 8px 24px -8px rgba(0,75,115,0.18)",
            }}
            formatter={(value, name) => [`${value} 分`, name]}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
