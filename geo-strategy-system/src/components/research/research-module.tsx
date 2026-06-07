"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { apiFetch } from "@/lib/api-fetch"
import type { Client, CompetitorCompareResult, CompetitorCompareSourceMode, CompetitorComparison, ResearchManualInput, ResearchMode, ResearchResult, ResearchSourceMode } from "@/types"
import {
  BarChart3,
  Brain,
  CheckCircle2,
  FlaskConical,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Swords,
  TriangleAlert,
} from "lucide-react"

const EMPTY_MANUAL_INPUT: ResearchManualInput = {
  region: "",
  industry: "",
  fullName: "",
  aliases: "",
}

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}

export default function ResearchModule({ client, onChangeClient }: Props) {
  const [mode, setMode] = useState<ResearchMode>("ai")
  const [researchSourceMode, setResearchSourceMode] = useState<ResearchSourceMode>(() => client.researchSourceMode ?? "module")
  const [manualInput, setManualInput] = useState<ResearchManualInput>(() => ({
    ...EMPTY_MANUAL_INPUT,
    ...(client.researchManualInput ?? {}),
  }))
  const [compareSourceMode, setCompareSourceMode] = useState<CompetitorCompareSourceMode>(() => client.competitorCompareSourceMode ?? "module")
  const [customCompetitorsText, setCustomCompetitorsText] = useState(() => (client.competitorCompareCustomCompetitors ?? []).join("\n"))
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>(() => client.competitorCompareSelectedCompetitors ?? client.competitorCompare?.selectedCompetitors ?? [])
  const [hypothesis, setHypothesis] = useState(() => client.research?.hypothesis ?? "")
  const [researchLoading, setResearchLoading] = useState(false)
  const [compareLoading, setCompareLoading] = useState(false)
  const [researchError, setResearchError] = useState<string | null>(null)
  const [compareError, setCompareError] = useState<string | null>(null)

  const competitorOptions = useMemo(() => {
    const names = new Set<string>()
    for (const name of client.penetration?.aggregated.topCompetitors ?? []) {
      if (name.trim()) names.add(name.trim())
    }
    for (const item of client.penetration?.aggregated.industryShare ?? []) {
      if (item.brand.trim() && item.brand.trim() !== client.ourBrand.trim()) names.add(item.brand.trim())
    }
    for (const name of client.competitors) {
      if (name.trim()) names.add(name.trim())
    }
    return Array.from(names).slice(0, 12)
  }, [client.competitors, client.ourBrand, client.penetration])

  const customCompetitorOptions = useMemo(() => parseLines(customCompetitorsText).slice(0, 20), [customCompetitorsText])
  const compareOptions = compareSourceMode === "manual" ? customCompetitorOptions : competitorOptions
  const activeSelectedCompetitors = selectedCompetitors.filter(name => compareOptions.includes(name)).slice(0, 5)
  const effectiveOurBrand = researchSourceMode === "manual" ? manualInput.fullName.trim() : client.ourBrand.trim()
  const effectiveIndustry = researchSourceMode === "manual" ? manualInput.industry.trim() : client.industry.trim()
  const researchReady = researchSourceMode === "manual"
    ? !!manualInput.fullName.trim() && !!manualInput.industry.trim()
    : !!client.ourBrand.trim()
  const compareReady = !!(client.ourBrand.trim() || manualInput.fullName.trim()) && activeSelectedCompetitors.length > 0

  function updateResearchSourceMode(value: ResearchSourceMode) {
    setResearchSourceMode(value)
    onChangeClient({ researchSourceMode: value })
  }

  function updateManualInput(field: keyof ResearchManualInput, value: string) {
    setManualInput(prev => {
      const next = { ...prev, [field]: value }
      onChangeClient({ researchManualInput: next })
      return next
    })
  }

  function updateCompareSourceMode(value: CompetitorCompareSourceMode) {
    setCompareSourceMode(value)
    setSelectedCompetitors([])
    onChangeClient({ competitorCompareSourceMode: value, competitorCompareSelectedCompetitors: [] })
  }

  function updateCustomCompetitors(value: string) {
    setCustomCompetitorsText(value)
    const parsed = parseLines(value).slice(0, 20)
    setSelectedCompetitors(prev => {
      const nextSelected = prev.filter(name => parsed.includes(name)).slice(0, 5)
      onChangeClient({
        competitorCompareCustomCompetitors: parsed,
        competitorCompareSelectedCompetitors: nextSelected,
      })
      return nextSelected
    })
  }

  function toggleCompetitor(name: string) {
    setSelectedCompetitors(prev => {
      const exists = prev.includes(name)
      const next = exists ? prev.filter(item => item !== name) : [...prev, name].slice(0, 5)
      onChangeClient({ competitorCompareSelectedCompetitors: next })
      return next
    })
  }

  async function runResearch(nextMode: ResearchMode) {
    setMode(nextMode)
    setResearchLoading(true)
    setResearchError(null)
    try {
      const res = await apiFetch("/api/research", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: nextMode,
          sourceMode: researchSourceMode,
          hypothesis,
          ourBrand: effectiveOurBrand,
          region: researchSourceMode === "manual" ? manualInput.region : "",
          aliases: researchSourceMode === "manual" ? parseLines(manualInput.aliases) : [],
          industry: effectiveIndustry,
          website: researchSourceMode === "manual" ? "" : client.website,
          competitors: researchSourceMode === "manual" ? [] : client.competitors,
          penetration: researchSourceMode === "module" ? client.penetration : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "调研失败")
      onChangeClient({ research: data as ResearchResult })
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : "未知错误")
    } finally {
      setResearchLoading(false)
    }
  }

  async function runCompare() {
    setCompareLoading(true)
    setCompareError(null)
    try {
      const compareOurBrand = client.ourBrand.trim() || manualInput.fullName.trim()
      const compareIndustry = compareSourceMode === "manual" ? manualInput.industry.trim() || client.industry : client.industry
      const allCompetitors = compareSourceMode === "manual" ? customCompetitorOptions : compareOptions
      const res = await apiFetch("/api/competitor-compare", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ourBrand: compareOurBrand,
          industry: compareIndustry,
          website: client.website,
          competitors: allCompetitors,
          selectedCompetitors: activeSelectedCompetitors,
          penetration: compareSourceMode === "module" ? client.penetration : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "竞品对比失败")
      onChangeClient({ competitorCompare: data as CompetitorCompareResult })
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : "未知错误")
    } finally {
      setCompareLoading(false)
    }
  }

  const research = client.research
  const compare = client.competitorCompare

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3 text-sm text-slate-800 sm:text-base">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-teal-200/50">
            <Brain className="h-5 w-5 text-white" />
          </span>
          <span className="min-w-0 bg-gradient-to-r from-emerald-600 to-cyan-600 bg-clip-text text-transparent font-semibold leading-snug">
            独立调研 · 豆包深度品牌画像与竞品对比
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-xl border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/40 to-cyan-50/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-emerald-600" />
                <div>
                  <div className="text-sm font-semibold text-slate-800">品牌 AI 心智调研</div>
                  <div className="text-[11px] text-slate-500">豆包视角 · 与疑问句检测结果独立保存</div>
                </div>
              </div>
              <div className="inline-flex rounded-lg bg-white/80 border border-emerald-100 p-1">
                <button
                  type="button"
                  onClick={() => setMode("ai")}
                  className={`px-3 py-1.5 text-xs rounded-md transition ${mode === "ai" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:text-emerald-700"}`}
                >
                  AI 调研
                </button>
                <button
                  type="button"
                  onClick={() => setMode("hypothesis")}
                  className={`px-3 py-1.5 text-xs rounded-md transition ${mode === "hypothesis" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:text-emerald-700"}`}
                >
                  做假设
                </button>
              </div>
            </div>

            <SourceTabs
              value={researchSourceMode}
              onChange={updateResearchSourceMode}
              moduleLabel="用模块 1 信息"
              manualLabel="手动填资料"
            />

            {researchSourceMode === "manual" && (
              <ManualResearchFields
                value={manualInput}
                onChange={updateManualInput}
              />
            )}

            {mode === "hypothesis" && (
              <div className="mb-3">
                <Label className="text-xs text-slate-600 mb-1.5 block">要验证的假设</Label>
                <Textarea
                  value={hypothesis}
                  onChange={event => setHypothesis(event.target.value)}
                  rows={4}
                  placeholder="例如：豆包不推荐我们，是因为缺少第三方测评和行业榜单信源。"
                  className="bg-white/80 text-xs"
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2 mb-4">
              <Button
                onClick={() => runResearch("ai")}
                disabled={researchLoading || !researchReady}
                className="gap-1.5 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:shadow-lg hover:shadow-emerald-200/60 border-0"
                size="sm"
              >
                {researchLoading && mode === "ai" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                {research?.mode === "ai" ? "重新 AI 调研" : "开始 AI 调研"}
              </Button>
              <Button
                onClick={() => runResearch("hypothesis")}
                disabled={researchLoading || !researchReady || !hypothesis.trim()}
                variant="outline"
                className="gap-1.5 bg-white/70"
                size="sm"
              >
                {researchLoading && mode === "hypothesis" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                验证假设
              </Button>
            </div>

            {researchError && <ErrorBox message={researchError} />}

            {!research ? (
              <EmptyBlock title="调研报告待生成" text={researchSourceMode === "module" ? "会结合模块一疑问句检测结果做深度分析" : "填写地区、行业、品牌全称和别名后即可独立调研"} />
            ) : (
              <ResearchReport result={research} />
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Swords className="h-4 w-4 text-rose-600" />
                <div>
                  <div className="text-sm font-semibold text-slate-800">竞品优劣势对比</div>
                  <div className="text-[11px] text-slate-500">基于检测竞品与豆包心智生成对比报告</div>
                </div>
              </div>
              <Button
                onClick={runCompare}
                disabled={compareLoading || !compareReady}
                size="sm"
                className="gap-1.5 bg-gradient-to-r from-rose-600 to-orange-500 hover:shadow-lg hover:shadow-rose-200/60 border-0"
              >
                {compareLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : compare ? <RefreshCw className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
                {compareLoading ? "对比中..." : compare ? "重新对比" : "生成对比"}
              </Button>
            </div>

            <SourceTabs
              value={compareSourceMode}
              onChange={updateCompareSourceMode}
              moduleLabel="用模块 1 竞品"
              manualLabel="手动填竞品"
              tone="rose"
            />

            {compareSourceMode === "manual" && (
              <div className="mb-4">
                <Label className="text-xs text-slate-600 mb-1.5 block">自定义竞品名单</Label>
                <Textarea
                  value={customCompetitorsText}
                  onChange={event => updateCustomCompetitors(event.target.value)}
                  rows={4}
                  placeholder={"每行一个竞品名称\n竞品 A\n竞品 B"}
                  className="bg-white text-xs"
                />
              </div>
            )}

            <CompetitorMultiSelect
              options={compareOptions}
              selected={activeSelectedCompetitors}
              onToggle={toggleCompetitor}
            />

            {compareError && <ErrorBox message={compareError} />}

            {!compare ? (
              <EmptyBlock title="对比报告待生成" text={compareOptions.length ? "最多选择 5 个竞品，同时生成优劣势对比" : "模块一检测完成后会自动带出同行竞品，也可以切换为手动填写"} />
            ) : (
              <CompareReport result={compare} ourBrand={client.ourBrand || manualInput.fullName} />
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  )
}

function SourceTabs({
  value,
  onChange,
  moduleLabel,
  manualLabel,
  tone = "emerald",
}: {
  value: "module" | "manual"
  onChange: (value: "module" | "manual") => void
  moduleLabel: string
  manualLabel: string
  tone?: "emerald" | "rose"
}) {
  const activeClass = tone === "rose" ? "bg-rose-600 text-white shadow-sm" : "bg-emerald-600 text-white shadow-sm"
  const idleClass = tone === "rose" ? "text-slate-600 hover:text-rose-700" : "text-slate-600 hover:text-emerald-700"

  return (
    <div className="mb-4 inline-flex w-full rounded-lg border border-slate-200 bg-white/85 p-1 sm:w-auto">
      <button
        type="button"
        onClick={() => onChange("module")}
        className={`flex-1 rounded-md px-3 py-1.5 text-xs transition sm:flex-none ${value === "module" ? activeClass : idleClass}`}
      >
        {moduleLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange("manual")}
        className={`flex-1 rounded-md px-3 py-1.5 text-xs transition sm:flex-none ${value === "manual" ? activeClass : idleClass}`}
      >
        {manualLabel}
      </button>
    </div>
  )
}

function ManualResearchFields({
  value,
  onChange,
}: {
  value: ResearchManualInput
  onChange: (field: keyof ResearchManualInput, value: string) => void
}) {
  return (
    <div className="mb-4 grid gap-3 rounded-xl border border-emerald-100 bg-white/70 p-3 sm:grid-cols-2">
      <div>
        <Label className="text-xs text-slate-600 mb-1.5 block">地区</Label>
        <Input
          value={value.region}
          onChange={event => onChange("region", event.target.value)}
          placeholder="例如：中国 / 华东 / 上海"
          className="bg-white text-xs"
        />
      </div>
      <div>
        <Label className="text-xs text-slate-600 mb-1.5 block">行业</Label>
        <Input
          value={value.industry}
          onChange={event => onChange("industry", event.target.value)}
          placeholder="例如：GEO 生成式引擎优化"
          className="bg-white text-xs"
        />
      </div>
      <div>
        <Label className="text-xs text-slate-600 mb-1.5 block">品牌全称</Label>
        <Input
          value={value.fullName}
          onChange={event => onChange("fullName", event.target.value)}
          placeholder="请输入公司/品牌/产品全称"
          className="bg-white text-xs"
        />
      </div>
      <div>
        <Label className="text-xs text-slate-600 mb-1.5 block">别名</Label>
        <Input
          value={value.aliases}
          onChange={event => onChange("aliases", event.target.value)}
          placeholder="多个别名用逗号或换行分隔"
          className="bg-white text-xs"
        />
      </div>
    </div>
  )
}

function CompetitorMultiSelect({
  options,
  selected,
  onToggle,
}: {
  options: string[]
  selected: string[]
  onToggle: (name: string) => void
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Label className="text-xs text-slate-600">选择对比竞品</Label>
        <span className={`text-[11px] ${selected.length >= 5 ? "text-rose-500" : "text-slate-400"}`}>
          已选 {selected.length}/5
        </span>
      </div>
      {options.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-400">
          暂无竞品，请先运行模块一或切换为手动填写。
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map(name => {
            const checked = selected.includes(name)
            const disabled = !checked && selected.length >= 5
            return (
              <button
                key={name}
                type="button"
                onClick={() => !disabled && onToggle(name)}
                disabled={disabled}
                className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-45 ${
                  checked
                    ? "border-rose-300 bg-rose-50 text-rose-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50/40"
                }`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-rose-500 bg-rose-500 text-white" : "border-slate-300 bg-white"}`}>
                  {checked && <CheckCircle2 className="h-3 w-3" />}
                </span>
                <span className="min-w-0 break-words">{name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mb-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">
      {message}
    </div>
  )
}

function parseLines(value: string): string[] {
  return value
    .split(/[\n,，、]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function EmptyBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="min-h-[220px] flex items-center justify-center text-center">
      <div>
        <div className="text-sm text-slate-500 mb-1">{title}</div>
        <div className="text-xs text-slate-400">{text}</div>
      </div>
    </div>
  )
}

function ResearchReport({ result }: { result: ResearchResult }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-100 bg-white/85 p-4">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <div className="text-sm font-semibold text-slate-800">
            {result.mode === "hypothesis" ? "假设验证结论" : "深度调研结论"}
          </div>
        </div>
        {result.hypothesis && (
          <div className="mb-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg p-2">
            {result.hypothesis}
          </div>
        )}
        <p className="text-sm leading-7 text-slate-700">{result.executiveSummary}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <MiniPanel title="品牌形象" text={result.brandImage} />
        <MiniPanel title="模型心智" text={result.modelMentality} />
      </div>

      {result.dimensions.length > 0 && (
        <div className="space-y-2">
          {result.dimensions.map(item => (
            <div key={item.name} className="rounded-lg border border-slate-200 bg-white/80 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-sm font-medium text-slate-800">{item.name}</div>
                <div className="font-mono text-sm font-semibold text-emerald-700">{item.score}</div>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 mb-2 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" style={{ width: `${item.score}%` }} />
              </div>
              <p className="text-xs leading-6 text-slate-600">{item.insight}</p>
              {item.evidence.length > 0 && <InlineList items={item.evidence} tone="slate" />}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <ListPanel title="用户感知" items={result.audiencePerception} tone="cyan" />
        <ListPanel title="信任信号" items={result.trustSignals} tone="emerald" />
        <ListPanel title="证据缺口" items={result.evidenceGaps} tone="amber" />
        <ListPanel title="风险暴露" items={result.risks} tone="rose" />
      </div>
      <ListPanel title="机会与行动建议" items={[...result.opportunities, ...result.recommendations]} tone="blue" />

      <div className="text-[11px] text-slate-400 text-right">
        生成于 {new Date(result.generatedAt).toLocaleString("zh-CN")}
      </div>
    </div>
  )
}

function CompareReport({ result, ourBrand }: { result: CompetitorCompareResult; ourBrand: string }) {
  const comparisons = getComparisons(result)

  return (
    <div className="space-y-4">
      {result.ourWeaknessSummary && result.ourWeaknessSummary.length > 0 && (
        <ListPanel title={`${ourBrand || "我方品牌"}对标所选竞品的劣势汇总`} items={result.ourWeaknessSummary} tone="amber" />
      )}

      {comparisons.map(item => (
        <div key={item.competitor} className="space-y-3 rounded-xl border border-rose-100 bg-white/85 p-3">
          <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-4">
            <div className="text-xs text-rose-600 mb-1">
              {ourBrand || "我方品牌"} vs {item.competitor}
            </div>
            <p className="text-sm leading-7 text-slate-700">{item.positioningSummary}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <ListPanel title="我方优势" items={item.ourAdvantages} tone="emerald" />
            <ListPanel title="竞品优势" items={item.competitorAdvantages} tone="rose" />
            <ListPanel title="我方短板" items={item.ourWeaknesses} tone="amber" />
            <ListPanel title="竞品短板" items={item.competitorWeaknesses} tone="slate" />
          </div>
          <ListPanel title="差异化叙事" items={item.differentiators} tone="blue" />
          <ListPanel title="用户选择因素" items={item.userChoiceDrivers} tone="cyan" />
          <ListPanel title="内容打法" items={item.contentActions} tone="rose" />
        </div>
      ))}

      <div className="text-[11px] text-slate-400 text-right">
        生成于 {new Date(result.generatedAt).toLocaleString("zh-CN")}
      </div>
    </div>
  )
}

function getComparisons(result: CompetitorCompareResult): CompetitorComparison[] {
  if (result.comparisons?.length) return result.comparisons
  return [{
    competitor: result.competitor,
    positioningSummary: result.positioningSummary,
    ourAdvantages: result.ourAdvantages,
    competitorAdvantages: result.competitorAdvantages,
    ourWeaknesses: result.ourWeaknesses,
    competitorWeaknesses: result.competitorWeaknesses,
    differentiators: result.differentiators,
    userChoiceDrivers: result.userChoiceDrivers,
    contentActions: result.contentActions,
  }]
}

function MiniPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white/80 p-3">
      <div className="text-xs font-semibold text-slate-700 mb-1">{title}</div>
      <p className="text-xs leading-6 text-slate-600">{text}</p>
    </div>
  )
}

function ListPanel({
  title,
  items,
  tone,
}: {
  title: string
  items: string[]
  tone: "emerald" | "rose" | "amber" | "blue" | "cyan" | "slate"
}) {
  const color = {
    emerald: "border-emerald-100 bg-emerald-50/35 text-emerald-700",
    rose: "border-rose-100 bg-rose-50/35 text-rose-700",
    amber: "border-amber-100 bg-amber-50/45 text-amber-700",
    blue: "border-blue-100 bg-blue-50/35 text-blue-700",
    cyan: "border-cyan-100 bg-cyan-50/35 text-cyan-700",
    slate: "border-slate-200 bg-slate-50/70 text-slate-700",
  }[tone]

  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <div className="text-xs font-semibold mb-2">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs opacity-70">暂无</div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-2 text-xs leading-6 text-slate-700">
              {tone === "rose" ? (
                <TriangleAlert className="mt-1 h-3.5 w-3.5 shrink-0 text-rose-500" />
              ) : (
                <CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-current" />
              )}
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function InlineList({ items, tone }: { items: string[]; tone: "slate" }) {
  const cls = tone === "slate" ? "bg-slate-100 text-slate-600" : "bg-slate-100 text-slate-600"
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((item, index) => (
        <span key={`${item}-${index}`} className={`rounded-md px-2 py-1 text-[11px] ${cls}`}>
          {item}
        </span>
      ))}
    </div>
  )
}
