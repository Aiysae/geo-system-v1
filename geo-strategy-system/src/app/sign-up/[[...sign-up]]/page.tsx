import { redirect } from "next/navigation"
import { LocalAuthForm } from "@/components/auth/local-auth-form"
import SiteFooter from "@/components/site-footer"
import { getCurrentUser, isSignUpInviteRequired } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>
}) {
  const params = await searchParams
  const user = await getCurrentUser()
  if (user) redirect("/")

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <LocalAuthForm
          mode="sign-up"
          redirectUrl={params.redirect_url}
          inviteRequired={isSignUpInviteRequired()}
        />
      </main>
      <SiteFooter />
    </div>
  )
}
