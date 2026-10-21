"use client"

import { MODEL_LABELS } from "@/lib/model-labels"
import { isSameBrand } from "@/lib/score-utils"
import ModelAvatar from "@/components/model-avatar"
import type { IndustryShareItem, ModelKey } from "@/types"

interface Props {
  items: IndustryShareItem[]
  ourBrand: string
  limit?: number
}

function cellTone(rate: number): string {
  if (rate >= 0.4) return "bg-[#1677FF] text-white"
  if (rate >= 0.25) return "bg-[#69b1ff] text-white"
  if (rate >= 0.1) return "bg-[#d6e8ff] text-slate-800"
  if (rate > 0) return "bg-slate-50 text-slate-700"
  return "text-slate-300"
}

/**
 * Each leading brand's rate on each model. One brand's rate can differ several
 * times between models, so an overall average alone hides where it is strong.
 */
export default function BrandModelMatrix({ items, ourBrand, limit = 8 }: Props) {
  const rows = items.filter(item => item.perModel).slice(0, limit)
  const models = Array.from(new Set(rows.flatMap(item => Object.keys(item.perModel || {})))) as ModelKey[]
  if (rows.length === 0 || models.length === 0) return null

  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="sticky left-0 bg-white py-2 pr-3 text-left font-medium">品牌</th>
            <th className="px-2 py-2 text-right font-medium">整体</th>
            {models.map(model => (
              <th key={model} className="px-2 py-2 text-center font-medium">
                <span className="inline-flex items-center gap-1">
                  <ModelAvatar model={model} size="xs" />
                  {MODEL_LABELS[model]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(item => {
            const ours = isSameBrand(item.brand, ourBrand)
            return (
              <tr key={item.brand} className={ours ? "font-semibold" : undefined}>
                <td className={`sticky left-0 max-w-[220px] truncate border-t border-slate-100 py-2 pr-3 ${ours ? "bg-cyan-50 text-[#0958d9]" : "bg-white text-slate-700"}`} title={item.brand}>
                  {item.brand}
                </td>
                <td className="border-t border-slate-100 px-2 py-2 text-right tabular-nums text-slate-800">
                  {(item.penetrationRate * 100).toFixed(1)}%
                </td>
                {models.map(model => {
                  const cell = item.perModel?.[model]
                  const rate = cell && cell.total > 0 ? cell.mentions / cell.total : 0
                  return (
                    <td key={model} className="border-t border-slate-100 px-1 py-1 text-center">
                      <span
                        className={`inline-block min-w-[52px] rounded px-1.5 py-1 tabular-nums ${cellTone(rate)}`}
                        title={cell ? `${cell.mentions}/${cell.total} 条回答提及` : "无有效回答"}
                      >
                        {cell && cell.total > 0 ? `${Math.round(rate * 100)}%` : "—"}
                      </span>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
