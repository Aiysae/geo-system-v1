import SiteFooter from "@/components/site-footer"
import { PasswordResetRequestForm } from "@/components/auth/password-reset-request-form"

export const dynamic = "force-dynamic"

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <PasswordResetRequestForm />
      </main>
      <SiteFooter />
    </div>
  )
}
