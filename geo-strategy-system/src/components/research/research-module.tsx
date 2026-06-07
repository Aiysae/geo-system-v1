"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { apiFetch } from "@/lib/api-fetch"
import type { Client, CompetitorCompareResult, ResearchMode, ResearchResult } from "@/types"
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

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}

export default function ResearchModule({ client, onChangeClient }: Props) {
  const [mode, setMode] = useState<ResearchMode>("ai")
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

  const [selectedCompetitor, setSelectedCompetitor] = useState("")
  const activeCompetitor = selectedCompetitor || competitorOptions[0] || ""

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
          hypothesis,
          ourBrand: client.ourBrand,
          industry: client.industry,
          website: client.website,
          competitors: client.competitors,
          penetration: client.penetration,
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
      const res = await apiFetch("/api/competitor-compare", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ourBrand: client.ourBrand,
          industry: client.industry,
          website: client.website,
          competitors: client.competitors,
          competitor: activeCompetitor,
          penetration: client.penetration,
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

  const ready = !!client.ourBrand.trim()
  const research = client.research
  const compare = client.competitorCompare

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3 text-base text-slate-800">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-teal-200/50">
            <Brain className="h-5 w-5 text-white" />
          </span>
          <span className="bg-gradient-to-r from-emerald-600 to-cyan-600 bg-clip-text text-transparent font-semibold">
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
                disabled={researchLoading || !ready}
                className="gap-1.5 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:shadow-lg hover:shadow-emerald-200/60 border-0"
                size="sm"
              >
                {researchLoading && mode === "ai" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                {research?.mode === "ai" ? "重新 AI 调研" : "开始 AI 调研"}
              </Button>
              <Button
                onClick={() => runResearch("hypothesis")}
                disabled={researchLoading || !ready || !hypothesis.trim()}
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
              <EmptyBlock title="调研报告待生成" text={client.penetration ? "会结合当前疑问句检测结果做深度分析" : "可先运行疑问句检测，也可直接做豆包调研"} />
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
                disabled={compareLoading || !ready || !activeCompetitor}
                size="sm"
                className="gap-1.5 bg-gradient-to-r from-rose-600 to-orange-500 hover:shadow-lg hover:shadow-rose-200/60 border-0"
              >
                {compareLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : compare ? <RefreshCw className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
                {compareLoading ? "对比中..." : compare ? "重新对比" : "生成对比"}
              </Button>
            </div>

            <div className="mb-4">
              <Label className="text-xs text-slate-600 mb-1.5 block">选择对比竞品</Label>
              <select
                value={activeCompetitor}
                onChange={event => setSelectedCompetitor(event.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-200"
              >
                {competitorOptions.length === 0 ? (
                  <option value="">暂无竞品，请先检测或手动填写竞品</option>
                ) : (
                  competitorOptions.map(name => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))
                )}
              </select>
            </div>

            {compareError && <ErrorBox message={compareError} />}

            {!compare ? (
              <EmptyBlock title="对比报告待生成" text={competitorOptions.length ? "选择一个竞品后生成优劣势报告" : "模块一检测完成后会自动带出同行竞品"} />
            ) : (
              <CompareReport result={compare} ourBrand={client.ourBrand} />
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mb-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">
      {message}
    </div>
  )
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
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-4">
        <div className="text-xs text-rose-600 mb-1">
          {ourBrand || "我方品牌"} vs {result.competitor}
        </div>
        <p className="text-sm leading-7 text-slate-700">{result.positioningSummary}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ListPanel title="我方优势" items={result.ourAdvantages} tone="emerald" />
        <ListPanel title="竞品优势" items={result.competitorAdvantages} tone="rose" />
        <ListPanel title="我方短板" items={result.ourWeaknesses} tone="amber" />
        <ListPanel title="竞品短板" items={result.competitorWeaknesses} tone="slate" />
      </div>
      <ListPanel title="差异化叙事" items={result.differentiators} tone="blue" />
      <ListPanel title="用户选择因素" items={result.userChoiceDrivers} tone="cyan" />
      <ListPanel title="内容打法" items={result.contentActions} tone="rose" />

      <div className="text-[11px] text-slate-400 text-right">
        生成于 {new Date(result.generatedAt).toLocaleString("zh-CN")}
      </div>
    </div>
  )
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
