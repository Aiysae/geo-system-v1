import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "客户账号管理 | 势途 GEO",
  description: "为客户面板创建受限的客户专属登录账号",
}

export default async function ClientAccountsPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in?redirect_url=/client-accounts")
  redirect("/account?tab=clients")
}
