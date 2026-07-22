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
import type { AnalysisSubjectType, ModelKey } from "@/types"
import type { KeywordCompetitionItem } from "@/lib/dashboard-aggregations"
import { MODEL_LABELS } from "@/lib/model-labels"
import ModelAvatar from "@/components/model-avatar"

type SortOrder = "redOcean" | "blueOcean"

interface Props {
  items: KeywordCompetitionItem[]
  /** 默认展示前 N 条；硬上限 10，传入更大值会被钳到 10 */
  maxItems?: number
  compact?: boolean
  subjectType?: AnalysisSubjectType
}

const CHART_HARD_CAP = 10

const MODEL_COLOR: Record<ModelKey, string> = {
  doubao: "text-sky-300",
  deepseek: "text-indigo-300",
  qwen: "text-fuchsia-300",
  kimi: "text-slate-300",
  ernie: "text-emerald-300",
  hunyuan: "text-rose-300",
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return `${s.slice(0, n - 1)}…`
}

export default function KeywordCompetition({
  items,
  maxItems = CHART_HARD_CAP,
  compact = false,
  subjectType = "brand",
}: Props) {
  const entityLabel = subjectType === "person" ? "同行人物" : "品牌"
  const [sortOrder, setSortOrder] = useState<SortOrder>("redOcean")
  const mode = sortOrder === "redOcean"
      ? {
        title: "红海竞争",
        panel: "from-rose-50 via-white to-white",
        barFrom: "#F43F5E",
        barMid: "#F97316",
        barTo: "#F59E0B",
        active: "bg-gradient-to-r from-rose-500 to-orange-500 text-white shadow shadow-rose-500/20",
      }
      : {
        title: "蓝海机会",
        panel: "from-cyan-50 via-white to-white",
        barFrom: "#10B981",
        barMid: "#00C8FF",
        barTo: "#00C8FF",
        active: "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow shadow-cyan-500/20",
      }

  const data = useMemo(() => {
    // 1) 先按竞争热度排序
    const sorted = [...items].sort((a, b) =>
      sortOrder === "redOcean"
        ? b.totalMentions - a.totalMentions
        : a.totalMentions - b.totalMentions,
    )
    // 2) 排序之后再 slice，保证图表上永远是"最符合当前排序规则"的前 N 条
    // 3) 防呆：调用方传入超过硬上限 10 也强行钳到 10；数据不足 10 时按实际数量
    const effectiveLimit = Math.min(maxItems, CHART_HARD_CAP, sorted.length)
    return sorted.slice(0, effectiveLimit).map(it => ({
      question: it.question,
      questionShort: truncate(it.question, compact ? 11 : 14),
      totalMentions: it.totalMentions,
      participatingModels: it.participatingModels,
      perModel: it.perModelMentions,
    }))
  }, [items, sortOrder, maxItems, compact])

  const chartHeight = Math.max(data.length * 34 + 60, 320)

  return (
    <div className={`geo-panel overflow-hidden ${compact ? "flex h-full min-h-[360px] flex-col" : ""}`}>
      <div className={`${compact ? "px-4 py-3" : "px-5 py-4"} flex items-center justify-between gap-3 border-b border-[#E8EEF5] bg-gradient-to-r ${mode.panel}`}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#2F54EB] to-[#1677FF]">
            <Activity className="h-4 w-4 text-white" />
          </span>
          <div>
            <div className="text-sm font-semibold text-[#102A43]">关键词竞争热度</div>
            <div className="mt-0.5 text-[10px] text-[#7E91A7]">{mode.title}视角</div>
          </div>
          {!compact ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">
              已排除无有效回答的问题
            </span>
          ) : null}
        </div>

        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] ring-1 ring-slate-200">
          <button
            onClick={() => setSortOrder("redOcean")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
              sortOrder === "redOcean"
                ? mode.active
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <Flame className="h-3 w-3" />
            {compact ? "红海" : "红海（竞争由高到低）"}
          </button>
          <button
            onClick={() => setSortOrder("blueOcean")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
              sortOrder === "blueOcean"
                ? mode.active
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <Gem className="h-3 w-3" />
            {compact ? "蓝海" : "蓝海（竞争由低到高）"}
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-slate-500">
          暂无有效关键词数据
        </div>
      ) : (
        <div className={`${compact ? "flex min-h-0 flex-1 flex-col p-3" : "p-4"}`}>
          <div
            className={compact ? "min-h-[250px] flex-1" : undefined}
            style={{ width: "100%", height: compact ? undefined : chartHeight }}
          >
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 320 }}>
              <ComposedChart
                data={data}
                layout="vertical"
                margin={{ top: 12, right: 56, left: 0, bottom: 24 }}
              >
                <defs>
                  <linearGradient id="kc-bar" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={mode.barFrom} />
                    <stop offset="52%" stopColor={mode.barMid} />
                    <stop offset="100%" stopColor={mode.barTo} />
                  </linearGradient>
                </defs>

                <CartesianGrid stroke="#E3EBF4" strokeDasharray="3 3" horizontal={false} />

                <XAxis
                  type="number"
                  xAxisId="mentions"
                  tick={{ fontSize: 11, fill: "#71869D" }}
                  axisLine={{ stroke: "#C8D7E8" }}
                  tickLine={{ stroke: "#C8D7E8" }}
                  label={{
                    value: `${entityLabel}提及总数`,
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
                  domain={[0, 6]}
                  ticks={[0, 1, 2, 3, 4, 5, 6]}
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
                  width={compact ? 112 : 150}
                  interval={0}
                  tick={(props: TickProps) => (
                    <CustomYTick {...props} fullLabels={data.map(d => d.question)} />
                  )}
                  axisLine={false}
                  tickLine={false}
                />

                <Tooltip
                  cursor={{ fill: "rgba(59,130,246,0.06)" }}
                  content={<CompetitionTooltip subjectType={subjectType} />}
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

          <div className={`${compact ? "mt-2 gap-3 text-[10px]" : "mt-3 gap-4 text-[11px]"} flex items-center text-slate-400 px-2`}>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-2 rounded-sm"
                style={{ background: `linear-gradient(90deg, ${mode.barFrom}, ${mode.barTo})` }}
              />
              {entityLabel}提及总数
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 border-t-2 border-amber-400" />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 -ml-2" />
              参与模型数
            </span>
            {items.length > data.length && (
            <span className="ml-auto text-slate-400">
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
        fill="#526A83"
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
  subjectType,
}: {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  subjectType: AnalysisSubjectType
}) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null

  const models: ModelKey[] = ["doubao", "qwen", "deepseek", "kimi", "ernie", "hunyuan"]
  return (
    <div className="rounded-lg bg-slate-950/95 ring-1 ring-slate-700 shadow-2xl shadow-black/40 px-3 py-2.5 max-w-xs">
      <div className="text-xs text-slate-200 font-medium leading-snug mb-2 break-words">
        {d.question}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div className="text-slate-400">
          {subjectType === "person" ? "同行人物提及总数" : "品牌提及总数"}
        </div>
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
                <ModelAvatar model={m} size="xs" className="h-4 w-4 ring-slate-700" />
                {MODEL_LABELS[m]} ×{v}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
