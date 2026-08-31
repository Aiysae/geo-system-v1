import { notFound, redirect } from "next/navigation"
import {
  Building2,
  CalendarClock,
  Crown,
  ReceiptText,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react"
import { isAdminUser } from "@/lib/admin"
import { getCurrentUser, getUserById, listUsers } from "@/lib/auth"
import { getCreditBalanceSnapshot } from "@/lib/credits"
import {
  getMembershipWithPaymentRepair,
  membershipTierLabel,
} from "@/lib/membership"
import { hasUnlimitedCreditAccess } from "@/lib/with-credits"
import { listCreditLedgerForUser, type CreditLedgerEntry } from "@/lib/credit-ledger"
import { formatYuan, getFeaturePrice } from "@/lib/pricing"
import { listRequestsForUser, type RechargeRequest } from "@/lib/recharge"
import {
  getClientAccountLink,
  getRecoverableClientAccountLink,
  listClientAccountAudit,
  type ClientAccountAuditAction,
} from "@/lib/client-accounts"
import { listWorkspaceClients } from "@/lib/workspace-store"
import SiteFooter from "@/components/site-footer"
import { CreditsAdjustForm } from "../../credits-adjust-form"
import { UserStatusForm } from "../../user-status-form"
import { AdminHeader } from "@/components/admin/admin-header"
import { ClientAccountForm } from "../../client-account-form"
import { getAdminInternalUser } from "@/lib/admin-internal-dataset"
import { AdminInternalUserDetail } from "./internal-user-detail"

export const dynamic = "force-dynamic"
export const revalidate = 0

type PageProps = {
  params: Promise<{ userId: string }>
}

const RECHARGE_LABEL: Record<RechargeRequest["status"], string> = {
  pending: "待审批",
  approved: "已到账",
  rejected: "已拒绝",
}

const RECHARGE_CLASS: Record<RechargeRequest["status"], string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
}

const LEDGER_LABEL: Record<CreditLedgerEntry["type"], string> = {
  trial_grant: "试用赠送",
  bootstrap_grant: "历史补足",
  recharge_requested: "充值申请",
  recharge_approved: "充值到账",
  recharge_rejected: "充值拒绝",
  admin_adjust: "管理员调整",
  usage_reserved: "功能扣费",
  usage_refund: "积分退回",
  usage_extra: "超额结算",
  client_monthly_grant: "客户月度额度",
  client_monthly_adjust: "客户额度调整",
}

const CLIENT_AUDIT_LABEL: Record<ClientAccountAuditAction, string> = {
  linked: "创建授权",
  updated: "更新授权",
  activated: "恢复授权",
  suspended: "暂停授权",
  permissions_updated: "更新查看权限",
  source_revoked: "来源授权失效",
  unlinked: "解除授权",
}

function formatTime(value?: number | string): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

function ledgerLabel(entry: CreditLedgerEntry): string {
  if (entry.description) return entry.description
  if (entry.featureKey) return getFeaturePrice(entry.featureKey).label
  return LEDGER_LABEL[entry.type] || "积分变动"
}

export default async function AdminUserDetailPage({ params }: PageProps) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect("/sign-in?redirect_url=/admin")

  if (!isAdminUser(currentUser)) {
    return (
      <div className="min-h-screen flex items-center justify-center geo-saturated-bg px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-200">
            <ShieldCheck className="h-7 w-7 text-rose-500" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">无权限访问</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">该页面仅限管理员访问。</p>
        </div>
      </div>
    )
  }

  const { userId } = await params
  const internalUser = getAdminInternalUser(userId)
  if (internalUser) {
    return <AdminInternalUserDetail record={internalUser} />
  }
  const user = await getUserById(userId)
  if (!user) notFound()

  const [creditBalance, recharges, ledger, membership, clientLink, clientAudit, allUsers, recoverableLink] = await Promise.all([
    getCreditBalanceSnapshot(user.id),
    listRequestsForUser(user.id, 100),
    listCreditLedgerForUser(user.id, 150),
    getMembershipWithPaymentRepair(user.id),
    getClientAccountLink(user.id),
    listClientAccountAudit(user.id, 12),
    listUsers(),
    getRecoverableClientAccountLink(user.id),
  ])
  const ownerRows = await Promise.all(
    allUsers
      .filter(owner => owner.id !== user.id)
      .map(async owner => ({
        owner,
        clients: await listWorkspaceClients(owner.id),
      })),
  )
  const clientOptions = ownerRows.flatMap(({ owner, clients }) =>
    clients.map(record => ({
      value: `${owner.id}::${record.client.id}`,
      clientName: record.client.name,
      industry: record.client.industry || "",
      ownerName: owner.name,
      ownerEmail: owner.email,
    })),
  )
  const credits = creditBalance.total
  const totalRechargeCredits = recharges
    .filter(item => item.status === "approved")
    .reduce((sum, item) => sum + (item.credits ?? item.amount), 0)
  const totalUsageCredits = ledger
    .filter(item => item.type === "usage_reserved" || item.type === "usage_extra")
    .reduce((sum, item) => sum + Math.abs(item.delta), 0)
  const unlimited = hasUnlimitedCreditAccess(user)

  return (
    <div className="min-h-screen geo-saturated-bg">
      <AdminHeader
        title={user.name}
        subtitle={user.email}
        icon={<UserRound className="h-5 w-5 text-white" />}
        active="users"
      />

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-8 md:py-8">
        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <WalletCards className="h-3.5 w-3.5 text-amber-500" />
              当前积分
            </div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{unlimited ? "无限" : credits}</div>
            {unlimited && <div className="mt-1 font-mono text-[10px] text-slate-400">账面余额 {credits}</div>}
            {!unlimited && clientLink ? (
              <div className="mt-1 text-[10px] leading-4 text-slate-400">
                本月额度 {creditBalance.monthly} · 充值积分 {creditBalance.permanent}
              </div>
            ) : null}
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-emerald-700">累计充值到账</div>
            <div className="mt-2 font-mono text-3xl font-bold text-emerald-700">{totalRechargeCredits}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-orange-700">累计功能扣费</div>
            <div className="mt-2 font-mono text-3xl font-bold text-orange-700">{totalUsageCredits}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-slate-500">账号状态</div>
            <div className="mt-2">
              <span className="inline-flex rounded-lg bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                {user.status === "active" ? "正常" : "停用"}
              </span>
              <span className="ml-2 inline-flex rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-100">
                {user.role === "admin" ? "管理员" : "用户"}
              </span>
              <span className={`ml-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ring-1 ${
                membership.active
                  ? "bg-amber-50 text-amber-700 ring-amber-200"
                  : "bg-slate-50 text-slate-500 ring-slate-200"
              }`}>
                <Crown className="h-3 w-3" />
                {membershipTierLabel(membership.tier)}
              </span>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Building2 className="h-4 w-4 text-[#1677FF]" />
                客户专属账号授权
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                将该登录账号绑定到一个现有客户面板；每个自然月自动刷新专属检测额度，不结转到下月。
              </p>
            </div>
            {clientLink ? (
              <span className={`inline-flex w-fit rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${
                clientLink.status === "active"
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-amber-50 text-amber-700 ring-amber-200"
              }`}>
                {clientLink.status === "active" ? "专属账号正常" : "专属账号已暂停"}
              </span>
            ) : (
              <span className="inline-flex w-fit rounded-lg bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
                普通账号
              </span>
            )}
          </div>
          <ClientAccountForm
            userId={user.id}
            options={clientOptions}
            currentLink={clientLink ? {
              ownerUserId: clientLink.ownerUserId,
              clientId: clientLink.clientId,
              clientName: clientLink.clientName,
              monthlyCredits: clientLink.monthlyCredits,
              status: clientLink.status,
            } : null}
            recoverableLink={recoverableLink ? {
              ownerUserId: recoverableLink.ownerUserId,
              clientId: recoverableLink.clientId,
              clientName: recoverableLink.clientName,
              monthlyCredits: recoverableLink.monthlyCredits,
              status: recoverableLink.status,
            } : null}
            disabled={isAdminUser(user)}
          />
          {clientAudit.length > 0 ? (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <CalendarClock className="h-3.5 w-3.5 text-[#1677FF]" />
                最近授权记录
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {clientAudit.slice(0, 6).map(entry => (
                  <div key={entry.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs ring-1 ring-slate-100">
                    <div className="font-medium text-slate-700">
                      {CLIENT_AUDIT_LABEL[entry.action]}
                      {entry.after?.clientName || entry.before?.clientName
                        ? ` · ${entry.after?.clientName || entry.before?.clientName}`
                        : ""}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-400">
                      {formatTime(entry.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ShieldCheck className="h-4 w-4 text-[#1677FF]" />
            账号管理
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">
                {clientLink ? "充值 / 永久积分调整" : "积分手动调整"}
              </div>
              <CreditsAdjustForm userId={user.id} disabled={unlimited} />
              {clientLink ? (
                <p className="mt-2 text-[10px] leading-4 text-slate-400">
                  此处只调整可长期保留的充值积分，不改变每月专属额度。
                </p>
              ) : null}
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">账号状态</div>
              <UserStatusForm userId={user.id} status={user.status} />
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
            <div>用户 ID：<span className="break-all font-mono text-slate-600">{user.id}</span></div>
            <div>注册时间：{formatTime(user.createdAt)}</div>
            <div>最近登录：{formatTime(user.lastLoginAt)}</div>
          </div>
          {membership.active ? (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              {membershipTierLabel(membership.tier)} 激活时间：{formatTime(membership.activatedAt)}；累计实际充值 ¥{(membership.paidCents / 100).toFixed(2)}；来源：{membership.source === "payment" ? "真实充值到账" : "管理员授权"}。
            </div>
          ) : null}
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ReceiptText className="h-4 w-4 text-[#1677FF]" />
                充值记录
              </h2>
            </div>
            {recharges.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">暂无充值记录</div>
            ) : (
              <div className="md:overflow-x-auto">
                <table className="admin-responsive-table w-full min-w-[960px] text-left">
                  <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3">套餐</th>
                      <th className="px-5 py-3">订单号</th>
                      <th className="px-5 py-3">金额</th>
                      <th className="px-5 py-3">积分</th>
                      <th className="px-5 py-3">付款核对信息</th>
                      <th className="px-5 py-3">状态</th>
                      <th className="px-5 py-3">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recharges.map(record => (
                      <tr key={record.id} className="border-t border-slate-100 text-sm">
                        <td data-label="套餐" className="px-5 py-3 font-medium text-slate-900">{record.packageName || "历史充值申请"}</td>
                        <td data-label="订单号" className="px-5 py-3 font-mono text-xs text-slate-500">
                          {record.paymentOutTradeNo || record.paymentOrderId || "-"}
                        </td>
                        <td data-label="金额" className="px-5 py-3 font-mono text-slate-700">
                          {record.priceCents ? formatYuan(record.priceCents) : "-"}
                        </td>
                        <td data-label="积分" className="px-5 py-3 font-mono font-semibold text-slate-900">+{record.credits ?? record.amount}</td>
                        <td data-label="付款核对信息" className="px-5 py-3 text-xs leading-5 text-slate-600">
                          {record.paymentReference || record.payerName || record.contact ? (
                            <>
                              {record.payerName && <div>付款人：{record.payerName}</div>}
                              {record.paymentReference && <div>凭证：{record.paymentReference}</div>}
                              {record.contact && <div>联系：{record.contact}</div>}
                            </>
                          ) : (
                            <span className="text-slate-400">未填写</span>
                          )}
                        </td>
                        <td data-label="状态" className="px-5 py-3">
                          <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-medium ring-1 ${RECHARGE_CLASS[record.status]}`}>
                            {RECHARGE_LABEL[record.status]}
                          </span>
                        </td>
                        <td data-label="时间" className="px-5 py-3 text-xs text-slate-500">{formatTime(record.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">消费流水</h2>
            </div>
            {ledger.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">暂无消费流水</div>
            ) : (
              <div className="md:overflow-x-auto">
                <table className="admin-responsive-table w-full min-w-[720px] text-left">
                  <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3">时间</th>
                      <th className="px-5 py-3">类型</th>
                      <th className="px-5 py-3">说明</th>
                      <th className="px-5 py-3">变动</th>
                      <th className="px-5 py-3">余额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map(entry => (
                      <tr key={entry.id} className="border-t border-slate-100 text-sm">
                        <td data-label="时间" className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatTime(entry.createdAt)}</td>
                        <td data-label="类型" className="px-5 py-3 text-slate-600">{LEDGER_LABEL[entry.type]}</td>
                        <td data-label="说明" className="px-5 py-3 text-slate-900">{ledgerLabel(entry)}</td>
                        <td data-label="变动" className={`px-5 py-3 font-mono font-semibold ${entry.delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                        </td>
                        <td data-label="余额" className="px-5 py-3 font-mono text-slate-700">
                          {typeof entry.balanceAfter === "number" ? entry.balanceAfter : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
