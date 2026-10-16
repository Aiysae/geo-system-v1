"use client"

import { ArrowRight, ChartNoAxesCombined } from "lucide-react"
import type { ClientExecutionProfile, ClientFeedbackReport } from "@/types/client-feedback"
import EffectDashboard, { NextActions } from "@/components/reports/effect-dashboard"
import s from "@/components/reports/effect-dashboard.module.css"

export default function ClientOverview({ reports, profile, onOpenReport }: {
  reports: ClientFeedbackReport[]
  profile: ClientExecutionProfile
  onOpenReport: (report: ClientFeedbackReport) => void
}) {
  // Only use published snapshots from the existing permission-filtered response.
  const latest = reports.filter(report => report.status === "published")
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.createdAt.localeCompare(a.createdAt))[0]
  return <section id="client-overview" aria-label="客户项目概览" className={`${s.dashboard} ${s.surface}`}>
    <div className={s.heading}>
      <div><h2>项目概览</h2><p className={s.muted}>{latest ? `${latest.snapshot.clientName} · ${latest.periodStart} 至 ${latest.periodEnd}` : "项目进展与效果"}</p></div>
      {latest ? <button type="button" onClick={() => onOpenReport(latest)} className={s.button}>查看完整报告<ArrowRight size={16} /></button> : null}
    </div>
    {latest ? <EffectDashboard snapshot={latest.snapshot} plans={profile.nextPlan} owner={profile.projectOwner} /> : <div className={s.grid}><div className={`${s.panel} ${s.empty}`}><ChartNoAxesCombined /><strong>暂无已发布报告</strong><span>报告发布后展示效果对比，当前可查看下方执行记录。</span></div><section className={s.panel}><NextActions plans={profile.nextPlan} owner={profile.projectOwner} /></section></div>}
  </section>
}
