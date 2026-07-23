"use client"

import { useMemo, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  FileCode2,
  Globe2,
  Heading1,
  ListChecks,
  MessagesSquare,
  ShieldCheck,
  XCircle,
} from "lucide-react"
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import type {
  GeoAuditBotPolicy,
  GeoAuditCheck,
  GeoAuditCheckStatus,
  WebsiteGeoAudit,
} from "@/types"

type CheckFilter = "all" | "fail" | "warning" | "pass"

const STATUS_META: Record<GeoAuditCheckStatus, {
  label: string
  className: string
  icon: typeof CheckCircle2
}> = {
  pass: {
    label: "通过",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: CheckCircle2,
  },
  warning: {
    label: "需优化",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    icon: AlertTriangle,
  },
  fail: {
    label: "未通过",
    className: "border-rose-200 bg-rose-50 text-rose-700",
    icon: XCircle,
  },
  not_applicable: {
    label: "不适用",
    className: "border-slate-200 bg-slate-50 text-slate-500",
    icon: CircleHelp,
  },
}

const FILTERS: Array<{ key: CheckFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "fail", label: "未通过" },
  { key: "warning", label: "需优化" },
  { key: "pass", label: "已通过" },
]

function scoreTone(score: number): {
  label: string
  color: string
  soft: string
} {
  if (score >= 85) return { label: "基础扎实", color: "#00A870", soft: "#E9FFF7" }
  if (score >= 70) return { label: "表现良好", color: "#1677FF", soft: "#EDF6FF" }
  if (score >= 50) return { label: "需要优化", color: "#FA8C16", soft: "#FFF7E8" }
  return { label: "优先整改", color: "#F5222D", soft: "#FFF1F0" }
}

function StatusBadge({ status }: { status: GeoAuditCheckStatus }) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${meta.className}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  )
}

function worstStatus(checks: GeoAuditCheck[]): GeoAuditCheckStatus {
  if (checks.some(check => check.status === "fail")) return "fail"
  if (checks.some(check => check.status === "warning")) return "warning"
  if (checks.some(check => check.status === "pass")) return "pass"
  return "not_applicable"
}

function CoreCheck({
  icon: Icon,
  title,
  checks,
}: {
  icon: typeof Heading1
  title: string
  checks: GeoAuditCheck[]
}) {
  const score = checks.reduce((sum, check) => sum + check.score, 0)
  const max = checks.reduce((sum, check) => sum + check.maxScore, 0)
  const status = worstStatus(checks)
  return (
    <div className="min-w-0 border-b border-slate-100 px-3 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF4FF] text-[#0958D9]">
            <Icon className="h-4 w-4" />
          </span>
          <span className="truncate text-xs font-semibold text-slate-800">{title}</span>
        </span>
        <StatusBadge status={status} />
      </div>
      <div className="mt-2 flex items-end gap-1">
        <span className="geo-data-number text-xl font-bold text-slate-900">{score}</span>
        <span className="pb-0.5 text-[10px] text-slate-400">/ {max}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">
        {checks.find(check => check.status !== "pass")?.summary || checks[0]?.summary || "暂无数据"}
      </p>
    </div>
  )
}

function BotPolicyBadge({ policy }: { policy: GeoAuditBotPolicy }) {
  const className = policy.status === "allowed"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : policy.status === "blocked"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-amber-200 bg-amber-50 text-amber-700"
  const label = policy.status === "allowed" ? "允许" : policy.status === "blocked" ? "禁止" : "待确认"
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${className}`}>
      {label}
    </span>
  )
}

export default function GeoAuditReport({ audit }: { audit: WebsiteGeoAudit }) {
  const [filter, setFilter] = useState<CheckFilter>("all")
  const tone = scoreTone(audit.score)
  const dimensionData = audit.dimensions.map(dimension => ({
    subject: dimension.label,
    score: dimension.maxScore > 0
      ? Math.round((dimension.score / dimension.maxScore) * 100)
      : 0,
    fullMark: 100,
  }))
  const checksById = useMemo(
    () => new Map(audit.checks.map(check => [check.id, check])),
    [audit.checks],
  )
  const coreGroups = [
    {
      title: "H1 / H2",
      icon: Heading1,
      checks: ["title-h1", "heading-hierarchy"].map(id => checksById.get(id)).filter(Boolean) as GeoAuditCheck[],
    },
    {
      title: "问答内容",
      icon: MessagesSquare,
      checks: ["visible-qa", "qa-schema"].map(id => checksById.get(id)).filter(Boolean) as GeoAuditCheck[],
    },
    {
      title: "Robots",
      icon: ShieldCheck,
      checks: ["robots-generic", "robots-oai-search"].map(id => checksById.get(id)).filter(Boolean) as GeoAuditCheck[],
    },
    {
      title: "LLMs 文本",
      icon: FileCode2,
      checks: ["llms-txt"].map(id => checksById.get(id)).filter(Boolean) as GeoAuditCheck[],
    },
  ]
  const visibleChecks = audit.checks
    .filter(check => filter === "all" || check.status === filter)
    .sort((a, b) => {
      const priority = { P0: 0, P1: 1, P2: 2 }
      return priority[a.priority] - priority[b.priority] || a.score / a.maxScore - b.score / b.maxScore
    })
  const counts = {
    fail: audit.checks.filter(check => check.status === "fail").length,
    warning: audit.checks.filter(check => check.status === "warning").length,
    pass: audit.checks.filter(check => check.status === "pass").length,
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-[#CFE5FF] bg-white">
        <div className="grid lg:grid-cols-[260px_minmax(0,1fr)]">
          <div
            className="flex min-h-[230px] items-center justify-center border-b border-[#D8E9FA] p-5 lg:border-b-0 lg:border-r"
            style={{ background: `linear-gradient(145deg, ${tone.soft}, #FFFFFF 72%)` }}
          >
            <div className="text-center">
              <div
                className="relative mx-auto flex h-36 w-36 items-center justify-center rounded-full"
                style={{ background: `conic-gradient(${tone.color} ${audit.score * 3.6}deg, #DDEAF7 0deg)` }}
                role="img"
                aria-label={`网站 GEO 诊断得分 ${audit.score} 分`}
              >
                <div className="flex h-[116px] w-[116px] flex-col items-center justify-center rounded-full bg-white shadow-sm">
                  <span className="geo-data-number text-4xl font-bold" style={{ color: tone.color }}>
                    {audit.score}
                  </span>
                  <span className="mt-0.5 text-[10px] font-semibold text-slate-400">总分 / 100</span>
                </div>
              </div>
              <span
                className="mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                style={{ color: tone.color, backgroundColor: tone.soft }}
              >
                {tone.label}
              </span>
            </div>
          </div>

          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold">
              <span className="rounded-full bg-[#EAF4FF] px-2.5 py-1 text-[#0958D9]">
                可信度：{audit.confidenceLabel}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                已读取 {audit.pagesFetched}/{audit.pagesRequested} 页
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                用时 {(audit.durationMs / 1000).toFixed(1)} 秒
              </span>
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-900">诊断结论</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">{audit.aiSummary.executiveSummary}</p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1.5 text-[11px] font-semibold text-emerald-700">当前优势</div>
                <ul className="space-y-1.5">
                  {(audit.aiSummary.strengths.length > 0
                    ? audit.aiSummary.strengths
                    : ["暂未发现达到满分的检查项"]
                  ).slice(0, 4).map(item => (
                    <li key={item} className="flex gap-2 text-xs leading-5 text-slate-600">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-semibold text-rose-700">优先风险</div>
                <ul className="space-y-1.5">
                  {(audit.aiSummary.risks.length > 0
                    ? audit.aiSummary.risks
                    : ["未发现阻断性问题"]
                  ).slice(0, 4).map(item => (
                    <li key={item} className="flex gap-2 text-xs leading-5 text-slate-600">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(340px,0.9fr)_minmax(0,1.1fr)]">
        <div className="geo-panel min-w-0 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">六维 GEO 表现</h3>
              <p className="mt-0.5 text-[11px] text-slate-400">分值全部来自本次读取结果</p>
            </div>
            <ListChecks className="h-4 w-4 text-[#1677FF]" />
          </div>
          <div className="h-[320px] min-h-[320px] w-full">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 380, height: 320 }}
            >
              <RadarChart data={dimensionData} margin={{ top: 28, right: 45, bottom: 20, left: 45 }}>
                <defs>
                  <linearGradient id="geoAuditRadar" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00C8FF" stopOpacity={0.65} />
                    <stop offset="55%" stopColor="#1677FF" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#2F54EB" stopOpacity={0.42} />
                  </linearGradient>
                </defs>
                <PolarGrid stroke="#DCE8F5" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: "#475569", fontWeight: 600 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                  dataKey="score"
                  name="得分"
                  stroke="#1677FF"
                  strokeWidth={2.5}
                  fill="url(#geoAuditRadar)"
                  fillOpacity={0.72}
                  dot={{ fill: "#00C8FF", stroke: "#FFFFFF", strokeWidth: 2, r: 3.5 }}
                  isAnimationActive
                  animationDuration={700}
                />
                <Tooltip
                  formatter={value => [`${value} 分`, "得分"]}
                  contentStyle={{
                    border: "1px solid #D8E6F5",
                    borderRadius: 8,
                    fontSize: 12,
                    boxShadow: "0 10px 24px -14px rgba(9,88,217,0.35)",
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="geo-panel min-w-0 overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-bold text-slate-900">四项核心检查</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">标题、问答、爬虫协议与 AI 文本入口</p>
          </div>
          <div className="grid sm:grid-cols-2">
            {coreGroups.map(group => (
              <CoreCheck key={group.title} {...group} />
            ))}
          </div>
          <div className="border-t border-slate-100 px-4 py-3">
            <h4 className="text-xs font-semibold text-slate-800">优先行动</h4>
            <ol className="mt-2 grid gap-2 sm:grid-cols-2">
              {audit.aiSummary.actions.slice(0, 6).map((action, index) => (
                <li key={action} className="flex min-w-0 gap-2 text-xs leading-5 text-slate-600">
                  <span className="geo-data-number flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#EAF4FF] text-[10px] font-bold text-[#0958D9]">
                    {index + 1}
                  </span>
                  <span>{action}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="geo-panel overflow-hidden">
        <div className="geo-panel-header">
          <div>
            <h3 className="geo-panel-title">AI 爬虫访问状态</h3>
            <p className="geo-panel-description">搜索访问与训练访问分开判断</p>
          </div>
          <ShieldCheck className="h-4 w-4 text-[#1677FF]" />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3">
          {audit.botPolicies.map(policy => (
            <div key={policy.key} className="min-w-0 border-b border-slate-100 px-4 py-3 sm:border-r lg:[&:nth-child(3n)]:border-r-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-800">{policy.label}</div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-slate-400">{policy.userAgent}</div>
                </div>
                <BotPolicyBadge policy={policy} />
              </div>
              <p className="mt-2 text-[11px] leading-5 text-slate-500">{policy.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="geo-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">检查明细与证据</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {counts.fail} 项未通过 · {counts.warning} 项需优化 · {counts.pass} 项已通过
            </p>
          </div>
          <div className="geo-segmented grid h-9 grid-cols-4 gap-1 p-1">
            {FILTERS.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`min-w-14 rounded px-2 text-[10px] font-semibold transition ${
                  filter === item.key
                    ? "bg-white text-[#0958D9] shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {visibleChecks.map(check => (
            <details key={check.id} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition hover:bg-[#F7FBFF]">
                <StatusBadge status={check.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-800">{check.label}</span>
                    {check.priority !== "P2" && (
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                        check.priority === "P0"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-amber-100 text-amber-700"
                      }`}>
                        {check.priority}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">{check.summary}</p>
                </div>
                <span className="geo-data-number shrink-0 text-xs font-bold text-slate-700">
                  {check.score}/{check.maxScore}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
              </summary>
              <div className="grid gap-3 bg-[#FBFDFF] px-4 pb-4 pt-1 md:grid-cols-2">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500">检查证据</div>
                  {check.evidence.length > 0 ? (
                    <ul className="mt-1.5 space-y-1.5">
                      {check.evidence.map(item => (
                        <li key={item} className="break-words text-[11px] leading-5 text-slate-600">{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-slate-400">本项未提取到有效证据。</p>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-slate-500">改进建议</div>
                  <p className="mt-1.5 text-[11px] leading-5 text-slate-600">{check.recommendation}</p>
                  {check.urls.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {check.urls.slice(0, 4).map((url, index) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-full items-center gap-1 rounded border border-[#CFE5FF] bg-white px-2 py-1 text-[10px] text-[#0958D9] hover:border-[#69B1FF]"
                        >
                          <span className="truncate">页面 {index + 1}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="geo-panel overflow-hidden">
        <div className="geo-panel-header">
          <div>
            <h3 className="geo-panel-title">页面读取记录</h3>
            <p className="geo-panel-description">保留本次诊断的网址、标题与结构摘要</p>
          </div>
          <Globe2 className="h-4 w-4 text-[#1677FF]" />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-left">
            <thead className="bg-[#F7FBFF] text-[10px] font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-2.5">页面</th>
                <th className="px-3 py-2.5">状态</th>
                <th className="px-3 py-2.5">H1 / H2</th>
                <th className="px-3 py-2.5">问答</th>
                <th className="px-3 py-2.5">Schema</th>
                <th className="px-4 py-2.5 text-right">耗时</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {audit.pages.map(page => (
                <tr key={`${page.url}-${page.finalUrl}`} className="text-[11px] text-slate-600">
                  <td className="max-w-[320px] px-4 py-3">
                    <a
                      href={page.finalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-semibold text-slate-800 hover:text-[#0958D9]"
                      title={page.title || page.finalUrl}
                    >
                      {page.title || page.finalUrl}
                    </a>
                    <div className="mt-0.5 truncate text-[10px] text-slate-400">{page.finalUrl}</div>
                    {page.error && <div className="mt-1 text-[10px] text-rose-600">{page.error}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={page.status >= 200 && page.status < 300 ? "text-emerald-600" : "text-rose-600"}>
                      HTTP {page.status || "-"}
                    </span>
                  </td>
                  <td className="px-3 py-3">{page.h1.length} / {page.h2.length}</td>
                  <td className="px-3 py-3">{page.visibleQuestionCount}</td>
                  <td className="max-w-[180px] px-3 py-3">
                    <span className="line-clamp-2">{page.structuredDataTypes.join("、") || "-"}</span>
                  </td>
                  <td className="px-4 py-3 text-right">{page.loadTimeMs ? `${page.loadTimeMs}ms` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
