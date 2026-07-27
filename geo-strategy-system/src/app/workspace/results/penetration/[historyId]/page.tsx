import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, ShieldCheck } from "lucide-react"
import { notFound, redirect } from "next/navigation"
import { PenetrationHistoryDetail } from "@/components/reports/penetration-history-panel"
import { getCurrentUser } from "@/lib/auth"
import {
  getPenetrationHistoryViewerPolicy,
  requirePenetrationHistoryAccess,
} from "@/lib/penetration/history-access"
import { getPenetrationHistoryOverviewRecord } from "@/lib/penetration/history-store"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "疑问句检测报告 · 势途 GEO",
  description: "查看指定时间完成的疑问句检测历史快照",
  robots: { index: false, follow: false, noarchive: true },
}

function shanghaiDate(value?: string): string {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

export default async function PenetrationResultPage({
  params,
}: {
  params: Promise<{ historyId: string }>
}) {
  const user = await getCurrentUser()
  if (!user) {
    const { historyId } = await params
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/workspace/results/penetration/${historyId}`)}`)
  }
  if (user.mustChangePassword) {
    redirect(`/forgot-password?email=${encodeURIComponent(user.email)}&managed=1`)
  }

  const { historyId } = await params
  let authorized: Awaited<ReturnType<typeof requirePenetrationHistoryAccess>>
  try {
    authorized = await requirePenetrationHistoryAccess({
      historyId,
      userId: user.id,
      action: "view",
    })
  } catch {
    notFound()
  }
  if (!authorized) notFound()
  const record = await getPenetrationHistoryOverviewRecord(
    authorized.scope.ownerUserId,
    historyId,
  )
  if (!record) notFound()
  const viewerPolicy = await getPenetrationHistoryViewerPolicy({
    userId: user.id,
    access: authorized.access,
    record,
  })
  if (!viewerPolicy.visible) notFound()

  const returnDate = shanghaiDate(record.completedAt || record.createdAt)
  const returnParams = new URLSearchParams({
    clientId: record.clientId,
    module: "feedback",
    date: returnDate,
  })
  if (authorized.access.teamId) {
    returnParams.set("teamId", authorized.access.teamId)
  }
  const returnHref = `/workspace?${returnParams.toString()}`

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#EAF5FF_0%,#F7FBFF_38%,#EDF4FA_100%)]">
      <header className="sticky top-0 z-30 border-b border-white/15 bg-[linear-gradient(100deg,#001D66_0%,#075BDB_52%,#00AEEA_100%)] px-3 py-3 text-white shadow-sm sm:px-6">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3">
          <Link
            href={returnHref}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-semibold transition hover:bg-white/18"
          >
            <ArrowLeft className="h-4 w-4" />
            返回执行日历
          </Link>
          <div className="flex min-w-0 items-center gap-2 text-right">
            <ShieldCheck className="h-4 w-4 shrink-0 text-cyan-200" />
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold">当次检测报告</div>
              <div className="truncate text-[10px] text-cyan-50/65">历史数据已冻结，不会被后续检测覆盖</div>
            </div>
          </div>
        </div>
      </header>
      <PenetrationHistoryDetail
        record={record}
        showRawAnswers={viewerPolicy.canViewRawAnswers}
      />
    </main>
  )
}
