import Link from "next/link"
import type { ReactNode } from "react"
import {
  BarChart3,
  Bot,
  CreditCard,
  Handshake,
  KeyRound,
  Menu,
  ReceiptText,
  UsersRound,
  Workflow,
} from "lucide-react"
import { AdminRechargeNotifier } from "@/components/admin/admin-recharge-notifier"

export type AdminSection = "users" | "recharge" | "managed-services" | "ai-models" | "metrics" | "ledger" | "password-resets"

type AdminHeaderProps = {
  title: string
  subtitle: string
  icon: ReactNode
  active: AdminSection
  pendingPasswordResetCount?: number
}

const ADMIN_LINKS = [
  { key: "users", href: "/admin", label: "用户管理", icon: UsersRound },
  { key: "recharge", href: "/admin/recharge", label: "充值管理", icon: CreditCard },
  { key: "managed-services", href: "/admin/managed-services", label: "代运营订单", icon: Handshake },
  { key: "ai-models", href: "/admin/ai-models", label: "AI 模型", icon: Bot },
  { key: "metrics", href: "/admin/metrics", label: "运营监控", icon: BarChart3 },
  { key: "ledger", href: "/admin/ledger", label: "积分流水", icon: ReceiptText },
  { key: "password-resets", href: "/admin/password-resets", label: "密码重置", icon: KeyRound },
] as const

function AdminNavLinks({
  active,
  pendingPasswordResetCount = 0,
  mobile = false,
}: {
  active: AdminSection
  pendingPasswordResetCount?: number
  mobile?: boolean
}) {
  return (
    <>
      {ADMIN_LINKS.map(item => {
        const Icon = item.icon
        const selected = item.key === active
        const pending = item.key === "password-resets" ? pendingPasswordResetCount : 0
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={selected ? "page" : undefined}
            className={mobile
              ? `flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${selected ? "bg-[#E6F4FF] text-[#0958D9]" : "text-slate-700 hover:bg-slate-50"}`
              : `geo-utility-header-action inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition ${selected ? "ring-1 ring-[#69B1FF]" : ""}`}
          >
            <span className="inline-flex items-center gap-2">
              <Icon className={mobile ? "h-4 w-4" : "h-3.5 w-3.5"} />
              {item.label}
            </span>
            {pending > 0 ? (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-700">
                {pending}
              </span>
            ) : null}
          </Link>
        )
      })}
      <Link
        href="/workspace"
        className={mobile
          ? "flex min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          : "geo-utility-header-action inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition"}
      >
        <Workflow className={mobile ? "h-4 w-4" : "h-3.5 w-3.5"} />
        返回工作台
      </Link>
    </>
  )
}

export function AdminHeader({
  title,
  subtitle,
  icon,
  active,
  pendingPasswordResetCount = 0,
}: AdminHeaderProps) {
  return (
    <header className="geo-utility-header sticky top-0 z-30 border-b backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-8 md:py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="geo-utility-header-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="geo-utility-header-title geo-brand-title truncate text-sm sm:text-lg">
              {title}
            </div>
            <div className="geo-utility-header-subtitle mt-0.5 truncate text-[11px]">{subtitle}</div>
          </div>
        </div>

        <nav className="hidden items-center gap-1.5 lg:flex" aria-label="后台导航">
          <AdminNavLinks active={active} pendingPasswordResetCount={pendingPasswordResetCount} />
        </nav>

        <AdminRechargeNotifier variant="admin" />

        <details className="group relative shrink-0 lg:hidden">
          <summary
            aria-label="打开后台导航"
            className="geo-utility-header-action flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg transition [&::-webkit-details-marker]:hidden"
          >
            <Menu className="h-5 w-5" />
          </summary>
          <nav
            className="absolute right-0 top-12 z-50 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/20"
            aria-label="移动端后台导航"
          >
            <AdminNavLinks
              active={active}
              pendingPasswordResetCount={pendingPasswordResetCount}
              mobile
            />
          </nav>
        </details>
      </div>
    </header>
  )
}
