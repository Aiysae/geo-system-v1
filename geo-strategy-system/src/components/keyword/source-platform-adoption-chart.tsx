"use client"

import { useMemo, useState } from "react"
import { BarChart3, ChevronDown, ExternalLink } from "lucide-react"
import { MODEL_LABELS } from "@/lib/model-labels"
import { SOURCE_PLATFORM_CATEGORY_LABELS } from "@/lib/source-platform-intelligence"
import type {
  SourcePlatformCategory,
  SourcePlatformEvidence,
  SourcePlatformSnapshot,
} from "@/types/geo-strategy"

const CATEGORY_TONES: Record<SourcePlatformCategory, { bar: string; badge: string; dot: string }> = {
  self_media: {
    bar: "bg-[#1677FF]",
    badge: "border-blue-200 bg-blue-50 text-[#0958D9]",
    dot: "bg-[#1677FF]",
  },
  industry_vertical: {
    bar: "bg-[#00B8D9]",
    badge: "border-cyan-200 bg-cyan-50 text-cyan-700",
    dot: "bg-[#00B8D9]",
  },
  authority_media: {
    bar: "bg-[#FA8C16]",
    badge: "border-orange-200 bg-orange-50 text-orange-700",
    dot: "bg-[#FA8C16]",
  },
  government_association: {
    bar: "bg-[#F5222D]",
    badge: "border-red-200 bg-red-50 text-red-700",
    dot: "bg-[#F5222D]",
  },
  brand_official: {
    bar: "bg-[#6F42C1]",
    badge: "border-violet-200 bg-violet-50 text-violet-700",
    dot: "bg-[#6F42C1]",
  },
  other: {
    bar: "bg-slate-400",
    badge: "border-slate-200 bg-slate-50 text-slate-600",
    dot: "bg-slate-400",
  },
}

function modelLabel(model: string): string {
  return (MODEL_LABELS as Record<string, string>)[model] || model
}

function PlatformRow({
  rank,
  platform,
  totalAnswers,
  totalModels,
  expanded,
  onToggle,
}: {
  rank: number
  platform: SourcePlatformEvidence
  totalAnswers: number
  totalModels: number
  expanded: boolean
  onToggle: () => void
}) {
  const tone = CATEGORY_TONES[platform.category]
  const visibleEvidence = expanded ? platform.evidence.slice(0, 80) : []

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="group grid w-full grid-cols-[28px_minmax(88px,132px)_minmax(0,1fr)_52px] items-center gap-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677FF] focus-visible:ring-inset sm:grid-cols-[32px_150px_minmax(0,1fr)_62px]"
        aria-expanded={expanded}
        title={`${platform.platform}：${platform.answer_hits}/${totalAnswers} 次独立联网回答采信，${platform.citation_events} 次有效引用事件`}
      >
        <span className="text-center text-[11px] font-semibold tabular-nums text-slate-400">
          #{rank}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
            <span className="truncate text-xs font-semibold text-slate-700">{platform.platform}</span>
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-slate-400">
            {SOURCE_PLATFORM_CATEGORY_LABELS[platform.category]}
          </span>
        </span>
        <span className="min-w-0">
          <span className="block h-2.5 overflow-hidden rounded-sm bg-slate-100">
            <span
              className={`block h-full rounded-sm transition-[width] duration-500 ${tone.bar}`}
              style={{ width: `${Math.max(platform.adoption_rate, platform.adoption_rate > 0 ? 1.5 : 0)}%` }}
            />
          </span>
          <span className="mt-1 block truncate text-[10px] tabular-nums text-slate-400">
            命中 {platform.answer_hits}/{totalAnswers} · 引用 {platform.citation_events} · 意图 {platform.intent_count ?? platform.question_count} · 模型 {platform.model_keys.length}/{totalModels}
          </span>
        </span>
        <span className="flex items-center justify-end gap-1 text-right text-xs font-bold tabular-nums text-slate-700">
          {platform.adoption_rate}%
          <ChevronDown className={`h-3.5 w-3.5 text-slate-300 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
      </button>

      {expanded ? (
        <div className="mb-2 ml-0 border-l-2 border-slate-100 py-1 pl-3 sm:ml-8">
          <div className="mb-2 flex flex-wrap gap-1.5">
            <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${tone.badge}`}>
              采信率 {platform.adoption_rate}%
            </span>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
              模型均衡采信率 {platform.balanced_adoption_rate}%
            </span>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
              {platform.unique_url_count} 个不同网址
            </span>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
              {platform.intent_count ?? platform.question_count} 个独立语义
            </span>
            {platform.intent_adoption_rate != null ? (
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                意图覆盖率 {platform.intent_adoption_rate}%
              </span>
            ) : null}
          </div>
          <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto pr-1">
            {visibleEvidence.map((evidence, index) => (
              <a
                key={`${evidence.model}-${evidence.sample_id || evidence.question}-${evidence.url}-${index}`}
                href={evidence.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-2 py-2 text-[11px] text-slate-500 transition hover:text-[#0958D9]"
              >
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium leading-4">{evidence.title || evidence.domain}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                    {modelLabel(evidence.model)} · {evidence.question || evidence.domain}
                  </span>
                </span>
              </a>
            ))}
          </div>
          {platform.evidence.length > visibleEvidence.length ? (
            <div className="mt-1 text-[10px] text-slate-400">
              当前展开前 {visibleEvidence.length} 条，完整采信次数已计入统计。
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function SourcePlatformAdoptionChart({ snapshot }: { snapshot?: SourcePlatformSnapshot }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const rankedPlatforms = useMemo(
    () => snapshot?.platforms.filter(platform => platform.answer_hits > 0) || [],
    [snapshot],
  )
  const visiblePlatforms = showAll ? rankedPlatforms : rankedPlatforms.slice(0, 10)

  if (!snapshot || snapshot.successful_answer_count === 0 || rankedPlatforms.length === 0) {
    return (
      <div className="flex min-h-28 items-center justify-center border-y border-dashed border-slate-200 px-4 py-6 text-center">
        <div>
          <BarChart3 className="mx-auto h-5 w-5 text-slate-300" />
          <div className="mt-2 text-xs font-medium text-slate-500">暂无可统计的联网信源</div>
          <div className="mt-1 text-[11px] text-slate-400">完成疑问句联网检测后生成平台采信率排名</div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2 border-y border-slate-100 py-3 sm:grid-cols-5">
        <div className="border-r border-slate-100 px-2 text-center">
          <div className="text-base font-bold tabular-nums text-slate-800">{snapshot.successful_answer_count}</div>
          <div className="text-[10px] text-slate-400">成功联网回答</div>
        </div>
        <div className="border-r border-slate-100 px-2 text-center">
          <div className="text-base font-bold tabular-nums text-slate-800">{snapshot.total_citation_events}</div>
          <div className="text-[10px] text-slate-400">有效引用事件</div>
        </div>
        <div className="border-r border-slate-100 px-2 text-center">
          <div className="text-base font-bold tabular-nums text-slate-800">{snapshot.unique_url_count ?? "—"}</div>
          <div className="text-[10px] text-slate-400">唯一网址</div>
        </div>
        <div className="border-r border-slate-100 px-2 text-center">
          <div className="text-base font-bold tabular-nums text-slate-800">{snapshot.unique_domain_count ?? "—"}</div>
          <div className="text-[10px] text-slate-400">唯一域名</div>
        </div>
        <div className="px-2 text-center">
          <div className="text-base font-bold tabular-nums text-slate-800">{rankedPlatforms.length}</div>
          <div className="text-[10px] text-slate-400">采信平台</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[28px_minmax(88px,132px)_minmax(0,1fr)_52px] gap-2 border-b border-slate-100 pb-1.5 text-[10px] font-medium text-slate-400 sm:grid-cols-[32px_150px_minmax(0,1fr)_62px]">
        <span className="text-center">排名</span>
        <span>平台</span>
        <span>独立回答采信率</span>
        <span className="text-right">概率</span>
      </div>

      <div>
        {visiblePlatforms.map((platform, index) => (
          <PlatformRow
            key={platform.platform_key}
            rank={index + 1}
            platform={platform}
            totalAnswers={snapshot.successful_answer_count}
            totalModels={Math.max(snapshot.successful_model_count, 1)}
            expanded={expandedKey === platform.platform_key}
            onToggle={() => setExpandedKey(current => current === platform.platform_key ? null : platform.platform_key)}
          />
        ))}
      </div>

      {rankedPlatforms.length > 10 ? (
        <button
          type="button"
          onClick={() => setShowAll(value => !value)}
          className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-[#0958D9] hover:text-[#1677FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677FF] focus-visible:ring-offset-2"
        >
          {showAll ? "收起至 Top 10" : `查看其余 ${rankedPlatforms.length - 10} 个平台`}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAll ? "rotate-180" : ""}`} />
        </button>
      ) : null}

      {snapshot.sample_confidence !== "high" ? (
        <div className="mt-3 border-l-2 border-amber-300 pl-2 text-[10px] leading-4 text-amber-700">
          当前样本
          {snapshot.sample_confidence === "medium" ? "属于方向性结果" : "属于探索性结果"}
          ：覆盖 {snapshot.semantic_intent_count ?? snapshot.distinct_question_count ?? 0} 个独立语义意图。
          平台排序会保留不同模型的重复采信事件，但建议结合唯一网址和唯一域名一起判断稳定权重。
        </div>
      ) : null}
    </div>
  )
}
