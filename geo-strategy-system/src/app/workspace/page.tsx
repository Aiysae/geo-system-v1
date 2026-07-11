import type { Metadata } from "next"
import { AuthenticatedAppShell } from "@/components/auth/authenticated-app-shell"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "势途 GEO 工作台",
  description: "势途 GEO 品牌可见度与生成式搜索增长工作台",
}

export default function WorkspacePage() {
  return <AuthenticatedAppShell />
}
