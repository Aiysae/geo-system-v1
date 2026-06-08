"use client"

import type { ModelKey } from "@/types"
import { MODEL_LABELS } from "@/lib/model-labels"

const MODEL_LOGOS: Record<ModelKey, string> = {
  doubao: "/model-logos/doubao.png",
  deepseek: "/model-logos/deepseek.ico",
  qwen: "/model-logos/qwen.png",
  kimi: "/model-logos/kimi.ico",
  ernie: "/model-logos/ernie.ico",
  hunyuan: "/model-logos/hunyuan.ico",
}

interface Props {
  model: ModelKey
  size?: "xs" | "sm" | "md"
  className?: string
}

const SIZE_CLASS: Record<NonNullable<Props["size"]>, string> = {
  xs: "h-5 w-5",
  sm: "h-6 w-6",
  md: "h-8 w-8",
}

export default function ModelAvatar({ model, size = "sm", className = "" }: Props) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-slate-200 ${SIZE_CLASS[size]} ${className}`}
      title={MODEL_LABELS[model]}
      aria-label={MODEL_LABELS[model]}
    >
      <img
        src={MODEL_LOGOS[model]}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
      />
    </span>
  )
}
