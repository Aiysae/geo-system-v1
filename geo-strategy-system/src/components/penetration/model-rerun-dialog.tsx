"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CreditCostBadge } from "@/components/credits/credit-cost-badge"
import { MODEL_LABELS } from "@/lib/model-labels"
import ModelAvatar from "@/components/model-avatar"
import type { ModelKey, PenetrationModelRerunMode } from "@/types"

interface Props {
  model: ModelKey
  questionCount: number
  defaultSamples: number
  onClose: () => void
  onConfirm: (input: { samplesPerQuestion: number; mode: PenetrationModelRerunMode }) => void
}

const MODES: Array<{ value: PenetrationModelRerunMode; title: string; detail: string }> = [
  {
    value: "compare",
    title: "先对比，我再决定",
    detail: "重测完列出新旧数据对比，点“采用”才替换原结果。",
  },
  {
    value: "overwrite",
    title: "直接覆盖原结果",
    detail: "重测完立即替换这个模型的回答，7 天内可以撤销。",
  },
]

/** Settings for re-running one model across every question of the report. */
export default function ModelRerunDialog({ model, questionCount, defaultSamples, onClose, onConfirm }: Props) {
  const [samples, setSamples] = useState(Math.max(1, Math.min(3, defaultSamples || 1)))
  const [mode, setMode] = useState<PenetrationModelRerunMode>("compare")
  const answers = questionCount * samples

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-rerun-title"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 bg-[#001D66] px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <ModelAvatar model={model} size="sm" />
            <div>
              <h2 id="model-rerun-title" className="text-base font-semibold">重新检测 {MODEL_LABELS[model]}</h2>
              <p className="mt-0.5 text-xs text-cyan-100/70">只重测这个模型，其他模型的数据不变</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-600">检测问题</span>
            <span className="font-medium text-slate-800">全部 {questionCount} 个问题</span>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-600">每题检测次数</span>
            <select
              value={samples}
              onChange={event => setSamples(Number(event.target.value))}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
            >
              {[1, 2, 3].map(value => <option key={value} value={value}>{value} 次</option>)}
            </select>
          </label>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-slate-600">重测完怎么处理</legend>
            {MODES.map(option => (
              <label
                key={option.value}
                className={`flex cursor-pointer gap-2.5 rounded-lg border p-2.5 transition ${
                  mode === option.value ? "border-[#1677FF] bg-[#1677FF]/5" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="model-rerun-mode"
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                  className="mt-1 accent-[#1677FF]"
                />
                <span>
                  <span className="block font-medium text-slate-800">{option.title}</span>
                  <span className="block text-xs leading-5 text-slate-500">{option.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <p className="text-xs leading-5 text-slate-500">
            个别问题重测失败时，保留它原来的回答。原结果会留在检测历史里。
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <CreditCostBadge featureKey="penetrationSlot" units={Math.max(1, answers)} className="w-fit" />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button
              type="button"
              disabled={questionCount === 0}
              onClick={() => onConfirm({ samplesPerQuestion: samples, mode })}
              className="gap-1.5"
            >
              <RotateCcw className="h-4 w-4" />
              开始重测（{answers} 条）
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
