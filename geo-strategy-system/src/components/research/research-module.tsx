"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { CreditCostBadge } from "@/components/credits/credit-cost-badge"
import { useResumableBackgroundJob } from "@/hooks/use-resumable-background-job"
import { createBackgroundRequestId } from "@/lib/background-job-client"
import { getClientSubjectType, getSubjectCopy } from "@/lib/analysis-subject"
import { getGeoArticleFormat } from "@/lib/geo-methodology/article-formats"
import { compactResearchPenetrationSnapshot } from "@/lib/research/penetration-snapshot"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type { BackgroundJobKind, BackgroundJobRef, Client, CompetitorCompareResult, CompetitorCompareSourceMode, CompetitorComparison, ResearchEvidenceReference, ResearchEvidenceSource, ResearchManualInput, ResearchMode, ResearchResult, ResearchSourceMode } from "@/types"
import {
  BarChart3,
  Brain,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Globe2,
  Layers3,
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

const CONTENT_PLATFORM_LABELS: Record<string, string> = {
  universal: "通用长文",
  officialSite: "官网",
  sohu: "搜狐",
  toutiao: "今日头条",
  netease: "网易",
  baijiahao: "百家号",
  zhihu: "知乎",
  xiaohongshu: "小红书",
  douyin: "抖音图文",
}

const TITLE_STRATEGY_LABELS: Record<string, string> = {
  directAnswer: "直接回答",
  audienceScenario: "人群场景",
  decisionCriteria: "决策标准",
  evidenceHook: "证据切入",
  riskAvoidance: "风险避坑",
  localService: "本地服务",
  comparisonMatrix: "对比矩阵",
  tieredList: "分层清单",
  marketTrend: "趋势研究",
  priceTransparency: "价格成本",
}

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}

export default function ResearchModule({ client, onChangeClient }: Props) {
  const subjectType = getClientSubjectType(client)
  const subjectCopy = getSubjectCopy(subjectType)
  const isPerson = subjectType === "person"
  const [mode, setMode] = useState<ResearchMode>(() => client.researchDraft?.mode ?? "ai")
  const [researchSourceMode, setResearchSourceMode] = useState<ResearchSourceMode>(() => client.researchSourceMode ?? "module")
  const [manualInput, setManualInput] = useState<ResearchManualInput>(() => ({
    ...EMPTY_MANUAL_INPUT,
    ...(client.researchManualInput ?? {}),
  }))
  const [compareSourceMode, setCompareSourceMode] = useState<CompetitorCompareSourceMode>(() => client.competitorCompareSourceMode ?? "module")
  const [customCompetitorsText, setCustomCompetitorsText] = useState(() => (client.competitorCompareCustomCompetitors ?? []).join("\n"))
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>(() => client.competitorCompareSelectedCompetitors ?? client.competitorCompare?.selectedCompetitors ?? [])
  const [hypothesis, setHypothesis] = useState(() => (
    client.researchDraft?.hypothesis ?? client.research?.hypothesis ?? ""
  ))
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
  const researchJobRef = client.backgroundJobs?.research
  const compareJobRef = client.backgroundJobs?.competitorCompare
  const researchLoading = Boolean(researchJobRef)
  const compareLoading = Boolean(compareJobRef)

  function backgroundJobsWith(kind: BackgroundJobKind, ref?: BackgroundJobRef) {
    const next = { ...(client.backgroundJobs || {}) }
    if (ref) next[kind] = ref
    else delete next[kind]
    return next
  }

  function researchPayload(nextMode: ResearchMode) {
    return {
      mode: nextMode,
      sourceMode: researchSourceMode,
      hypothesis,
      ourBrand: effectiveOurBrand,
      region: researchSourceMode === "manual" ? manualInput.region : "",
      aliases: researchSourceMode === "manual" ? parseLines(manualInput.aliases) : [],
      industry: effectiveIndustry,
      website: researchSourceMode === "manual" ? "" : client.website,
      competitors: researchSourceMode === "manual" ? [] : client.competitors,
      penetration: researchSourceMode === "module"
        ? compactResearchPenetrationSnapshot(client.penetration)
        : undefined,
      subjectType,
      personProfile: client.personProfile,
    }
  }

  function comparePayload() {
    const compareOurBrand = client.ourBrand.trim() || manualInput.fullName.trim()
    const compareIndustry = compareSourceMode === "manual"
      ? manualInput.industry.trim() || client.industry
      : client.industry
    const allCompetitors = compareSourceMode === "manual" ? customCompetitorOptions : compareOptions
    return {
      ourBrand: compareOurBrand,
      industry: compareIndustry,
      website: client.website,
      region: compareSourceMode === "manual" ? manualInput.region : "",
      competitors: allCompetitors,
      selectedCompetitors: activeSelectedCompetitors,
      penetration: compareSourceMode === "module"
        ? compactResearchPenetrationSnapshot(client.penetration)
        : undefined,
      subjectType,
      personProfile: client.personProfile,
    }
  }

  const researchJobState = useResumableBackgroundJob<ResearchResult>({
    kind: "research",
    clientId: client.id,
    jobRef: researchJobRef,
    payload: researchPayload(mode),
    onAccepted: job => {
      onChangeClient({
        backgroundJobs: backgroundJobsWith("research", { requestId: job.requestId, jobId: job.id }),
      })
    },
    onSucceeded: job => {
      if (!job.result?.generatedAt) {
        setResearchError("调研结果不完整，请重新生成。")
        onChangeClient({ backgroundJobs: backgroundJobsWith("research") })
        return
      }
      setResearchError(null)
      onChangeClient({
        research: job.result,
        backgroundJobs: backgroundJobsWith("research"),
      })
    },
    onFailed: message => {
      setResearchError(toUserFacingError(message, { fallback: "调研未完成，请稍后重试。", subject: "调研" }))
      onChangeClient({ backgroundJobs: backgroundJobsWith("research") })
    },
  })

  const compareJobState = useResumableBackgroundJob<CompetitorCompareResult>({
    kind: "competitorCompare",
    clientId: client.id,
    jobRef: compareJobRef,
    payload: comparePayload(),
    onAccepted: job => {
      onChangeClient({
        backgroundJobs: backgroundJobsWith("competitorCompare", { requestId: job.requestId, jobId: job.id }),
      })
    },
    onSucceeded: job => {
      const data = job.result
      if (!data?.generatedAt || (!data.comparisons?.length && !data.competitor)) {
        setCompareError("竞品优劣势对比返回数据不完整，请重新生成。")
        onChangeClient({ backgroundJobs: backgroundJobsWith("competitorCompare") })
        return
      }
      setCompareError(null)
      onChangeClient({
        competitorCompare: data,
        backgroundJobs: backgroundJobsWith("competitorCompare"),
      })
    },
    onFailed: message => {
      setCompareError(toUserFacingError(message, { fallback: "对比报告未完成，请稍后重试。", subject: "竞品对比" }))
      onChangeClient({ backgroundJobs: backgroundJobsWith("competitorCompare") })
    },
  })

  function updateResearchDraft(patch: Partial<NonNullable<Client["researchDraft"]>>) {
    onChangeClient({
      researchDraft: {
        ...(client.researchDraft || {}),
        mode,
        hypothesis,
        ...patch,
      },
    })
  }

  function updateResearchMode(nextMode: ResearchMode) {
    setMode(nextMode)
    updateResearchDraft({ mode: nextMode })
  }

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

  function runResearch(nextMode: ResearchMode) {
    setMode(nextMode)
    setResearchError(null)
    const payload = researchPayload(nextMode)
    onChangeClient({
      backgroundJobs: backgroundJobsWith("research", {
        requestId: createBackgroundRequestId("research"),
        payload,
      }),
    })
  }

  function runCompare() {
    setCompareError(null)
    const payload = comparePayload()
    onChangeClient({
      backgroundJobs: backgroundJobsWith("competitorCompare", {
        requestId: createBackgroundRequestId("compare"),
        payload,
      }),
    })
  }

  const research = client.research
  const compare = client.competitorCompare

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3 text-sm text-slate-800 sm:text-base">
          <span className="geo-module-icon">
            <Brain className="h-5 w-5 text-white" />
          </span>
          <span className="geo-module-title min-w-0">
            {isPerson ? "个人 IP 与同行调研" : "品牌与竞品调研"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="geo-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-[#1677FF]" />
                <div>
                  <div className="text-sm font-semibold text-slate-800">
                    {isPerson ? "个人 IP 现状调研" : "品牌现状调研"}
                  </div>
                  <div className="text-[11px] text-slate-500">可使用已有检测结果，也可以手动填写资料</div>
                </div>
              </div>
              <div className="geo-segmented inline-grid grid-cols-2">
                <button
                  type="button"
                  onClick={() => updateResearchMode("ai")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${mode === "ai" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-600 hover:text-[#1677FF]"}`}
                >
                  全面调研
                </button>
                <button
                  type="button"
                  onClick={() => updateResearchMode("hypothesis")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${mode === "hypothesis" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-600 hover:text-[#1677FF]"}`}
                >
                  验证判断
                </button>
              </div>
            </div>

            <SourceTabs
              value={researchSourceMode}
              onChange={updateResearchSourceMode}
              moduleLabel="使用已有检测结果"
              manualLabel="手动填写资料"
            />

            {researchSourceMode === "manual" && (
              <ManualResearchFields
                value={manualInput}
                onChange={updateManualInput}
                subjectType={subjectType}
              />
            )}

            {mode === "hypothesis" && (
              <div className="mb-3">
                <Label className="text-xs text-slate-600 mb-1.5 block">要验证的假设</Label>
                <Textarea
                  value={hypothesis}
                  onChange={event => {
                    setHypothesis(event.target.value)
                    updateResearchDraft({ hypothesis: event.target.value })
                  }}
                  rows={4}
                  placeholder={isPerson
                    ? "例如：这位专家很少被提及，是因为缺少权威资料页和专业案例来源。"
                    : "例如：品牌很少被推荐，是因为缺少第三方测评和行业榜单来源。"}
                  className="bg-white/80 text-xs"
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2 mb-4">
              <Button
                onClick={() => runResearch("ai")}
                disabled={researchLoading || !researchReady}
                className="gap-1.5"
                size="sm"
              >
                {researchLoading && mode === "ai" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                {research?.mode === "ai" ? "重新全面调研" : "开始全面调研"}
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
            <div className="mb-4 flex flex-wrap gap-2">
              <CreditCostBadge featureKey="researchAi" label="全面调研预计" />
              <CreditCostBadge featureKey="researchHypothesis" label="验证判断预计" />
            </div>

            {researchLoading && (
              <BackgroundJobNotice
                stage={researchJobState.currentJob?.stage}
                notice={researchJobState.connectionNotice}
                tone="emerald"
              />
            )}

            {researchError && <ErrorBox message={researchError} />}

            {!research ? (
              <EmptyBlock
                title="调研报告待生成"
                text={researchSourceMode === "module"
                  ? "会结合渗透率检测结果做深度分析"
                  : `填写地区、行业、${subjectCopy.subjectShortLabel}和别名后即可独立调研`}
              />
            ) : (
              <ResearchReport result={research} subjectType={subjectType} />
            )}
          </section>

          <section className="geo-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Swords className="h-4 w-4 text-rose-600" />
                <div>
                  <div className="text-sm font-semibold text-slate-800">
                    {isPerson ? "同行人物对比" : "竞品优劣势对比"}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    根据已有检测结果和公开信息生成{isPerson ? "同行人物" : "竞品"}对比
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <CreditCostBadge
                  featureKey="competitorCompareUnit"
                  units={Math.max(1, activeSelectedCompetitors.length)}
                />
                <Button
                  onClick={runCompare}
                  disabled={compareLoading || !compareReady}
                  size="sm"
                  className="gap-1.5"
                >
                  {compareLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : compare ? <RefreshCw className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
                  {compareLoading ? "对比中..." : compare ? "重新对比" : "生成对比"}
                </Button>
              </div>
            </div>

            <SourceTabs
              value={compareSourceMode}
              onChange={updateCompareSourceMode}
              moduleLabel={`用渗透率情报${isPerson ? "同行人物" : "竞品"}`}
              manualLabel={`手动填${isPerson ? "同行人物" : "竞品"}`}
            />

            {compareSourceMode === "manual" && (
              <div className="mb-4">
                <Label className="text-xs text-slate-600 mb-1.5 block">
                  自定义{isPerson ? "同行人物" : "竞品"}名单
                </Label>
                <Textarea
                  value={customCompetitorsText}
                  onChange={event => updateCustomCompetitors(event.target.value)}
                  rows={4}
                  placeholder={isPerson
                    ? "每行一个同行人物姓名\n同行人物 A\n同行人物 B"
                    : "每行一个竞品名称\n竞品 A\n竞品 B"}
                  className="bg-white text-xs"
                />
              </div>
            )}

            <CompetitorMultiSelect
              options={compareOptions}
              selected={activeSelectedCompetitors}
              onToggle={toggleCompetitor}
              subjectType={subjectType}
            />

            {compareLoading && (
              <BackgroundJobNotice
                stage={compareJobState.currentJob?.stage}
                notice={compareJobState.connectionNotice}
                tone="rose"
              />
            )}

            {compareError && <ErrorBox message={compareError} />}

            {!compare ? (
              <EmptyBlock
                title="对比报告待生成"
                text={compareOptions.length
                  ? `最多选择 5 个${isPerson ? "同行人物" : "竞品"}，同时生成对比`
                  : `渗透率检测完成后会自动带出${isPerson ? "同行人物" : "同行竞品"}，也可以切换为手动填写`}
              />
            ) : (
              <CompareReport
                result={compare}
                ourBrand={client.ourBrand || manualInput.fullName}
                subjectType={subjectType}
              />
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
}: {
  value: "module" | "manual"
  onChange: (value: "module" | "manual") => void
  moduleLabel: string
  manualLabel: string
}) {
  return (
    <div className="geo-segmented mb-4 inline-grid w-full grid-cols-2 sm:w-auto">
      <button
        type="button"
        onClick={() => onChange("module")}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${value === "module" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-600 hover:text-[#1677FF]"}`}
      >
        {moduleLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange("manual")}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${value === "manual" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-600 hover:text-[#1677FF]"}`}
      >
        {manualLabel}
      </button>
    </div>
  )
}

function ManualResearchFields({
  value,
  onChange,
  subjectType = "brand",
}: {
  value: ResearchManualInput
  onChange: (field: keyof ResearchManualInput, value: string) => void
  subjectType?: "brand" | "person"
}) {
  const isPerson = subjectType === "person"
  return (
    <div className="mb-4 grid gap-3 rounded-lg border border-[#DCE6F2] bg-[#F8FAFD] p-3 sm:grid-cols-2">
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
        <Label className="text-xs text-slate-600 mb-1.5 block">
          {isPerson ? "人物姓名" : "品牌全称"}
        </Label>
        <Input
          value={value.fullName}
          onChange={event => onChange("fullName", event.target.value)}
          placeholder={isPerson ? "请输入需要调研的人物姓名" : "请输入公司/品牌/产品全称"}
          className="bg-white text-xs"
        />
      </div>
      <div>
        <Label className="text-xs text-slate-600 mb-1.5 block">
          {isPerson ? "姓名别名" : "别名"}
        </Label>
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
  subjectType = "brand",
}: {
  options: string[]
  selected: string[]
  onToggle: (name: string) => void
  subjectType?: "brand" | "person"
}) {
  const noun = subjectType === "person" ? "同行人物" : "竞品"
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Label className="text-xs text-slate-600">选择对比{noun}</Label>
        <span className={`text-[11px] ${selected.length >= 5 ? "text-rose-500" : "text-slate-400"}`}>
          已选 {selected.length}/5
        </span>
      </div>
      {options.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-400">
          暂无{noun}，请先运行渗透率情报或切换为手动填写。
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
                    ? "border-[#69B1FF] bg-[#EEF6FF] text-[#0958D9]"
                    : "border-slate-200 bg-white text-slate-600 hover:border-[#91CAFF] hover:bg-[#F7FBFF]"
                }`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-[#1677FF] bg-[#1677FF] text-white" : "border-slate-300 bg-white"}`}>
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

function BackgroundJobNotice({
  stage,
  notice,
  tone,
}: {
  stage?: string
  notice?: string | null
  tone: "emerald" | "rose"
}) {
  const classes = tone === "rose"
    ? "border-rose-200 bg-rose-50 text-rose-800"
    : "border-emerald-200 bg-emerald-50 text-emerald-800"
  return (
    <div className={`mb-4 rounded-lg border px-3 py-2 text-xs leading-5 ${classes}`}>
      <div className="font-medium">{stage || "正在生成调研结果"}</div>
      <div className="text-[11px] opacity-80">
        {notice || "可以继续使用其他功能，完成后结果会自动保存。"}
      </div>
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
    <div className="geo-empty-state min-h-[160px]">
      <div>
        <div className="text-sm text-slate-500 mb-1">{title}</div>
        <div className="text-xs text-slate-400">{text}</div>
      </div>
    </div>
  )
}

function ResearchReport({
  result,
  subjectType,
}: {
  result: ResearchResult
  subjectType: "brand" | "person"
}) {
  const references = result.evidenceReferences || []
  const sources = result.sources || []
  return (
    <div className="space-y-4">
      <EvidenceStatus
        audit={result.evidenceAudit}
        sourceCount={sources.length}
      />
      <div className="rounded-lg border border-[#BAE0FF] bg-[#F5F9FF] p-4">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="h-4 w-4 text-[#1677FF]" />
          <div className="text-sm font-semibold text-slate-800">
            {result.mode === "hypothesis" ? "判断验证结果" : "全面调研结论"}
          </div>
        </div>
        {result.hypothesis && (
          <div className="mb-2 rounded-lg border border-[#BAE0FF] bg-white p-2 text-xs text-[#0958D9]">
            {result.hypothesis}
          </div>
        )}
        <p className="text-sm leading-7 text-slate-700">{result.executiveSummary}</p>
        <SourceBadges path="executiveSummary" references={references} sources={sources} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <MiniPanel
          title={subjectType === "person" ? "个人 IP 形象" : "品牌形象"}
          text={result.brandImage}
          sourceIds={referenceIds(references, "brandImage")}
          sources={sources}
        />
        <MiniPanel
          title="当前认知"
          text={result.modelMentality}
          sourceIds={referenceIds(references, "modelMentality")}
          sources={sources}
        />
      </div>

      {result.dimensions.length > 0 && (
        <div className="space-y-2">
          {result.dimensions.map((item, dimensionIndex) => (
            <div key={item.name} className="rounded-lg border border-slate-200 bg-white/80 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-sm font-medium text-slate-800">{item.name}</div>
                <div className="font-mono text-sm font-semibold text-[#0958D9]">{item.score}</div>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 mb-2 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-[#1677FF] to-[#00C8FF]" style={{ width: `${item.score}%` }} />
              </div>
              <p className="text-xs leading-6 text-slate-600">{item.insight}</p>
              <SourceBadges
                path={`dimensions.${dimensionIndex}.insight`}
                references={references}
                sources={sources}
              />
              {item.evidence.length > 0 && <InlineList items={item.evidence} tone="slate" />}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <ListPanel title="用户感知" items={result.audiencePerception} tone="cyan" referencePath="audiencePerception" references={references} sources={sources} />
        <ListPanel title="信任信号" items={result.trustSignals} tone="emerald" referencePath="trustSignals" references={references} sources={sources} />
        <ListPanel title="证据缺口" items={result.evidenceGaps} tone="amber" referencePath="evidenceGaps" references={references} sources={sources} />
        <ListPanel title="风险暴露" items={result.risks} tone="rose" referencePath="risks" references={references} sources={sources} />
        <ListPanel title="增长机会" items={result.opportunities} tone="blue" referencePath="opportunities" references={references} sources={sources} />
        <ListPanel title="行动建议" items={result.recommendations} tone="emerald" referencePath="recommendations" references={references} sources={sources} />
      </div>

      {Boolean(result.contentBlueprints?.length) && (
        <section className="overflow-hidden rounded-lg border border-violet-200 bg-white">
          <div className="flex items-center gap-2 border-b border-violet-100 bg-violet-50 px-4 py-3">
            <Layers3 className="h-4 w-4 text-violet-600" />
            <div>
              <div className="text-sm font-semibold text-slate-800">建议优先制作的内容</div>
              <div className="mt-0.5 text-[11px] text-slate-500">根据本次调研结论匹配文章结构与证据准备项</div>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {result.contentBlueprints?.map((item, index) => (
              <div key={`${item.question}-${index}`} className="px-4 py-3">
                <div className="text-sm font-medium leading-6 text-slate-800">{item.question}</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{item.rationale}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  <span className="rounded bg-violet-50 px-2 py-1 text-violet-700">
                    {getGeoArticleFormat(item.articleFormat).title}
                  </span>
                  <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">
                    {CONTENT_PLATFORM_LABELS[item.targetPlatform] || "通用长文"}
                  </span>
                  <span className="rounded bg-cyan-50 px-2 py-1 text-cyan-700">{TITLE_STRATEGY_LABELS[item.titleStrategy] || "自动标题"}</span>
                  {item.evidenceNeeded.slice(0, 3).map(evidence => (
                    <span key={evidence} className="rounded bg-amber-50 px-2 py-1 text-amber-700">需准备：{evidence}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <EvidenceSourceList sources={sources} />

      <div className="text-[11px] text-slate-400 text-right">
        生成于 {new Date(result.generatedAt).toLocaleString("zh-CN")}
      </div>
    </div>
  )
}

function CompareReport({
  result,
  ourBrand,
  subjectType,
}: {
  result: CompetitorCompareResult
  ourBrand: string
  subjectType: "brand" | "person"
}) {
  const comparisons = getComparisons(result)
  const targetLabel = ourBrand || (subjectType === "person" ? "目标人物" : "我方品牌")

  return (
    <div className="space-y-4">
      {result.ourWeaknessSummary && result.ourWeaknessSummary.length > 0 && (
        <ListPanel
          title={`${targetLabel}对标所选${subjectType === "person" ? "同行人物" : "竞品"}的劣势汇总`}
          items={result.ourWeaknessSummary}
          tone="amber"
        />
      )}

      {comparisons.map(item => (
        <div key={item.competitor} className="space-y-3 rounded-lg border border-[#DCE6F2] bg-white p-3">
          <div className="rounded-lg border border-[#BAE0FF] bg-[#F5F9FF] p-4">
            <div className="mb-1 text-xs text-[#0958D9]">
              {targetLabel} vs {item.competitor}
            </div>
            <p className="text-sm leading-7 text-slate-700">{item.positioningSummary}</p>
            <SourceBadges
              path="positioningSummary"
              references={item.evidenceReferences || []}
              sources={item.sources || []}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <ListPanel title={subjectType === "person" ? "目标人物优势" : "我方优势"} items={item.ourAdvantages} tone="emerald" referencePath="ourAdvantages" references={item.evidenceReferences} sources={item.sources} />
            <ListPanel title={subjectType === "person" ? "同行人物优势" : "竞品优势"} items={item.competitorAdvantages} tone="rose" referencePath="competitorAdvantages" references={item.evidenceReferences} sources={item.sources} />
            <ListPanel title={subjectType === "person" ? "目标人物短板" : "我方短板"} items={item.ourWeaknesses} tone="amber" referencePath="ourWeaknesses" references={item.evidenceReferences} sources={item.sources} />
            <ListPanel title={subjectType === "person" ? "同行人物短板" : "竞品短板"} items={item.competitorWeaknesses} tone="slate" referencePath="competitorWeaknesses" references={item.evidenceReferences} sources={item.sources} />
          </div>
          <ListPanel title="差异化叙事" items={item.differentiators} tone="blue" referencePath="differentiators" references={item.evidenceReferences} sources={item.sources} />
          <ListPanel title="用户选择因素" items={item.userChoiceDrivers} tone="cyan" referencePath="userChoiceDrivers" references={item.evidenceReferences} sources={item.sources} />
          <ListPanel title="内容打法" items={item.contentActions} tone="rose" referencePath="contentActions" references={item.evidenceReferences} sources={item.sources} />
          <EvidenceStatus audit={item.evidenceAudit} sourceCount={item.sources?.length || 0} compact />
          <EvidenceSourceList sources={item.sources || []} />
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
    sources: result.sources,
    evidenceReferences: result.evidenceReferences,
    evidenceAudit: result.evidenceAudit,
  }]
}

function MiniPanel({
  title,
  text,
  sourceIds = [],
  sources = [],
}: {
  title: string
  text: string
  sourceIds?: string[]
  sources?: ResearchEvidenceSource[]
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white/80 p-3">
      <div className="text-xs font-semibold text-slate-700 mb-1">{title}</div>
      <p className="text-xs leading-6 text-slate-600">{text}</p>
      <SourceBadges sourceIds={sourceIds} sources={sources} />
    </div>
  )
}

function ListPanel({
  title,
  items,
  tone,
  referencePath,
  references,
  sources,
}: {
  title: string
  items: string[]
  tone: "emerald" | "rose" | "amber" | "blue" | "cyan" | "slate"
  referencePath?: string
  references?: ResearchEvidenceReference[]
  sources?: ResearchEvidenceSource[]
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
              <span className="min-w-0">
                <span>{item}</span>
                {referencePath ? (
                  <SourceBadges
                    path={`${referencePath}.${index}`}
                    references={references || []}
                    sources={sources || []}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function referenceIds(references: ResearchEvidenceReference[], path: string): string[] {
  return references.find(reference => reference.path === path)?.sourceIds || []
}

function SourceBadges({
  path,
  references = [],
  sourceIds,
  sources,
}: {
  path?: string
  references?: ResearchEvidenceReference[]
  sourceIds?: string[]
  sources: ResearchEvidenceSource[]
}) {
  const ids = sourceIds || (path ? referenceIds(references, path) : [])
  if (ids.length === 0) return null
  const sourceMap = new Map(sources.map(source => [source.id, source]))
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {ids.map(id => {
        const source = sourceMap.get(id)
        if (!source) return null
        return (
          <a
            key={`${path || "source"}-${id}`}
            href={source.url}
            target="_blank"
            rel="noreferrer noopener"
            title={source.title}
            className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-100 hover:text-blue-900"
          >
            {id}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )
      })}
    </span>
  )
}

function EvidenceStatus({
  audit,
  sourceCount,
  compact = false,
}: {
  audit?: ResearchResult["evidenceAudit"]
  sourceCount: number
  compact?: boolean
}) {
  if (!audit) {
    return (
      <div className={`${compact ? "mt-1" : ""} rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800`}>
        这是旧版结果，未保存完整的联网证据快照；重新调研后可查看可点击来源。
      </div>
    )
  }
  return (
    <div className={`${compact ? "mt-1" : ""} flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800`}>
      <span className="inline-flex items-center gap-1 font-semibold">
        <Globe2 className="h-3.5 w-3.5" />
        强制联网验证完成
      </span>
      <span>{sourceCount} 条可读来源</span>
      <span>{audit.uniqueDomainCount} 个独立网站</span>
      <span>{audit.queryCount} 组检索</span>
    </div>
  )
}

function EvidenceSourceList({ sources }: { sources: ResearchEvidenceSource[] }) {
  if (sources.length === 0) return null
  return (
    <section className="overflow-hidden rounded-lg border border-blue-100 bg-white">
      <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50/70 px-3 py-2.5">
        <Globe2 className="h-4 w-4 text-blue-600" />
        <div>
          <div className="text-xs font-semibold text-slate-800">联网来源与引用</div>
          <div className="text-[10px] text-slate-500">以下网址均已实际打开并验证为可读页面</div>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {sources.map(source => (
          <a
            key={`${source.id}-${source.url}`}
            href={source.url}
            target="_blank"
            rel="noreferrer noopener"
            className="group grid gap-1 px-3 py-2.5 transition hover:bg-blue-50/50 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-start sm:gap-2"
          >
            <span className="font-mono text-[10px] font-bold text-blue-700">{source.id}</span>
            <span className="min-w-0">
              <span className="block text-xs font-medium leading-5 text-slate-700 group-hover:text-blue-800">{source.title}</span>
              <span className="block break-all text-[10px] leading-4 text-slate-400">{source.url}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
              {source.domain}
              <ExternalLink className="h-3 w-3" />
            </span>
          </a>
        ))}
      </div>
    </section>
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
