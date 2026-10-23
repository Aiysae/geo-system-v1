import type { Metadata } from "next"
import { notFound } from "next/navigation"
import PublicReportActions from "@/components/client-feedback/public-report-actions"
import SharedPenetrationView from "@/components/penetration/shared-penetration-view"
import { getPenetrationShare } from "@/lib/penetration/share-store"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "AI 检测结果分享",
  description: "疑问句检测结果：品牌在各 AI 模型回答中的提及与排名",
  robots: { index: false, follow: false, noarchive: true },
}

export default async function SharedPenetrationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const share = await getPenetrationShare(token)
  if (!share) notFound()

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#EAF5FF_0%,#F7FBFF_44%,#EAF2F8_100%)] px-3 py-5 sm:px-6 sm:py-8 print:bg-white print:p-0">
      <PublicReportActions />
      <SharedPenetrationView
        clientName={share.clientName}
        ourBrand={share.ourBrand}
        brandAliases={share.brandAliases}
        competitors={share.competitors}
        subjectType={share.subjectType}
        penetration={share.penetration}
        sharedAt={share.createdAt}
      />
    </main>
  )
}
