"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Play, AlertTriangle, XCircle } from "lucide-react"
import { MODEL_LABELS } from "@/lib/llm"
import type { Client, ModelKey } from "@/types"

const ALL_MODELS: ModelKey[] = ["doubao", "deepseek", "qwen", "kimi"]

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

  const questionCount = parseLines(questionsText).length
  const canRun =
    !loading && client.ourBrand.trim().length > 0 && questionCount > 0 && client.selectedModels.length > 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
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
        <Label className="text-xs text-slate-600 mb-1.5 block">
          疑问句列表 * <span className="text-slate-400">（每行一条，已识别 {questionCount} 条）</span>
        </Label>
        <Textarea
          value={questionsText}
          onChange={e => setQuestionsText(e.target.value)}
          rows={6}
          placeholder={"国内有哪些值得推荐的 AI Agent 工具？\n2026 年企业级 GEO 平台怎么选？\n..."}
          className="font-mono text-xs"
        />
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
        <div className="grid grid-cols-2 gap-2">
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
                <b>{MODEL_LABELS[m]} 接口配置缺失或调用失败：</b>
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
    </div>
  )
}
