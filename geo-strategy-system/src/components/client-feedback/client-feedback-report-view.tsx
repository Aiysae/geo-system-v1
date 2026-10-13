import EffectDashboard from "@/components/reports/effect-dashboard"
import dashboardStyles from "@/components/reports/effect-dashboard.module.css"
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  Globe2,
  Link2,
} from "lucide-react"
import Link from "next/link"
import type {
  ClientExecutionAction,
  ClientExecutionStage,
  ClientFeedbackReport,
} from "@/types/client-feedback"

const STAGE_LABELS: Record<ClientExecutionStage, string> = {
  baseline: "基线建档",
  foundation: "基础建设",
  initial_mention: "首次提及",
  coverage_growth: "覆盖增长",
  stable_mention: "稳定提及",
  continuous_optimization: "持续优化",
}

const CATEGORY_LABELS: Record<ClientExecutionAction["category"], string> = {
  penetration_check: "疑问句检测",
  content_production: "内容生产",
  self_media_publish: "自媒体发布",
  authority_media_publish: "权威媒体发布",
  video_publish: "视频发布",
  website_optimization: "网站优化",
  strategy_adjustment: "策略调整",
  client_communication: "客户沟通",
  other: "其他动作",
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function dateOnly(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function addDays(value: string, count: number): string {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + count))
  return date.toISOString().slice(0, 10)
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  for (let cursor = start, guard = 0; cursor <= end && guard < 370; cursor = addDays(cursor, 1), guard += 1) {
    dates.push(cursor)
  }
  return dates
}

function shortDate(value: string): string {
  const [, month, day] = value.split("-")
  return `${Number(month)}月${Number(day)}日`
}

function percent(value: number | null | undefined): string {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "暂无"
}

function signedPercent(value: number | null): string {
  if (value === null) return "不可比"
  const points = value * 100
  return `${points > 0 ? "+" : ""}${points.toFixed(1)} 个百分点`
}

function signedNumber(value: number | null): string {
  if (value === null) return "不可比"
  return `${value > 0 ? "+" : ""}${Math.round(value)}`
}

export default function ClientFeedbackReportView({
  report,
  publicView = false,
}: {
  report: ClientFeedbackReport
  publicView?: boolean
}) {
  const { snapshot } = report
  const current = snapshot.comparison.current
  const baseline = snapshot.comparison.baseline
  const actionsByDate = new Map<string, ClientExecutionAction[]>()
  for (const action of snapshot.actions) {
    const day = dateOnly(action.occurredAt)
    actionsByDate.set(day, [...(actionsByDate.get(day) || []), action])
  }
  const timeline = dateRange(report.periodStart, report.periodEnd).map(date => ({
    date,
    actions: actionsByDate.get(date) || [],
    beforeProject: Boolean(snapshot.projectStartDate && date < snapshot.projectStartDate),
  }))
  const actionDays = timeline.filter(day => day.actions.length > 0)
  const metrics = [
    {
      label: "品牌渗透率",
      before: percent(baseline?.penetrationRate),
      after: percent(current?.penetrationRate),
      delta: signedPercent(snapshot.comparison.penetrationDelta),
    },
    {
      label: "综合提及率",
      before: percent(baseline?.balancedPenetrationRate),
      after: percent(current?.balancedPenetrationRate),
      delta: signedPercent(snapshot.comparison.balancedPenetrationDelta),
    },
    {
      label: "不同来源网址",
      before: baseline ? String(baseline.uniqueSourceCount) : "暂无",
      after: current ? String(current.uniqueSourceCount) : "暂无",
      delta: signedNumber(snapshot.comparison.sourceDelta),
    },
    {
      label: "不同来源网站",
      before: baseline ? String(baseline.uniqueDomainCount) : "暂无",
      after: current ? String(current.uniqueDomainCount) : "暂无",
      delta: signedNumber(snapshot.comparison.domainDelta),
    },
  ]

  return (
    <article className="feedback-report mx-auto w-full max-w-6xl overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900 print:max-w-none print:rounded-none print:border-0 print:shadow-none">
      <header className="border-b border-slate-200 bg-white px-5 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="max-w-3xl break-words text-2xl font-semibold leading-snug text-slate-900">{snapshot.reportTitle}</h1>
          <span className="rounded-md bg-blue-50 px-3 py-1 text-sm font-medium text-blue-800">{report.type === "weekly" ? "周度反馈" : "月度反馈"}</span>
        </div>
        <p className="mt-2 break-words text-base text-slate-700">{snapshot.subjectName} · {snapshot.clientName}</p>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs leading-5 text-slate-600">
          <span>周期：{report.periodStart} 至 {report.periodEnd}</span>
          <span>数据截止：{formatDate(snapshot.dataCutoffAt)}</span>
          {snapshot.industry ? <span>行业：{snapshot.industry}</span> : null}
        </div>
        <nav aria-label="报告内容" className="no-print mt-2 flex flex-wrap gap-3 text-xs">
          {[["summary", "本期结论"], ["comparison", "效果对比"], ["plan", "下一步计划"], ["evidence", "执行与证据"]].map(([key, label]) => (
            <a key={key} href={`#feedback-${report.id}-${key}`} className="inline-flex min-h-8 items-center rounded-md border border-slate-200 px-3 py-1 text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{label}</a>
          ))}
        </nav>
      </header>

      <div className="space-y-6 bg-slate-50 px-5 py-3 sm:px-6 sm:py-4 print:bg-white">
        <section id={`feedback-${report.id}-summary`} className="scroll-mt-20">
          <EffectDashboard snapshot={snapshot} />
        </section>

        <details id={`feedback-${report.id}-comparison`} className={`${dashboardStyles.details} scroll-mt-20`}><summary>查看完整指标对比与检测记录</summary>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#1677FF]" />
                <h2 className="text-base font-bold">效果对比</h2>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">{snapshot.comparison.comparabilityNote}</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">品牌渗透率按有效回答中的提及比例统计；综合提及率按已覆盖的问题类别均衡计算。不同来源网址与网站表示信源范围，不代表销售转化。</p>
            </div>
            <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${snapshot.comparison.comparable ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {snapshot.comparison.comparable ? "可直接对比" : "仅供参考"}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              {
                label: "起始检测",
                metric: baseline,
                mode: snapshot.comparison.baselineSelectionMode,
              },
              {
                label: "当前检测",
                metric: current,
                mode: snapshot.comparison.currentSelectionMode,
              },
            ].map(entry => (
              <div key={entry.label} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[#DCE8F4] bg-[#F8FBFF] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-600">{entry.label}</p>
                  <p className="mt-1 break-words text-xs font-semibold text-[#102A43]">
                    {entry.metric?.completedAt ? formatDate(entry.metric.completedAt) : "未选择有效检测"}
                  </p>
                  {entry.metric ? <p className="mt-1 text-xs leading-5 text-slate-600">{entry.metric.questionCount} 个问题 · {entry.metric.modelCount} 个模型 · 有效采样 {entry.metric.completedSlots}/{entry.metric.totalSlots}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {entry.metric ? (
                    <span className="rounded-md bg-[#EAF4FF] px-2 py-1 text-xs font-semibold text-[#0958D9]">
                      {entry.mode === "manual" ? "人工选择" : "系统推荐"}
                    </span>
                  ) : null}
                  {!publicView && entry.metric?.historyRecordId ? (
                    <Link href={`/workspace/results/penetration/${encodeURIComponent(entry.metric.historyRecordId)}`} className="text-xs font-semibold text-[#1677FF] hover:underline">
                      查看记录
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map(item => (
              <div key={item.label} className="rounded-lg border border-[#DCE8F4] bg-white p-4">
                <p className="text-xs font-semibold text-slate-600">{item.label}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-slate-600">起始值</dt><dd className="mt-1 tabular-nums text-slate-700">{item.before}</dd></div>
                  <div><dt className="text-xs text-slate-600">当前值</dt><dd className="mt-1 font-semibold tabular-nums text-slate-900">{item.after}</dd></div>
                </dl>
                <p className={`mt-2 text-xs font-semibold ${snapshot.comparison.comparable && item.delta.startsWith("+") ? "text-emerald-600" : snapshot.comparison.comparable && item.delta.startsWith("-") ? "text-rose-600" : "text-slate-600"}`}>{snapshot.comparison.comparable ? item.delta : "暂无可比结果"}</p>
              </div>
            ))}
          </div>
        </details>

        <section id={`feedback-${report.id}-plan`} className="scroll-mt-20 grid gap-5 lg:grid-cols-[1fr_.75fr]">
          <div className="rounded-lg border border-[#DCE8F4] p-5">
            <h2 className="text-base font-bold">下一阶段计划</h2>
            {snapshot.nextPlan.length ? (
              <ul className="mt-4 space-y-3">
                {snapshot.nextPlan.map((item, index) => (
                  <li key={`${index}-${item}`} className="flex gap-3 text-sm leading-6 text-[#38536E]">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1677FF]" />
                    <span className="break-words">{item}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-4 text-sm text-slate-600">暂未填写下一阶段计划。</p>}
          </div>
          <div className="rounded-lg bg-slate-50 p-5">
            <Globe2 className="h-6 w-6 text-[#1677FF]" />
            <h2 className="mt-4 text-base font-bold">可信数据说明</h2>
            <p className="mt-2 text-sm leading-6 text-[#526A83]">
              仅对使用相同检测模型且问题范围接近的结果进行前后对比，其他变化仅供参考。
            </p>
            {publicView ? <p className="mt-3 text-xs text-slate-600">此页面仅供查看，数据以报告生成时为准。</p> : null}
          </div>
        </section>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-slate-200 py-5 lg:grid-cols-4">
          {[
            { label: "阶段进度", value: `${snapshot.stageProgress}% · 第 ${snapshot.executionDay} 天` },
            { label: "当前阶段", value: STAGE_LABELS[snapshot.currentStage] },
            { label: "服务周期", value: `第 ${snapshot.serviceWeek} 周 / 第 ${snapshot.serviceMonth} 月` },
            { label: "可核验证据", value: `${snapshot.evidenceRecordCount} 条` },
          ].map(item => (
            <div key={item.label} className="min-w-0">
              <dt className="text-xs text-slate-600">{item.label}</dt>
              <dd className="mt-2 break-words text-lg font-semibold tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>

        {snapshot.contentAttribution && snapshot.contentAttribution.generatedArticleCount > 0 ? (
          <section>
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-[#1677FF]" />
              <h2 className="text-base font-bold">内容执行结构</h2>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "完成内容", value: `${snapshot.contentAttribution.generatedArticleCount} 篇` },
                { label: "覆盖问题", value: `${snapshot.contentAttribution.coveredQuestionCount} 个` },
                { label: "引用客户资料", value: `${snapshot.contentAttribution.evidenceLinkedArticleCount} 篇` },
                { label: "使用资料资产", value: `${snapshot.contentAttribution.knowledgeAssetUseCount} 项` },
              ].map(item => (
                <div key={item.label} className="rounded-lg border border-[#DCE8F4] bg-[#F8FBFF] p-4">
                  <p className="text-xs font-medium text-slate-600">{item.label}</p>
                  <p className="mt-2 text-xl font-bold text-[#102A43]">{item.value}</p>
                </div>
              ))}
            </div>
            {snapshot.contentAttribution.platformCounts.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {snapshot.contentAttribution.platformCounts.map(item => (
                  <span key={item.platform} className="rounded-md bg-[#EAF4FF] px-2.5 py-1 text-xs font-semibold text-[#0958D9]">
                    {item.platform} {item.count} 篇
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <section id={`feedback-${report.id}-evidence`} className="scroll-mt-20">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#13C2C2]" />
                <h2 className="text-base font-bold">本期执行与证据</h2>
              </div>
              <p className="mt-1 text-xs text-slate-600">完整覆盖 {report.periodStart} 至 {report.periodEnd}</p>
            </div>
            <span className="text-xs font-semibold text-[#526A83]">共 {snapshot.actions.length} 项动作</span>
          </div>


          {actionDays.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-[#C8D9E8] bg-[#F8FBFD] px-4 py-10 text-center text-sm text-slate-600">
              该反馈周期尚未记录可向客户展示的执行动作
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {actionDays.map(day => (
                <details key={`${report.id}-${day.date}`} className="group overflow-hidden rounded-lg border border-[#DCE8F4]">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 bg-[#F8FBFF] px-4 py-3 hover:bg-[#EDF5FF] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1677FF] group-open:border-b group-open:border-[#E9F0F6] [&::-webkit-details-marker]:hidden">
                    <h3 className="text-xs font-bold text-[#102A43]">{day.date} · {shortDate(day.date)}</h3>
                    <span className="flex shrink-0 items-center gap-3 text-xs font-semibold text-[#1677FF]">
                      {day.actions.length} 项
                      <span className="group-open:hidden">展开</span>
                      <span className="hidden group-open:inline">收起</span>
                      <ChevronDown aria-hidden="true" className="h-4 w-4 group-open:rotate-180" />
                    </span>
                  </summary>
                  {day.actions.map((action, index) => (
                    <div key={action.id} className="grid gap-3 border-b border-[#E9F0F6] px-4 py-4 last:border-b-0 sm:grid-cols-[34px_1fr_auto]">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1677FF] font-mono text-xs font-bold text-white">{index + 1}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="break-words text-sm font-semibold">{action.title}</h3>
                          <span className="rounded-md bg-[#EDF5FF] px-2 py-0.5 text-xs font-semibold text-[#0958D9]">{CATEGORY_LABELS[action.category]}</span>
                        </div>
                        {action.description ? <p className="mt-1 break-words text-sm leading-6 text-slate-600">{action.description}</p> : null}
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                          <span>{formatDate(action.occurredAt)}</span>
                          {action.platform ? <span>平台：{action.platform}</span> : null}
                          {typeof action.quantity === "number" ? <span>{action.quantity} {action.unit || ""}</span> : null}
                        </div>
                        {action.evidence.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {action.evidence.map(evidence => (
                              <a key={evidence.url} href={evidence.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[#1677FF] hover:underline">
                                <Link2 className="h-3 w-3" />{evidence.label}
                              </a>
                            ))}
                          </div>
                        ) : null}
                        {!publicView
                          && action.publication === "full"
                          && (action.resultRef?.resourceId || action.sourceRecordId)
                          && action.category === "penetration_check" ? (
                            <Link href={`/workspace/results/penetration/${encodeURIComponent(action.resultRef?.resourceId || action.sourceRecordId || "")}`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1677FF] hover:underline">
                              <FileCheck2 className="h-3.5 w-3.5" />查看当次检测报告
                            </Link>
                          ) : null}
                        {!publicView && action.publication === "full" && action.category !== "penetration_check" ? (
                          <Link href={`/workspace/actions/${encodeURIComponent(action.id)}?clientId=${encodeURIComponent(report.clientId)}`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1677FF] hover:underline">
                            <FileCheck2 className="h-3.5 w-3.5" />查看动作详情
                          </Link>
                        ) : null}
                      </div>
                      <span className={`h-fit rounded-md px-2 py-1 text-xs font-semibold ${action.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {action.status === "completed" ? "已完成" : "计划中"}
                      </span>
                    </div>
                  ))}
                </details>
              ))}
            </div>
          )}
          <h3 className="mt-6 text-sm font-semibold text-slate-900">每日执行分布</h3>
          <div className={`mt-4 grid gap-2 ${report.type === "weekly" ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7" : "grid-cols-3 sm:grid-cols-5 lg:grid-cols-6"}`}>
            {timeline.map(day => (
              <div key={day.date} data-feedback-day={day.date} className={`min-h-20 rounded-lg border px-2.5 py-2.5 ${day.actions.length > 0 ? "border-[#91CAFF] bg-[#EFF8FF]" : day.beforeProject ? "border-slate-200 bg-slate-50" : "border-[#E3EDF6] bg-white"}`}>
                <p className={`text-xs font-semibold ${day.actions.length > 0 ? "text-[#0958D9]" : "text-slate-600"}`}>{shortDate(day.date)}</p>
                <p className={`mt-2 text-xs font-bold ${day.actions.length > 0 ? "text-[#102A43]" : day.beforeProject ? "text-slate-400" : "text-slate-600"}`}>
                  {day.actions.length > 0 ? `${day.actions.length} 项动作` : day.beforeProject ? "正式执行前" : "暂无动作"}
                </p>
                <div className={`mt-2 h-1 rounded-full ${day.actions.length > 0 ? "bg-[#1677FF]" : "bg-[#E8F0F7]"}`} />
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#DCE8F4] bg-[#F6FAFD] px-5 py-4 text-xs text-slate-600 sm:px-9">
        <span>由势途 GEO 全链路操作工具生成</span>
        <span>生成于 {formatDate(snapshot.generatedAt)}</span>
      </footer>
    </article>
  )
}
