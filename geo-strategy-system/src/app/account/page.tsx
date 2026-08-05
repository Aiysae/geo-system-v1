import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { AccountCenter } from "@/components/account/account-center"
import { getCurrentUser } from "@/lib/auth"
import { isAdminUser } from "@/lib/admin"
import { mergeBillingRechargeRecords } from "@/lib/billing-records"
import {
  encodeClientAccessRef,
  listClientCatalog,
  type ClientCatalogEntry,
} from "@/lib/client-access-catalog"
import { getClientAccountLink, getWorkspaceAccountAccess } from "@/lib/client-accounts"
import { listCreditLedgerForUser } from "@/lib/credit-ledger"
import { getCreditBalanceSnapshot } from "@/lib/credits"
import { getMembershipWithPaymentRepair } from "@/lib/membership"
import { listManagedServiceOrdersForUser } from "@/lib/managed-services"
import { listPaymentOrdersForUser } from "@/lib/payment-orders"
import { getFeaturePrice } from "@/lib/pricing"
import { listRequestsForUser } from "@/lib/recharge"
import { hasUnlimitedCreditAccess } from "@/lib/with-credits"
import { listAdminPaymentRequestsForUser } from "@/lib/admin-payment-requests"
import { listWorkspaceClientSummaries } from "@/lib/workspace-store"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "我的主页 · 势途 GEO",
  description: "管理客户、报告、积分、VIP 权益和账号信息",
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const params = await searchParams
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in?redirect_url=/account")
  if (user.mustChangePassword) {
    redirect(`/forgot-password?email=${encodeURIComponent(user.email)}&managed=1`)
  }

  const [membership, credits, access, rechargeRequests, paymentOrders, ledger, managedServices, adminPaymentRequests] = await Promise.all([
    getMembershipWithPaymentRepair(user.id),
    getCreditBalanceSnapshot(user.id),
    getWorkspaceAccountAccess(user.id),
    listRequestsForUser(user.id, 80),
    listPaymentOrdersForUser(user.id, 80),
    listCreditLedgerForUser(user.id, 120),
    listManagedServiceOrdersForUser(user.id, 100),
    listAdminPaymentRequestsForUser(user.id, 80),
  ])

  const link = access.mode === "client" ? await getClientAccountLink(user.id) : null
  let clients: ClientCatalogEntry[]
  if (link) {
    const summary = (await listWorkspaceClientSummaries(link.dataOwnerUserId))
      .find(client => client.id === link.clientId)
    clients = summary ? [{
      ...summary,
      accessRef: encodeClientAccessRef({
        sourceType: link.sourceType,
        dataOwnerUserId: link.dataOwnerUserId,
        clientId: link.clientId,
        teamId: link.teamId,
      }),
      sourceType: link.sourceType,
      teamId: link.teamId,
      dataOwnerUserId: link.dataOwnerUserId,
      parentUserId: link.parentUserId,
      canEdit: false,
      canDelete: false,
      canManageClientAccount: false,
      clientAccount: {
        userId: link.userId,
        status: link.status,
        sourceStatus: access.status === "active" ? "active" : "revoked",
      },
    }] : []
  } else {
    clients = await listClientCatalog(user.id)
  }

  return (
    <AccountCenter
      key={`account-${typeof params.tab === "string" ? params.tab : "overview"}`}
      initialTab={typeof params.tab === "string" ? params.tab : undefined}
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      }}
      membership={membership}
      credits={credits}
      access={access}
      clients={clients}
      rechargeRecords={mergeBillingRechargeRecords(rechargeRequests, paymentOrders, 80, adminPaymentRequests)}
      ledger={ledger}
      isAdmin={isAdminUser(user)}
      unlimitedCredits={hasUnlimitedCreditAccess(user)}
      whiteLabelCredits={getFeaturePrice("reportCustomBranding").credits}
      managedServices={managedServices.map(order => ({
        id: order.id,
        planName: order.planName,
        projectName: order.intake?.projectName,
        status: order.status,
        priceCents: order.priceCents,
        durationMonths: order.durationMonths,
        createdAt: order.createdAt,
      }))}
    />
  )
}
