import SiteFooter from "@/components/site-footer"
import { PasswordResetRequestForm } from "@/components/auth/password-reset-request-form"

export const dynamic = "force-dynamic"

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email = "" } = await searchParams
  return (
    <div className="flex min-h-screen flex-col geo-saturated-bg">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <PasswordResetRequestForm initialEmail={email} />
      </main>
      <SiteFooter />
    </div>
  )
}
