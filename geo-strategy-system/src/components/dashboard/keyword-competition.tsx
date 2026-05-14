"use client"

import { useMemo, useState } from "react"
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Flame, Gem, Activity } from "lucide-react"
import type { ModelKey } from "@/types"
import type { KeywordCompetitionItem } from "@/lib/dashboard-aggregations"
import { MODEL_LABELS } from "@/lib/llm"

type SortOrder = "redOcean" | "blueOcean"

interface Props {
  items: KeywordCompetitionItem[]
  /** 默认展示前 N 条；不传则全量 */
  maxItems?: number
}

const MODEL_COLOR: Record<ModelKey, string> = {
  doubao: "text-sky-300",
  deepseek: "text-indigo-300",
  qwen: "text-fuchsia-300",
  kimi: "text-slate-300",
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return `${s.slice(0, n - 1)}…`
}

export default function KeywordCompetition({ items, maxItems = 20 }: Props) {
  const [sortOrder, setSortOrder] = useState<SortOrder>("redOcean")

  const data = useMemo(() => {
    const sorted = [...items].sort((a, b) =>
      sortOrder === "redOcean"
        ? b.totalMentions - a.totalMentions
        : a.totalMentions - b.totalMentions,
    )
    return sorted.slice(0, maxItems).map(it => ({
      question: it.question,
      questionShort: truncate(it.question, 14),
      totalMentions: it.totalMentions,
      participatingModels: it.participatingModels,
      perModel: it.perModelMentions,
    }))
  }, [items, sortOrder, maxItems])

  const chartHeight = Math.max(data.length * 34 + 60, 320)

  return (
    <div className="rounded-2xl bg-slate-900/95 ring-1 ring-slate-800 overflow-hidden shadow-xl shadow-black/20">
      <div className="px-5 py-4 flex items-center justify-between border-b border-slate-800/80 gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-slate-400" />
          <div className="text-sm font-semibold text-slate-200">关键词竞争热度</div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 ring-1 ring-slate-700">
            已过滤 0 参与模型的拒答题
          </span>
        </div>

        <div className="inline-flex p-0.5 rounded-lg bg-slate-800/80 ring-1 ring-slate-700 text-[11px]">
          <button
            onClick={() => setSortOrder("redOcean")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
              sortOrder === "redOcean"
                ? "bg-gradient-to-r from-rose-500/80 to-orange-500/80 text-white shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Flame className="h-3 w-3" />
            红海（竞争由高到低）
          </button>
          <button
            onClick={() => setSortOrder("blueOcean")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
              sortOrder === "blueOcean"
                ? "bg-gradient-to-r from-cyan-500/80 to-blue-500/80 text-white shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Gem className="h-3 w-3" />
            蓝海（竞争由低到高）
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-slate-500">
          暂无有效关键词数据（所有疑问句均被模型拒答 / 未参与）
        </div>
      ) : (
        <div className="p-4">
          <div style={{ width: "100%", height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                layout="vertical"
                margin={{ top: 12, right: 56, left: 0, bottom: 24 }}
              >
                <defs>
                  <linearGradient id="kc-bar" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#0077B6" />
                    <stop offset="50%" stopColor="#00B4D8" />
                    <stop offset="100%" stopColor="#48cae4" />
                  </linearGradient>
                </defs>

                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" horizontal={false} />

                <XAxis
                  type="number"
                  xAxisId="mentions"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={{ stroke: "#334155" }}
                  tickLine={{ stroke: "#334155" }}
                  label={{
                    value: "品牌提及总数",
                    position: "insideBottom",
                    offset: -8,
                    fill: "#64748b",
                    fontSize: 11,
                  }}
                />
                <XAxis
                  type="number"
                  xAxisId="models"
                  orientation="top"
                  domain={[0, 4]}
                  ticks={[0, 1, 2, 3, 4]}
                  tick={{ fontSize: 11, fill: "#f59e0b" }}
                  axisLine={{ stroke: "#f59e0b", opacity: 0.4 }}
                  tickLine={{ stroke: "#f59e0b", opacity: 0.4 }}
                  label={{
                    value: "参与模型数",
                    position: "insideTop",
                    offset: -2,
                    fill: "#f59e0b",
                    fontSize: 11,
                  }}
                />

                <YAxis
                  dataKey="questionShort"
                  type="category"
                  width={150}
                  interval={0}
                  tick={(props: TickProps) => (
                    <CustomYTick {...props} fullLabels={data.map(d => d.question)} />
                  )}
                  axisLine={false}
                  tickLine={false}
                />

                <Tooltip
                  cursor={{ fill: "rgba(59,130,246,0.06)" }}
                  content={<CompetitionTooltip />}
                />

                <Bar
                  xAxisId="mentions"
                  dataKey="totalMentions"
                  fill="url(#kc-bar)"
                  radius={[0, 6, 6, 0]}
                  barSize={16}
                />

                <Line
                  xAxisId="models"
                  dataKey="participatingModels"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#f59e0b", stroke: "#0f172a", strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: "#fbbf24", stroke: "#0f172a", strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-400 px-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded-sm bg-gradient-to-r from-[#0077B6] to-[#48cae4]" />
              品牌提及总数
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 border-t-2 border-amber-400" />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 -ml-2" />
              参与模型数
            </span>
            {items.length > data.length && (
              <span className="ml-auto text-slate-500">
                仅展示 {sortOrder === "redOcean" ? "Top" : "Bottom"} {data.length} / {items.length}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface TickProps {
  x?: number | string
  y?: number | string
  payload?: { value?: string; index?: number }
}

function CustomYTick({ x = 0, y = 0, payload, fullLabels }: TickProps & { fullLabels: string[] }) {
  const idx = payload?.index ?? -1
  const full = idx >= 0 ? fullLabels[idx] : ""
  const short = payload?.value ?? ""
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{full}</title>
      <text
        x={-8}
        y={0}
        dy={4}
        textAnchor="end"
        fill="#cbd5e1"
        fontSize={11}
        style={{ cursor: "help" }}
      >
        {short}
      </text>
    </g>
  )
}

interface TooltipPayloadEntry {
  payload?: {
    question?: string
    totalMentions?: number
    participatingModels?: number
    perModel?: Partial<Record<ModelKey, number>>
  }
}

function CompetitionTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayloadEntry[]
}) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null

  const models: ModelKey[] = ["doubao", "qwen", "deepseek", "kimi"]
  return (
    <div className="rounded-lg bg-slate-950/95 ring-1 ring-slate-700 shadow-2xl shadow-black/40 px-3 py-2.5 max-w-xs">
      <div className="text-xs text-slate-200 font-medium leading-snug mb-2 break-words">
        {d.question}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div className="text-slate-400">品牌提及总数</div>
        <div className="text-right text-cyan-300 font-semibold tabular-nums">
          {d.totalMentions ?? 0}
        </div>
        <div className="text-slate-400">参与模型数</div>
        <div className="text-right text-amber-300 font-semibold tabular-nums">
          {d.participatingModels ?? 0}
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-slate-800">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
          各模型提及数明细
        </div>
        <div className="flex flex-wrap gap-1.5">
          {models.map(m => {
            const v = d.perModel?.[m] ?? 0
            return (
              <span
                key={m}
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 ${
                  v > 0 ? MODEL_COLOR[m] : "text-slate-600"
                }`}
              >
                {MODEL_LABELS[m]} ×{v}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
