"use client"

import { useMemo, useState } from "react"
import {
  Cell,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
} from "recharts"
import {
  DIFFICULTY_RING_COLORS,
  difficultyDimensionPercent,
} from "@/lib/difficulty/dimension-visuals"
import type { DifficultyDimensionResult, DifficultyLevel } from "@/types"

type Props = {
  dimensions: DifficultyDimensionResult[]
  totalScore: number
  level: DifficultyLevel
}

function levelClasses(level: DifficultyLevel): string {
  if (level === "容易") return "bg-emerald-50 text-emerald-700 ring-emerald-200"
  if (level === "中等") return "bg-sky-50 text-sky-700 ring-sky-200"
  if (level === "困难") return "bg-amber-50 text-amber-700 ring-amber-200"
  return "bg-rose-50 text-rose-700 ring-rose-200"
}

export default function DifficultyDimensionsRadial({ dimensions, totalScore, level }: Props) {
  const [activeIndex, setActiveIndex] = useState(0)
  const data = useMemo(() => dimensions.map((dimension, index) => ({
    ...dimension,
    color: DIFFICULTY_RING_COLORS[index % DIFFICULTY_RING_COLORS.length],
    percent: difficultyDimensionPercent(dimension.score, dimension.max),
  })), [dimensions])
  const active = data[Math.min(activeIndex, Math.max(0, data.length - 1))]

  if (data.length === 0) return null

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-br from-white via-[#F7FBFF] to-[#EFF9FF]">
      <div className="grid items-center gap-4 px-3 py-4 md:grid-cols-[minmax(300px,0.92fr)_minmax(320px,1.08fr)] md:px-5">
        <div
          className="relative mx-auto h-[310px] w-full max-w-[390px]"
          role="img"
          aria-label={`${data.length}维 GEO 难度评分环形图，总分 ${totalScore}，难度等级 ${level}`}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={310}
            initialDimension={{ width: 320, height: 310 }}
          >
            <RadialBarChart
              data={data}
              cx="50%"
              cy="50%"
              innerRadius="31%"
              outerRadius="92%"
              startAngle={90}
              endAngle={-270}
              barSize={10}
            >
              <PolarAngleAxis
                type="number"
                dataKey="percent"
                domain={[0, 100]}
                tick={false}
                axisLine={false}
              />
              <RadialBar
                dataKey="percent"
                background={{ fill: "#DFEAF5", opacity: 0.72 }}
                cornerRadius={7}
                stroke="none"
                isAnimationActive
                animationDuration={650}
                onMouseEnter={(_entry, index) => setActiveIndex(index)}
                onClick={(_entry, index) => setActiveIndex(index)}
              >
                {data.map((dimension, index) => (
                  <Cell
                    key={dimension.name}
                    fill={dimension.color}
                    opacity={index === activeIndex ? 1 : 0.8}
                    style={{
                      cursor: "pointer",
                      filter: index === activeIndex ? `drop-shadow(0 2px 4px ${dimension.color}55)` : "none",
                    }}
                  />
                ))}
              </RadialBar>
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="geo-data-number text-4xl font-bold text-[#003EB3]">{totalScore}</div>
              <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">总分 / 100</div>
              <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${levelClasses(level)}`}>
                {level}
              </span>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="grid gap-1.5 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
            {data.map((dimension, index) => {
              const selected = index === activeIndex
              return (
                <button
                  key={dimension.name}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex min-h-12 items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677FF] ${selected
                    ? "bg-white shadow-sm ring-1 ring-[#8AC8FF]"
                    : "hover:bg-white/75"
                  }`}
                  aria-pressed={selected}
                >
                  <span
                    className="h-7 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: dimension.color }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-800">{dimension.name}</span>
                    <span className="mt-0.5 block text-[10px] text-slate-400">{dimension.level} · 完成度 {dimension.percent}%</span>
                  </span>
                  <span className="geo-data-number shrink-0 text-sm font-bold text-slate-900">
                    {dimension.score}<span className="text-[10px] font-medium text-slate-400">/{dimension.max}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {active ? (
            <div className="mt-3 border-t border-slate-200/80 pt-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: active.color }} />
                <span className="text-xs font-semibold text-slate-800">{active.name}分析</span>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-slate-600">{active.analysis}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
