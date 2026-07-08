"use client"

import { useEffect, useMemo, useState } from "react"
import {
  CheckCircle2,
  Copy,
  Download,
  FileDown,
  FileText,
  KeyRound,
  Link,
  Loader2,
  RefreshCw,
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
import type { AiProviderPublicSetting } from "@/types/ai-settings"
import type { ArticleGenerationState, ArticleModelProviderKey, ArticlePromptKey, Client } from "@/types"
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

function createInitialArticle(client: Client): ArticleGenerationState {
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
    ...(client.articleGeneration ?? {}),
  }
}

export default function ArticleGenerationModule({ client, onChangeClient }: Props) {
  const [article, setArticle] = useState<ArticleGenerationState>(() => createInitialArticle(client))
  const [providers, setProviders] = useState<AiProviderPublicSetting[]>([])
  const [prompts, setPrompts] = useState<ArticlePromptOption[]>(ARTICLE_PROMPT_OPTIONS)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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

  function persist(next: ArticleGenerationState) {
    setArticle(next)
    onChangeClient({ articleGeneration: next })
  }

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

  async function runExtractArticle() {
    const sourceUrl = article.sourceUrl?.trim() || ""
    if (!sourceUrl) {
      persist({ ...article, extractStatus: "error", extractError: "请先填写文章链接" })
      return
    }
    const extracting: ArticleGenerationState = {
      ...article,
      extractStatus: "generating",
      extractError: undefined,
      error: undefined,
    }
    persist(extracting)

    try {
      const res = await apiFetch("/api/article-generation/extract-url", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl }),
      })
      const data = await readApiJson<ArticleExtractResponse>(res, "文章读取")
      if (!res.ok) throw new Error(data.error || "文章读取失败")
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

  async function runGenerate() {
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
    persist(generating)

    try {
      const res = await apiFetch("/api/article-generation", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptKey: generating.promptKey,
          modelProvider: generating.modelProvider,
          model: generating.model,
          clientName: client.name,
          brandName: client.ourBrand || client.name,
          industry: client.industry,
          website: client.website,
          sourceUrl: generating.sourceUrl,
          sourceTitle: generating.sourceTitle,
          sourceMarkdown: generating.sourceMarkdown,
          rewriteBrand: generating.rewriteBrand,
          rewriteMaterials: generating.rewriteMaterials,
          coreQuestion: generating.coreQuestion,
          keywords: generating.keywords,
          region: generating.region,
          business: generating.business,
          advantages: generating.advantages,
          audience: generating.audience,
          extraRequirements: generating.extraRequirements,
        }),
      })
      const data = await readApiJson<ArticleGenerationResponse>(res, isRewrite ? "文章改写" : "文章生成")
      if (!res.ok) throw new Error(data.error || (isRewrite ? "文章改写失败" : "文章生成失败"))
      const next: ArticleGenerationState = {
        ...generating,
        promptKey: data.promptKey || generating.promptKey,
        modelProvider: data.modelProvider || generating.modelProvider,
        model: data.model || generating.model,
        output: data.article || "",
        generatedAt: data.generatedAt || new Date().toISOString(),
        status: "done",
        error: undefined,
      }
      persist(next)
    } catch (error) {
      persist({
        ...generating,
        status: "error",
        error: error instanceof Error ? error.message : isRewrite ? "文章改写失败" : "文章生成失败",
      })
    }
  }

  async function copyOutput() {
    if (!hasOutput) return
    await navigator.clipboard.writeText(article.output)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  function exportMarkdown() {
    if (!hasOutput) return
    const blob = new Blob([article.output], { type: "text/markdown;charset=utf-8" })
    downloadBlob(blob, `${buildFileBaseName(client, activePrompt)}.md`)
  }

  function exportWord() {
    if (!hasOutput) return
    const html = buildWordHtml(article.output, client.name)
    const blob = new Blob([html], { type: "application/msword;charset=utf-8" })
    downloadBlob(blob, `${buildFileBaseName(client, activePrompt)}.doc`)
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white via-slate-50/70 to-cyan-50/30 shadow-sm">
      <div className="border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="flex flex-col gap-3 px-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#004B73] to-[#00B4D8] shadow-md shadow-cyan-200/50">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight text-slate-900 sm:text-base">
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
          <section className="rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm sm:p-4">
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

          <section className="rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm sm:p-4">
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

          <section className="rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm sm:p-4">
            <div className="grid gap-3">
              {isRewrite ? (
                <>
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
                        onClick={runExtractArticle}
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

          <CreditCostBadge featureKey={articleFeatureKey} className="w-fit" />

          <Button
            onClick={runGenerate}
            disabled={!canGenerate}
            className="h-11 w-full gap-2 rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] text-sm font-semibold text-white transition-all hover:shadow-lg hover:shadow-blue-300/40"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : hasOutput ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <WandSparkles className="h-4 w-4" />
            )}
            {isGenerating
              ? isRewrite ? "文章改写中..." : "文章生成中..."
              : hasOutput
                ? isRewrite ? "重新改写文章" : "重新生成文章"
                : isRewrite ? "开始改写文章" : "生成文章"}
          </Button>
        </div>

        <section className="flex min-h-[620px] flex-col rounded-xl border border-slate-200/80 bg-white/90 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-3 sm:px-4">
            <div>
              <div className="text-sm font-semibold text-slate-900">生成结果</div>
              <div className="text-[11px] text-slate-500">
                {article.status === "done" ? "已生成，可继续编辑" : isRewrite ? "等待改写" : "等待生成"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={copyOutput} disabled={!hasOutput}>
                {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "已复制" : "复制"}
              </Button>
              <Button size="sm" variant="outline" onClick={exportMarkdown} disabled={!hasOutput}>
                <Download className="h-3.5 w-3.5" />
                导出 MD
              </Button>
              <Button size="sm" variant="outline" onClick={exportWord} disabled={!hasOutput}>
                <FileDown className="h-3.5 w-3.5" />
                导出文档
              </Button>
            </div>
          </div>

          <Textarea
            value={article.output}
            onChange={event => updateField("output", event.target.value)}
            placeholder={isGenerating ? (isRewrite ? "模型正在改写文章..." : "模型正在生成文章...") : "生成后的内容会显示在这里"}
            className="min-h-[560px] flex-1 resize-none rounded-none border-0 bg-transparent p-4 font-mono text-sm leading-7 shadow-none focus-visible:ring-0"
          />
        </section>
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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function buildWordHtml(content: string, title: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title || "文章生成")}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif; line-height: 1.75; color: #172033; }
    pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 14px; }
  </style>
</head>
<body>
  <pre>${escapeHtml(content)}</pre>
</body>
</html>`
}
