"use client"

import { Fragment, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ChevronDown, MessageSquare } from "lucide-react"
import ModelAvatar from "@/components/model-avatar"
import { MODEL_LABELS } from "@/lib/model-labels"
import type { AnalysisSubjectType, PenetrationQuestionBrand, PenetrationQuestionStat } from "@/types"

interface Props {
  stats: PenetrationQuestionStat[]
  subjectType: AnalysisSubjectType
  /** Shows this question's raw answers; omitted where there are none to show. */
  onViewAnswers?: (question: string) => void
}

type SortKey = "asked" | "rate" | "rank"

const TOP_BRANDS = 5

function rate(value: number): string {
  return `${Math.round(value * 100)}%`
}

function rankLabel(rank: number | null, brands: PenetrationQuestionBrand[]): string {
  if (rank === null) return "未上榜"
  const tied = brands.filter(brand => brand.rank === rank).length > 1
  return `第 ${rank} 名${tied ? "（并列）" : ""}`
}

/** 0 models: not covered; 1: partly; 2 or more: covered. */
function coverage(stat: PenetrationQuestionStat): { label: string; className: string } {
  const models = stat.perModel.filter(item => item.mentions > 0).length
  if (models === 0) return { label: "未覆盖", className: "bg-rose-50 text-rose-700 ring-rose-200" }
  if (models === 1) return { label: "部分覆盖", className: "bg-amber-50 text-amber-700 ring-amber-200" }
  return { label: "已覆盖", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" }
}

function SortHeader({ label, sort, className = "", sortKey, ascending, onSort }: {
  label: string
  sort: SortKey
  className?: string
  sortKey: SortKey
  ascending: boolean
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === sort
  return (
    <th className={`py-2 font-medium ${className}`}>
      <button type="button" onClick={() => onSort(sort)} className={`inline-flex items-center gap-0.5 ${active ? "text-slate-800" : "hover:text-slate-700"}`}>
        {label}
        {active ? (ascending ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
      </button>
    </th>
  )
}

function BrandChip({ brand }: { brand: PenetrationQuestionBrand }) {
  return (
    <span
      className={`inline-flex max-w-[180px] items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ring-1 ${
        brand.isTarget ? "bg-[#1677FF]/10 font-semibold text-[#0958d9] ring-[#91CAFF]" : "bg-white text-slate-600 ring-slate-200"
      }`}
      title={`${brand.brand} · ${rate(brand.penetrationRate)}`}
    >
      <span className="shrink-0 tabular-nums text-slate-400">{brand.rank}</span>
      <span className="truncate">{brand.brand}</span>
      <span className="shrink-0 tabular-nums">{rate(brand.penetrationRate)}</span>
    </span>
  )
}

function QuestionDetail({
  stat,
  subjectType,
  onViewAnswers,
}: {
  stat: PenetrationQuestionStat
  subjectType: AnalysisSubjectType
  onViewAnswers?: (question: string) => void
}) {
  const ours = stat.brands.find(brand => brand.isTarget)
  const models = stat.perModel.map(item => item.model)
  const subject = subjectType === "person" ? "人物" : "品牌"
  return (
    <div className="space-y-3 bg-slate-50/70 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <span>我方提及率 <b className="text-slate-900">{rate(stat.ourRate)}</b>（{stat.ourMentions}/{stat.answers} 条回答）</span>
          <span>我方排名 <b className="text-slate-900">{rankLabel(stat.ourRanking, stat.brands)}</b> / {stat.brandCount} 个{subject}</span>
        </div>
        {onViewAnswers ? (
          <button
            type="button"
            onClick={() => onViewAnswers(stat.question)}
            className="inline-flex items-center gap-1 text-xs font-medium text-[#1677FF] hover:underline"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            查看这一题的原始回答
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {stat.perModel.map(item => (
          <span
            key={item.model}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] ring-1 ${
              item.mentions > 0 ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-white text-slate-400 ring-slate-200"
            }`}
          >
            <ModelAvatar model={item.model} size="xs" />
            {MODEL_LABELS[item.model]} {item.mentions}/{item.total}
          </span>
        ))}
      </div>
      <div className="min-w-0 overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="bg-slate-50 text-left text-slate-500">
              <th className="px-2 py-1.5 font-medium">排名</th>
              <th className="px-2 py-1.5 font-medium">{subject}</th>
              <th className="px-2 py-1.5 text-right font-medium">本题提及率</th>
              <th className="px-2 py-1.5 text-right font-medium">提及次数</th>
              <th className="px-2 py-1.5 font-medium">各模型提及</th>
            </tr>
          </thead>
          <tbody>
            {stat.brands.map(brand => (
              <tr
                key={`${brand.rank}-${brand.brand}`}
                className={`border-t border-slate-100 ${brand.isTarget ? "bg-[#1677FF]/5 font-semibold text-[#0958d9]" : "text-slate-700"}`}
              >
                <td className="px-2 py-1.5 tabular-nums">{brand.rank}</td>
                <td className="px-2 py-1.5">{brand.brand}{brand.isTarget ? "（我方）" : ""}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rate(brand.penetrationRate)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{brand.count}</td>
                <td className="px-2 py-1.5 text-[10px] text-slate-500">
                  {brand.perModel
                    ? models
                      .filter(model => (brand.perModel?.[model] ?? 0) > 0)
                      .map(model => `${MODEL_LABELS[model]} ${brand.perModel?.[model]}`)
                      .join(" · ") || "—"
                    : "—"}
                </td>
              </tr>
            ))}
            {!ours ? (
              <tr className="border-t border-slate-100 bg-rose-50/60 font-semibold text-rose-700">
                <td className="px-2 py-1.5">—</td>
                <td className="px-2 py-1.5">我方</td>
                <td className="px-2 py-1.5 text-right tabular-nums">0%</td>
                <td className="px-2 py-1.5 text-right tabular-nums">0</td>
                <td className="px-2 py-1.5 text-[10px]">这一题没有模型提到我方</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] leading-4 text-slate-400">
        本题共 {stat.answers} 条回答，一条回答约占 {rate(1 / Math.max(1, stat.answers))}，相差一两条时不必过度解读。提及次数相同的{subject}并列同一名次。
      </p>
    </div>
  )
}

/**
 * Each question on its own: our rate and rank, the five leaders, and on
 * click the full ranking for that question. The overall rate pools every
 * question, so a strong one can hide those where we never come up.
 */
export default function QuestionRankingPanel({ stats, subjectType, onViewAnswers }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("rate")
  const [ascending, setAscending] = useState(true)
  const [openQuestion, setOpenQuestion] = useState<string | null>(null)

  const rows = useMemo(() => {
    const indexed = stats.map((stat, index) => ({ stat, index }))
    const value = ({ stat, index }: { stat: PenetrationQuestionStat; index: number }) => (
      sortKey === "asked" ? index
        : sortKey === "rate" ? stat.ourRate
          : stat.ourRanking ?? Number.POSITIVE_INFINITY
    )
    return indexed
      .sort((a, b) => (value(a) - value(b)) * (ascending ? 1 : -1) || a.index - b.index)
      .map(item => item.stat)
  }, [stats, sortKey, ascending])

  if (stats.length === 0) return null
  const covered = stats.filter(stat => stat.ourMentions > 0).length
  const steady = stats.filter(stat => stat.perModel.filter(item => item.mentions > 0).length >= 3).length

  // A new column sorts ascending: the lowest rate, the best rank, the first asked.
  function sortBy(key: SortKey) {
    if (key === sortKey) setAscending(value => !value)
    else {
      setSortKey(key)
      setAscending(true)
    }
  }
  const header = { sortKey, ascending, onSort: sortBy }

  return (
    <div className="geo-data-panel min-w-0 rounded-lg p-4">
      <div className="geo-section-kicker mb-1">单题渗透率与排名</div>
      <p className="mb-3 text-[11px] leading-5 text-slate-500">
        {stats.length} 个问题中，{covered} 个有模型提到我方，<b className={stats.length - covered ? "text-rose-600" : ""}>{stats.length - covered} 个为 0</b>；
        {steady} 个问题在 3 个及以上模型中出现。整体渗透率是所有问题合在一起算的，请逐题核对。点任一问题查看完整排名。
      </p>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[860px] text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <SortHeader {...header} label="问题" sort="asked" className="pr-3" />
              <SortHeader {...header} label="我方提及率" sort="rate" className="px-2 text-right" />
              <SortHeader {...header} label="我方排名" sort="rank" className="px-2" />
              <th className="px-2 py-2 font-medium">提到我方的模型</th>
              <th className="px-2 py-2 font-medium">本题前 {TOP_BRANDS} 名</th>
              <th className="py-2 pl-2 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(stat => {
              const open = openQuestion === stat.question
              const status = coverage(stat)
              const hitModels = stat.perModel.filter(item => item.mentions > 0)
              return (
                <Fragment key={stat.question}>
                  <tr
                    className={`cursor-pointer border-t border-slate-100 align-top transition hover:bg-slate-50 ${open ? "bg-slate-50" : ""}`}
                    onClick={() => setOpenQuestion(open ? null : stat.question)}
                  >
                    <td className="py-2 pr-3 text-slate-800">
                      <span className="inline-flex items-start gap-1">
                        <ChevronDown className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
                        <span className="max-w-[260px]">{stat.question}</span>
                      </span>
                    </td>
                    <td className={`px-2 py-2 text-right font-semibold tabular-nums ${stat.ourMentions ? "text-slate-900" : "text-rose-600"}`}>
                      {rate(stat.ourRate)}
                      <div className="text-[10px] font-normal text-slate-400">{stat.ourMentions}/{stat.answers}</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-700">
                      {rankLabel(stat.ourRanking, stat.brands)}
                      <div className="text-[10px] text-slate-400">共 {stat.brandCount} 个</div>
                    </td>
                    <td className="px-2 py-2">
                      {hitModels.length ? (
                        <span className="inline-flex flex-wrap items-center gap-0.5" title={hitModels.map(item => `${MODEL_LABELS[item.model]} ${item.mentions}/${item.total}`).join("、")}>
                          {hitModels.map(item => <ModelAvatar key={item.model} model={item.model} size="xs" />)}
                          <span className="ml-1 text-[10px] text-slate-500">{hitModels.length}/{stat.perModel.length}</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">0/{stat.perModel.length}</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex max-w-[360px] flex-wrap gap-1">
                        {stat.brands.slice(0, TOP_BRANDS).map(brand => <BrandChip key={`${brand.rank}-${brand.brand}`} brand={brand} />)}
                      </div>
                    </td>
                    <td className="py-2 pl-2">
                      <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={6} className="pb-2">
                        <QuestionDetail stat={stat} subjectType={subjectType} onViewAnswers={onViewAnswers} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
