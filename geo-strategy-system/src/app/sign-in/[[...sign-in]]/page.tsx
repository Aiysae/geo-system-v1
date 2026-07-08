import { redirect } from "next/navigation"
import { LocalAuthForm } from "@/components/auth/local-auth-form"
import SiteFooter from "@/components/site-footer"
import { getCurrentUser } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>
}) {
  const params = await searchParams
  const user = await getCurrentUser()
  if (user) redirect("/")

  return (
    <div className="min-h-screen flex flex-col geo-saturated-bg">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <LocalAuthForm mode="sign-in" redirectUrl={params.redirect_url} />
      </main>
      <SiteFooter />
    </div>
  )
}
