import { LocalAuthForm } from "@/components/auth/local-auth-form"

export const dynamic = "force-dynamic"

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>
}) {
  const params = await searchParams
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30 px-4">
      <LocalAuthForm mode="sign-in" redirectUrl={params.redirect_url} />
    </div>
  )
}
