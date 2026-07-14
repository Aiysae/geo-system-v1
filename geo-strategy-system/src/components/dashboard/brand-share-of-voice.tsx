"use client"

import { useMemo, useState } from "react"
import { AudioLines, ChevronDown, ChevronUp, HelpCircle } from "lucide-react"
import type { BrandVoiceItem } from "@/lib/dashboard-aggregations"
import ModelAvatar from "@/components/model-avatar"

interface Props {
  items: BrandVoiceItem[]
  /** 折叠态默认展示的条数（默认 5） */
  defaultVisible?: number
  compact?: boolean
}

export default function BrandShareOfVoice({ items, defaultVisible = 5, compact = false }: Props) {
  const [expanded, setExpanded] = useState(false)

  const initialBatch = useMemo(() => items.slice(0, defaultVisible), [items, defaultVisible])
  const extraBatch = useMemo(() => items.slice(defaultVisible), [items, defaultVisible])
  const hasMore = extraBatch.length > 0
  const targetRank = items.find(it => it.isTarget)?.rank ?? null
  // 进度条的"满刻度"参考：用首位提及数。这样最大声量品牌的条占满 100% 视觉宽度。
  const maxMentions = items[0]?.mentions ?? 1

  return (
    <div className={`geo-dark-panel overflow-hidden rounded-lg ${compact ? "flex h-full min-h-[420px] flex-col" : ""}`}>
      <div className={`${compact ? "px-4 py-3" : "px-5 py-4"} flex items-center justify-between border-b border-white/10 bg-white/[0.03]`}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00C8FF]">
            <AudioLines className="h-4 w-4 text-white" />
          </span>
          <div className="text-sm font-semibold text-white">品牌声量表</div>
          {targetRank && (
            <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-cyan-400/15 text-cyan-100 ring-1 ring-cyan-300/35">
              我方排名 #{targetRank}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <HelpCircle className="h-3.5 w-3.5" />
          <span>{items.length} 个品牌</span>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 py-10 text-center text-sm text-slate-500">
          暂无品牌声量数据
        </div>
      ) : compact ? (
        <CompactBrandVoiceTable items={items} maxMentions={maxMentions} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="min-w-[780px]">
              <div className="grid grid-cols-[60px_1fr_minmax(140px,2fr)_70px_70px_70px_60px] items-center gap-4 px-5 py-2.5 text-[11px] uppercase tracking-wider text-cyan-100/55 bg-white/[0.04]">
                <div>排名</div>
                <div>品牌</div>
                <div>声量强度</div>
                <div className="text-right">渗透率</div>
                <div className="text-right">声量占比</div>
                <div className="text-right">提及</div>
                <div className="text-right">模型</div>
              </div>

              <div className="divide-y divide-slate-800/60">
                {initialBatch.map(item => (
                  <BrandRow key={item.brand} item={item} maxMentions={maxMentions} />
                ))}
              </div>
            </div>
          </div>

          {hasMore && (
            <>
              {/* CSS Grid 0fr↔1fr 平滑展开：高度自适应、无 max-h 魔数 */}
              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                  expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
                aria-hidden={!expanded}
              >
                <div className="overflow-hidden">
                  <div className="overflow-x-auto border-t border-slate-800/60">
                    <div className="min-w-[780px] divide-y divide-slate-800/60">
                    {extraBatch.map(item => (
                      <BrandRow key={item.brand} item={item} maxMentions={maxMentions} />
                    ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center bg-white/[0.03] border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setExpanded(v => !v)}
                  aria-expanded={expanded}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 my-1 text-xs font-medium text-cyan-100/65 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                >
                  {expanded ? (
                    <>
                      <ChevronUp className="h-3.5 w-3.5" />
                      收起
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5" />
                      展开全部（共 {items.length} 个）
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function rankToneFor(item: BrandVoiceItem) {
  return item.rank === 1
    ? {
        row: "bg-[#1677FF]/12",
        rank: "bg-[#1677FF] text-white",
        bar: "bg-gradient-to-r from-[#1677FF] to-[#00C8FF]",
      }
    : item.rank === 2
      ? {
          row: "bg-[#13C2C2]/10",
          rank: "bg-[#13C2C2] text-white",
          bar: "bg-[#13C2C2]",
        }
      : item.rank === 3
        ? {
            row: "bg-[#2F54EB]/12",
            rank: "bg-[#2F54EB] text-white",
            bar: "bg-[#2F54EB]",
          }
        : {
            row: "hover:bg-white/[0.04]",
            rank: "bg-slate-800 text-slate-400 ring-1 ring-slate-700",
            bar: "bg-[#6E94C5]",
          }
}

function CompactBrandVoiceTable({ items, maxMentions }: { items: BrandVoiceItem[]; maxMentions: number }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-[36px_minmax(0,1fr)_minmax(72px,1fr)_56px_38px] items-center gap-2 bg-white/[0.04] px-3 py-2 text-[9px] text-cyan-100/55">
        <div>排名</div>
        <div>品牌</div>
        <div>声量</div>
        <div className="text-right">渗透率</div>
        <div className="text-right">提及</div>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-slate-800/60 overflow-y-auto">
        {items.map(item => {
          const rankTone = rankToneFor(item)
          const widthPct = maxMentions > 0 ? Math.max(2, (item.mentions / maxMentions) * 100) : 0
          const penetrationPct = (item.penetrationRate * 100).toFixed(item.penetrationRate < 0.001 ? 2 : 1)
          const targetTone = item.isTarget ? "ring-1 ring-inset ring-[#00C8FF]/55" : ""
          return (
            <div
              key={item.brand}
              className={`grid grid-cols-[36px_minmax(0,1fr)_minmax(72px,1fr)_56px_38px] items-center gap-2 px-3 py-2.5 transition-colors ${rankTone.row} ${targetTone}`}
              title={`${item.brand} · 声量占比 ${(item.ratio * 100).toFixed(1)}% · ${item.modelCount} 个模型`}
            >
              <div className={`inline-flex h-6 w-7 items-center justify-center rounded-md text-[10px] font-bold tabular-nums ${rankTone.rank}`}>
                {item.rank}
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                <div className={`min-w-0 flex-1 truncate text-xs ${item.isTarget ? "font-semibold text-cyan-100" : "font-medium text-slate-100"}`}>
                  {item.brand}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {item.models.slice(0, 3).map(model => (
                    <ModelAvatar key={model} model={model} size="xs" className="ring-1 ring-slate-900" />
                  ))}
                  {item.models.length > 3 ? <span className="ml-0.5 text-[9px] text-slate-500">+{item.models.length - 3}</span> : null}
                </div>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-slate-800/80 ring-1 ring-white/5">
                <div className={`absolute inset-y-0 left-0 rounded-full ${rankTone.bar}`} style={{ width: `${widthPct}%` }} />
              </div>
              <div className={`text-right text-[11px] tabular-nums ${item.isTarget ? "text-cyan-100" : "text-slate-300"}`}>
                {penetrationPct}%
              </div>
              <div className={`text-right text-xs tabular-nums ${item.isTarget ? "font-semibold text-cyan-100" : "text-slate-200"}`}>
                {item.mentions}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BrandRow({ item, maxMentions }: { item: BrandVoiceItem; maxMentions: number }) {
  const widthPct = maxMentions > 0 ? Math.max(2, (item.mentions / maxMentions) * 100) : 0
  const ratioPct = (item.ratio * 100).toFixed(item.ratio < 0.001 ? 2 : 1)
  const penetrationPct = (item.penetrationRate * 100).toFixed(
    item.penetrationRate < 0.001 ? 2 : 1
  )

  const rankTone = rankToneFor(item)
  const targetTone = item.isTarget ? "ring-1 ring-inset ring-[#00C8FF]/55" : ""

  return (
    <div
      className={`grid grid-cols-[60px_1fr_minmax(140px,2fr)_70px_70px_70px_60px] items-center gap-4 px-5 py-3.5 transition-colors ${
        rankTone.row
      } ${targetTone}`}
    >
      <div className={`inline-flex h-7 w-9 items-center justify-center rounded-md text-xs font-bold tabular-nums ${rankTone.rank}`}>
        {item.rank}
      </div>

      <div className="min-w-0">
        <div
          className={`text-sm truncate ${
            item.isTarget ? "text-cyan-100 font-semibold" : "text-slate-100 font-medium"
          }`}
          title={item.brand}
        >
          {item.brand}
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          {item.models.map(m => (
            <ModelAvatar
              key={m}
              model={m}
              size="xs"
              className="ring-2 ring-slate-900"
            />
          ))}
        </div>
      </div>

      <div className="relative h-2.5 rounded-full bg-slate-800/80 overflow-hidden ring-1 ring-white/5">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${rankTone.bar}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>

      <div
        className={`text-sm tabular-nums text-right ${
          item.isTarget ? "text-cyan-100" : "text-slate-300"
        }`}
      >
        {penetrationPct}%
      </div>
      <div
        className={`text-sm tabular-nums text-right ${
          item.isTarget ? "text-cyan-100" : "text-slate-300"
        }`}
      >
        {ratioPct}%
      </div>
      <div
        className={`text-sm tabular-nums text-right ${
          item.isTarget ? "text-cyan-100 font-semibold" : "text-slate-200"
        }`}
      >
        {item.mentions}
      </div>
      <div className="text-sm tabular-nums text-right text-slate-400">
        {item.modelCount}
      </div>
    </div>
  )
}
