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
}

export default function IndustryShareChart({ items, ourBrand }: Props) {
  const data = items.map(it => ({
    brand: it.brand,
    count: it.count,
    ratio: Math.round(it.ratio * 1000) / 10,
    isOur: isSameBrand(it.brand, ourBrand),
  }))

  if (data.length === 0) {
    return <div className="text-sm text-slate-400 py-8 text-center">暂无数据</div>
  }

  return (
    <div className="w-full" style={{ height: Math.max(data.length * 36 + 32, 320) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 56, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="barOur" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#004B73" />
              <stop offset="50%" stopColor="#0077B6" />
              <stop offset="100%" stopColor="#00B4D8" />
            </linearGradient>
            <linearGradient id="barOther" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#cbd5e1" />
              <stop offset="100%" stopColor="#94a3b8" />
            </linearGradient>
          </defs>
          <XAxis type="number" hide />
          <YAxis
            dataKey="brand"
            type="category"
            width={110}
            tick={{ fontSize: 12, fill: "#475569" }}
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
              const payload = (item as { payload?: { ratio?: number; isOur?: boolean } } | undefined)?.payload
              const ratio = payload?.ratio ?? 0
              const label = payload?.isOur ? "我方提及频次" : "提及频次"
              return [`${value} 次 (${ratio}%)`, label]
            }}
          />
          <Bar dataKey="count" radius={[0, 8, 8, 0]} barSize={20}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.isOur ? "url(#barOur)" : "url(#barOther)"} />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              fontSize={11}
              fill="#64748b"
              formatter={(v) => `${v ?? 0} 次`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
