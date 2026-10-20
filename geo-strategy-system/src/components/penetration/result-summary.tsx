import { CircleAlert, ChartNoAxesCombined } from "lucide-react"
import type { PenetrationResult } from "@/types"
import { ModelPerformance, QuestionCoverage } from "@/components/reports/detection-breakdown"
import { NextActions, rateLabel } from "@/components/reports/effect-dashboard"
import s from "@/components/reports/effect-dashboard.module.css"

export default function PenetrationResultSummary({ result, plannedSlots }: { result: PenetrationResult; plannedSlots?: number }) {
  const { aggregated, extraction } = result
  const completed = aggregated.totalSlots
  const planned = aggregated.plannedSlots ?? plannedSlots
  const incomplete = typeof planned === "number" && completed < planned
  const extractionIncomplete = extraction && extraction.status !== "complete"
  const models = aggregated.perModelRate.filter(model => model.total > 0).sort((a, b) => b.rate - a.rate)
  const next = completed === 0 || incomplete ? "补齐未完成的检测，再判断整体表现" : extractionIncomplete ? "完成品牌榜整理，再查看排名与同行对比" : aggregated.missedQuestions.length > 0 ? "优先查看未被提及的问题，核对需要补充的内容" : "查看模型回答与来源，按相同范围持续复测"
  return <section aria-label="检测结果摘要" className={`${s.dashboard} ${s.surface}`}>
    <div className={s.heading}><div><h2>本次检测结果</h2><p className={s.muted}>{new Date(result.generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · 本次有效回答统计</p></div><span className={s.badge}>检测结果</span></div>
    <div className={s.banner}><span className={s.statusIcon}><ChartNoAxesCombined /></span><h3>{completed === 0 ? "尚无有效回答，先完成检测" : aggregated.missedQuestions.length > 0 ? `发现 ${aggregated.missedQuestions.length} 个未被提及的问题` : "本次各问题均有提及记录，继续关注模型差异"}</h3></div>
    <dl className={s.metrics}>
      <div className={s.metric}><dt>检测对象被提及率</dt><dd><span className={s.value}>{completed > 0 ? rateLabel(aggregated.penetrationRate) : "—"}</span></dd><div className={s.muted}>{aggregated.ourMentions} 条回答提及检测对象</div></div>
      <div className={s.metric}><dt>有效回答</dt><dd><span className={s.value}>{completed}</span></dd><div className={s.muted}>计划采样 {planned ?? "未记录"}</div></div>
      <div className={s.metric}><dt>有结果的模型</dt><dd><span className={s.value}>{models.length}</span></dd><div className={s.muted}>覆盖范围以本次检测为准</div></div>
    </dl>
    {incomplete || extractionIncomplete ? <div className={s.scope}><CircleAlert /><span>{incomplete ? "部分采样尚未完成，当前仅统计有效回答。" : ""}{extractionIncomplete ? "品牌榜尚未整理完成，当前排名仅供参考。" : ""}</span></div> : null}
    <div className={s.referenceGrid}>
      <section className={s.panel}>
        <div className={s.panelHeader}><h3>本次品牌覆盖</h3><span className={s.badge}>单次检测</span></div>
        <p className={s.rowNote}>本页为当次检测快照，前后变化请查看项目报告。</p>
        {completed > 0 ? <><div className={s.singleReading}><strong>{rateLabel(aggregated.penetrationRate)}</strong><span>{aggregated.ourMentions} / {completed} 条有效回答提及品牌</span></div><div className={s.split} role="img" aria-label={`${aggregated.ourMentions}条提及，${completed - aggregated.ourMentions}条未提及`}><div className={s.fill} style={{ width: `${Math.max(0, Math.min(1, aggregated.penetrationRate)) * 100}%` }} /></div><div className={s.legend}><span><i className={s.swatch} />已提及 {aggregated.ourMentions} 条</span><span><i className={`${s.swatch} ${s.baseline}`} />未提及 {completed - aggregated.ourMentions} 条</span></div></> : <div className={s.empty}>暂无有效回答</div>}
      </section>
      <section className={s.panel}><ModelPerformance result={result}/></section>
      <section className={s.panel}><QuestionCoverage result={result} rate={completed > 0 ? aggregated.penetrationRate : null}/></section>
      <section className={`${s.panel} ${s.nextPanel}`}><NextActions plans={[next]} derived /></section>
    </div>
    <p className={s.footer}>仅反映本次问题和模型范围内的表现；详细模型回答、信源与同行对比保留在下方。</p>
  </section>
}
