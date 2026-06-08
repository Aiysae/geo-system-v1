"use client"

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Cell,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
} from "recharts"
import { MODEL_LABELS } from "@/lib/model-labels"
import type { PerModelRate } from "@/types"

interface Props {
  perModelRate: PerModelRate[]
  overallRate: number
}

const COLORS = ["#004B73", "#0077B6", "#00B4D8", "#48cae4", "#10b981", "#f43f5e"]

export default function ModelRateTrend({ perModelRate, overallRate }: Props) {
  if (perModelRate.length === 0) {
    return <div className="text-sm text-slate-400 py-8 text-center">暂无数据</div>
  }

  const data = perModelRate.map((r, i) => ({
    model: MODEL_LABELS[r.model],
    rate: Math.round(r.rate * 1000) / 10,
    mentions: r.mentions,
    total: r.total,
    avg: Math.round(overallRate * 1000) / 10,
    color: COLORS[i % COLORS.length],
  }))

  return (
    <div className="w-full h-64 min-h-[256px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 24, right: 24, left: 0, bottom: 8 }}>
          <defs>
            {COLORS.map((c, i) => (
              <linearGradient key={i} id={`barGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c} stopOpacity={0.95} />
                <stop offset="100%" stopColor={c} stopOpacity={0.55} />
              </linearGradient>
            ))}
            <linearGradient id="avgLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#fbbf24" />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 6" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="model"
            tick={{ fontSize: 12, fill: "#475569" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
            unit="%"
            domain={[0, (dataMax: number) => Math.max(20, Math.ceil(dataMax / 10) * 10 + 10)]}
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
            formatter={(value, name, item) => {
              const payload = (item as { payload?: { mentions?: number; total?: number } } | undefined)?.payload
              if (name === "渗透率") {
                return [
                  `${value}%  (${payload?.mentions ?? 0}/${payload?.total ?? 0})`,
                  "我方命中率",
                ]
              }
              return [`${value}%`, "整体均值"]
            }}
          />
          <Bar dataKey="rate" name="渗透率" radius={[8, 8, 0, 0]} barSize={42}>
            {data.map((d, i) => (
              <Cell key={i} fill={`url(#barGrad${i % COLORS.length})`} />
            ))}
            <LabelList
              dataKey="rate"
              position="top"
              formatter={(v) => `${v ?? 0}%`}
              fill="#0f172a"
              fontSize={11}
              fontWeight={600}
            />
          </Bar>
          <Line
            dataKey="avg"
            name="整体均值"
            stroke="url(#avgLine)"
            strokeWidth={2.5}
            strokeDasharray="4 4"
            dot={{ fill: "#f59e0b", r: 3 }}
            activeDot={{ r: 5 }}
            isAnimationActive
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
