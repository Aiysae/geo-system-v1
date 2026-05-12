"use client"

import { useState } from "react"
import { Copy, Check, Flame, Zap, Snowflake, Sparkles, Target, Compass, Megaphone } from "lucide-react"
import type { StrategyRow } from "@/types"

interface Props {
  rows: StrategyRow[]
}

const HEADERS = [
  { label: "#", icon: null },
  { label: "新增关键词", icon: Sparkles },
  { label: "针对性疑问句", icon: Target },
  { label: "第三方切入视角", icon: Compass },
  { label: "优先级", icon: null },
  { label: "落地平台", icon: Megaphone },
]

export default function StrategyTable({ rows }: Props) {
  const [copied, setCopied] = useState<"tsv" | "md" | null>(null)

  async function copyAs(format: "tsv" | "md") {
    const text =
      format === "tsv"
        ? toTsv(rows)
        : toMarkdown(rows)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(format)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      alert("复制失败，请手动选择文本复制")
    }
  }

  const priorityBadge = (p: string) => {
    if (p === "高")
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gradient-to-r from-rose-100 to-red-100 text-red-700 border border-red-200 font-semibold">
          <Flame className="h-3 w-3" /> 高
        </span>
      )
    if (p === "中")
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-700 border border-amber-200 font-medium">
          <Zap className="h-3 w-3" /> 中
        </span>
      )
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
        <Snowflake className="h-3 w-3" /> 低
      </span>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-wider text-slate-400">
          共 <span className="text-[#0077B6] font-semibold">{rows.length}</span> 条建议
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => copyAs("tsv")}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 hover:border-[#004B73] hover:text-[#004B73] hover:-translate-y-0.5 transition-all"
          >
            {copied === "tsv" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            复制为 Excel (TSV)
          </button>
          <button
            onClick={() => copyAs("md")}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 hover:border-[#004B73] hover:text-[#004B73] hover:-translate-y-0.5 transition-all"
          >
            {copied === "md" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            复制为 Markdown
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-slate-50 via-blue-50/50 to-slate-50 text-[11px] uppercase tracking-wider text-slate-600">
            <tr>
              {HEADERS.map(h => {
                const Icon = h.icon
                return (
                  <th key={h.label} className="text-left px-3 py-3 font-semibold whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {Icon && <Icon className="h-3.5 w-3.5 text-[#0077B6]" />}
                      {h.label}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                <td className="px-3 py-3 text-slate-400 tabular-nums font-mono">
                  {String(i + 1).padStart(2, "0")}
                </td>
                <td className="px-3 py-3 font-semibold text-slate-800">{r.newKeyword || "-"}</td>
                <td className="px-3 py-3 text-slate-700 max-w-xs">{r.attackQuestion || "-"}</td>
                <td className="px-3 py-3 text-slate-600 max-w-xs">{r.thirdPartyAngle || "-"}</td>
                <td className="px-3 py-3">{priorityBadge(r.priority)}</td>
                <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{r.platform || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function escapeTsv(s: string): string {
  return s.replace(/\t/g, " ").replace(/\r?\n/g, " ")
}

function toTsv(rows: StrategyRow[]): string {
  const header = ["序号", "新增关键词", "针对性疑问句", "第三方切入视角", "优先级", "落地平台"].join("\t")
  const body = rows
    .map((r, i) =>
      [
        i + 1,
        escapeTsv(r.newKeyword),
        escapeTsv(r.attackQuestion),
        escapeTsv(r.thirdPartyAngle),
        r.priority,
        escapeTsv(r.platform),
      ].join("\t")
    )
    .join("\n")
  return `${header}\n${body}`
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function toMarkdown(rows: StrategyRow[]): string {
  const head = "| # | 新增关键词 | 针对性疑问句 | 第三方切入视角 | 优先级 | 落地平台 |"
  const sep = "| --- | --- | --- | --- | --- | --- |"
  const body = rows
    .map((r, i) =>
      `| ${i + 1} | ${escapeMd(r.newKeyword)} | ${escapeMd(r.attackQuestion)} | ${escapeMd(r.thirdPartyAngle)} | ${r.priority} | ${escapeMd(r.platform)} |`
    )
    .join("\n")
  return `${head}\n${sep}\n${body}`
}
