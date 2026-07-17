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
  const compactItems = expanded ? items : initialBatch
  const hasMore = extraBatch.length > 0
  const targetRank = items.find(it => it.isTarget)?.rank ?? null
  // 进度条的"满刻度"参考：用首位提及数。这样最大声量品牌的条占满 100% 视觉宽度。
  const maxMentions = items[0]?.mentions ?? 1

  return (
    <div className={`geo-panel overflow-hidden ${compact ? "flex h-full min-h-[360px] flex-col" : ""}`}>
      <div className={`${compact ? "px-4 py-3" : "px-5 py-4"} flex items-center justify-between border-b border-[#E8EEF5] bg-white`}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00C8FF]">
            <AudioLines className="h-4 w-4 text-white" />
          </span>
          <div className="text-sm font-semibold text-[#102A43]">品牌声量表</div>
          {targetRank && (
            <span className="ml-2 rounded-full bg-[#E6F4FF] px-2 py-0.5 text-[10px] text-[#0958D9] ring-1 ring-[#BAE0FF]">
              我方排名 #{targetRank}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[#7E91A7]">
          <HelpCircle className="h-3.5 w-3.5" />
          <span>{items.length} 个品牌</span>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 py-10 text-center text-sm text-slate-500">
          暂无品牌声量数据
        </div>
      ) : compact ? (
        <>
          <CompactBrandVoiceTable items={compactItems} maxMentions={maxMentions} />
          {hasMore ? (
            <BrandTableToggle
              expanded={expanded}
              total={items.length}
              visibleCount={defaultVisible}
              onToggle={() => setExpanded(value => !value)}
            />
          ) : null}
        </>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="min-w-[780px]">
                <div className="grid grid-cols-[60px_1fr_minmax(140px,2fr)_70px_70px_70px_60px] items-center gap-4 bg-[#F5F8FC] px-5 py-2.5 text-[11px] text-[#60758D]">
                <div>排名</div>
                <div>品牌</div>
                <div>声量强度</div>
                <div className="text-right">渗透率</div>
                <div className="text-right">声量占比</div>
                <div className="text-right">提及</div>
                <div className="text-right">模型</div>
              </div>

              <div className="divide-y divide-slate-100">
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
                  <div className="overflow-x-auto border-t border-slate-100">
                    <div className="min-w-[780px] divide-y divide-slate-100">
                    {extraBatch.map(item => (
                      <BrandRow key={item.brand} item={item} maxMentions={maxMentions} />
                    ))}
                    </div>
                  </div>
                </div>
              </div>

              <BrandTableToggle
                expanded={expanded}
                total={items.length}
                visibleCount={defaultVisible}
                onToggle={() => setExpanded(value => !value)}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}

function BrandTableToggle({
  expanded,
  total,
  visibleCount,
  onToggle,
}: {
  expanded: boolean
  total: number
  visibleCount: number
  onToggle: () => void
}) {
  return (
    <div className="flex justify-center border-t border-slate-100 bg-[#F8FAFD]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="my-1 inline-flex min-h-9 items-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium text-[#526A83] transition-colors hover:bg-[#EAF3FF] hover:text-[#0958D9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677FF]/35"
      >
        {expanded ? (
          <>
            <ChevronUp className="h-3.5 w-3.5" />
            收起至前 {Math.min(visibleCount, total)} 个
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5" />
            展开全部（共 {total} 个）
          </>
        )}
      </button>
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
            row: "hover:bg-[#F7FAFD]",
            rank: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
            bar: "bg-[#6E94C5]",
          }
}

function CompactBrandVoiceTable({ items, maxMentions }: { items: BrandVoiceItem[]; maxMentions: number }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-[36px_minmax(0,1fr)_minmax(72px,1fr)_56px_38px] items-center gap-2 bg-[#F5F8FC] px-3 py-2 text-[9px] text-[#60758D]">
        <div>排名</div>
        <div>品牌</div>
        <div>声量</div>
        <div className="text-right">渗透率</div>
        <div className="text-right">提及</div>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
        {items.map(item => {
          const rankTone = rankToneFor(item)
          const widthPct = maxMentions > 0 ? Math.max(2, (item.mentions / maxMentions) * 100) : 0
          const penetrationPct = (item.penetrationRate * 100).toFixed(item.penetrationRate < 0.001 ? 2 : 1)
          const targetTone = item.isTarget ? "ring-1 ring-inset ring-[#69B1FF]" : ""
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
                <div className={`min-w-0 flex-1 truncate text-xs ${item.isTarget ? "font-semibold text-[#0958D9]" : "font-medium text-[#38536E]"}`}>
                  {item.brand}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {item.models.slice(0, 3).map(model => (
                    <ModelAvatar key={model} model={model} size="xs" className="ring-1 ring-white" />
                  ))}
                  {item.models.length > 3 ? <span className="ml-0.5 text-[9px] text-slate-500">+{item.models.length - 3}</span> : null}
                </div>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/80">
                <div className={`absolute inset-y-0 left-0 rounded-full ${rankTone.bar}`} style={{ width: `${widthPct}%` }} />
              </div>
              <div className={`text-right text-[11px] tabular-nums ${item.isTarget ? "text-[#0958D9]" : "text-[#526A83]"}`}>
                {penetrationPct}%
              </div>
              <div className={`text-right text-xs tabular-nums ${item.isTarget ? "font-semibold text-[#0958D9]" : "text-[#38536E]"}`}>
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
  const targetTone = item.isTarget ? "ring-1 ring-inset ring-[#69B1FF]" : ""

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
            item.isTarget ? "text-[#0958D9] font-semibold" : "text-[#38536E] font-medium"
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
              className="ring-2 ring-white"
            />
          ))}
        </div>
      </div>

      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/80">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${rankTone.bar}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>

      <div
        className={`text-sm tabular-nums text-right ${
          item.isTarget ? "text-[#0958D9]" : "text-[#526A83]"
        }`}
      >
        {penetrationPct}%
      </div>
      <div
        className={`text-sm tabular-nums text-right ${
          item.isTarget ? "text-[#0958D9]" : "text-[#526A83]"
        }`}
      >
        {ratioPct}%
      </div>
      <div
        className={`text-sm tabular-nums text-right ${
          item.isTarget ? "text-[#0958D9] font-semibold" : "text-[#38536E]"
        }`}
      >
        {item.mentions}
      </div>
      <div className="text-right text-sm tabular-nums text-[#7E91A7]">
        {item.modelCount}
      </div>
    </div>
  )
}
