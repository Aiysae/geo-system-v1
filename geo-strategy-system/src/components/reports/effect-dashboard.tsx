"use client"

import { useEffect, useId, useState } from "react"
import type { PenetrationHistoryRecord } from "@/types"
import { ModelPerformance, QuestionCoverage } from "./detection-breakdown"
import ModelAvatar from "@/components/model-avatar"
import { ArrowRight, ArrowUpRight, ArrowDownRight, MoveRight, ChartNoAxesCombined, CircleAlert, MessagesSquare, Layers3, Target, ListChecks, Globe2 } from "lucide-react"
import type { ClientFeedbackMetricComparison, ClientFeedbackReportSnapshot } from "@/types/client-feedback"
import s from "./effect-dashboard.module.css"

export function rateLabel(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "暂无数据"
}

export function RateBar({ label, rate, detail, warning = false }: { label: string; rate: number | null; detail?: string; warning?: boolean }) {
  return <div>
    <div className={s.rowHeader}><span>{label}</span><strong className={warning ? s.warning : undefined}>{rateLabel(rate)}</strong></div>
    {rate !== null ? <div className={s.track} aria-hidden="true"><div className={`${s.fill} ${warning ? s.amber : ""}`} style={{ width: `${Math.max(0, Math.min(1, rate)) * 100}%` }} /></div> : null}
    {detail ? <div className={s.rowNote}>{detail}</div> : null}
  </div>
}

export function ComparisonChart({ comparison }: { comparison: ClientFeedbackMetricComparison }) {
  const entries = [{ label: "基准检测", value: comparison.baseline && comparison.baseline.completedSlots > 0 ? comparison.baseline.penetrationRate : null, date: comparison.baseline?.completedAt }, { label: "本期检测", value: comparison.current && comparison.current.completedSlots > 0 ? comparison.current.penetrationRate : null, date: comparison.current?.completedAt }]
  const chartId = useId().replace(/:/g, "")
  const hasData = entries.some(entry => typeof entry.value === "number")
  const points = entries.map((entry,index) => ({...entry, x: index === 0 ? 54 : 566, y: 180 - (typeof entry.value === "number" ? Math.max(0,Math.min(1,entry.value))*156 : 0)}))
  const connected = points.every(point => typeof point.value === "number" && Number.isFinite(point.value))
  return <>
    <div className={s.panelHeader}><h3>品牌被提及率趋势</h3><span className={s.badge}>{comparison.comparable ? "同口径可比" : "不可直接比较"}</span></div>
    <div className={s.trendLegend}><span><i />品牌被提及率</span><span>{connected && !comparison.comparable ? "虚线仅连接两次观测值，不代表可比增长" : "仅显示报告选定的两次记录"}</span></div>
    {hasData ? <>
      <svg className={s.trendSvg} viewBox="0 0 620 210" preserveAspectRatio="none" role="img" aria-label={entries.map(entry=>`${entry.label}：${rateLabel(entry.value)}`).join("；")}>
        <defs><linearGradient id={chartId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#1677ff" stopOpacity=".20"/><stop offset="1" stopColor="#1677ff" stopOpacity=".025"/></linearGradient></defs>
        {[0,25,50,75,100].map(value=><g key={value}><line x1="54" x2="590" y1={180-value*1.56} y2={180-value*1.56} stroke="#e4edf7" strokeDasharray="3 3"/><text x="4" y={184-value*1.56} fill="#61748e" fontSize="12">{value}%</text></g>)}
        {connected ? <>{comparison.comparable ? <path d={`M54 180 L${points[0].x} ${points[0].y} L${points[1].x} ${points[1].y} L566 180 Z`} fill={`url(#${chartId})`}/> : null}<line x1={points[0].x} x2={points[1].x} y1={points[0].y} y2={points[1].y} stroke="#1677ff" strokeWidth="3" strokeDasharray={comparison.comparable ? undefined : "7 5"}/></> : null}
        {points.map((point,index)=>typeof point.value === "number" ? <g key={point.label}><circle cx={point.x} cy={point.y} r={index===1?6:4} fill="#1677ff" stroke="white" strokeWidth="2"/><text x={point.x} y={point.y-14} textAnchor="middle" fill="#0958d9" fontSize="14" fontWeight="600">{rateLabel(point.value)}</text><text x={point.x} y="205" textAnchor={index===0?"start":"end"} fill="#61748e" fontSize="12">{point.date ? new Date(point.date).toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"}) : point.label}</text></g> : null)}
      </svg>
    </> : <div className={s.empty}><ChartNoAxesCombined/><span>完成有效检测后展示趋势点位</span></div>}
    <p className={s.note}>{comparison.comparabilityNote || "对比以本报告选定的两次检测为准。"}</p>
  </>
}

export function NextActions({ plans, owner, derived = false }: { plans: string[]; owner?: string; derived?: boolean }) {
  const steps = plans.filter(plan => plan.trim())
  return <>
    <h3>下一步重点</h3>
    {steps.length ? <>
      <div className={s.action}><span className={s.actionNumber}>01</span><strong>{steps[0]}</strong></div>
      {steps.length > 1 ? <ol className={s.steps}>{steps.slice(1, 3).map((step, index) => <li key={`${index}-${step}`}><span className={s.stepNumber}>{index + 2}</span><span>{step}</span></li>)}</ol> : null}
      {steps.length > 3 ? <details className={s.details}><summary>其余 {steps.length - 3} 项计划</summary><ol>{steps.slice(3).map((step, index) => <li key={index}>{step}</li>)}</ol></details> : null}
      <p className={s.note}>{derived ? "根据本次检测状态提示" : "按现有计划顺序展示"}{owner ? ` · 负责人：${owner}` : ""}</p>
    </> : <div className={s.empty}><CircleAlert /><span>下一阶段计划待项目负责人确认</span></div>}
  </>
}

export function CoverageGap({ rate, children }: { rate: number | null; children?: React.ReactNode }) {
  const known = typeof rate === "number" && Number.isFinite(rate)
  const gap = known ? 1 - Math.max(0, Math.min(1, rate)) : null
  return <section className={`${s.panel} ${s.gapPanel}`}>
    <div className={s.panelHeader}><h3><Target aria-hidden="true" />主要问题在哪</h3><span className={s.badge}>{gap === null ? "待检测" : gap > 0 ? "提及缺口" : "持续观察"}</span></div>
    <div className={s.gapReading}><strong>{gap === null ? "—" : rateLabel(gap)}</strong><div><b>{gap === null ? "还没有有效检测结果" : gap > 0 ? "有效回答未提及品牌" : "本次有效回答均已提及"}</b><p>{gap === null ? "完成检测后识别覆盖缺口" : "范围：本次检测，不代表整个市场"}</p></div></div>
    {gap !== null ? <div className={s.coverageTrack} role="img" aria-label={`已提及${rateLabel(rate)}，未提及${rateLabel(gap)}`}><span style={{width: `${(1 - gap) * 100}%`}} /><span style={{width: `${gap * 100}%`}} /></div> : null}
    {children}
  </section>
}

export default function EffectDashboard({ snapshot, plans = snapshot.nextPlan, owner = snapshot.projectOwner }: { snapshot: ClientFeedbackReportSnapshot; plans?: string[]; owner?: string }) {
  const historyId = snapshot.comparison.current?.historyRecordId
  const [detail, setDetail] = useState<{id: string; record?: PenetrationHistoryRecord; message?: string} | null>(null)
  useEffect(() => {
    if (!historyId) return
    const controller = new AbortController()
    fetch(`/api/penetration/history/${encodeURIComponent(historyId)}?view=overview`, {signal: controller.signal, cache:"no-store"})
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 403 ? "当前账号未开放检测明细" : "检测明细暂不可用")
        return response.json() as Promise<PenetrationHistoryRecord>
      })
      .then(record => setDetail({id:historyId,record}))
      .catch(error => { if (!controller.signal.aborted) setDetail({id:historyId,message:error instanceof Error ? error.message : "检测明细暂不可用"}) })
    return () => controller.abort()
  },[historyId])
  const matchingDetail = detail?.id === historyId ? detail : null
  const candidate = matchingDetail?.record?.result
  const matchesSnapshot = candidate && candidate.aggregated.totalSlots === snapshot.comparison.current?.completedSlots && candidate.aggregated.penetrationRate === snapshot.comparison.current?.penetrationRate
  const breakdown = matchesSnapshot ? candidate : null
  const detailMessage = candidate && !matchesSnapshot ? "检测记录已更新，与发布快照不一致；请以报告汇总指标为准" : !historyId ? "此报告未关联检测明细" : matchingDetail?.message || (!matchingDetail ? "正在读取已授权的检测明细…" : undefined)
  const { comparison } = snapshot
  const current = comparison.current
  const valid = current !== null && current.completedSlots > 0 && typeof current.penetrationRate === "number" && Number.isFinite(current.penetrationRate)
  const delta = valid && comparison.comparable ? comparison.penetrationDelta : null
  const direction = typeof delta === "number" ? delta > 0 ? "up" : delta < 0 ? "down" : "flat" : "unknown"
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : direction === "flat" ? MoveRight : ChartNoAxesCombined
  const tone = direction === "up" ? s.positive : direction === "down" ? s.negative : ""
  const title = !valid ? "效果待检测" : direction === "up" ? "品牌提及率较基准提升" : direction === "down" ? "品牌提及率下降，优先核对检测差异" : direction === "flat" ? "品牌提及率与基准持平" : "已有检测结果，尚无可比结论"
  const completed = snapshot.actions.filter(action => action.status === "completed").length
  const actions = snapshot.actions.length
  return <div className={s.dashboard}>
    <div className={s.banner}><span className={s.statusIcon}><Icon className={tone} /></span><h3>{title}</h3><span className={s.badge}>{snapshot.currentStage === "baseline" ? "基线建档" : "本期结论"}</span></div>
    <dl className={s.metrics}>
      <div className={s.metric}><dt><ChartNoAxesCombined aria-hidden="true" />品牌被提及率</dt><dd><span className={s.value}>{valid ? rateLabel(current.penetrationRate) : "—"}</span><div className={s.metricAside}>{typeof delta === "number" ? <span className={`${s.delta} ${tone}`}>{delta > 0 ? "+" : ""}{(delta * 100).toFixed(1)} 个百分点</span> : null}<span className={s.muted}>{typeof delta === "number" ? "较报告基准" : "暂无可比变化"}</span></div></dd></div>
      <div className={s.metric}><dt><MessagesSquare aria-hidden="true" />有效回答</dt><dd><span className={s.value}>{current?.completedSlots ?? "—"}</span><div className={s.metricAside}><b>计划 {current?.totalSlots ?? "—"} 条</b><span className={s.muted}>检测问题 {current?.questionCount ?? "—"} 个</span></div></dd></div>
      <div className={s.metric}><dt><Layers3 aria-hidden="true" />覆盖模型</dt><dd><span className={s.value}>{current?.modelCount ?? "—"}</span><div className={s.modelIdentities}>{breakdown?.aggregated.perModelRate.filter(model=>model.total>0).map(model=><ModelAvatar key={model.model} model={model.model} size="md"/>)}<span className={s.muted}>本期检测范围</span></div></dd></div>
    </dl>
    <div className={s.referenceGrid}>
      <section className={`${s.panel} ${s.chartPanel}`}><ComparisonChart comparison={comparison} /><div className={s.chartFoot}><span>本期</span><strong className={tone}>{typeof delta === "number" ? `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)} 个百分点` : "暂不判断变化"}</strong></div></section>
      <section className={s.panel}><ModelPerformance result={breakdown} message={detailMessage}/></section>
      <section className={s.panel}><QuestionCoverage result={breakdown} rate={valid ? current.penetrationRate : null} message={detailMessage}/></section>
      <section className={`${s.panel} ${s.nextPanel}`}><NextActions plans={plans} owner={owner} /></section>
    </div>
    {current && (current.completedSlots < current.totalSlots || current.sampleConfidence === "low" || current.modelCount < 2) ? <div className={s.scope}><CircleAlert /><span>{current.completedSlots < current.totalSlots ? "部分采样尚未完成。" : ""}{current.modelCount < 2 ? `当前覆盖 ${current.modelCount} 个模型。` : ""}{current.sampleConfidence === "low" ? "样本置信度较低。" : ""}结论仅适用于本次检测范围。</span></div> : null}
    <div className={s.supportStrip}>
      <section><ListChecks aria-hidden="true" /><div><h3>执行完成</h3><strong>{completed}<small> / {actions} 项</small></strong></div><div className={s.supportNote}>{actions > 0 ? <div className={s.track} role="img" aria-label={`已完成${completed}项，共${actions}项`}><div className={`${s.fill} ${s.teal}`} style={{width:`${completed / actions * 100}%`}} /></div> : null}<span>动作完成不等于效果提升</span></div></section>
      <section><Globe2 aria-hidden="true" /><div><h3>信源与证据</h3><strong>{current?.uniqueDomainCount ?? "—"}<small> 个引用网站</small></strong></div><div className={s.supportNote}><b>{snapshot.evidenceRecordCount} 条可核验证据</b><span>联网引用 {current?.sourceCount ?? "—"} 次</span></div></section>
    </div>
    <details className={s.details}><summary>报告摘要与统计口径 <ArrowRight size={14} className="inline" /></summary><ul>{snapshot.executiveSummary.map((item, index) => <li key={index}>{item}</li>)}</ul><p>品牌提及率按有效回答中的提及比例统计。信源范围不代表销售转化。数据截止 {new Date(snapshot.dataCutoffAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}。完整检测与来源以报告明细为准。</p></details>
  </div>
}
