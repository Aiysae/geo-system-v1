"use client"

import {
  ArrowRight,
  BadgeCheck,
  Loader2,
  Plus,
  ScanSearch,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type {
  ArticleRewriteAnalysis,
  ArticleRewriteAudit,
  ArticleRewriteBrandMapping,
  ArticleRewriteBrandRole,
} from "@/types"

const ROLE_LABELS: Record<ArticleRewriteBrandRole, string> = {
  primary: "全文主推",
  featured: "重点介绍",
  listed: "并列介绍",
  background: "背景提及",
}

const ROLE_STYLES: Record<ArticleRewriteBrandRole, string> = {
  primary: "bg-blue-600 text-white",
  featured: "bg-cyan-100 text-cyan-800",
  listed: "bg-indigo-50 text-indigo-700",
  background: "bg-slate-100 text-slate-600",
}

interface Props {
  sourceReady: boolean
  analysis?: ArticleRewriteAnalysis
  mappings: ArticleRewriteBrandMapping[]
  audit?: ArticleRewriteAudit
  analyzing: boolean
  analysisError?: string
  onAnalyze: () => void
  onChangeMappings: (mappings: ArticleRewriteBrandMapping[]) => void
}

export default function ArticleRewriteBrandMapper({
  sourceReady,
  analysis,
  mappings,
  audit,
  analyzing,
  analysisError,
  onAnalyze,
  onChangeMappings,
}: Props) {
  const candidates = analysis?.brands || []

  function updateMapping(index: number, patch: Partial<ArticleRewriteBrandMapping>) {
    const next = mappings.map((mapping, currentIndex) => {
      if (currentIndex !== index) return mapping
      const merged = { ...mapping, ...patch }
      if (patch.sourceBrand !== undefined) {
        const candidate = candidates.find(item => item.name === patch.sourceBrand)
        merged.sourceAliases = candidate?.aliases || []
      }
      return merged
    })
    onChangeMappings(next)
  }

  function addMapping() {
    if (mappings.length >= 10) return
    const used = new Set(mappings.map(mapping => mapping.sourceBrand))
    const candidate = candidates.find(item => !used.has(item.name))
    onChangeMappings([
      ...mappings,
      {
        sourceBrand: candidate?.name || "",
        sourceAliases: candidate?.aliases || [],
        targetBrand: "",
        materials: "",
      },
    ])
  }

  function removeMapping(index: number) {
    if (mappings.length <= 1) return
    onChangeMappings(mappings.filter((_, currentIndex) => currentIndex !== index))
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-blue-100 bg-blue-50/55 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ScanSearch className="h-4 w-4 text-[#1677FF]" />
              原文主要品牌分析
            </div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              系统会结合介绍篇幅、文章结构和推荐角色，判断原文中的主要品牌。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onAnalyze}
            disabled={!sourceReady || analyzing}
            className="h-9 shrink-0 gap-1.5 rounded-lg border-blue-200 bg-white text-[#0958D9] hover:bg-blue-50"
          >
            {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
            {analyzing ? "正在分析..." : analysis ? "重新分析" : "分析主要品牌"}
          </Button>
        </div>

        {analysisError && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {analysisError}
          </div>
        )}

        {analysis && (
          candidates.length > 0 ? (
            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
              {candidates.map((candidate, index) => (
                <div
                  key={`${candidate.name}-${index}`}
                  className="rounded-lg border border-blue-100 bg-white px-3 py-2.5 shadow-sm shadow-blue-900/5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#1677FF]">#{index + 1}</span>
                    <span className="text-sm font-semibold text-slate-900">{candidate.name}</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${ROLE_STYLES[candidate.role]}`}>
                      {ROLE_LABELS[candidate.role]}
                    </span>
                    {candidate.aliases.length > 0 && (
                      <span className="text-[10px] text-slate-400">
                        别名：{candidate.aliases.join(" / ")}
                      </span>
                    )}
                  </div>
                  <details className="mt-2 text-[10px] text-slate-500">
                    <summary className="cursor-pointer font-medium text-[#0958D9]">查看判断依据</summary>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                      <span>介绍篇幅 {candidate.descriptionChars} 字</span>
                      <span>{candidate.blockCount} 个内容区块</span>
                      <span>{candidate.headingCount} 个小标题</span>
                      <span>{candidate.tableRowCount} 个表格行</span>
                      <span>提及 {candidate.mentionCount} 次</span>
                    </div>
                    {(candidate.detailSignals.length > 0 || candidate.evidence.length > 0) && (
                      <div className="mt-1.5 leading-4 text-slate-400">
                        {[...candidate.detailSignals, ...candidate.evidence].slice(0, 5).join(" · ")}
                      </div>
                    )}
                  </details>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-blue-200 bg-white/70 px-3 py-3 text-xs text-slate-500">
              没有识别到明确品牌。可以在下方手动填写原文品牌和新品牌映射。
            </div>
          )
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">品牌一对一替换映射</div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              默认按上方主要品牌顺序配对。未建立映射的品牌会保留，不会统一替换。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={addMapping}
            disabled={mappings.length >= 10}
            className="h-9 shrink-0 gap-1.5 rounded-lg"
          >
            <Plus className="h-3.5 w-3.5" />
            增加品牌
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          {mappings.map((mapping, index) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <span className="font-mono text-[#1677FF]">#{index + 1}</span>
                  原品牌
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                  新品牌
                </div>
                <button
                  type="button"
                  onClick={() => removeMapping(index)}
                  disabled={mappings.length <= 1}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30"
                  title="删除这组品牌映射"
                  aria-label={`删除第 ${index + 1} 组品牌映射`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-slate-500">原文品牌</span>
                  <Input
                    list={`rewrite-source-brands-${index}`}
                    value={mapping.sourceBrand}
                    onChange={event => updateMapping(index, { sourceBrand: event.target.value })}
                    placeholder="选择或手动输入原文品牌"
                    className="h-10 rounded-lg bg-white"
                  />
                  <datalist id={`rewrite-source-brands-${index}`}>
                    {candidates.map(candidate => (
                      <option key={candidate.name} value={candidate.name} />
                    ))}
                  </datalist>
                </label>
                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-slate-500">替换为</span>
                  <Input
                    value={mapping.targetBrand}
                    onChange={event => updateMapping(index, { targetBrand: event.target.value })}
                    placeholder="填写新品牌或产品名称"
                    className="h-10 rounded-lg bg-white"
                  />
                </label>
              </div>

              <label className="mt-3 block text-xs">
                <span className="mb-1.5 block font-medium text-slate-500">该品牌对应资料</span>
                <Textarea
                  value={mapping.materials}
                  onChange={event => updateMapping(index, { materials: event.target.value })}
                  placeholder="只填写这个新品牌的介绍、优势、产品、参数、案例和场景，系统不会与其他品牌资料混用。"
                  className="min-h-[110px] rounded-lg bg-white"
                />
              </label>
            </div>
          ))}
        </div>
      </section>

      {audit && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-900">
          <div className="flex items-center gap-2 font-semibold">
            {audit.repaired ? <BadgeCheck className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            品牌映射核验通过{audit.repaired ? "，系统已自动修复一次" : ""}
          </div>
          <div className="mt-1.5 leading-5 text-emerald-800/80">
            已替换：{audit.mappedPairs.map(pair => `${pair.sourceBrand} → ${pair.targetBrand}`).join("；")}
            {audit.protectedBrands.length > 0 ? `。已保留其他品牌：${audit.protectedBrands.join("、")}` : ""}
          </div>
        </section>
      )}
    </div>
  )
}
