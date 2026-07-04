import { LocalAuthForm } from "@/components/auth/local-auth-form"
import SiteFooter from "@/components/site-footer"

export const dynamic = "force-dynamic"

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>
}) {
  const params = await searchParams
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <LocalAuthForm mode="sign-in" redirectUrl={params.redirect_url} />
      </main>
      <SiteFooter />
    </div>
  )
}
