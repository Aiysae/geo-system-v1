import type { Metadata } from "next"
import { AuthenticatedAppShell } from "@/components/auth/authenticated-app-shell"
import { parseWorkspaceNavigation } from "@/lib/workspace-navigation"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "势途 GEO 工作台",
  description: "势途 GEO 品牌可见度与生成式搜索增长工作台",
}

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const input = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    const first = Array.isArray(value) ? value[0] : value
    if (first) params.set(key, first)
  }
  return <AuthenticatedAppShell initialNavigation={parseWorkspaceNavigation(params)} />
}
