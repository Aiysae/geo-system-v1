"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Loader2,
  Play,
  AlertTriangle,
  XCircle,
  Sparkles,
  Pencil,
  X,
  Globe2,
} from "lucide-react"
import { MODEL_LABELS } from "@/lib/model-labels"
import { apiFetch } from "@/lib/api-fetch"
import ModelAvatar from "@/components/model-avatar"
import type { Client, ModelKey } from "@/types"

const ALL_MODELS: ModelKey[] = ["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"]

type InputMode = "manual" | "ai"

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
  onRun: (params: { questions: string[]; models: ModelKey[] }) => void
  loading: boolean
  error: string | null
  skipped?: string[]
  modelErrors?: Partial<Record<ModelKey, string>>
}

export default function BatchInputPanel({
  client,
  onChangeClient,
  onRun,
  loading,
  error,
  skipped,
  modelErrors,
}: Props) {
  const [questionsText, setQuestionsText] = useState(() => client.questions.join("\n"))
  const [competitorsText, setCompetitorsText] = useState(() => client.competitors.join("\n"))

  const [inputMode, setInputMode] = useState<InputMode>("manual")
  const [aiCount, setAiCount] = useState(5)
  const [aiKeywords, setAiKeywords] = useState("")
  const [aiLoading, setAiLoading] = useState(false)
  const [aiToast, setAiToast] = useState<string | null>(null)

  useEffect(() => {
    if (!aiToast) return
    const t = setTimeout(() => setAiToast(null), 4500)
    return () => clearTimeout(t)
  }, [aiToast])

  function parseLines(text: string): string[] {
    return text
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
  }

  function toggleModel(m: ModelKey) {
    const set = new Set(client.selectedModels)
    if (set.has(m)) set.delete(m)
    else set.add(m)
    if (!set.has("doubao")) set.add("doubao")
    onChangeClient({ selectedModels: ALL_MODELS.filter(k => set.has(k)) })
  }

  function handleRun() {
    const questions = parseLines(questionsText)
    const competitors = parseLines(competitorsText)
    onChangeClient({ questions, competitors })
    onRun({ questions, models: client.selectedModels })
  }

  async function runAiGenerate() {
    setAiLoading(true)
    try {
      const res = await apiFetch("/api/generate-queries", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry: client.industry,
          brand: client.ourBrand,
          count: aiCount,
          keywords: aiKeywords,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || "生成失败，请检查豆包 API 配置")
      }
      const generated = Array.isArray(data.questions) ? (data.questions as string[]) : []
      if (generated.length === 0) {
        throw new Error("生成失败：豆包未返回任何疑问句")
      }

      // 按行去重追加到 textarea
      const existing = parseLines(questionsText)
      const seen = new Set(existing)
      const merged = [...existing]
      for (const q of generated) {
        const s = q.trim()
        if (s && !seen.has(s)) {
          seen.add(s)
          merged.push(s)
        }
      }
      const mergedText = merged.join("\n")
      setQuestionsText(mergedText)
      onChangeClient({ questions: merged })

      // 自动切回手动 Tab，方便用户审核 / 微调
      setInputMode("manual")
    } catch (e) {
      setAiToast(e instanceof Error ? e.message : "生成失败，请检查豆包 API 配置")
    } finally {
      setAiLoading(false)
    }
  }

  const questionCount = parseLines(questionsText).length
  const canRun =
    !loading && client.ourBrand.trim().length > 0 && questionCount > 0 && client.selectedModels.length > 0
  const canAiRun = !aiLoading && (!!client.industry.trim() || !!client.ourBrand.trim())

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs text-slate-600 mb-1.5 block">我方品牌名 *</Label>
          <Input
            value={client.ourBrand}
            onChange={e => onChangeClient({ ourBrand: e.target.value })}
            placeholder="如：势途"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-600 mb-1.5 block">所属行业</Label>
          <Input
            value={client.industry}
            onChange={e => onChangeClient({ industry: e.target.value })}
            placeholder="如：B端 AI Agent 工具"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs text-slate-600 block">
            疑问句列表 * <span className="text-slate-400">（已识别 {questionCount} 条）</span>
          </Label>
        </div>

        {/* Tabs：手动录入 / AI 智能生成 */}
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/80 border border-slate-200 mb-3">
          <button
            type="button"
            onClick={() => setInputMode("manual")}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition font-medium ${
              inputMode === "manual"
                ? "bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white shadow"
                : "bg-transparent text-slate-600 hover:text-[#0077B6]"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" />
            手动录入
          </button>
          <button
            type="button"
            onClick={() => setInputMode("ai")}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition font-medium ${
              inputMode === "ai"
                ? "bg-gradient-to-r from-orange-500 via-rose-500 to-pink-500 text-white shadow"
                : "bg-transparent text-slate-600 hover:text-rose-600"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI 智能生成
            <span className="ml-1 text-[9px] font-medium bg-white/25 px-1.5 py-0.5 rounded-full whitespace-nowrap">
              专属豆包
            </span>
          </button>
        </div>

        {inputMode === "manual" ? (
          <Textarea
            value={questionsText}
            onChange={e => setQuestionsText(e.target.value)}
            rows={6}
            placeholder={"国内有哪些值得推荐的 AI Agent 工具？\n2026 年企业级 GEO 平台怎么选？\n..."}
            className="font-mono text-xs"
          />
        ) : (
          <div className="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50/60 to-rose-50/40 p-3 space-y-3">
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
                className="gap-2 bg-gradient-to-r from-orange-500 via-rose-500 to-pink-500 hover:shadow-lg hover:shadow-orange-300/40 hover:-translate-y-0.5 transition-all border-0 px-4 py-2.5 text-xs font-medium whitespace-nowrap"
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

            {!client.industry.trim() && !client.ourBrand.trim() && (
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                请先在上方填写「我方品牌名」或「所属行业」，豆包需要据此推演消费者疑问句。
              </div>
            )}

            <div className="text-[11px] text-slate-500 leading-relaxed">
              生成结果将自动追加到「手动录入」文本框，并切回手动 Tab 以便你审核 / 微调后再开始检测。
            </div>
          </div>
        )}
      </div>

      <div>
        <Label className="text-xs text-slate-600 mb-1.5 block">
          已知主要竞品 <span className="text-slate-400">（可选，每行一个）</span>
        </Label>
        <Textarea
          value={competitorsText}
          onChange={e => setCompetitorsText(e.target.value)}
          rows={2}
          placeholder={"竞品A\n竞品B"}
          className="font-mono text-xs"
        />
      </div>

      <div>
        <Label className="text-xs text-slate-600 mb-2 block">检测模型 *</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ALL_MODELS.map(m => {
            const checked = client.selectedModels.includes(m)
            const isDoubao = m === "doubao"
            return (
              <label
                key={m}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition text-sm ${
                  checked
                    ? "border-[#004B73] bg-[#004B73]/5 text-[#004B73]"
                    : "border-slate-200 hover:border-slate-300 text-slate-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleModel(m)}
                  className="accent-[#004B73]"
                />
                <ModelAvatar model={m} size="xs" />
                <span className="font-medium">{MODEL_LABELS[m]}</span>
                {isDoubao && (
                  <span className="ml-auto text-[10px] bg-[#004B73] text-white px-1.5 py-0.5 rounded">
                    必含
                  </span>
                )}
              </label>
            )
          })}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-cyan-200 bg-cyan-50/70 p-2.5 text-[11px] leading-relaxed text-cyan-900">
        <Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-700" />
        <span>
          每条疑问句会逐模型单独联网提问；被测模型只收到该问题本身，不会收到目标品牌、竞品清单或检测意图。命中结果由后端读取真实回答原文后判断。
        </span>
      </div>

      {skipped && skipped.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            以下模型未配置 API Key 已被跳过：<b>{skipped.join("、")}</b>
          </span>
        </div>
      )}

      {modelErrors && Object.keys(modelErrors).length > 0 && (
        <div className="space-y-1.5">
          {(Object.entries(modelErrors) as Array<[ModelKey, string]>).map(([m, msg]) => (
            <div
              key={m}
              className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-300 rounded-lg p-2.5"
            >
              <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-500" />
              <span>
                <b>{MODEL_LABELS[m]} API 调用失败：</b>
                {msg}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">
          {error}
        </div>
      )}

      <Button
        onClick={handleRun}
        disabled={!canRun}
        className="w-full bg-gradient-to-r from-[#004B73] via-[#0077B6] to-[#00B4D8] hover:shadow-lg hover:shadow-blue-300/40 hover:-translate-y-0.5 transition-all border-0 gap-2 py-5 text-sm font-medium"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            正在并行检测...
          </>
        ) : (
          <>
            <Play className="h-4 w-4" />
            开始多模型检测 ({client.selectedModels.length} × {questionCount})
          </>
        )}
      </Button>

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
