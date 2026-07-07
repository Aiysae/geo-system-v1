import { redirect } from "next/navigation"
import AppShell from "@/components/app-shell"
import { getCurrentUser } from "@/lib/auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function HomePage() {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in?redirect_url=/")
  return <AppShell />
}
