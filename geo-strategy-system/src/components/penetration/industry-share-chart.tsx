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
import type { IndustryShareItem } from "@/types"
import { isSameBrand } from "@/lib/score-utils"

interface Props {
  items: IndustryShareItem[]
  ourBrand: string
  totalSlots: number
}

const RANK_COLORS = [
  "#00A6FB",
  "#7C3AED",
  "#10B981",
  "#F59E0B",
  "#F43F5E",
  "#06B6D4",
  "#8B5CF6",
  "#22C55E",
  "#FB7185",
  "#38BDF8",
]

export default function IndustryShareChart({ items, ourBrand, totalSlots }: Props) {
  const data = items.map((it, index) => ({
    brand: it.brand,
    count: it.count,
    ratio: Math.round(it.ratio * 1000) / 10,
    penetrationRate:
      Math.round(
        (it.penetrationRate ?? (totalSlots > 0 ? it.count / totalSlots : 0)) * 1000
      ) / 10,
    isOur: isSameBrand(it.brand, ourBrand),
    color: RANK_COLORS[index % RANK_COLORS.length],
  }))

  if (data.length === 0) {
    return <div className="text-sm text-slate-400 py-8 text-center">暂无数据</div>
  }

  const compactBrandLabel = (value: string) =>
    value.length > 9 ? `${value.slice(0, 8)}...` : value

  return (
    <div className="w-full" style={{ height: Math.max(data.length * 36 + 32, 320) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 56, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="barOur" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#F59E0B" />
              <stop offset="48%" stopColor="#F97316" />
              <stop offset="100%" stopColor="#F43F5E" />
            </linearGradient>
            {data.map((d, index) => (
              <linearGradient key={d.brand} id={`barOther${index}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={d.color} stopOpacity={0.92} />
                <stop offset="100%" stopColor={d.color} stopOpacity={0.52} />
              </linearGradient>
            ))}
          </defs>
          <XAxis type="number" hide />
          <YAxis
            dataKey="brand"
            type="category"
            width={110}
            tick={{ fontSize: 12, fill: "#263d50", fontWeight: 600 }}
            tickFormatter={compactBrandLabel}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,119,182,0.05)" }}
            contentStyle={{
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              fontSize: 12,
              padding: "8px 12px",
              boxShadow: "0 8px 24px -8px rgba(0,75,115,0.18)",
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
              const label = payload?.isOur ? "我方品牌渗透率" : "品牌渗透率"
              return [`${value}% · ${count} 次提及 · 声量占比 ${ratio}%`, label]
            }}
          />
          <Bar dataKey="penetrationRate" radius={[0, 8, 8, 0]} barSize={20}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.isOur ? "url(#barOur)" : `url(#barOther${i})`} />
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
