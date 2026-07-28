"use client"

import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { ArticleComparisonBrand } from "@/types"

interface Props {
  primaryBrand: string
  suggestedBrands: string[]
  value: ArticleComparisonBrand[]
  onChange: (value: ArticleComparisonBrand[]) => void
}

function emptyBrand(position: number, name = ""): ArticleComparisonBrand {
  return {
    id: `comparison_${position}_${Date.now()}`,
    name,
    aliases: [],
    materials: "",
    sourceUrls: [],
    role: "supporting",
  }
}

const MAX_COMPARISON_BRANDS = 9

const ROLE_OPTIONS: Array<{
  value: NonNullable<ArticleComparisonBrand["role"]>
  label: string
}> = [
  { value: "supporting", label: "辅助推荐" },
  { value: "peer", label: "同级对比" },
  { value: "benchmark", label: "标杆参照" },
  { value: "alternative", label: "替代方案" },
]

export default function ArticleComparisonBrandPanel({
  primaryBrand,
  suggestedBrands,
  value,
  onChange,
}: Props) {
  const brands = value.slice(0, MAX_COMPARISON_BRANDS)

  function update(index: number, patch: Partial<ArticleComparisonBrand>) {
    onChange(brands.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )))
  }

  function addBrand() {
    if (brands.length >= MAX_COMPARISON_BRANDS) return
    const used = new Set([primaryBrand, ...brands.map(item => item.name)].map(item => item.trim()))
    const suggestion = suggestedBrands.find(item => item.trim() && !used.has(item.trim())) || ""
    onChange([...brands, emptyBrand(brands.length + 2, suggestion)])
  }

  return (
    <section className="rounded-lg border border-blue-100 bg-[#F7FBFF] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-700">对比品牌（选填）</div>
          <div className="mt-1 text-[11px] leading-5 text-slate-500">
            主品牌为“{primaryBrand || "当前客户"}”，可补充最多 {MAX_COMPARISON_BRANDS} 个独立对比品牌及各自资料。
          </div>
        </div>
        {brands.length < MAX_COMPARISON_BRANDS && (
          <Button type="button" size="sm" variant="outline" onClick={addBrand} className="h-8 shrink-0 gap-1">
            <Plus className="h-3.5 w-3.5" />
            添加品牌
          </Button>
        )}
      </div>

      {brands.length === 0 ? (
        <button
          type="button"
          onClick={addBrand}
          className="mt-3 w-full rounded-lg border border-dashed border-blue-200 bg-white px-3 py-3 text-xs font-medium text-[#0958D9] hover:bg-blue-50"
        >
          添加第二品牌
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          {brands.map((brand, index) => (
            <div key={brand.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  第 {index + 2} 品牌
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => onChange(brands.filter((_, itemIndex) => itemIndex !== index))}
                  className="h-7 w-7 text-slate-400 hover:text-rose-600"
                  title="移除该品牌"
                  aria-label="移除该品牌"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Label className="text-[11px] text-slate-500">
                  品牌名称
                  <Input
                    value={brand.name}
                    onChange={event => update(index, { name: event.target.value })}
                    placeholder="填写独立品牌名称"
                    className="mt-1 h-9 bg-white text-xs"
                  />
                </Label>
                <Label className="text-[11px] text-slate-500">
                  品牌别名
                  <Input
                    value={brand.aliases.join("、")}
                    onChange={event => update(index, {
                      aliases: event.target.value.split(/[,，、]/).map(item => item.trim()).filter(Boolean),
                    })}
                    placeholder="多个别名用顿号分隔"
                    className="mt-1 h-9 bg-white text-xs"
                  />
                </Label>
                <Label className="text-[11px] text-slate-500">
                  对比角色
                  <Select
                    value={brand.role || "supporting"}
                    onChange={event => update(index, {
                      role: event.target.value as NonNullable<ArticleComparisonBrand["role"]>,
                    })}
                    className="mt-1 h-9 bg-white text-xs"
                  >
                    {ROLE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </Label>
              </div>
              <Label className="mt-2 block text-[11px] text-slate-500">
                该品牌资料
                <Textarea
                  value={brand.materials}
                  onChange={event => update(index, { materials: event.target.value })}
                  placeholder="只填写可核验的产品、服务、参数、优势、限制或案例资料"
                  className="mt-1 min-h-20 bg-white text-xs"
                />
              </Label>
              <Label className="mt-2 block text-[11px] text-slate-500">
                资料来源链接
                <Textarea
                  value={brand.sourceUrls.join("\n")}
                  onChange={event => update(index, {
                    sourceUrls: event.target.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
                  })}
                  placeholder="每行一个公开来源网址"
                  className="mt-1 min-h-16 bg-white text-xs"
                />
              </Label>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
