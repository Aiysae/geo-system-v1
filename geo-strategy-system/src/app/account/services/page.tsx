import Image from "next/image"
import Link from "next/link"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { ArrowLeft, ArrowRight, CalendarDays, ShieldCheck } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { listManagedServiceOrdersForUser } from "@/lib/managed-services"
import { formatYuan } from "@/lib/pricing"
import { ManagedServiceCard } from "@/components/managed-services/managed-service-card"
import { ManagedServicePaymentReturn } from "@/components/managed-services/managed-service-payment-return"

export const dynamic = "force-dynamic"
export const revalidate = 0

const STATUS: Record<string, string> = {
  pending_payment: "待付款",
  paid: "已付款",
  provisioning: "正在创建项目",
  awaiting_intake: "待提交资料",
  intake_submitted: "资料已提交",
  active: "执行中",
  paused: "已暂停",
  completed: "已完成",
  canceled: "已取消",
  provisioning_failed: "待人工处理",
}

export default async function ManagedServicesPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in?redirect_url=/account/services")
  const orders = await listManagedServiceOrdersForUser(user.id)

  return <div className="min-h-screen bg-[#F2F7FD]">
    <header className="border-b border-[#CFE4FA] bg-white"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6"><Link href="/account?tab=services" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#0958D9]"><ArrowLeft className="h-4 w-4" />我的主页</Link><Image src="/brand/shitu-lockup-transparent-v2.png" alt="势途 GEO" width={140} height={42} className="h-8 w-auto object-contain" /></div></header>
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <Suspense><ManagedServicePaymentReturn /></Suspense>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-semibold uppercase text-[#1677FF]">Managed GEO Service</p><h1 className="mt-1 text-2xl font-bold text-slate-950">我的官方代运营项目</h1><p className="mt-1 text-xs text-slate-500">查看付款、资料、立项与执行状态。</p></div></div>
      <div className="mt-5"><ManagedServiceCard /></div>
      {orders.length ? <section className="mt-5 grid gap-3 sm:grid-cols-2">{orders.map(order => <Link key={order.id} href={`/account/services/${encodeURIComponent(order.id)}`} className="group rounded-lg border border-[#D8E7F7] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#69B1FF] hover:shadow-md"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-950">{order.intake?.projectName || order.planName}</p><p className="mt-1 font-mono text-[10px] text-slate-400">{order.id}</p></div><span className="shrink-0 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold text-[#0958D9] ring-1 ring-blue-100">{STATUS[order.status] || order.status}</span></div><div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-slate-500"><span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-[#1677FF]" />{formatYuan(order.priceCents)}</span><span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-cyan-600" />{order.durationMonths} 个月</span></div><span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#0958D9]">查看项目<ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span></Link>)}</section> : <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">尚未购买官方代运营套餐</div>}
    </main>
  </div>
}
