"use client"

import { Target } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import PenetrationResultSummary from "./result-summary"
import { PenetrationResultsBody } from "./penetration-module"
import type { AnalysisSubjectType, PenetrationResult } from "@/types"

interface Props {
  clientName: string
  ourBrand: string
  brandAliases: string[]
  competitors: string[]
  subjectType: AnalysisSubjectType
  penetration: PenetrationResult
  sharedAt: string
}

function dateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false })
}

/** A shared detection result, read-only: the page the owner sees, without its controls. */
export default function SharedPenetrationView({
  clientName,
  ourBrand,
  brandAliases,
  competitors,
  subjectType,
  penetration,
  sharedAt,
}: Props) {
  const questions = new Set(
    Object.values(penetration.byModel).flatMap(items => (items || []).map(item => item.question.trim())),
  ).size
  const models = Object.values(penetration.byModel).filter(items => items?.length).length
  return (
    <Card className="mx-auto w-full max-w-6xl">
      <CardHeader className="flex flex-col gap-2 pb-3">
        <CardTitle className="flex items-center gap-3 text-sm text-slate-800 sm:text-base">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1677FF]">
            <Target className="h-5 w-5 text-white" />
          </span>
          <span className="geo-module-title min-w-0 text-base sm:text-lg">
            {subjectType === "person" ? "个人 IP 可见度检测结果" : "关键词渗透率检测结果"} · {ourBrand}
          </span>
        </CardTitle>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {clientName && clientName !== ourBrand ? <span>客户：{clientName}</span> : null}
          <span>{questions} 个问题 · {models} 个 AI 模型</span>
          <span>检测于 {dateTime(penetration.generatedAt)}</span>
          <span>分享于 {dateTime(sharedAt)}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <PenetrationResultSummary result={penetration} />
        <div className="min-w-0 space-y-4">
          <PenetrationResultsBody
            pen={penetration}
            ourBrand={ourBrand}
            brandAliases={brandAliases}
            competitors={competitors}
            subjectType={subjectType}
          />
        </div>
      </CardContent>
    </Card>
  )
}
