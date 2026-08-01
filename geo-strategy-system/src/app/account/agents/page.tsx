import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { AgentManager } from "@/components/account/agent-manager"
import { getCurrentUser } from "@/lib/auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "Agent 接入 · 势途 GEO",
  description: "管理 Agent 密钥、客户授权、预算与审计记录",
}

export default async function AgentAccountPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in?redirect_url=/account/agents")
  return <AgentManager userName={user.name} />
}
