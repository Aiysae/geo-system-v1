import type { Metadata } from "next"
import { Suspense } from "react"
import TutorialGate from "@/components/tutorial/tutorial-gate"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "新手体验教程 | 势途 GEO",
  description: "零等待体验势途 GEO 从检测、诊断、策略到交付的完整成果。",
}

export default function TutorialPage() {
  return (
    <Suspense fallback={<TutorialLoading />}>
      <TutorialGate />
    </Suspense>
  )
}

function TutorialLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F3F8FF] px-4">
      <div className="rounded-lg border border-[#CFE0F2] bg-white px-6 py-5 text-sm text-slate-600 shadow-lg">
        正在准备体验教程...
      </div>
    </main>
  )
}
