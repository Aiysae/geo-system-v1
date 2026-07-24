import { redirect } from "next/navigation"
import { Handshake, ShieldCheck } from "lucide-react"
import { AdminHeader } from "@/components/admin/admin-header"
import { ManagedServiceAdminList } from "@/components/admin/managed-service-admin-list"
import SiteFooter from "@/components/site-footer"
import { isAdminUser } from "@/lib/admin"
import { getCurrentUser } from "@/lib/auth"
import { listAllManagedServiceOrders } from "@/lib/managed-services"
import { getPaymentOrder } from "@/lib/payment-orders"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminManagedServicesPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in?redirect_url=/admin/managed-services")
  if (!isAdminUser(user)) return <div className="flex min-h-screen items-center justify-center bg-slate-50"><div className="rounded-lg bg-white p-8 text-center ring-1 ring-slate-200"><ShieldCheck className="mx-auto h-8 w-8 text-rose-500" /><h1 className="mt-4 text-lg font-bold">无权限访问</h1></div></div>
  const orders = await listAllManagedServiceOrders()
  const rows = await Promise.all(orders.map(async order => ({
    ...order,
    payment: order.paymentOrderId ? await getPaymentOrder(order.paymentOrderId) : null,
  })))
  const pending = rows.filter(order => ["pending_payment", "provisioning_failed", "intake_submitted"].includes(order.status)).length
  const active = rows.filter(order => order.status === "active").length

  return <div className="min-h-screen geo-saturated-bg"><AdminHeader title="势途 GEO · 管理后台" subtitle="官方代运营订单与项目交付" icon={<Handshake className="h-5 w-5 text-white" />} active="managed-services" /><main className="mx-auto max-w-7xl px-4 py-6 md:px-8"><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[11px] font-medium uppercase tracking-[.16em] text-slate-400">Managed Services</p><h1 className="mt-1 text-2xl font-bold text-slate-950">代运营服务订单</h1></div><div className="flex gap-2 text-xs"><span className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">待处理 <b className="font-mono text-amber-700">{pending}</b></span><span className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">执行中 <b className="font-mono text-emerald-700">{active}</b></span><span className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">总订单 <b className="font-mono">{rows.length}</b></span></div></div><ManagedServiceAdminList orders={rows} /></main><SiteFooter /></div>
}
