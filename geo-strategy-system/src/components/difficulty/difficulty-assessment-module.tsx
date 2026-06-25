"use client"

import { useMemo, useState } from "react"
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileText,
  Gauge,
  History,
  Loader2,
  Play,
  Table2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import type {
  Client,
  DifficultyAssessmentEntry,
  DifficultyAssessmentResult,
  DifficultyLevel,
  DifficultyStageKey,
} from "@/types"

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}

const STAGES: Array<{ key: DifficultyStageKey; title: string; desc: string }> = [
  { key: "research", title: "调研取样", desc: "问题样本与信源分布" },
  { key: "comparison", title: "品牌/渠道对比", desc: "推荐池和渠道集中度" },
  { key: "scoring", title: "规则评分", desc: "六维标准折算" },
  { key: "review", title: "一致性复核", desc: "证据与分数校验" },
  { key: "report", title: "生成报告", desc: "结论和策略建议" },
]

const SCORE_STANDARDS = [
  {
    name: "头部品牌曝光集中度",
    max: 25,
    easy: "0-6 没有明显头部",
    medium: "7-12 有头部但仍有缝隙",
    hard: "13-19 头部占据主要曝光位",
    super: "20-25 头部霸屏",
  },
  {
    name: "推荐品牌多样性",
    max: 20,
    easy: "0-5 推荐池很宽",
    medium: "6-10 推荐池约20-30个",
    hard: "11-15 推荐池约10-15个",
    super: "16-20 推荐池不足10个",
  },
  {
    name: "本地化信息垄断程度",
    max: 20,
    easy: "0-5 本地商家容易出现",
    medium: "6-10 全国品牌和本地混合",
    hard: "11-15 全国品牌压过本地",
    super: "16-20 本地真实商家几乎不可见",
  },
  {
    name: "内容真实性与投毒程度",
    max: 15,
    easy: "0-4 真实信息较多",
    medium: "5-8 软文和真实内容混杂",
    hard: "9-12 批量内容影响判断",
    super: "13-15 虚假榜单主导",
  },
  {
    name: "GEO准入门槛与马太效应",
    max: 10,
    easy: "0-3 小品牌可快速进入",
    medium: "4-6 需要基础信任源",
    hard: "7-8 头部信任资产占优",
    super: "9-10 强马太效应",
  },
  {
    name: "信息来源单一性",
    max: 10,
    easy: "0-3 来源分散",
    medium: "4-6 部分渠道权重高",
    hard: "7-8 少数渠道控制主要答案",
    super: "9-10 高度依赖单一来源",
  },
]

const TOTAL_STANDARDS = [
  { range: "0-24", level: "容易", desc: "AI 推荐池开放，适合快速切入" },
  { range: "25-49", level: "中等", desc: "需要内容矩阵和基础信任源" },
  { range: "50-74", level: "困难", desc: "头部和渠道已有明显占位" },
  { range: "75-100", level: "超难", desc: "信息垄断强，需要系统性 GEO 战役" },
]

const SAMPLE_RESULT: DifficultyAssessmentResult = {
  totalScore: 72,
  level: "困难",
  stableMentionPeriod: "约25-30天",
  summary:
    "除甲醛行业真实竞争分散，但 AI 搜索呈现层已经被少数连锁品牌、榜单软文和问答平台内容压缩。新品牌并非没有机会，但需要避开全国大词，优先用本地真实案例、检测流程和细分人群场景建立可引用信源。",
  dimensions: {
    dimension1: {
      name: "头部品牌曝光集中度",
      score: 20,
      max: 25,
      level: "超难",
      analysis: "AI 回答更容易复用已有榜单和连锁品牌，头部品牌重复率较高，新品牌直接抢占全国大词难度较大。",
    },
    dimension2: {
      name: "推荐品牌多样性",
      score: 14,
      max: 20,
      level: "困难",
      analysis: "推荐池约 12-15 个品牌，仍有进入空间，但需要持续积累第三方内容和口碑信号。",
    },
    dimension3: {
      name: "本地化信息垄断程度",
      score: 16,
      max: 20,
      level: "超难",
      analysis: "本地真实服务商容易被全国连锁和外地内容稀释，城市服务词需要补足地图、案例和本地媒体信源。",
    },
    dimension4: {
      name: "内容真实性与投毒程度",
      score: 12,
      max: 15,
      level: "超难",
      analysis: "软文榜单、AI 批量内容和低质量评测较多，用户真实经验和权威检测资料不足。",
    },
    dimension5: {
      name: "GEO准入门槛与马太效应",
      score: 6,
      max: 10,
      level: "困难",
      analysis: "准入门槛主要来自信任资产和第三方渠道，不是完全封闭，但需要持续运营。",
    },
    dimension6: {
      name: "信息来源单一性",
      score: 4,
      max: 10,
      level: "中等",
      analysis: "来源包括新闻、知乎、小红书、行业站和本地生活平台，仍有多渠道突围机会。",
    },
  },
  insights: [
    "行业真实供给分散，但 AI 推荐池呈现出头部感知垄断。",
    "本地词和细分场景比全国排名大词更适合切入。",
    "高质量案例、检测流程和第三方背书会直接影响被引用概率。",
  ],
  suggestions: [
    "先建设城市级服务页和真实案例库，覆盖新房、母婴、办公室等场景。",
    "用第三方评测、媒体稿和问答内容建立交叉验证，而不是只堆官网文章。",
    "每 2 周复测一次重点问题，跟踪 AI 回答中的品牌提及变化。",
  ],
  process: {
    research: {
      title: "调研取样",
      summary: "围绕全国除甲醛、城市除甲醛、新房入住、母婴安全、甲醛检测等场景生成问题样本。",
      evidence: ["样本覆盖全国大词、本地服务、细分人群和检测流程", "AI 回答常出现固定品牌和服务榜单", "本地真实商家信息弱于全国连锁内容"],
      tags: ["12个问题样本", "榜单内容", "本地服务"],
    },
    comparison: {
      title: "品牌/渠道对比",
      summary: "头部品牌在多类问题中重复出现，本地服务商被外地品牌和内容平台稀释。",
      evidence: ["TOP 品牌重复率高", "推荐池约 12-15 个品牌", "新闻、博客、问答平台贡献主要引用"],
      tags: ["TOP3集中", "推荐池偏窄", "渠道集中"],
    },
    scoring: {
      title: "规则评分",
      summary: "头部集中、本地垄断、内容投毒三个维度显著拉高总分，最终落在困难区间。",
      evidence: ["头部集中 20/25", "本地垄断 16/20", "内容投毒 12/15"],
      tags: ["72分", "困难", "六维加权"],
    },
    review: {
      title: "一致性复核",
      summary: "总分与证据匹配：行业竞争分散，但 AI 搜索呈现层已被少数品牌和渠道压缩。",
      evidence: ["总分与困难级区间一致", "维度高分均有对应证据", "来源单一性较低，保留突围空间"],
      tags: ["置信度中高", "证据匹配", "可突围"],
    },
    report: {
      title: "生成报告",
      summary: "报告建议避开全国排名大词，优先布局本地真实案例、细分场景内容和多渠道矩阵。",
      evidence: ["本地案例优先", "细分场景切入", "定期复测"],
      tags: ["策略生成", "历史可追溯", "可打印"],
    },
  },
  generatedAt: new Date().toISOString(),
  providerLabel: "示例",
}

function levelClasses(level: DifficultyLevel): string {
  if (level === "超难") return "border-red-200 bg-red-50 text-red-700"
  if (level === "困难") return "border-orange-200 bg-orange-50 text-orange-700"
  if (level === "中等") return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-emerald-200 bg-emerald-50 text-emerald-700"
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function createEntry(args: {
  industry: string
  city: string
  source: string
  result: DifficultyAssessmentResult
}): DifficultyAssessmentEntry {
  const now = new Date().toISOString()
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `difficulty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    industry: args.industry,
    city: args.city,
    source: args.source,
    createdAt: now,
    result: {
      ...args.result,
      generatedAt: args.result.generatedAt || now,
    },
  }
}

export default function DifficultyAssessmentModule({ client, onChangeClient }: Props) {
  const [industry, setIndustry] = useState(() => client.industry || "")
  const [city, setCity] = useState("全国")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeEntry, setActiveEntry] = useState<DifficultyAssessmentEntry | null>(
    () => client.difficultyAssessments?.[0] ?? null
  )

  const history = client.difficultyAssessments ?? []
  const result = activeEntry?.result ?? SAMPLE_RESULT
  const dimensions = useMemo(() => Object.values(result.dimensions), [result.dimensions])

  function saveEntry(entry: DifficultyAssessmentEntry) {
    const next = [entry, ...history.filter(item => item.id !== entry.id)].slice(0, 30)
    onChangeClient({ difficultyAssessments: next })
    setActiveEntry(entry)
  }

  function loadSample() {
    const targetIndustry = industry.trim() || client.industry || "除甲醛"
    const entry = createEntry({
      industry: targetIndustry,
      city: city.trim() || "全国",
      source: "示例",
      result: SAMPLE_RESULT,
    })
    saveEntry(entry)
    setError(null)
  }

  async function runAssessment() {
    const targetIndustry = industry.trim() || client.industry.trim()
    const targetCity = city.trim() || "全国"
    if (!targetIndustry) {
      setError("请先填写行业/赛道名称。")
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch("/api/difficulty-assessment", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry: targetIndustry,
          city: targetCity,
        }),
      })
      const data = await readApiJson<DifficultyAssessmentResult & { error?: string }>(
        res,
        "GEO 难度测评"
      )
      if (!res.ok) throw new Error(data.error || "评估失败")
      const entry = createEntry({
        industry: targetIndustry,
        city: targetCity,
        source: data.providerLabel || "服务端模型",
        result: data,
      })
      saveEntry(entry)
      if (!client.industry && targetIndustry) onChangeClient({ industry: targetIndustry })
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误")
    } finally {
      setLoading(false)
    }
  }

  function deleteEntry(id: string) {
    const next = history.filter(item => item.id !== id)
    onChangeClient({ difficultyAssessments: next })
    if (activeEntry?.id === id) setActiveEntry(next[0] ?? null)
  }

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-5 no-print">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-3 text-sm text-slate-800 sm:text-base">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#004B73] to-[#00B4D8] shadow-lg shadow-blue-200/50">
                <Gauge className="h-5 w-5 text-white" />
              </span>
              <span className="min-w-0">
                <span className="block bg-gradient-to-r from-[#004B73] to-[#0077B6] bg-clip-text font-semibold text-transparent">
                  模块六 · GEO 难度测评
                </span>
                <span className="mt-1 block text-xs font-normal text-slate-400">
                  调研 → 对比 → 评分 → 复核 → 报告
                </span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="difficulty-industry">行业/赛道</Label>
              <Input
                id="difficulty-industry"
                value={industry}
                onChange={event => setIndustry(event.target.value)}
                placeholder="除甲醛、医美、律师服务"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="difficulty-city">城市/地区</Label>
              <Input
                id="difficulty-city"
                value={city}
                onChange={event => setCity(event.target.value)}
                placeholder="全国、上海、深圳"
              />
            </div>
            {error && (
              <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" onClick={runAssessment} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {loading ? "评估中" : "开始评估"}
              </Button>
              <Button type="button" variant="outline" onClick={loadSample} disabled={loading}>
                示例
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              真实评估会消耗 5 积分，由服务端调用已配置模型；前端不会暴露 API Key。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-slate-700">
              <History className="h-4 w-4 text-[#0077B6]" />
              历史测评
            </CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400">
                暂无历史报告，先运行一次测评。
              </div>
            ) : (
              <div className="space-y-2">
                {history.map(entry => (
                  <div
                    key={entry.id}
                    className={`rounded-xl border px-3 py-2.5 text-xs transition ${
                      activeEntry?.id === entry.id ? "border-[#0077B6] bg-blue-50/70" : "border-slate-200 bg-white"
                    }`}
                  >
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => setActiveEntry(entry)}
                    >
                      <span className="block truncate font-semibold text-slate-800">
                        {entry.city} · {entry.industry}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-slate-500">
                        <span>{entry.result.totalScore}分 / {entry.result.level}</span>
                        <span>{formatDate(entry.createdAt)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteEntry(entry.id)}
                      className="mt-2 text-[11px] text-slate-400 hover:text-red-600"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="min-w-0 space-y-5">
        {loading && (
          <Card className="no-print border-blue-200 bg-blue-50/80">
            <CardContent className="flex items-center gap-3 py-4 text-sm text-[#004B73]">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在执行五步评估，模型会依次完成调研、对比、评分、复核和报告生成。
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-100 pb-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-[#0077B6]">
                    {activeEntry?.source ?? "示例"} · GEO/AEO monopoly score
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${levelClasses(result.level)}`}>
                    {result.level}
                  </span>
                </div>
                <CardTitle className="text-xl leading-tight text-slate-900 md:text-2xl">
                  {activeEntry ? `${activeEntry.city} · ${activeEntry.industry}` : "GEO 难度测评示例"}
                </CardTitle>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  {result.summary}
                </p>
              </div>
              <div className="flex shrink-0 items-end gap-4">
                <div className="text-right">
                  <div className="text-[11px] text-slate-400">垄断总分</div>
                  <div className="text-5xl font-black tabular-nums tracking-tight text-[#004B73]">
                    {result.totalScore}
                  </div>
                </div>
                <Button type="button" variant="outline" className="no-print" onClick={() => window.print()}>
                  <FileText className="h-4 w-4" />
                  打印报告
                </Button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label="被 AI 稳定提及周期" value={result.stableMentionPeriod} />
              <Metric label="六维合计" value={`${dimensions.reduce((sum, item) => sum + item.score, 0)}/100`} />
              <Metric label="报告时间" value={formatDate(result.generatedAt)} />
            </div>
          </CardHeader>
          <CardContent className="space-y-6 pt-5">
            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <BarChart3 className="h-4 w-4 text-[#0077B6]" />
                六维评分
              </div>
              <div className="space-y-3">
                {dimensions.map(item => {
                  const percent = Math.round((item.score / item.max) * 100)
                  return (
                    <div key={item.name} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 font-medium text-slate-800">{item.name}</div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${levelClasses(item.level)}`}>
                            {item.level}
                          </span>
                          <span className="font-mono text-sm font-bold text-slate-900">
                            {item.score}/{item.max}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#004B73] via-[#0077B6] to-[#00B4D8]"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">{item.analysis}</p>
                    </div>
                  )
                })}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <CheckCircle2 className="h-4 w-4 text-[#0077B6]" />
                评估过程证据
              </div>
              <div className="grid gap-3 lg:grid-cols-5">
                {STAGES.map((stage, index) => {
                  const item = result.process[stage.key]
                  return (
                    <div key={stage.key} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#004B73] text-[11px] font-bold text-white">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-slate-800">{item.title}</div>
                          <div className="truncate text-[10px] text-slate-400">{stage.desc}</div>
                        </div>
                      </div>
                      <p className="text-xs leading-5 text-slate-600">{item.summary}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.tags.map(tag => (
                          <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <InsightList title="关键洞察" items={result.insights} />
              <InsightList title="GEO 策略建议" items={result.suggestions} />
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-slate-700">
              <Table2 className="h-4 w-4 text-[#0077B6]" />
              分数标准说明
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-[640px] w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">总分</th>
                    <th className="px-3 py-2 font-medium">等级</th>
                    <th className="px-3 py-2 font-medium">含义</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {TOTAL_STANDARDS.map(item => (
                    <tr key={item.range}>
                      <td className="px-3 py-2 font-mono text-slate-700">{item.range}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${levelClasses(item.level as DifficultyLevel)}`}>
                          {item.level}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{item.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-[960px] w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">维度</th>
                    <th className="px-3 py-2 font-medium">满分</th>
                    <th className="px-3 py-2 font-medium">容易</th>
                    <th className="px-3 py-2 font-medium">中等</th>
                    <th className="px-3 py-2 font-medium">困难</th>
                    <th className="px-3 py-2 font-medium">超难</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {SCORE_STANDARDS.map(item => (
                    <tr key={item.name}>
                      <td className="px-3 py-2 font-medium text-slate-700">{item.name}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">{item.max}</td>
                      <td className="px-3 py-2 text-slate-500">{item.easy}</td>
                      <td className="px-3 py-2 text-slate-500">{item.medium}</td>
                      <td className="px-3 py-2 text-slate-500">{item.hard}</td>
                      <td className="px-3 py-2 text-slate-500">{item.super}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <Clock3 className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-800">{value}</div>
    </div>
  )
}

function InsightList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-slate-800">{title}</div>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item} className="flex gap-2 text-xs leading-5 text-slate-600">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0077B6]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
