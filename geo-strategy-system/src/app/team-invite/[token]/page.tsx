import type { Metadata } from "next"
import { TeamInvitePageClient } from "@/components/team/team-invite-page-client"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "加入团队 · 势途 GEO",
  description: "接受势途 GEO 团队邀请",
}

export default async function TeamInvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <TeamInvitePageClient token={token} />
}
