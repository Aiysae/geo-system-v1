"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts"
import type { AnalysisSubjectType, IndustryShareItem } from "@/types"
import { isSameSubject } from "@/lib/subject-canonicalization"

interface Props {
  items: IndustryShareItem[]
  ourBrand: string
  totalSlots: number
  compact?: boolean
  subjectType?: AnalysisSubjectType
  entityLabel?: string
  highlightTarget?: boolean
}

const TOP_RANK_GRADIENTS = [
  { from: "#1677FF", to: "#00C8FF" },
  { from: "#13C2C2", to: "#69E3E0" },
  { from: "#2F54EB", to: "#7B8CFF" },
]

export default function IndustryShareChart({
  items,
  ourBrand,
  totalSlots,
  compact = false,
  subjectType = "brand",
  entityLabel,
  highlightTarget = true,
}: Props) {
  const resolvedEntityLabel = entityLabel || (subjectType === "person" ? "同行人物" : "品牌")
  const data = items.map((it, index) => ({
    brand: it.brand,
    count: it.count,
    ratio: Math.round(it.ratio * 1000) / 10,
    penetrationRate:
      Math.round(
        (it.penetrationRate ?? (totalSlots > 0 ? it.count / totalSlots : 0)) * 1000
      ) / 10,
    isOur: highlightTarget && isSameSubject(it.brand, ourBrand, subjectType),
    rankIndex: index,
  }))

  if (data.length === 0) {
    return <div className="text-sm text-slate-400 py-8 text-center">暂无数据</div>
  }

  const compactBrandLabel = (value: string) =>
    value.length > 9 ? `${value.slice(0, 8)}...` : value

  return (
    <div
      className={compact ? "h-full min-h-[320px] w-full" : "w-full"}
      style={compact ? undefined : { height: Math.max(data.length * 36 + 32, 320) }}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 420 }}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: compact ? 42 : 56, left: 0, bottom: 8 }}>
          <defs>
            {TOP_RANK_GRADIENTS.map((color, index) => (
              <linearGradient key={index} id={`barRank${index}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={color.from} stopOpacity={0.94} />
                <stop offset="100%" stopColor={color.to} stopOpacity={0.74} />
              </linearGradient>
            ))}
            <linearGradient id="barRest" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#6E94C5" stopOpacity={0.88} />
              <stop offset="100%" stopColor="#A9C3E5" stopOpacity={0.72} />
            </linearGradient>
          </defs>
          <XAxis type="number" hide />
          <YAxis
            dataKey="brand"
            type="category"
            width={compact ? 92 : 110}
            tick={{ fontSize: compact ? 11 : 12, fill: "#263d50", fontWeight: 600 }}
            tickFormatter={compactBrandLabel}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(22,119,255,0.06)" }}
            contentStyle={{
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              fontSize: 12,
              padding: "8px 12px",
              boxShadow: "0 8px 24px -8px rgba(22,119,255,0.22)",
            }}
            formatter={(value, _name, item) => {
              const payload = (
                item as {
                  payload?: {
                    ratio?: number
                    count?: number
                    isOur?: boolean
                  }
                } | undefined
              )?.payload
              const ratio = payload?.ratio ?? 0
              const count = payload?.count ?? 0
              const label = payload?.isOur
                ? subjectType === "person" ? "目标人物可见率" : "我方品牌渗透率"
                : `${resolvedEntityLabel}提及率`
              return [`${value}% · ${count} 次提及 · 声量占比 ${ratio}%`, label]
            }}
          />
          <Bar dataKey="penetrationRate" radius={[0, 8, 8, 0]} barSize={compact ? 17 : 20}>
            {data.map((d) => (
              <Cell
                key={d.brand}
                fill={d.rankIndex < TOP_RANK_GRADIENTS.length ? `url(#barRank${d.rankIndex})` : "url(#barRest)"}
              />
            ))}
            <LabelList
              dataKey="penetrationRate"
              position="right"
              fontSize={11}
              fill="#64748b"
              formatter={(v) => `${v ?? 0}%`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
