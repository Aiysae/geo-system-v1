"use client"

import Image from "next/image"
import Link from "next/link"
import { useState, type FormEvent } from "react"
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  MessageCircle,
  ShieldCheck,
} from "lucide-react"
import type { ManagedServiceOrder } from "@/lib/managed-services"
import { formatYuan } from "@/lib/pricing"
import { RECHARGE_PAYMENT_INFO } from "@/lib/recharge-payment"

const STATUS_LABEL: Record<ManagedServiceOrder["status"], string> = {
  pending_payment: "待付款",
  paid: "已付款",
  provisioning: "正在创建项目",
  awaiting_intake: "待提交资料",
  intake_submitted: "资料已提交",
  active: "执行中",
  paused: "已暂停",
  completed: "已完成",
  canceled: "已取消",
  provisioning_failed: "项目创建待处理",
}

export function ManagedServiceDashboard({ initialOrder }: { initialOrder: ManagedServiceOrder }) {
  const [order, setOrder] = useState(initialOrder)
  const [subjectType, setSubjectType] = useState<"brand" | "person">(order.intake?.subjectType || "brand")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const paid = Boolean(order.paidAt)

  async function submitIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !paid) return
    setPending(true)
    setMessage("")
    const formData = new FormData(event.currentTarget)
    const body = Object.fromEntries(formData.entries())
    body.subjectType = subjectType
    try {
      const response = await fetch(`/api/managed-services/${encodeURIComponent(order.id)}/intake`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await response.json() as { order?: ManagedServiceOrder; error?: string }
      if (!response.ok || !payload.order) throw new Error(payload.error || "资料提交失败")
      setOrder(payload.order)
      setMessage("项目资料已保存，官方团队会据此确认立项。")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "资料提交失败")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F2F7FD] text-slate-900">
      <header className="border-b border-[#CFE4FA] bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/account?tab=services" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#0958D9]"><ArrowLeft className="h-4 w-4" />返回我的主页</Link>
          <Image src="/brand/shitu-lockup-transparent-v2.png" alt="势途 GEO" width={140} height={42} className="h-8 w-auto object-contain" />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <section className="overflow-hidden rounded-lg bg-[linear-gradient(115deg,#001D66,#0958D9_55%,#00B8D9)] p-5 text-white shadow-lg sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-[10px] font-semibold text-cyan-100">专业 GEO 全链路运营</p><h1 className="mt-2 text-xl font-bold sm:text-2xl">{order.intake?.projectName || order.planName}</h1><p className="mt-1 text-xs text-blue-100">服务单号 {order.id}</p></div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-white/12 px-3 py-2 text-xs font-semibold ring-1 ring-white/25"><ShieldCheck className="h-4 w-4" />{STATUS_LABEL[order.status]}</span>
          </div>
        </section>

        <section className="mt-4 grid gap-px overflow-hidden rounded-lg bg-[#D8E7F7] ring-1 ring-[#D8E7F7] sm:grid-cols-4">
          <Metric label="服务套餐" value={order.planName} icon={FileText} />
          <Metric label="订单金额" value={formatYuan(order.priceCents)} icon={CheckCircle2} />
          <Metric label="服务周期" value={`${order.durationMonths} 个月`} icon={CalendarDays} />
          <Metric label="正式起算" value={order.serviceStartsAt ? new Date(order.serviceStartsAt).toLocaleDateString("zh-CN") : "资料确认后立项"} icon={Clock3} />
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
          <section className="rounded-lg border border-[#D8E7F7] bg-white p-5 shadow-sm sm:p-6">
            <div><h2 className="text-base font-bold text-slate-950">项目资料</h2><p className="mt-1 text-xs leading-5 text-slate-500">资料越完整，官方团队越快完成策略确认和正式立项。</p></div>
            {!paid ? <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 ring-1 ring-amber-200">当前订单尚未确认到账。银行转账会由管理员核对，确认后即可提交项目资料。</div> : null}
            <form onSubmit={submitIntake} className={`mt-5 space-y-4 ${paid ? "" : "pointer-events-none opacity-55"}`}>
              <div><label className="text-xs font-semibold text-slate-700">服务主体</label><div className="mt-2 inline-flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-1"><button type="button" onClick={() => setSubjectType("brand")} className={`h-8 rounded-md px-4 text-xs font-semibold ${subjectType === "brand" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-500"}`}>品牌 / 公司</button><button type="button" onClick={() => setSubjectType("person")} className={`h-8 rounded-md px-4 text-xs font-semibold ${subjectType === "person" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-500"}`}>个人 IP</button></div></div>
              <div className="grid gap-4 sm:grid-cols-2"><Field name="subjectName" label={subjectType === "person" ? "姓名" : "品牌 / 公司名称"} required defaultValue={order.intake?.subjectName} /><Field name="projectName" label="项目名称" defaultValue={order.intake?.projectName} placeholder="例如：某品牌 GEO 全链路运营" /><Field name="aliases" label="别名" defaultValue={order.intake?.aliases.join("、")} placeholder="多个别名用逗号分隔" /><Field name="industry" label="行业" defaultValue={order.intake?.industry} /><Field name="region" label="重点区域" defaultValue={order.intake?.region} placeholder="全国、省、市或海外市场" /><Field name="website" label="官方网站" defaultValue={order.intake?.website} placeholder="https://" /></div>
              <Area name="platformLinks" label="已有平台与资料链接" defaultValue={order.intake?.platformLinks.join("\n")} placeholder="官网、公众号、媒体报道、短视频主页等，每行一个" />
              <Area name="coreOffer" label="核心产品或服务" defaultValue={order.intake?.coreOffer} />
              <Area name="advantages" label="核心优势与可佐证资料" defaultValue={order.intake?.advantages} placeholder="资质、参数、案例、服务能力、公开信源等" />
              <Area name="competitors" label="主要竞品" defaultValue={order.intake?.competitors} />
              <Area name="goals" label="项目目标" defaultValue={order.intake?.goals} placeholder="希望在哪些问题、模型和区域获得怎样的变化" />
              <Area name="prohibitedClaims" label="禁用表述与合规边界" defaultValue={order.intake?.prohibitedClaims} />
              <div className="grid gap-4 sm:grid-cols-2"><Field name="contactName" label="项目联系人" defaultValue={order.intake?.contactName} /><Field name="contactPhone" label="联系电话" defaultValue={order.intake?.contactPhone} /><Field name="contactWechat" label="联系微信" defaultValue={order.intake?.contactWechat} /><Field name="preferredStartDate" label="期望启动日期" type="date" defaultValue={order.intake?.preferredStartDate} /></div>
              <Area name="notes" label="其他说明" defaultValue={order.intake?.notes} />
              {message ? <p className={`rounded-lg px-3 py-2 text-xs ring-1 ${message.includes("失败") || message.includes("请") ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>{message}</p> : null}
              <button type="submit" disabled={pending || !paid} className="flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEF] text-sm font-semibold text-white disabled:opacity-50">{pending ? <><Loader2 className="h-4 w-4 animate-spin" />保存中</> : order.intake ? "更新项目资料" : "提交项目资料"}</button>
            </form>
          </section>

          <aside className="space-y-4">
            <section className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
              <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><MessageCircle className="h-4 w-4 text-emerald-600" />项目客服</div>
              <Image src={RECHARGE_PAYMENT_INFO.serviceWechatQrImageUrl || "/recharge/service-wechat.png"} alt="项目客服微信二维码" width={260} height={260} className="mx-auto mt-3 h-auto w-full max-w-[210px] rounded-lg bg-white object-contain" />
              <p className="mt-3 text-center font-mono text-xs font-semibold text-slate-900">微信号：{RECHARGE_PAYMENT_INFO.serviceWechatId}</p>
              <p className="mt-2 text-center text-[11px] leading-5 text-slate-500">合同、发票、资料交接和启动安排均可联系项目客服。</p>
            </section>
            <section className="rounded-lg border border-[#D8E7F7] bg-white p-4"><h3 className="text-sm font-bold text-slate-900">交付流程</h3><ol className="mt-3 space-y-3 text-xs text-slate-600"><Flow number="1" text="确认到账并创建专属项目" done={paid} /><Flow number="2" text="提交并确认项目资料" done={Boolean(order.intakeSubmittedAt)} /><Flow number="3" text="确定执行日期并正式立项" done={Boolean(order.serviceStartsAt)} /><Flow number="4" text="持续执行、监测和周期复盘" done={order.status === "active" || order.status === "completed"} /></ol></section>
          </aside>
        </div>
      </main>
    </div>
  )
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof FileText }) { return <div className="bg-white p-4"><div className="flex items-center gap-1.5 text-[10px] text-slate-500"><Icon className="h-3.5 w-3.5 text-[#1677FF]" />{label}</div><p className="mt-2 truncate text-sm font-bold text-slate-900" title={value}>{value}</p></div> }
function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) { return <label className="block"><span className="text-xs font-semibold text-slate-700">{label}</span><input {...props} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15" /></label> }
function Area({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) { return <label className="block"><span className="text-xs font-semibold text-slate-700">{label}</span><textarea {...props} rows={3} className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15" /></label> }
function Flow({ number, text, done }: { number: string; text: string; done: boolean }) { return <li className="flex items-center gap-2"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{done ? "✓" : number}</span>{text}</li> }
