"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ModelDiagnosisItem } from "@/types"

type Key = "doubao" | "qwen" | "deepseek" | "kimi"

const TABS: { key: Key; label: string; hint: string }[] = [
  { key: "doubao", label: "豆包 (字节)", hint: "头条号 / 掘金 / 抖音图文" },
  { key: "qwen", label: "通义 (阿里)", hint: "夸克 / 阿里系内容资产" },
  { key: "deepseek", label: "DeepSeek", hint: "技术博客 / GitHub / 行业论坛" },
  { key: "kimi", label: "Kimi (Moonshot)", hint: "知乎 / 长文 / 论文白皮书" },
]

interface Props {
  data: Record<Key, ModelDiagnosisItem>
}

export default function ModelTabs({ data }: Props) {
  return (
    <Tabs defaultValue="doubao" className="w-full">
      <TabsList className="w-full justify-start flex-wrap h-auto gap-1 bg-slate-100 rounded-xl p-1">
        {TABS.map(t => (
          <TabsTrigger
            key={t.key}
            value={t.key}
            className="text-xs sm:text-sm data-[state=active]:bg-[#004B73] data-[state=active]:text-white rounded-lg"
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {TABS.map(t => {
        const d = data[t.key]
        return (
          <TabsContent key={t.key} value={t.key} className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-3">
              {t.hint}
            </div>
            <dl className="space-y-3">
              <Row label="抓取偏好" value={d?.preference} tone="neutral" />
              <Row label="核心失分项" value={d?.weakness} tone="warn" />
              <Row label="修复动作" value={d?.fix} tone="action" />
            </dl>
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value?: string
  tone: "neutral" | "warn" | "action"
}) {
  const toneCls =
    tone === "warn"
      ? "border-amber-200 bg-amber-50/70 text-amber-900"
      : tone === "action"
        ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
        : "border-slate-200 bg-white text-slate-700"
  return (
    <div className={`rounded-lg border ${toneCls} p-3`}>
      <dt className="text-[11px] uppercase tracking-wider opacity-70 mb-1">{label}</dt>
      <dd className="text-sm leading-relaxed">{value || "-"}</dd>
    </div>
  )
}
