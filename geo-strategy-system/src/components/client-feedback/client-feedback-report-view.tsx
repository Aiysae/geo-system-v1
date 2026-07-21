import {
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  FileCheck2,
  Globe2,
  Link2,
  Target,
} from "lucide-react"
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
  const metrics = [
    {
      label: "品牌渗透率",
      before: percent(baseline?.penetrationRate),
      after: percent(current?.penetrationRate),
      delta: signedPercent(snapshot.comparison.penetrationDelta),
    },
    {
      label: "均衡渗透率",
      before: percent(baseline?.balancedPenetrationRate),
      after: percent(current?.balancedPenetrationRate),
      delta: signedPercent(snapshot.comparison.balancedPenetrationDelta),
    },
    {
      label: "独立信源",
      before: baseline ? String(baseline.uniqueSourceCount) : "暂无",
      after: current ? String(current.uniqueSourceCount) : "暂无",
      delta: signedNumber(snapshot.comparison.sourceDelta),
    },
    {
      label: "独立域名",
      before: baseline ? String(baseline.uniqueDomainCount) : "暂无",
      after: current ? String(current.uniqueDomainCount) : "暂无",
      delta: signedNumber(snapshot.comparison.domainDelta),
    },
  ]

  return (
    <article className="feedback-report mx-auto w-full max-w-6xl overflow-hidden rounded-lg border border-[#CFE1F5] bg-white text-[#102A43] shadow-[0_24px_70px_-44px_rgba(0,61,150,0.52)] print:max-w-none print:rounded-none print:border-0 print:shadow-none">
      <header className="relative overflow-hidden bg-[radial-gradient(circle_at_14%_22%,rgba(79,209,255,.38),transparent_24%),radial-gradient(circle_at_82%_12%,rgba(99,102,241,.34),transparent_30%),linear-gradient(135deg,#001D66_0%,#075BDB_46%,#00AEEA_100%)] px-6 py-10 text-white sm:px-10 sm:py-14">
        <div className="absolute inset-0 opacity-45 [background-image:radial-gradient(circle,rgba(255,255,255,.72)_0_1px,transparent_1.5px)] [background-size:34px_34px]" />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-semibold text-cyan-50/78">
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#53F3FF] shadow-[0_0_16px_rgba(83,243,255,.9)]" />
              GEO EXECUTION INTELLIGENCE
            </span>
            <span>{report.type === "weekly" ? "周度反馈" : "月度反馈"} · V{report.version}</span>
          </div>
          <h1 className="mt-8 max-w-4xl break-words text-3xl font-bold leading-tight sm:text-5xl">
            {snapshot.reportTitle}
          </h1>
          <p className="mt-4 max-w-3xl break-words text-base text-cyan-50/84 sm:text-lg">
            {snapshot.subjectName}
          </p>
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-xs text-white/72">
            <span>客户：{snapshot.clientName}</span>
            <span>行业：{snapshot.industry || "未填写"}</span>
            <span>周期：{report.periodStart} 至 {report.periodEnd}</span>
            <span>数据截止：{formatDate(snapshot.dataCutoffAt)}</span>
          </div>
        </div>
      </header>

      <div className="space-y-8 px-5 py-7 sm:px-9 sm:py-10">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "执行天数", value: `第 ${snapshot.executionDay} 天`, icon: CalendarDays, color: "text-[#1677FF] bg-[#EAF4FF]" },
            { label: "当前阶段", value: STAGE_LABELS[snapshot.currentStage], icon: Target, color: "text-[#6C5CE7] bg-[#F0EEFF]" },
            { label: "最新渗透率", value: percent(current?.penetrationRate), icon: Activity, color: "text-[#08979C] bg-[#E6FFFB]" },
            { label: "可核验证据", value: `${snapshot.evidenceRecordCount} 条`, icon: FileCheck2, color: "text-[#D46B08] bg-[#FFF7E6]" },
          ].map(item => {
            const Icon = item.icon
            return (
              <div key={item.label} className="min-w-0 rounded-lg border border-[#DCE8F4] bg-[#F8FBFF] p-4">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${item.color}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <p className="mt-4 text-[11px] font-medium text-[#6B8299]">{item.label}</p>
                <p className="mt-1 break-words text-xl font-bold">{item.value}</p>
              </div>
            )
          })}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
          <div className="rounded-lg border border-[#DCE8F4] p-5">
            <div className="flex items-center gap-2">
              <CircleDot className="h-4 w-4 text-[#1677FF]" />
              <h2 className="text-base font-bold">执行摘要</h2>
            </div>
            <ol className="mt-4 space-y-3">
              {snapshot.executiveSummary.map((item, index) => (
                <li key={`${index}-${item}`} className="flex gap-3 text-sm leading-6 text-[#38536E]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#EAF4FF] font-mono text-[10px] font-bold text-[#0958D9]">
                    {index + 1}
                  </span>
                  <span className="min-w-0 break-words">{item}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-lg border border-[#DCE8F4] p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold">阶段进度</h2>
              <span className="font-mono text-xl font-bold text-[#0958D9]">{snapshot.stageProgress}%</span>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-[#E8F0F8]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#1677FF] via-[#00AEEA] to-[#13C2C2]"
                style={{ width: `${snapshot.stageProgress}%` }}
              />
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-[#F5F9FD] p-3">
                <dt className="text-[#7E91A7]">服务周</dt>
                <dd className="mt-1 text-lg font-bold">第 {snapshot.serviceWeek} 周</dd>
              </div>
              <div className="rounded-lg bg-[#F5F9FD] p-3">
                <dt className="text-[#7E91A7]">服务月</dt>
                <dd className="mt-1 text-lg font-bold">第 {snapshot.serviceMonth} 月</dd>
              </div>
            </dl>
            {snapshot.projectOwner ? <p className="mt-4 text-xs text-[#6B8299]">项目负责人：{snapshot.projectOwner}</p> : null}
          </div>
        </section>

        <section>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#1677FF]" />
                <h2 className="text-base font-bold">效果对比</h2>
              </div>
              <p className="mt-1 text-xs text-[#7E91A7]">{snapshot.comparison.comparabilityNote}</p>
            </div>
            <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold ${snapshot.comparison.comparable ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {snapshot.comparison.comparable ? "样本可比" : "仅供观察"}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map(item => (
              <div key={item.label} className="rounded-lg border border-[#DCE8F4] bg-white p-4">
                <p className="text-[11px] font-semibold text-[#6B8299]">{item.label}</p>
                <div className="mt-3 flex items-center gap-2 text-sm">
                  <span className="text-[#8AA0B5]">{item.before}</span>
                  <span className="text-[#B3C1CF]">→</span>
                  <span className="font-bold">{item.after}</span>
                </div>
                <p className={`mt-2 text-xs font-semibold ${item.delta.startsWith("+") ? "text-emerald-600" : item.delta.startsWith("-") ? "text-rose-600" : "text-[#6B8299]"}`}>{item.delta}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#13C2C2]" />
            <h2 className="text-base font-bold">本期动作记录</h2>
          </div>
          {snapshot.actions.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-[#C8D9E8] bg-[#F8FBFD] px-4 py-10 text-center text-sm text-[#7E91A7]">
              当前周期尚未记录可向客户展示的执行动作
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-lg border border-[#DCE8F4]">
              {snapshot.actions.map((action, index) => (
                <div key={action.id} className="grid gap-3 border-b border-[#E9F0F6] px-4 py-4 last:border-b-0 sm:grid-cols-[34px_1fr_auto]">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00AEEA] font-mono text-xs font-bold text-white">{index + 1}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-sm font-semibold">{action.title}</h3>
                      <span className="rounded-md bg-[#EDF5FF] px-2 py-0.5 text-[10px] font-semibold text-[#0958D9]">{CATEGORY_LABELS[action.category]}</span>
                    </div>
                    {action.description ? <p className="mt-1 break-words text-xs leading-5 text-[#6B8299]">{action.description}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#8AA0B5]">
                      <span>{formatDate(action.occurredAt)}</span>
                      {action.platform ? <span>平台：{action.platform}</span> : null}
                      {typeof action.quantity === "number" ? <span>{action.quantity} {action.unit || ""}</span> : null}
                    </div>
                    {action.evidence.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {action.evidence.map(evidence => (
                          <a key={evidence.url} href={evidence.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1677FF] hover:underline">
                            <Link2 className="h-3 w-3" />{evidence.label}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <span className={`h-fit rounded-md px-2 py-1 text-[10px] font-semibold ${action.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {action.status === "completed" ? "已完成" : "计划中"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_.75fr]">
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
            ) : <p className="mt-4 text-sm text-[#7E91A7]">暂未填写下一阶段计划。</p>}
          </div>
          <div className="rounded-lg bg-[linear-gradient(135deg,#EAF4FF_0%,#F2FBFF_100%)] p-5 ring-1 ring-[#CFE7FA]">
            <Globe2 className="h-6 w-6 text-[#1677FF]" />
            <h2 className="mt-4 text-base font-bold">可信数据说明</h2>
            <p className="mt-2 text-xs leading-5 text-[#526A83]">
              本报告由客户执行记录与平台历史检测快照生成。效果变化仅在检测模型一致、疑问句样本重合度达到标准时标注为“样本可比”。
            </p>
            {publicView ? <p className="mt-3 text-[10px] text-[#7E91A7]">本页面为只读验证页面，数据以报告生成时快照为准。</p> : null}
          </div>
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#DCE8F4] bg-[#F6FAFD] px-5 py-4 text-[10px] text-[#7E91A7] sm:px-9">
        <span>由势途 GEO 全链路操作工具生成</span>
        <span>报告 ID：{report.id} · 生成于 {formatDate(snapshot.generatedAt)}</span>
      </footer>
    </article>
  )
}
