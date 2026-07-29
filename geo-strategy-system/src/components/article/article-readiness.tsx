"use client"

import { CircleAlert, CircleCheck } from "lucide-react"
import { evaluateArticleReadiness } from "@/lib/geo-methodology/readiness"
import type {
  ArticleComparisonBrand,
  ArticleMethodologySelection,
  ArticlePromptKey,
  ClientKnowledgeBase,
} from "@/types"

interface Props {
  promptKey: ArticlePromptKey
  methodology?: ArticleMethodologySelection
  coreQuestion: string
  primarySubject: string
  region: string
  business: string
  advantages: string
  comparisonBrands: ArticleComparisonBrand[]
  knowledgeBase?: ClientKnowledgeBase
}

export default function ArticleReadiness(props: Props) {
  if (props.promptKey === "rewrite" || props.promptKey === "shortVideoScript") return null

  const report = evaluateArticleReadiness({
    promptKey: props.promptKey,
    selection: props.methodology,
    coreQuestion: props.coreQuestion,
    primarySubject: props.primarySubject,
    region: props.region,
    business: props.business,
    advantages: props.advantages,
    comparisonBrands: props.comparisonBrands,
    knowledgeBase: props.knowledgeBase,
  })
  const blocking = report.issues.filter(issue => issue.severity === "blocking")
  const warnings = report.issues.filter(issue => issue.severity === "warning")

  if (report.issues.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
        <CircleCheck className="h-3.5 w-3.5 shrink-0" />
        <span>{report.formatTitle}所需信息已就绪</span>
      </div>
    )
  }

  return (
    <div className={`rounded-md border px-3 py-2 text-[11px] ${
      blocking.length > 0
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-amber-200 bg-amber-50 text-amber-800"
    }`}>
      <div className="flex items-center gap-2 font-semibold">
        <CircleAlert className="h-3.5 w-3.5 shrink-0" />
        <span>{blocking.length > 0 ? "还需补充关键信息" : `${report.formatTitle}生成提示`}</span>
      </div>
      <ul className="mt-1.5 space-y-1 pl-5">
        {[...blocking, ...warnings].slice(0, 3).map(issue => (
          <li key={issue.code} className="list-disc leading-5">{issue.message}</li>
        ))}
      </ul>
    </div>
  )
}
