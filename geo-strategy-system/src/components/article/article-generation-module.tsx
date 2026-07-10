"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import {
  Check,
  ExternalLink,
  FileText,
  Globe2,
  KeyRound,
  Link,
  Loader2,
  RefreshCw,
  Square,
  WandSparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch, readApiJson } from "@/lib/api-fetch"
import { ARTICLE_PROMPT_OPTIONS, type ArticlePromptOption } from "@/lib/article-prompt-meta"
import { extractQuestionAdvantages, resolveQuestionAdvantage } from "@/lib/geo-strategy/question-advantages"
import { CreditCostBadge } from "@/components/credits/credit-cost-badge"
import { ARTICLE_PROMPT_PRICE_KEYS } from "@/lib/pricing"
import { buildArticleSourceModelGroups } from "@/lib/article-source-options"
import { cancelBackgroundJob, createBackgroundRequestId, createIdempotentApiJob } from "@/lib/background-job-client"
import { useResumableBackgroundJob } from "@/hooks/use-resumable-background-job"
import type { AiProviderPublicSetting } from "@/types/ai-settings"
import type {
  ArticleGenerationState,
  ArticleModelProviderKey,
  ArticlePromptKey,
  BackgroundJobRef,
  Client,
  ModelKey,
} from "@/types"
import type { QuestionItem } from "@/types/geo-strategy"

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}

interface ArticleSettingsResponse {
  prompts?: ArticlePromptOption[]
  providers?: AiProviderPublicSetting[]
  error?: string
}

interface ArticleGenerationResponse {
  article?: string
  promptKey?: ArticlePromptKey
  modelProvider?: ArticleModelProviderKey
  model?: string
  generatedAt?: string
  error?: string
}

interface ArticleExtractResponse {
  finalUrl?: string
  title?: string
  markdown?: string
  contentLength?: number
  error?: string
}

const ArticleMarkdownWorkspace = dynamic(
  () => import("@/components/article/article-markdown-workspace"),
  {
    ssr: false,
    loading: () => (
      <section className="flex min-h-[620px] flex-col rounded-xl border border-slate-200/80 bg-white/90 p-4 text-sm text-slate-500 shadow-sm">
        Markdown 工作台加载中...
      </section>
    ),
  }
)

function createInitialArticle(client: Client): ArticleGenerationState {
  const saved = client.articleGeneration
  const interruptedLegacyRequest = saved?.status === "generating"
    && !client.backgroundJobs?.articleGeneration
  return {
    promptKey: "thirdPartyObservation",
    modelProvider: "article",
    model: "",
    sourceUrl: "",
    sourceTitle: "",
    sourceMarkdown: "",
    rewriteBrand: client.ourBrand || client.name || "",
    rewriteMaterials: "",
    extractStatus: "idle",
    coreQuestion: "",
    keywords: "",
    region: "",
    business: client.industry || "",
    advantages: "",
    audience: "",
    extraRequirements: "",
    output: "",
    status: "idle",
    ...(saved ?? {}),
    ...(interruptedLegacyRequest
      ? {
          status: "idle" as const,
          error: "上次生成连接已经中断，请重新发起；新任务将支持断线恢复。",
        }
      : {}),
  }
}

function buildArticleJobPayload(client: Client, article: ArticleGenerationState) {
  return {
    promptKey: article.promptKey,
    modelProvider: article.modelProvider,
    model: article.model,
    clientName: client.name,
    brandName: client.ourBrand || client.name,
    industry: client.industry,
    website: client.website,
    sourceUrl: article.sourceUrl,
    sourceTitle: article.sourceTitle,
    sourceMarkdown: article.sourceMarkdown,
    rewriteBrand: article.rewriteBrand,
    rewriteMaterials: article.rewriteMaterials,
    coreQuestion: article.coreQuestion,
    keywords: article.keywords,
    region: article.region,
    business: article.business,
    advantages: article.advantages,
    audience: article.audience,
    extraRequirements: article.extraRequirements,
  }
}

export default function ArticleGenerationModule({ client, onChangeClient }: Props) {
  const [article, setArticle] = useState<ArticleGenerationState>(() => createInitialArticle(client))
  const [providers, setProviders] = useState<AiProviderPublicSetting[]>([])
  const [prompts, setPrompts] = useState<ArticlePromptOption[]>(ARTICLE_PROMPT_OPTIONS)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [preferredSourceModel, setPreferredSourceModel] = useState<ModelKey | null>(null)
  const [stoppingJob, setStoppingJob] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadSettings() {
      try {
        const res = await apiFetch("/api/article-generation/settings", { cache: "no-store" })
        const data = await readApiJson<ArticleSettingsResponse>(res, "文章生成配置")
        if (!res.ok) throw new Error(data.error || "配置读取失败")
        if (cancelled) return
        const nextProviders = data.providers || []
        setProviders(nextProviders)
        setPrompts(data.prompts?.length ? data.prompts : ARTICLE_PROMPT_OPTIONS)
        setSettingsError(null)

        setArticle(prev => {
          if (prev.model) return prev
          const provider = nextProviders.find(item => item.key === prev.modelProvider)
            || nextProviders.find(item => item.key === "article")
          if (!provider?.model) return prev
          const next = { ...prev, model: provider.model }
          onChangeClient({ articleGeneration: next })
          return next
        })
      } catch (error) {
        if (!cancelled) {
          setSettingsError(error instanceof Error ? error.message : "配置读取失败")
        }
      }
    }

    loadSettings()
    return () => {
      cancelled = true
    }
  }, [onChangeClient])

  const activePrompt = useMemo(
    () => prompts.find(item => item.key === article.promptKey) || prompts[0] || ARTICLE_PROMPT_OPTIONS[0],
    [article.promptKey, prompts]
  )

  const activeProvider = useMemo(
    () => providers.find(item => item.key === article.modelProvider),
    [article.modelProvider, providers]
  )
  const keywordQuestions = client.keywordStrategy?.questions || []
  const keywordAdvantages = useMemo(() => collectKeywordAdvantages(client), [client])
  const penetrationSourceGroups = useMemo(
    () => buildArticleSourceModelGroups(client.penetration),
    [client.penetration],
  )
  const activeSourceGroup = penetrationSourceGroups.find(
    group => group.model === preferredSourceModel,
  ) || penetrationSourceGroups[0]
  const quickQuestions = keywordQuestions.slice(0, 24)
  const quickAdvantages = keywordAdvantages.slice(0, 24)
  const hasKeywordQuickFill = keywordQuestions.length > 0 || keywordAdvantages.length > 0

  const isRewrite = article.promptKey === "rewrite"
  const isGenerating = article.status === "generating"
  const isExtracting = article.extractStatus === "generating"
  const canGenerate = isRewrite
    ? Boolean(article.sourceMarkdown?.trim() && article.rewriteBrand?.trim() && article.rewriteMaterials?.trim()) && !isGenerating && !isExtracting
    : Boolean(article.coreQuestion.trim()) && !isGenerating
  const hasOutput = Boolean(article.output.trim())
  const articleFeatureKey = ARTICLE_PROMPT_PRICE_KEYS[article.promptKey || "thirdPartyObservation"]
  const visiblePrompts = isRewrite
    ? prompts.filter(prompt => prompt.key === "rewrite")
    : prompts.filter(prompt => prompt.key !== "rewrite")
  const articleJobRef = client.backgroundJobs?.articleGeneration

  function persist(next: ArticleGenerationState) {
    setArticle(next)
    onChangeClient({ articleGeneration: next })
  }

  function backgroundJobsWith(ref?: BackgroundJobRef) {
    const next = { ...(client.backgroundJobs || {}) }
    if (ref) next.articleGeneration = ref
    else delete next.articleGeneration
    return next
  }

  function persistArticleAndJob(
    nextArticle: ArticleGenerationState,
    ref?: BackgroundJobRef,
  ) {
    setArticle(nextArticle)
    onChangeClient({
      articleGeneration: nextArticle,
      backgroundJobs: backgroundJobsWith(ref),
    })
  }

  const articleJobState = useResumableBackgroundJob<ArticleGenerationResponse>({
    kind: "articleGeneration",
    clientId: client.id,
    jobRef: articleJobRef,
    payload: buildArticleJobPayload(client, article),
    onAccepted: job => {
      onChangeClient({
        backgroundJobs: backgroundJobsWith({ requestId: job.requestId, jobId: job.id }),
      })
    },
    onSucceeded: job => {
      const data = job.result
      if (!data?.article) {
        const next = {
          ...article,
          status: "error" as const,
          error: "后台文章任务没有返回有效内容，请重新生成。",
        }
        persistArticleAndJob(next)
        return
      }
      const next: ArticleGenerationState = {
        ...article,
        promptKey: data.promptKey || article.promptKey,
        modelProvider: data.modelProvider || article.modelProvider,
        model: data.model || article.model,
        output: data.article,
        generatedAt: data.generatedAt || new Date().toISOString(),
        status: "done",
        error: undefined,
      }
      persistArticleAndJob(next)
    },
    onFailed: message => {
      persistArticleAndJob({
        ...article,
        status: "error",
        error: message,
      })
    },
    onCancelled: () => {
      persistArticleAndJob({
        ...article,
        status: "idle",
        error: "文章任务已停止，预扣积分会自动退回。",
      })
    },
  })

  function updateField<K extends keyof ArticleGenerationState>(
    key: K,
    value: ArticleGenerationState[K]
  ) {
    persist({
      ...article,
      [key]: value,
      error: key === "output" ? article.error : undefined,
      status: key === "output" ? article.status : article.status === "error" ? "idle" : article.status,
    })
  }

  function updatePrompt(key: ArticlePromptKey) {
    persist({
      ...article,
      promptKey: key,
      status: article.status === "error" ? "idle" : article.status,
      error: undefined,
    })
  }

  function updateMode(mode: "generate" | "rewrite") {
    const nextPrompt: ArticlePromptKey = mode === "rewrite"
      ? "rewrite"
      : article.promptKey === "rewrite"
        ? "thirdPartyObservation"
        : article.promptKey
    persist({
      ...article,
      promptKey: nextPrompt,
      rewriteBrand: article.rewriteBrand || client.ourBrand || client.name || "",
      rewriteMaterials: article.rewriteMaterials || article.advantages || "",
      status: article.status === "error" ? "idle" : article.status,
      error: undefined,
    })
  }

  function updateProvider(key: ArticleModelProviderKey) {
    const provider = providers.find(item => item.key === key)
    persist({
      ...article,
      modelProvider: key,
      model: provider?.model || "",
      status: article.status === "error" ? "idle" : article.status,
      error: undefined,
    })
  }

  function fillKeywordQuestions() {
    if (keywordQuestions.length === 0) return
    persist({
      ...article,
      coreQuestion: article.coreQuestion || keywordQuestions[0]?.question || "",
      keywords: keywordQuestions.map(question => question.question).join("\n"),
      status: article.status === "error" ? "idle" : article.status,
      error: undefined,
    })
  }

  function fillKeywordAdvantages() {
    if (keywordAdvantages.length === 0) return
    persist({
      ...article,
      advantages: keywordAdvantages.join("\n"),
      status: article.status === "error" ? "idle" : article.status,
      error: undefined,
    })
  }

  function fillKeywordQuestionsAndAdvantages() {
    const nextQuestions = keywordQuestions.map(question => question.question).filter(Boolean)
    persist({
      ...article,
      coreQuestion: article.coreQuestion || nextQuestions[0] || "",
      keywords: nextQuestions.length > 0 ? nextQuestions.join("\n") : article.keywords,
      advantages: keywordAdvantages.length > 0 ? keywordAdvantages.join("\n") : article.advantages,
      status: article.status === "error" ? "idle" : article.status,
      error: undefined,
    })
  }

  function handleQuestionAsTopic(question: QuestionItem) {
    const matchedAdvantage = resolveQuestionAdvantage(question, keywordAdvantages)
    persist({
      ...article,
      coreQuestion: question.question,
      advantages: appendUniqueLines(article.advantages, matchedAdvantage ? [matchedAdvantage] : []),
      status: article.status === "error" ? "idle" : article.status,
      error: undefined,
    })
  }

  function appendAdvantage(advantage: string) {
    persist({
      ...article,
      advantages: appendUniqueLines(article.advantages, [advantage]),
      status: article.status === "error" ? "idle" : article.status,
      error: undefined,
    })
  }

  async function runExtractArticle(sourceUrlOverride?: string) {
    const selectedSourceUrl = sourceUrlOverride?.trim() || ""
    const sourceUrl = selectedSourceUrl || article.sourceUrl?.trim() || ""
    if (!sourceUrl) {
      persist({ ...article, extractStatus: "error", extractError: "请先填写文章链接" })
      return
    }
    const extractionBase: ArticleGenerationState = selectedSourceUrl
      ? {
          ...article,
          sourceUrl: selectedSourceUrl,
          sourceTitle: "",
          sourceMarkdown: "",
        }
      : article
    const extracting: ArticleGenerationState = {
      ...extractionBase,
      extractStatus: "generating",
      extractError: undefined,
      error: undefined,
    }
    persist(extracting)

    try {
      const data = await createIdempotentApiJob<ArticleExtractResponse>({
        endpoint: "/api/article-generation/extract-url",
        requestId: createBackgroundRequestId("article_extract"),
        label: "文章读取",
        payload: { url: sourceUrl },
        onRetry: () => {
          persist({
            ...extracting,
            extractError: "网络暂时中断，正在重新确认原文读取结果...",
          })
        },
      })
      persist({
        ...extracting,
        sourceUrl: data.finalUrl || sourceUrl,
        sourceTitle: data.title || "",
        sourceMarkdown: data.markdown || "",
        extractStatus: "done",
        extractError: undefined,
      })
    } catch (error) {
      persist({
        ...extracting,
        extractStatus: "error",
        extractError: error instanceof Error ? error.message : "文章读取失败",
      })
    }
  }

  function runGenerate() {
    if (isRewrite && !article.sourceMarkdown?.trim()) {
      persist({ ...article, status: "error", error: "请先读取或粘贴原文内容" })
      return
    }
    if (isRewrite && !article.rewriteBrand?.trim()) {
      persist({ ...article, status: "error", error: "请先填写推荐品牌" })
      return
    }
    if (isRewrite && !article.rewriteMaterials?.trim()) {
      persist({ ...article, status: "error", error: "请先填写相关资料" })
      return
    }
    if (!isRewrite && !article.coreQuestion.trim()) {
      persist({ ...article, status: "error", error: "请先填写核心搜索问题或内容主题" })
      return
    }

    const generating: ArticleGenerationState = {
      ...article,
      status: "generating",
      error: undefined,
    }
    persistArticleAndJob(generating, {
      requestId: createBackgroundRequestId("article"),
      payload: buildArticleJobPayload(client, generating),
    })
  }

  async function stopArticleJob() {
    if (!articleJobRef?.jobId || stoppingJob) return
    setStoppingJob(true)
    try {
      await cancelBackgroundJob(articleJobRef.jobId)
      persistArticleAndJob({
        ...article,
        status: "idle",
        error: "文章任务已停止，预扣积分会自动退回。",
      })
    } catch (error) {
      persist({
        ...article,
        error: error instanceof Error ? error.message : "停止任务失败，后台任务仍在继续。",
      })
    } finally {
      setStoppingJob(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#d8e2e1] bg-white/96 shadow-[0_12px_32px_-26px_rgba(8,28,36,0.5)]">
      <div className="border-b border-[#d8e2e1] bg-white/95 backdrop-blur">
        <div className="flex flex-col gap-3 px-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="geo-module-icon h-9 w-9 bg-[#9B527E]">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <div className="geo-display-title text-lg text-[#573047]">
                文章生成 · GEO 内容写作台
              </div>
              <div className="truncate text-[11px] text-slate-500">
                {isRewrite ? "文章改写" : activePrompt.title} · {article.model || activeProvider?.model || "后台托管模型"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeProvider && (
              <span className={activeProvider.hasApiKey
                ? "inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-100"
                : "inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 ring-1 ring-rose-100"
              }>
                <KeyRound className="h-3 w-3" />
                {activeProvider.hasApiKey ? "Key 已配置" : "Key 未配置"}
              </span>
            )}
            {article.generatedAt && (
              <span className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
                {new Date(article.generatedAt).toLocaleString("zh-CN", { hour12: false })}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-3 sm:p-5 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)] lg:p-6">
        <div className="space-y-4">
          <section className="geo-section-panel p-3 sm:p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-700">
              <WandSparkles className="h-3.5 w-3.5 text-[#0077B6]" />
              生成设置
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => updateMode("generate")}
                className={`h-9 rounded-lg text-xs font-semibold transition ${
                  !isRewrite
                    ? "bg-white text-[#004B73] shadow-sm"
                    : "text-slate-500 hover:bg-white/70"
                }`}
              >
                文章生成
              </button>
              <button
                type="button"
                onClick={() => updateMode("rewrite")}
                className={`h-9 rounded-lg text-xs font-semibold transition ${
                  isRewrite
                    ? "bg-white text-[#004B73] shadow-sm"
                    : "text-slate-500 hover:bg-white/70"
                }`}
              >
                文章改写
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs">
                <span className="mb-1.5 block font-medium text-slate-500">模型来源</span>
                <select
                  value={article.modelProvider}
                  onChange={event => updateProvider(event.target.value as ArticleModelProviderKey)}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-2 focus:ring-blue-100"
                >
                  {providers.length === 0 && <option value="article">文章生成</option>}
                  {providers.map(provider => (
                    <option key={provider.key} value={provider.key}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              <Label className="text-xs">
                <span className="mb-1.5 block font-medium text-slate-500">模型名 / Endpoint</span>
                <Input
                  value={article.model}
                  onChange={event => updateField("model", event.target.value)}
                  placeholder={activeProvider?.model || activePrompt.defaultModelHint}
                  className="h-10 rounded-lg bg-white"
                />
              </Label>
            </div>
            {settingsError && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {settingsError}
              </div>
            )}
          </section>

          <section className="geo-section-panel p-3 sm:p-4">
            <div className="mb-3 text-xs font-semibold text-slate-700">
              {isRewrite ? "改写模板" : "Prompt 模板"}
            </div>
            <div className="grid gap-2">
              {visiblePrompts.map(prompt => {
                const active = prompt.key === article.promptKey
                return (
                  <button
                    key={prompt.key}
                    type="button"
                    onClick={() => updatePrompt(prompt.key)}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      active
                        ? "border-[#0077B6] bg-blue-50 text-slate-900 shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">{prompt.title}</span>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                        {prompt.outputType}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                      {prompt.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="geo-section-panel p-3 sm:p-4">
            <div className="grid gap-3">
              {isRewrite ? (
                <>
                  <div className="border-y border-slate-100 py-3">
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-slate-700">渗透率检测信源</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {penetrationSourceGroups.length > 0
                            ? `${penetrationSourceGroups.reduce((total, group) => total + group.sourceCount, 0)} 条可用文章链接`
                            : "当前客户暂无可用信源"}
                        </div>
                      </div>
                    </div>

                    {penetrationSourceGroups.length > 0 && activeSourceGroup ? (
                      <>
                        <div
                          className="mb-3 flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1"
                          role="tablist"
                          aria-label="按检测模型选择信源"
                        >
                          {penetrationSourceGroups.map(group => {
                            const active = group.model === activeSourceGroup.model
                            return (
                              <button
                                key={group.model}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setPreferredSourceModel(group.model)}
                                className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition ${
                                  active
                                    ? "bg-white text-[#006AA3] shadow-sm"
                                    : "text-slate-500 hover:text-slate-800"
                                }`}
                              >
                                {group.label} · {group.sourceCount}
                              </button>
                            )
                          })}
                        </div>

                        <div className="max-h-72 overflow-y-auto border-t border-slate-100 pr-1">
                          {activeSourceGroup.domains.map(domainGroup => (
                            <div key={domainGroup.domain} className="border-b border-slate-100 py-2 last:border-b-0">
                              <div className="mb-1 flex items-center justify-between gap-2 px-1 text-[11px]">
                                <span className="flex min-w-0 items-center gap-1.5 font-medium text-slate-600">
                                  <Globe2 className="h-3.5 w-3.5 shrink-0 text-cyan-600" />
                                  <span className="truncate">{domainGroup.domain}</span>
                                </span>
                                <span className="shrink-0 text-slate-400">{domainGroup.sources.length} 条</span>
                              </div>
                              <div className="divide-y divide-slate-100">
                                {domainGroup.sources.map(source => {
                                  const selected = article.sourceUrl === source.url
                                  return (
                                    <div key={source.url} className="flex items-stretch gap-1">
                                      <button
                                        type="button"
                                        disabled={isExtracting}
                                        onClick={() => void runExtractArticle(source.url)}
                                        className={`min-w-0 flex-1 px-1 py-2 text-left transition disabled:cursor-wait disabled:opacity-60 ${
                                          selected ? "text-[#006AA3]" : "text-slate-600 hover:text-[#006AA3]"
                                        }`}
                                        title="选用该信源并读取原文"
                                      >
                                        <span className="flex items-start gap-2">
                                          <span className="min-w-0 flex-1">
                                            <span className="block break-words text-[11px] font-medium leading-4">
                                              {source.title || source.domain}
                                            </span>
                                            {source.questions[0] && (
                                              <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                                                来自：{source.questions[0]}
                                                {source.questions.length > 1 ? ` 等 ${source.questions.length} 个问题` : ""}
                                              </span>
                                            )}
                                          </span>
                                          <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium">
                                            {selected ? <Check className="h-3.5 w-3.5" /> : null}
                                            {selected ? "已选" : "选用并读取"}
                                          </span>
                                        </span>
                                      </button>
                                      <a
                                        href={source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex w-8 shrink-0 items-center justify-center text-slate-400 transition hover:text-[#0077B6]"
                                        title="在新窗口查看信源"
                                        aria-label={`查看信源：${source.title || source.domain}`}
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      </a>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] leading-5 text-slate-400">
                        完成当前客户的疑问句检测后，可在这里按模型选择原始回复引用的文章链接。
                      </div>
                    )}
                  </div>

                  <Label className="text-xs">
                    <span className="mb-1.5 block font-medium text-slate-500">原文链接</span>
                    <div className="flex gap-2">
                      <Input
                        value={article.sourceUrl || ""}
                        onChange={event => updateField("sourceUrl", event.target.value)}
                        placeholder="粘贴需要改写的文章链接"
                        className="h-10 rounded-lg bg-white"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void runExtractArticle()}
                        disabled={isExtracting || !article.sourceUrl?.trim()}
                        className="h-10 shrink-0 gap-1.5 rounded-lg"
                      >
                        {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link className="h-3.5 w-3.5" />}
                        读取
                      </Button>
                    </div>
                  </Label>
                  {article.extractError && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      {article.extractError}
                    </div>
                  )}
                  <Label className="text-xs">
                    <span className="mb-1.5 block font-medium text-slate-500">原文标题</span>
                    <Input
                      value={article.sourceTitle || ""}
                      onChange={event => updateField("sourceTitle", event.target.value)}
                      placeholder="读取后自动填入，也可手动修改"
                      className="h-10 rounded-lg bg-white"
                    />
                  </Label>
                  <Label className="text-xs">
                    <span className="mb-1.5 block font-medium text-slate-500">原文 Markdown</span>
                    <Textarea
                      value={article.sourceMarkdown || ""}
                      onChange={event => updateField("sourceMarkdown", event.target.value)}
                      placeholder={"读取后的原文会显示在这里；也可以直接粘贴原文 Markdown。"}
                      className="min-h-[220px] rounded-lg bg-white font-mono text-xs leading-5"
                    />
                  </Label>
                  <Label className="text-xs">
                    <span className="mb-1.5 block font-medium text-slate-500">推荐品牌</span>
                    <Textarea
                      value={article.rewriteBrand || ""}
                      onChange={event => updateField("rewriteBrand", event.target.value)}
                      placeholder={"填写要推荐的品牌名称、产品名称、核心卖点\n例如：杭州势途数字科技有限公司 / 势途 GEO / GEO 内容优化服务"}
                      className="min-h-[90px] rounded-lg bg-white"
                    />
                  </Label>
                  <Label className="text-xs">
                    <span className="mb-1.5 block font-medium text-slate-500">相关资料</span>
                    <Textarea
                      value={article.rewriteMaterials || ""}
                      onChange={event => updateField("rewriteMaterials", event.target.value)}
                      placeholder={"填写品牌介绍、产品优势、应用场景、参数、案例、用户痛点、行业背景等\n系统会禁止模型编造未提供的数据、资质、价格或案例。"}
                      className="min-h-[150px] rounded-lg bg-white"
                    />
                  </Label>
                  <Label className="text-xs">
                    <span className="mb-1.5 block font-medium text-slate-500">补充要求</span>
                    <Textarea
                      value={article.extraRequirements}
                      onChange={event => updateField("extraRequirements", event.target.value)}
                      placeholder="例如：保留原文小标题数量 / 不要提价格 / 适合小红书长文发布"
                      className="min-h-[90px] rounded-lg bg-white"
                    />
                  </Label>
                </>
              ) : (
                <>
              {hasKeywordQuickFill && (
                <div className="rounded-xl border border-cyan-100 bg-cyan-50/50 p-3">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-xs font-semibold text-slate-700">关键词策略快捷填入</div>
                      <div className="text-[11px] text-slate-500">
                        {keywordQuestions.length} 条疑问句 · {keywordAdvantages.length} 条优势
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={fillKeywordQuestions}
                        disabled={keywordQuestions.length === 0}
                        className="rounded-lg border border-cyan-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-cyan-700 transition hover:bg-cyan-50 disabled:opacity-50"
                      >
                        填入全部疑问句
                      </button>
                      <button
                        type="button"
                        onClick={fillKeywordAdvantages}
                        disabled={keywordAdvantages.length === 0}
                        className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                      >
                        填入主要优势
                      </button>
                      <button
                        type="button"
                        onClick={fillKeywordQuestionsAndAdvantages}
                        className="rounded-lg bg-[#004B73] px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#006AA3]"
                      >
                        一键填入问句+优势
                      </button>
                    </div>
                  </div>

                  {quickQuestions.length > 0 && (
                    <div className="mb-3">
                      <div className="mb-1.5 text-[11px] font-medium text-slate-500">疑问句</div>
                      <div className="max-h-32 space-y-1.5 overflow-y-auto pr-1">
                        {quickQuestions.map(question => (
                          <button
                            key={question.id}
                            type="button"
                            onClick={() => handleQuestionAsTopic(question)}
                            className="block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[11px] leading-4 text-slate-600 transition hover:border-cyan-200 hover:bg-cyan-50"
                          >
                            {question.question}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {quickAdvantages.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[11px] font-medium text-slate-500">主要优势</div>
                      <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
                        {quickAdvantages.map(advantage => (
                          <button
                            key={advantage}
                            type="button"
                            onClick={() => appendAdvantage(advantage)}
                            className="rounded-lg border border-emerald-100 bg-white px-2 py-1 text-[11px] leading-4 text-emerald-700 transition hover:bg-emerald-50"
                          >
                            {advantage}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <Label className="text-xs">
                <span className="mb-1.5 block font-medium text-slate-500">核心搜索问题 / 内容主题</span>
                <Input
                  value={article.coreQuestion}
                  onChange={event => updateField("coreQuestion", event.target.value)}
                  placeholder="例如：深圳企业做 GEO 内容，为什么进不了 AI 搜索答案？"
                  className="h-10 rounded-lg bg-white"
                />
              </Label>
              <Label className="text-xs">
                <span className="mb-1.5 block font-medium text-slate-500">关键词 / 相关问题</span>
                <Textarea
                  value={article.keywords}
                  onChange={event => updateField("keywords", event.target.value)}
                  placeholder={"每行一个关键词或相关问法\n例如：GEO 内容怎么写\nAI 搜索优化避坑"}
                  className="min-h-[90px] rounded-lg bg-white"
                />
              </Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <Label className="text-xs">
                  <span className="mb-1.5 block font-medium text-slate-500">所在地域</span>
                  <Input
                    value={article.region}
                    onChange={event => updateField("region", event.target.value)}
                    placeholder="例如：深圳 / 粤港澳大湾区"
                    className="h-10 rounded-lg bg-white"
                  />
                </Label>
                <Label className="text-xs">
                  <span className="mb-1.5 block font-medium text-slate-500">主营业务 / 具体业务</span>
                  <Input
                    value={article.business}
                    onChange={event => updateField("business", event.target.value)}
                    placeholder={client.industry || "例如：全屋定制 / GEO 优化服务"}
                    className="h-10 rounded-lg bg-white"
                  />
                </Label>
              </div>
              <Label className="text-xs">
                <span className="mb-1.5 block font-medium text-slate-500">核心优势 / 可验证事实</span>
                <Textarea
                  value={article.advantages}
                  onChange={event => updateField("advantages", event.target.value)}
                  placeholder={"例如：交付经验、客户复购率、案例数量、服务流程、质保范围\n缺少事实时可留空，系统会要求模型避免编造"}
                  className="min-h-[95px] rounded-lg bg-white"
                />
              </Label>
              <Label className="text-xs">
                <span className="mb-1.5 block font-medium text-slate-500">目标读者 / 补充要求</span>
                <Textarea
                  value={[article.audience, article.extraRequirements].filter(Boolean).join("\n---\n")}
                  onChange={event => {
                    const [audience = "", ...rest] = event.target.value.split(/\n---\n/)
                    persist({
                      ...article,
                      audience,
                      extraRequirements: rest.join("\n---\n"),
                      status: article.status === "error" ? "idle" : article.status,
                      error: undefined,
                    })
                  }}
                  placeholder={"目标读者：老板 / 采购负责人 / 运营负责人\n---\n补充要求：语气、字数、发布平台、禁用说法等"}
                  className="min-h-[95px] rounded-lg bg-white"
                />
              </Label>
                </>
              )}
            </div>
          </section>

          {article.error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {article.error}
            </div>
          )}

          {isGenerating && (
            <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs leading-5 text-cyan-800">
              <div className="font-medium">
                {articleJobState.currentJob?.stage || "任务正在转入服务器后台"}
              </div>
              <div className="text-[11px] text-cyan-700/80">
                {articleJobState.connectionNotice || "可以切换客户或刷新页面，生成结果会自动恢复。"}
              </div>
            </div>
          )}

          <CreditCostBadge featureKey={articleFeatureKey} className="w-fit" />

          <div className="flex gap-2">
            <Button
              onClick={runGenerate}
              disabled={!canGenerate}
              className="h-11 min-w-0 flex-1 gap-2 rounded-xl bg-[#087F9C] text-sm font-semibold text-white transition-all hover:shadow-lg hover:shadow-blue-300/40"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : hasOutput ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <WandSparkles className="h-4 w-4" />
              )}
              {isGenerating
                ? articleJobState.currentJob?.status === "queued"
                  ? "任务排队中..."
                  : isRewrite ? "后台改写中..." : "后台生成中..."
                : hasOutput
                  ? isRewrite ? "重新改写文章" : "重新生成文章"
                  : isRewrite ? "开始改写文章" : "生成文章"}
            </Button>
            {isGenerating && articleJobRef?.jobId && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void stopArticleJob()}
                disabled={stoppingJob}
                className="h-11 shrink-0 gap-1.5 rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              >
                {stoppingJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                停止
              </Button>
            )}
          </div>
        </div>

        <ArticleMarkdownWorkspace
          value={article.output}
          onChange={value => updateField("output", value)}
          fileBaseName={buildFileBaseName(client, activePrompt)}
          title={client.ourBrand || client.name || activePrompt.title || "文章生成"}
          statusText={article.status === "done" ? "已生成，可编辑、预览和导出" : isRewrite ? "等待改写" : "等待生成"}
          placeholder={isGenerating ? (isRewrite ? "模型正在改写文章..." : "模型正在生成文章...") : "生成后的 Markdown 内容会显示在这里"}
        />
      </div>
    </div>
  )
}

function buildFileBaseName(client: Client, prompt: ArticlePromptOption): string {
  const pieces = [client.ourBrand || client.name || "文章", prompt.title]
  return sanitizeFileName(pieces.filter(Boolean).join("_"))
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "文章生成"
}

function uniqueLines(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const value = String(raw || "").trim()
    const key = value.replace(/\s+/g, "").toLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function appendUniqueLines(current: string, additions: string[]): string {
  return uniqueLines([
    ...current.split(/\n+/),
    ...additions,
  ]).join("\n")
}

function collectKeywordAdvantages(client: Client): string[] {
  const strategy = client.keywordStrategy
  if (!strategy) return []

  const planAdvantages = extractQuestionAdvantages(strategy.strategyPlan)
  const extractedAdvantages = (strategy.extractedProfile?.advantages || [])
    .filter(item => item.enabled !== false)
    .map(item => item.text)
  const baseAdvantages = uniqueLines([...planAdvantages, ...extractedAdvantages])
  const questionAdvantages = (strategy.questions || [])
    .map(question => resolveQuestionAdvantage(question, baseAdvantages))

  return uniqueLines([
    ...baseAdvantages,
    ...questionAdvantages,
  ])
}
