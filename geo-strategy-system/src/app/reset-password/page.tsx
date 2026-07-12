import Link from "next/link"
import SiteFooter from "@/components/site-footer"
import { PasswordResetConfirmForm } from "@/components/auth/password-reset-confirm-form"

export const dynamic = "force-dynamic"

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const params = await searchParams
  const token = typeof params.token === "string" ? params.token : ""

  return (
    <div className="flex min-h-screen flex-col geo-saturated-bg">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        {token ? (
          <PasswordResetConfirmForm token={token} />
        ) : (
          <div className="w-full max-w-md rounded-2xl bg-white px-7 py-8 text-center shadow-xl ring-1 ring-slate-200">
            <h1 className="text-lg font-bold text-slate-900">重置链接无效</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              请重新提交密码重置申请，或联系管理员获取新的重置链接。
            </p>
            <Link
              href="/forgot-password"
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#1677FF] text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300/40"
            >
              重新申请
            </Link>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  )
}
