import type { Metadata } from "next"
import { notFound } from "next/navigation"
import ClientFeedbackReportView from "@/components/client-feedback/client-feedback-report-view"
import PublicReportActions from "@/components/client-feedback/public-report-actions"
import { getSharedClientFeedbackReport } from "@/lib/client-feedback/store"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "GEO 执行反馈报告",
  description: "客户 GEO 执行进度与效果验证报告",
  robots: { index: false, follow: false, noarchive: true },
}

export default async function SharedFeedbackPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const report = await getSharedClientFeedbackReport(token)
  if (!report) notFound()

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#EAF5FF_0%,#F7FBFF_44%,#EAF2F8_100%)] px-3 py-5 sm:px-6 sm:py-8 print:bg-white print:p-0">
      <PublicReportActions />
      <ClientFeedbackReportView report={report} publicView />
    </main>
  )
}
