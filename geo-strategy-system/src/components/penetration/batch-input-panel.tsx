"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import {
  Loader2,
  Play,
  AlertTriangle,
  Building2,
  XCircle,
  Sparkles,
  Pencil,
  X,
  Globe2,
  RefreshCw,
  UserRound,
} from "lucide-react"
import { MODEL_LABELS } from "@/lib/model-labels"
import ModelAvatar from "@/components/model-avatar"
import { CreditCostBadge } from "@/components/credits/credit-cost-badge"
import { useResumableBackgroundJob } from "@/hooks/use-resumable-background-job"
import { createBackgroundRequestId } from "@/lib/background-job-client"
import {
  EMPTY_PERSON_SUBJECT_PROFILE,
  getClientSubjectType,
  getSubjectCopy,
  normalizePersonSubjectProfile,
} from "@/lib/analysis-subject"
import type {
  AnalysisSubjectType,
  BackgroundJobRef,
  Client,
  ModelKey,
  PenetrationModelProgress,
  PersonSubjectProfile,
} from "@/types"

const ALL_MODELS: ModelKey[] = ["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"]

type InputMode = "manual" | "ai"
type ModelReadiness = Partial<Record<ModelKey, { ready: boolean; reason?: string }>>

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
  onRun: (params: {
    questions: string[]
    models: ModelKey[]
    brandAliases: string[]
    competitors: string[]
  }) => void
  onStop: () => void
  loading: boolean
  error: string | null
  skipped?: string[]
  modelErrors?: Partial<Record<ModelKey, string>>
  modelProgress?: Partial<Record<ModelKey, PenetrationModelProgress>>
  progressLabel?: string
  identityReadOnly?: boolean
}

export default function BatchInputPanel({
  client,
  onChangeClient,
  onRun,
  onStop,
  loading,
  error,
  skipped,
  modelErrors,
  modelProgress,
  progressLabel,
  identityReadOnly = false,
}: Props) {
  const [questionsText, setQuestionsText] = useState(() => client.questions.join("\n"))
  const [brandAliasesText, setBrandAliasesText] = useState(() => (client.brandAliases ?? []).join("\n"))
  const [competitorsText, setCompetitorsText] = useState(() => client.competitors.join("\n"))

  const [inputMode, setInputMode] = useState<InputMode>("manual")
  const [aiCount, setAiCount] = useState(5)
  const [aiKeywords, setAiKeywords] = useState("")
  const [aiToast, setAiToast] = useState<string | null>(null)
  const [modelReadiness, setModelReadiness] = useState<ModelReadiness>({})
  const subjectType = getClientSubjectType(client)
  const subjectCopy = getSubjectCopy(subjectType)
  const personProfile = normalizePersonSubjectProfile(client.personProfile)
  const subjectModeLocked = Boolean(
    client.penetration
      || client.research
      || client.diagnosis
      || client.keywordStrategy
      || client.difficultyAssessments?.length
      || client.articleGeneration?.generatedAt,
  )
  const aiJobRef = identityReadOnly ? undefined : client.backgroundJobs?.queryGeneration
  const aiLoading = Boolean(aiJobRef)
  const aiPayload = {
    industry: client.industry,
    brand: client.ourBrand,
    subjectType,
    personProfile: subjectType === "person" ? personProfile : undefined,
    count: aiCount,
    keywords: aiKeywords,
  }

  function backgroundJobsWith(ref?: BackgroundJobRef) {
    const next = { ...(client.backgroundJobs || {}) }
    if (ref) next.queryGeneration = ref
    else delete next.queryGeneration
    return next
  }

  const aiJobState = useResumableBackgroundJob<{ questions?: string[] }>({
    kind: "queryGeneration",
    clientId: client.id,
    jobRef: aiJobRef,
    payload: aiPayload,
    onAccepted: job => {
      onChangeClient({
        backgroundJobs: backgroundJobsWith({ requestId: job.requestId, jobId: job.id }),
      })
    },
    onSucceeded: job => {
      const generated = Array.isArray(job.result?.questions) ? job.result.questions : []
      if (generated.length === 0) {
        setAiToast("生成失败：豆包未返回任何疑问句")
        onChangeClient({ backgroundJobs: backgroundJobsWith() })
        return
      }

      const existing = parseLines(questionsText)
      const seen = new Set(existing)
      const merged = [...existing]
      for (const question of generated) {
        const value = String(question || "").trim()
        if (value && !seen.has(value)) {
          seen.add(value)
          merged.push(value)
        }
      }
      setQuestionsText(merged.join("\n"))
      setInputMode("manual")
      setAiToast(null)
      onChangeClient({
        questions: merged,
        backgroundJobs: backgroundJobsWith(),
      })
    },
    onFailed: message => {
      setAiToast(message)
      onChangeClient({ backgroundJobs: backgroundJobsWith() })
    },
  })

  useEffect(() => {
    if (!aiToast) return
    const t = setTimeout(() => setAiToast(null), 4500)
    return () => clearTimeout(t)
  }, [aiToast])

  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/penetration/readiness", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<{
          readiness?: Array<{ model: ModelKey; ready: boolean; reason?: string }>
        }>
      })
      .then(data => {
        const next: ModelReadiness = {}
        for (const item of data.readiness || []) next[item.model] = item
        setModelReadiness(next)
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return
        console.warn("[penetration] model readiness check failed", error)
      })
    return () => controller.abort()
  }, [])

  function parseLines(text: string): string[] {
    return text
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
  }

  function toggleModel(m: ModelKey) {
    if (modelReadiness[m]?.ready === false) return
    const set = new Set(client.selectedModels)
    if (set.has(m)) set.delete(m)
    else set.add(m)
    onChangeClient({ selectedModels: ALL_MODELS.filter(k => set.has(k)) })
  }

  function changeSubjectType(nextType: AnalysisSubjectType) {
    if (identityReadOnly || subjectModeLocked || nextType === subjectType) return
    onChangeClient({
      subjectType: nextType,
      personProfile: nextType === "person"
        ? normalizePersonSubjectProfile(client.personProfile || EMPTY_PERSON_SUBJECT_PROFILE)
        : client.personProfile,
    })
  }

  function updatePersonProfile(patch: Partial<PersonSubjectProfile>) {
    if (identityReadOnly) return
    onChangeClient({
      personProfile: {
        ...personProfile,
        ...patch,
      },
    })
  }

  function handleRun() {
    const questions = parseLines(questionsText)
    const brandAliases = identityReadOnly
      ? client.brandAliases ?? []
      : parseLines(brandAliasesText)
    const competitors = identityReadOnly
      ? client.competitors
      : parseLines(competitorsText)
    onChangeClient(identityReadOnly
      ? { questions }
      : { questions, brandAliases, competitors })
    onRun({ questions, models: eligibleSelectedModels, brandAliases, competitors })
  }

  function runAiGenerate() {
    setAiToast(null)
    onChangeClient({
      backgroundJobs: backgroundJobsWith({
        requestId: createBackgroundRequestId("query_generation"),
        payload: aiPayload,
      }),
    })
  }

  const questionCount = parseLines(questionsText).length
  const eligibleSelectedModels = client.selectedModels.filter(
    model => modelReadiness[model]?.ready !== false,
  )
  const canRun =
    !loading && client.ourBrand.trim().length > 0 && questionCount > 0 && eligibleSelectedModels.length > 0
  const canAiRun = !aiLoading && (!!client.industry.trim() || !!client.ourBrand.trim())

  return (
    <div className="space-y-4">
      {identityReadOnly ? (
        <div className="flex items-start gap-2 rounded-lg border border-[#91CAFF] bg-[#EAF5FF] px-3 py-2.5 text-xs leading-5 text-[#0958D9]">
          <Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {subjectType === "person"
            ? "人物身份、专业领域、姓名别名和同行名单由管理员统一维护。你可以编辑疑问句、选择模型并独立发起联网检测。"
            : "品牌、行业、别名和竞品由管理员统一维护。你可以编辑疑问句、选择模型并独立发起联网检测。"}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 rounded-lg border border-[#CFE1F5] bg-[#F5FAFF] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-semibold text-[#17324D]">分析主体</div>
          <div className="mt-0.5 text-[10px] leading-4 text-[#6F8296]">
            {subjectModeLocked
              ? "当前项目已有分析结果，模式已锁定；如需分析另一类主体，请新建客户项目。"
              : "选择后，识别对象、同行判断、图表和报告会使用对应规则。"}
          </div>
        </div>
        <div className="geo-segmented grid shrink-0 grid-cols-2 p-1">
          {([
            { value: "brand", label: "品牌", icon: Building2 },
            { value: "person", label: "个人 IP", icon: UserRound },
          ] as const).map(option => {
            const Icon = option.icon
            const active = subjectType === option.value
            return (
              <button
                key={option.value}
                type="button"
                disabled={identityReadOnly || subjectModeLocked}
                onClick={() => changeSubjectType(option.value)}
                className={`inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "bg-white text-[#0958D9] shadow-sm"
                    : "text-[#60758A] hover:text-[#1677FF]"
                } disabled:cursor-not-allowed disabled:opacity-70`}
              >
                <Icon className="h-3.5 w-3.5" />
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={subjectCopy.subjectLabel} required>
          <Input
            value={client.ourBrand}
            onChange={e => onChangeClient({ ourBrand: e.target.value })}
            placeholder={subjectType === "person" ? "如：张三" : "如：势途"}
            disabled={identityReadOnly}
          />
        </Field>
        <Field label={subjectCopy.industryLabel}>
          <Input
            value={client.industry}
            onChange={e => onChangeClient({ industry: e.target.value })}
            placeholder={subjectType === "person" ? "如：医疗 / 心血管内科" : "如：B端 AI Agent 工具"}
            disabled={identityReadOnly}
          />
        </Field>
      </div>

      {subjectType === "person" ? (
        <div className="rounded-lg border border-[#B8D8FA] bg-white">
          <div className="flex items-center gap-2 border-b border-[#E1ECF7] px-3 py-2.5">
            <UserRound className="h-4 w-4 text-[#1677FF]" />
            <div>
              <div className="text-xs font-semibold text-[#17324D]">个人 IP 身份卡</div>
              <div className="mt-0.5 text-[10px] text-[#7A8EA3]">
                用于区分同名人物、判断真正同行；不会写入被测模型的盲测问题。
              </div>
            </div>
          </div>
          <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="职业 / 身份" required>
              <Input
                value={personProfile.profession}
                onChange={event => updatePersonProfile({ profession: event.target.value })}
                placeholder="如：医生、律师、财经博主"
                disabled={identityReadOnly}
              />
            </Field>
            <Field label="所属机构">
              <Input
                value={personProfile.organization}
                onChange={event => updatePersonProfile({ organization: event.target.value })}
                placeholder="医院、律所、公司或工作室"
                disabled={identityReadOnly}
              />
            </Field>
            <Field label="职称 / 公开身份">
              <Input
                value={personProfile.title}
                onChange={event => updatePersonProfile({ title: event.target.value })}
                placeholder="如：主任医师、创始人"
                disabled={identityReadOnly}
              />
            </Field>
            <Field label="主要地区">
              <Input
                value={personProfile.region}
                onChange={event => updatePersonProfile({ region: event.target.value })}
                placeholder="如：杭州 / 全国"
                disabled={identityReadOnly}
              />
            </Field>
            <Field label="专业方向" aside="每行一个">
              <Textarea
                value={personProfile.specialties.join("\n")}
                onChange={event => updatePersonProfile({ specialties: parseLines(event.target.value) })}
                rows={2}
                placeholder={"冠心病诊疗\n心脏介入"}
                disabled={identityReadOnly}
                className="min-h-[76px] text-xs"
              />
            </Field>
            <Field label="资质 / 代表性身份" aside="每行一个">
              <Textarea
                value={personProfile.credentials.join("\n")}
                onChange={event => updatePersonProfile({ credentials: parseLines(event.target.value) })}
                rows={2}
                placeholder={"主任医师\n某专业委员会委员"}
                disabled={identityReadOnly}
                className="min-h-[76px] text-xs"
              />
            </Field>
            <div className="md:col-span-2 xl:col-span-3">
              <Field
                label="公开主页链接"
                aside="每行一个"
                help="可填写医院主页、律所主页、百科或认证社交账号，用于后续身份消歧。"
              >
                <Textarea
                  value={personProfile.profileUrls.join("\n")}
                  onChange={event => updatePersonProfile({ profileUrls: parseLines(event.target.value) })}
                  rows={2}
                  placeholder={"https://example.com/profile\nhttps://example.com/homepage"}
                  disabled={identityReadOnly}
                  className="min-h-[72px] font-mono text-xs"
                />
              </Field>
            </div>
          </div>
        </div>
      ) : null}

      <details className="rounded-lg border border-[#DCE6F2] bg-[#F8FAFD]">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-semibold text-[#526A83]">
          <span>{subjectType === "person" ? "姓名归一与同行设置" : "品牌归一与竞品设置"}</span>
          <span className="text-[10px] font-normal text-[#7E91A7]">
            {subjectType === "person" ? "姓名变体、公开称呼和已知同行" : "别名、公司全称和已知竞品"}
          </span>
        </summary>
        <div className="grid gap-3 border-t border-[#E8EEF5] p-3 md:grid-cols-2">
          <Field
            label={subjectCopy.aliasesLabel}
            aside="每行一个"
            help={subjectType === "person"
              ? "只用于回答后的同名消歧与姓名归一，不会发送给被测模型。"
              : "只用于回答后的品牌识别与统计归一，不会发送给被测模型。"}
          >
            <Textarea
              value={brandAliasesText}
              disabled={identityReadOnly}
              onChange={e => {
                const value = e.target.value
                setBrandAliasesText(value)
                onChangeClient({ brandAliases: parseLines(value) })
              }}
              rows={2}
              placeholder={subjectType === "person"
                ? "英文名 / 曾用名\n带职称的公开称呼"
                : "品牌简称\n英文名 / 公司全称"}
              className="min-h-[76px] font-mono text-xs"
            />
          </Field>
          <Field label={subjectCopy.competitorsLabel} aside="每行一个">
            <Textarea
              value={competitorsText}
              disabled={identityReadOnly}
              onChange={e => {
                const value = e.target.value
                setCompetitorsText(value)
                onChangeClient({ competitors: parseLines(value) })
              }}
              rows={2}
              placeholder={subjectType === "person"
                ? "同行人物 A\n同行人物 B"
                : "竞品 A\n竞品 B"}
              className="min-h-[76px] font-mono text-xs"
            />
          </Field>
        </div>
      </details>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs text-slate-600 block">
            疑问句列表 * <span className="text-slate-400">（已识别 {questionCount} 条）</span>
          </Label>
        </div>

        {/* Tabs：手动录入 / AI 智能生成 */}
        <div className={`geo-segmented mb-3 inline-grid w-full ${identityReadOnly ? "grid-cols-1" : "grid-cols-2"} sm:w-auto`}>
          <button
            type="button"
            onClick={() => setInputMode("manual")}
            className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              inputMode === "manual"
                ? "bg-white text-[#0958D9] shadow-sm"
                : "bg-transparent text-slate-600 hover:text-[#1677FF]"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" />
            手动录入
          </button>
          {!identityReadOnly ? <button
            type="button"
            onClick={() => setInputMode("ai")}
            className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              inputMode === "ai"
                ? "bg-white text-[#0958D9] shadow-sm"
                : "bg-transparent text-slate-600 hover:text-[#0958D9]"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI 智能生成
            <span className="ml-1 hidden whitespace-nowrap rounded-full bg-[#E6F4FF] px-1.5 py-0.5 text-[9px] font-medium text-[#0958D9] sm:inline">
              专属豆包
            </span>
          </button> : null}
        </div>

        {inputMode === "manual" || identityReadOnly ? (
          <Textarea
            value={questionsText}
            onChange={e => {
              const value = e.target.value
              setQuestionsText(value)
              onChangeClient({ questions: parseLines(value) })
            }}
            rows={6}
            placeholder={"国内有哪些值得推荐的 AI Agent 工具？\n2026 年企业级 GEO 平台怎么选？\n..."}
            className="font-mono text-xs"
          />
        ) : (
          <div className="space-y-3 rounded-lg border border-[#CFE1F5] bg-[#F5FAFF] p-3">
            <div className="grid gap-3 md:grid-cols-[110px_1fr_auto] md:items-end">
              <div>
                <Label className="text-[11px] text-slate-600 mb-1.5 block">生成数量</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={aiCount}
                  onChange={e => {
                    const n = Number(e.target.value)
                    setAiCount(Number.isFinite(n) ? Math.max(1, Math.min(30, n)) : 5)
                  }}
                />
              </div>
              <div>
                <Label className="text-[11px] text-slate-600 mb-1.5 block">
                  包含关键词（可选）
                </Label>
                <Input
                  value={aiKeywords}
                  onChange={e => setAiKeywords(e.target.value)}
                  placeholder="多个词用空格隔开"
                />
              </div>
              <Button
                onClick={runAiGenerate}
                disabled={!canAiRun}
                className="gap-2 whitespace-nowrap border-0 px-4 py-2.5 text-xs font-medium"
              >
                {aiLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    智能生成
                  </>
                )}
              </Button>
            </div>
            <CreditCostBadge featureKey="legacyQueryGenerateUnit" units={aiCount} />

            {aiLoading && (
              <div className="rounded-lg border border-[#BAE0FF] bg-white px-3 py-2 text-[11px] leading-5 text-[#0958D9]">
                <div className="font-medium">{aiJobState.currentJob?.stage || "疑问句正在转入服务器后台"}</div>
                <div className="text-[#526A83]">
                  {aiJobState.connectionNotice || "可以切换客户或刷新页面，生成结果会自动追加到疑问句列表。"}
                </div>
              </div>
            )}

            {!client.industry.trim() && !client.ourBrand.trim() && (
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                请先在上方填写「{subjectCopy.subjectShortLabel}」或「{subjectCopy.industryLabel}」，豆包需要据此推演用户疑问句。
              </div>
            )}

            <div className="text-[11px] text-slate-500 leading-relaxed">
              生成结果将自动追加到「手动录入」文本框，并切回手动 Tab 以便你审核 / 微调后再开始检测。
            </div>
          </div>
        )}
      </div>

      <div>
        <Label className="text-xs text-slate-600 mb-2 block">检测模型 *</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {ALL_MODELS.map(m => {
            const readiness = modelReadiness[m]
            const unavailable = readiness?.ready === false
            const checked = !unavailable && client.selectedModels.includes(m)
            return (
              <label
                key={m}
                title={unavailable ? readiness.reason : undefined}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition text-sm ${
                  unavailable
                    ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 opacity-75"
                    : checked
                    ? "border-[#003EB3] bg-[#003EB3]/5 text-[#003EB3]"
                    : "border-slate-200 hover:border-slate-300 text-slate-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={unavailable}
                  onChange={() => toggleModel(m)}
                  className="accent-[#003EB3]"
                />
                <ModelAvatar model={m} size="xs" />
                <span className="font-medium">{MODEL_LABELS[m]}</span>
                {unavailable && <span className="ml-auto text-[10px]">暂不可用</span>}
              </label>
            )
          })}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-cyan-200 bg-cyan-50/70 p-2.5 text-[11px] leading-relaxed text-cyan-900">
        <Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-700" />
        <span>
          每条疑问句会逐模型单独请求；严格模式只接受模型官方联网搜索返回的原始回复和可审计来源。渗透率情报不会把目标品牌、竞品清单或资料包交给被测模型。
        </span>
      </div>

      {skipped && skipped.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            以下模型未通过严格联网预检，已在任务开始前跳过且不计费：<b>{skipped.join("、")}</b>
          </span>
        </div>
      )}

      {modelErrors && Object.keys(modelErrors).length > 0 && (
        <div className="space-y-1.5">
          {(Object.entries(modelErrors) as Array<[ModelKey, string]>).map(([m, msg]) => (
            <div
              key={m}
              className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
                loading
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-red-300 bg-red-50 text-red-700"
              }`}
            >
              {loading ? (
                <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-600" />
              ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              )}
              <span>
                <b>{MODEL_LABELS[m]} {loading ? "正在自动补采：" : "需要处理："}</b>
                {msg}
              </span>
            </div>
          ))}
        </div>
      )}

      {modelProgress && Object.keys(modelProgress).length > 0 && loading && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {(Object.entries(modelProgress) as Array<[ModelKey, PenetrationModelProgress]>).map(([model, progress]) => (
            <div key={model} className="rounded-lg border border-blue-100 bg-blue-50/60 px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700">
                <ModelAvatar model={model} size="xs" />
                <span className="truncate">{MODEL_LABELS[model]}</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                有效 {progress.succeeded}/{progress.total}
                {progress.retrying > 0 ? ` · 补采 ${progress.retrying}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-slate-200/70 pt-4 lg:flex-row lg:items-center lg:justify-between">
        <CreditCostBadge
          featureKey="penetrationSlot"
          units={Math.max(1, questionCount * eligibleSelectedModels.length)}
          className="w-fit"
        />

        {loading ? (
          <Button
            type="button"
            variant="outline"
            onClick={onStop}
            className="w-full gap-2 border-rose-200 px-6 py-5 text-sm font-medium text-rose-700 hover:bg-rose-50 hover:text-rose-800 lg:w-auto lg:min-w-[300px]"
          >
            <XCircle className="h-4 w-4" />
            停止检测 · {progressLabel || "后台任务运行中"}
          </Button>
        ) : (
          <Button
            onClick={handleRun}
            disabled={!canRun}
            className="h-11 w-full gap-2 border-0 px-6 text-sm font-medium lg:w-auto lg:min-w-[300px]"
          >
            <Play className="h-4 w-4" />
            开始多模型检测 ({eligibleSelectedModels.length} × {questionCount})
          </Button>
        )}
      </div>

      {/* 红色 Toast：AI 生成失败时右下角浮窗，4.5 秒自动消失 */}
      {aiToast && (
        <div
          className="fixed bottom-6 right-6 z-[100] max-w-sm rounded-xl bg-red-600 text-white shadow-2xl shadow-red-300/40 px-4 py-3 text-sm leading-relaxed animate-fade-in-up no-print"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">{aiToast}</div>
            <button
              onClick={() => setAiToast(null)}
              className="shrink-0 -mr-1 p-0.5 text-white/80 hover:text-white"
              aria-label="关闭提示"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
