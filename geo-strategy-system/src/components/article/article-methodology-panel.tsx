"use client"

import { useState } from "react"
import {
  BookOpenCheck,
  ChevronDown,
  Database,
  Settings2,
  Sparkles,
} from "lucide-react"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { GEO_ARTICLE_FORMAT_OPTIONS } from "@/lib/geo-methodology/article-formats"
import { getGeoContentRecipe } from "@/lib/geo-methodology/content-recipes"
import { cn } from "@/lib/utils"
import type {
  ArticleMethodologySelection,
  GeoArticleFormatKey,
  GeoBrandLayout,
  GeoContentPlatform,
  GeoMethodologyKey,
  GeoTitleStrategy,
} from "@/types"

const METHOD_OPTIONS: Array<{ value: GeoMethodologyKey; label: string }> = [
  { value: "problemSolution", label: "问题解决" },
  { value: "primaryEvidence", label: "证据链说明" },
  { value: "evidenceStory", label: "案例故事" },
  { value: "explainer", label: "专业科普" },
  { value: "industryWhitepaper", label: "行业研究" },
  { value: "entityKnowledge", label: "主体认知" },
  { value: "recommendationComparison", label: "推荐对比" },
]

const PLATFORM_OPTIONS: Array<{ value: GeoContentPlatform; label: string }> = [
  { value: "auto", label: "自动适配" },
  { value: "universal", label: "通用长文" },
  { value: "officialSite", label: "官网" },
  { value: "sohu", label: "搜狐" },
  { value: "toutiao", label: "今日头条" },
  { value: "netease", label: "网易" },
  { value: "baijiahao", label: "百家号" },
  { value: "zhihu", label: "知乎" },
  { value: "xiaohongshu", label: "小红书" },
  { value: "douyin", label: "抖音图文" },
]

const BRAND_LAYOUT_OPTIONS: Array<{ value: GeoBrandLayout; label: string }> = [
  { value: "auto", label: "自动判断" },
  { value: "singlePrimary", label: "单一主品牌" },
  { value: "primaryFourSupporting", label: "一主多辅" },
  { value: "tieredFive", label: "分层盘点" },
  { value: "comparisonMatrix", label: "同维横评" },
  { value: "topList", label: "榜单清单" },
]

const TITLE_OPTIONS: Array<{ value: GeoTitleStrategy; label: string }> = [
  { value: "auto", label: "自动判断" },
  { value: "directAnswer", label: "直接回答" },
  { value: "audienceScenario", label: "人群场景" },
  { value: "decisionCriteria", label: "决策标准" },
  { value: "evidenceHook", label: "证据切入" },
  { value: "riskAvoidance", label: "风险避坑" },
  { value: "localService", label: "本地服务" },
  { value: "comparisonMatrix", label: "对比矩阵" },
  { value: "tieredList", label: "分层清单" },
  { value: "marketTrend", label: "趋势研究" },
  { value: "priceTransparency", label: "价格成本" },
]

interface Props {
  value?: ArticleMethodologySelection
  knowledgeAssetCount: number
  sourceLinkedAssetCount: number
  onChange: (value: ArticleMethodologySelection) => void
}

function normalized(value?: ArticleMethodologySelection): ArticleMethodologySelection {
  return {
    mode: value?.mode === "manual" ? "manual" : "auto",
    methodKey: value?.methodKey,
    articleFormat: value?.articleFormat || "auto",
    targetPlatform: value?.targetPlatform || "auto",
    brandLayout: value?.brandLayout || "auto",
    titleStrategy: value?.titleStrategy || "auto",
  }
}

export default function ArticleMethodologyPanel({
  value,
  knowledgeAssetCount,
  sourceLinkedAssetCount,
  onChange,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const current = normalized(value)
  const selectedMethod = current.methodKey || "problemSolution"
  const recipe = getGeoContentRecipe(selectedMethod)
  const formatOptions = GEO_ARTICLE_FORMAT_OPTIONS.filter(option => (
    recipe.allowedFormats.includes(option.value)
  ))
  const patch = (next: Partial<ArticleMethodologySelection>) => onChange({
    ...current,
    ...next,
  })

  return (
    <section className="rounded-lg border border-[#C7E2FF] bg-gradient-to-r from-[#F3F9FF] via-white to-[#F0FCFF] p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1677FF] text-white">
            <BookOpenCheck className="h-4 w-4" />
          </span>
          <div>
            <div className="text-xs font-semibold text-slate-800">内容目标</div>
            <div className="mt-1 text-[11px] leading-5 text-slate-500">
              自动匹配写作目标、内容结构和证据要求，也可按任务指定。
            </div>
          </div>
        </div>
        <div className="flex h-8 shrink-0 rounded-lg border border-blue-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => patch({ mode: "auto", articleFormat: "auto", brandLayout: "auto", titleStrategy: "auto" })}
            className={cn(
              "rounded-md px-2.5 text-[11px] font-semibold transition",
              current.mode === "auto" ? "bg-[#1677FF] text-white" : "text-slate-500",
            )}
          >
            自动
          </button>
          <button
            type="button"
            onClick={() => patch({
              mode: "manual",
              methodKey: selectedMethod,
              articleFormat: "auto",
              brandLayout: "auto",
              titleStrategy: "auto",
            })}
            className={cn(
              "rounded-md px-2.5 text-[11px] font-semibold transition",
              current.mode === "manual" ? "bg-[#1677FF] text-white" : "text-slate-500",
            )}
          >
            手动
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Label className="text-[11px] text-slate-500">
          内容目标
          <Select
            value={selectedMethod}
            disabled={current.mode !== "manual"}
            onChange={event => patch({
              methodKey: event.target.value as GeoMethodologyKey,
              mode: "manual",
              articleFormat: "auto",
              brandLayout: "auto",
              titleStrategy: "auto",
            })}
            className="mt-1 h-9 bg-white text-xs disabled:bg-slate-50"
          >
            {METHOD_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </Label>
        <Label className="text-[11px] text-slate-500">
          发布平台
          <Select
            value={current.targetPlatform}
            onChange={event => patch({ targetPlatform: event.target.value as GeoContentPlatform })}
            className="mt-1 h-9 bg-white text-xs"
          >
            {PLATFORM_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </Label>
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen(open => !open)}
        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 transition hover:border-[#69B1FF] hover:text-[#0958D9]"
        aria-expanded={advancedOpen}
      >
        <Settings2 className="h-3.5 w-3.5" />
        高级设置
        <ChevronDown className={cn("h-3.5 w-3.5 transition", advancedOpen && "rotate-180")} />
      </button>

      {advancedOpen ? (
        <div className="mt-2 grid gap-2 rounded-lg border border-blue-100 bg-white/80 p-2.5 sm:grid-cols-3">
          <Label className="text-[11px] text-slate-500">
            文章形态
            <Select
              value={recipe.allowedFormats.includes(current.articleFormat as Exclude<GeoArticleFormatKey, "auto">)
                ? current.articleFormat
                : "auto"}
              disabled={current.mode !== "manual"}
              onChange={event => patch({ articleFormat: event.target.value as GeoArticleFormatKey })}
              className="mt-1 h-9 bg-white text-xs disabled:bg-slate-50"
            >
              <option value="auto">按内容目标匹配</option>
              {formatOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </Label>
          <Label className="text-[11px] text-slate-500">
            品牌结构
            <Select
              value={current.brandLayout}
              disabled={current.mode !== "manual"}
              onChange={event => patch({ brandLayout: event.target.value as GeoBrandLayout })}
              className="mt-1 h-9 bg-white text-xs disabled:bg-slate-50"
            >
              {BRAND_LAYOUT_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </Label>
          <Label className="text-[11px] text-slate-500">
            标题方向
            <Select
              value={current.titleStrategy}
              disabled={current.mode !== "manual"}
              onChange={event => patch({ titleStrategy: event.target.value as GeoTitleStrategy })}
              className="mt-1 h-9 bg-white text-xs disabled:bg-slate-50"
            >
              {TITLE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </Label>
          {current.mode === "auto" ? (
            <p className="text-[10px] text-slate-400 sm:col-span-3">自动模式会统一确定文章形态、品牌结构和标题方向。</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 ring-1 ring-slate-200">
          <BookOpenCheck className="h-3 w-3 text-violet-500" />
          {current.mode === "auto" ? "按任务自动选择" : recipe.title}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 ring-1 ring-slate-200">
          <Database className="h-3 w-3 text-[#1677FF]" />
          资料库 {knowledgeAssetCount} 条，本篇按主题匹配
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 ring-1 ring-slate-200">
          <Sparkles className="h-3 w-3 text-cyan-500" />
          {sourceLinkedAssetCount} 条带来源
        </span>
      </div>
    </section>
  )
}
