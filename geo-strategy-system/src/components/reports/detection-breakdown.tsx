import { CircleAlert, ArrowUpRight } from "lucide-react"
import type { PenetrationResult } from "@/types"
import ModelAvatar from "@/components/model-avatar"
import { MODEL_LABELS } from "@/lib/model-labels"
import s from "./effect-dashboard.module.css"

export function ModelPerformance({ result, message }: { result?: PenetrationResult | null; message?: string }) {
  const models = result?.aggregated.perModelRate.filter(item => item.total > 0).sort((a,b) => b.rate - a.rate) ?? []
  const lowest = models.at(-1)
  return <>
    <div className={s.panelHeader}><h3>各模型表现</h3><span className={s.badge}>品牌被提及率</span></div>
    {models.length ? <div className={s.modelRows}>{models.map(model => <div key={model.model} className={s.modelRow}>
      <div className={s.modelName}><ModelAvatar model={model.model} /><span>{MODEL_LABELS[model.model]}</span></div>
      <div><div className={s.track}><div className={`${s.fill} ${models.length > 1 && model.rate === lowest?.rate && lowest.rate < models[0].rate ? s.amber : ""}`} style={{width:`${Math.max(0,Math.min(1,model.rate))*100}%`}} /></div><small>{model.mentions} / {model.total} 条回答提及</small></div>
      <strong>{(model.rate * 100).toFixed(1)}%</strong>
    </div>)}</div> : <div className={s.empty}>{message || "此报告未提供逐模型明细"}</div>}
    <div className={s.insight}><CircleAlert size={16} /><span>{models.length === 1 ? "仅有 1 个模型结果，暂不做跨模型比较" : lowest ? `最低提及率：${MODEL_LABELS[lowest.model]} ${(lowest.rate*100).toFixed(1)}% · 仅比较本次样本` : "有可查看的检测记录后展示模型对比"}</span></div>
  </>
}

export function QuestionCoverage({ result, rate, message }: { result?: PenetrationResult | null; rate: number | null; message?: string }) {
  const missed = result?.aggregated.missedQuestions ?? []
  return <>
    <div className={s.panelHeader}><h3>问题覆盖缺口</h3><span className={s.chartKey}><i />已提及 <i className={s.keyMuted} />未提及</span></div>
    <p className={s.rowNote}>按有效回答统计 · 未提供分类提及率时不推算分类结果</p>
    {rate !== null ? <div className={s.coverageRow}><b>全部回答</b><div className={s.track}><div className={s.fill} style={{width:`${Math.max(0,Math.min(1,rate))*100}%`}} /></div><strong>{(rate*100).toFixed(1)}%</strong></div> : <div className={s.empty}>暂无有效回答</div>}
    <div className={s.insight}><CircleAlert size={16}/><span>{rate !== null ? `${((1-rate)*100).toFixed(1)}% 的有效回答未提及品牌` : "等待检测结果"}{result ? ` · ${missed.length} 个问题未被任一模型提及` : ""}</span></div>
    {missed.length ? <><ul className={s.missed}>{missed.slice(0,2).map((q,i)=><li key={i}><ArrowUpRight/><span>{q}</span></li>)}</ul>{missed.length>2 ? <details className={s.details}><summary>查看其余 {missed.length-2} 个问题</summary><ul>{missed.slice(2).map((q,i)=><li key={i}>{q}</li>)}</ul></details> : null}</> : <p className={s.note}>{result ? "本次未发现完全缺失提及的问题，继续关注不同模型的回答差异。" : message || "此报告未提供具体问题明细"}</p>}
  </>
}
