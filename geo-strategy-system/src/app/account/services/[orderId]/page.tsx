import { notFound, redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { isAdminUser } from "@/lib/admin"
import {
  canAccessManagedServiceOrder,
  getManagedServiceOrder,
} from "@/lib/managed-services"
import { ManagedServiceDashboard } from "@/components/managed-services/managed-service-dashboard"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ManagedServiceOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const user = await getCurrentUser()
  const { orderId } = await params
  if (!user) redirect(`/sign-in?redirect_url=${encodeURIComponent(`/account/services/${orderId}`)}`)
  const order = await getManagedServiceOrder(orderId)
  if (!order || (!canAccessManagedServiceOrder(order, user.id) && !isAdminUser(user))) notFound()
  return <ManagedServiceDashboard initialOrder={order} />
}
