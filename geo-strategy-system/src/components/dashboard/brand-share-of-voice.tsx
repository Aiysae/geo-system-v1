"use client"

import { useMemo, useState } from "react"
import { AudioLines, ChevronDown, ChevronUp, HelpCircle } from "lucide-react"
import type { BrandVoiceItem } from "@/lib/dashboard-aggregations"
import ModelAvatar from "@/components/model-avatar"

interface Props {
  items: BrandVoiceItem[]
  /** 折叠态默认展示的条数（默认 5） */
  defaultVisible?: number
}

export default function BrandShareOfVoice({ items, defaultVisible = 5 }: Props) {
  const [expanded, setExpanded] = useState(false)

  const initialBatch = useMemo(() => items.slice(0, defaultVisible), [items, defaultVisible])
  const extraBatch = useMemo(() => items.slice(defaultVisible), [items, defaultVisible])
  const hasMore = extraBatch.length > 0
  const targetRank = items.find(it => it.isTarget)?.rank ?? null
  // 进度条的"满刻度"参考：用首位提及数。这样最大声量品牌的条占满 100% 视觉宽度。
  const maxMentions = items[0]?.mentions ?? 1

  return (
    <div className="rounded-2xl bg-slate-900/95 ring-1 ring-slate-800 overflow-hidden shadow-xl shadow-black/20">
      <div className="px-5 py-4 flex items-center justify-between border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <AudioLines className="h-4 w-4 text-slate-400" />
          <div className="text-sm font-semibold text-slate-200">品牌声量表</div>
          {targetRank && (
            <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30">
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
        <div className="px-5 py-10 text-center text-sm text-slate-500">
          暂无品牌声量数据
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="min-w-[680px]">
              <div className="grid grid-cols-[60px_1fr_minmax(140px,2fr)_70px_70px_60px] items-center gap-4 px-5 py-2.5 text-[11px] uppercase tracking-wider text-slate-500 bg-slate-800/40">
                <div>排名</div>
                <div>品牌</div>
                <div>声量强度</div>
                <div className="text-right">百分比</div>
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
                    <div className="min-w-[680px] divide-y divide-slate-800/60">
                    {extraBatch.map(item => (
                      <BrandRow key={item.brand} item={item} maxMentions={maxMentions} />
                    ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center bg-slate-900/60 border-t border-slate-800/60">
                <button
                  type="button"
                  onClick={() => setExpanded(v => !v)}
                  aria-expanded={expanded}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 my-1 text-xs font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 rounded-md transition-colors"
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

function BrandRow({ item, maxMentions }: { item: BrandVoiceItem; maxMentions: number }) {
  const widthPct = maxMentions > 0 ? Math.max(2, (item.mentions / maxMentions) * 100) : 0
  const ratioPct = (item.ratio * 100).toFixed(item.ratio < 0.001 ? 2 : 1)

  return (
    <div
      className={`grid grid-cols-[60px_1fr_minmax(140px,2fr)_70px_70px_60px] items-center gap-4 px-5 py-3.5 transition-colors ${
        item.isTarget
          ? "bg-gradient-to-r from-amber-500/15 via-amber-500/[0.06] to-transparent ring-1 ring-inset ring-amber-400/30"
          : "hover:bg-slate-800/30"
      }`}
    >
      <div
        className={`text-sm tabular-nums ${
          item.isTarget ? "text-amber-300 font-semibold" : "text-slate-500"
        }`}
      >
        {item.rank}
      </div>

      <div className="min-w-0">
        <div
          className={`text-sm truncate ${
            item.isTarget ? "text-amber-200 font-semibold" : "text-slate-200 font-medium"
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

      <div className="relative h-2 rounded-full bg-slate-800/80 overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${
            item.isTarget
              ? "bg-gradient-to-r from-amber-400 to-orange-400"
              : "bg-gradient-to-r from-[#0077B6] via-[#00B4D8] to-[#48cae4]"
          }`}
          style={{ width: `${widthPct}%` }}
        />
      </div>

      <div
        className={`text-sm tabular-nums text-right ${
          item.isTarget ? "text-amber-200" : "text-slate-300"
        }`}
      >
        {ratioPct}%
      </div>
      <div
        className={`text-sm tabular-nums text-right ${
          item.isTarget ? "text-amber-200 font-semibold" : "text-slate-200"
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
