"use client"

import Image from "next/image"
import Link from "next/link"
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react"
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  Crown,
  FileClock,
  FileText,
  Gem,
  History,
  Handshake,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Mail,
  Menu,
  PencilLine,
  Plus,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react"
import { InvoiceSupportButton } from "@/components/billing/invoice-support-button"
import { ClientAccountDialog } from "@/components/accounts/client-account-dialog"
import { ClientKnowledgeBaseDialog } from "@/components/knowledge/client-knowledge-base-dialog"
import { RechargeButton } from "@/components/credits/recharge-button"
import { ManagedServiceCard } from "@/components/managed-services/managed-service-card"
import { UserNotificationCenter } from "@/components/notifications/user-notification-center"
import ReportHistoryDialog from "@/components/reports/report-history-dialog"
import SiteFooter from "@/components/site-footer"
import { TeamCenter } from "@/components/team/team-center"
import type { BillingRechargeRecord, BillingRechargeStatus } from "@/lib/billing-records"
import type { CreditLedgerEntry } from "@/lib/credit-ledger"
import {
  FREE_MEMBERSHIP_BENEFITS,
  MEMBERSHIP_LEVELS,
  membershipLevelForTier,
  membershipTierLabel,
} from "@/lib/membership-catalog"
import { createClient, setActiveId } from "@/lib/storage"
import { cn } from "@/lib/utils"
import type {
  AnalysisSubjectType,
  MembershipSnapshot,
  WorkspaceAccountAccess,
} from "@/types"

type AccountTab = "overview" | "clients" | "teams" | "services" | "billing" | "reports" | "vip" | "settings"

type AccountUser = {
  id: string
  name: string
  email: string
  role: "admin" | "user"
  createdAt: string
}

type ClientSummary = {
  id: string
  accessRef: string
  sourceType: "personal" | "team"
  teamId?: string
  teamName?: string
  dataOwnerUserId: string
  parentUserId: string
  canEdit: boolean
  canDelete: boolean
  canManageClientAccount: boolean
  clientAccount: {
    userId: string
    status: "active" | "suspended"
    sourceStatus: "active" | "revoked"
  } | null
  name: string
  subjectType: AnalysisSubjectType
  ourBrand: string
  industry: string
  website: string
  createdAt: string
  updatedAt: string
  questionCount: number
  selectedModelCount: number
  completedModules: string[]
}

type CreditSnapshot = {
  total: number
  permanent: number
  monthly: number
  monthlyAllowance?: number
  monthlyPeriod?: string
  renewsAt?: string
}

type Props = {
  initialTab?: string
  user: AccountUser
  membership: MembershipSnapshot
  credits: CreditSnapshot
  access: WorkspaceAccountAccess
  clients: ClientSummary[]
  rechargeRecords: BillingRechargeRecord[]
  ledger: CreditLedgerEntry[]
  isAdmin: boolean
  unlimitedCredits: boolean
  whiteLabelCredits: number
  managedServices: Array<{
    id: string
    planName: string
    projectName?: string
    status: string
    priceCents: number
    durationMonths: number
    createdAt: number
  }>
}

const TABS: Array<{ id: AccountTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "概览", icon: LayoutDashboard },
  { id: "clients", label: "我的客户", icon: BriefcaseBusiness },
  { id: "teams", label: "团队协作", icon: UsersRound },
  { id: "services", label: "官方代运营", icon: Handshake },
  { id: "billing", label: "账单积分", icon: ReceiptText },
  { id: "reports", label: "历史报告", icon: FileClock },
  { id: "vip", label: "VIP 权益", icon: Crown },
  { id: "settings", label: "账号设置", icon: Settings },
]

const VALID_TABS = new Set<AccountTab>(TABS.map(tab => tab.id))

function tabFromLocation(): AccountTab {
  if (typeof window === "undefined") return "overview"
  return normalizeTab(new URL(window.location.href).searchParams.get("tab"))
}

function normalizeTab(value?: string | null): AccountTab {
  return value && VALID_TABS.has(value as AccountTab) ? value as AccountTab : "overview"
}

export function AccountCenter(props: Props) {
  const [activeTab, setActiveTab] = useState<AccountTab>(() => normalizeTab(props.initialTab))
  const [clients, setClients] = useState(props.clients)
  const [currentUser, setCurrentUser] = useState(props.user)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    const onPopState = () => setActiveTab(tabFromLocation())
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  function selectTab(tab: AccountTab) {
    setActiveTab(tab)
    setMobileNavOpen(false)
    const url = new URL(window.location.href)
    if (tab === "overview") url.searchParams.delete("tab")
    else url.searchParams.set("tab", tab)
    window.history.pushState({}, "", `${url.pathname}${url.search}`)
  }

  const currentLevel = membershipLevelForTier(props.membership.tier)
  const nextLevel = membershipLevelForTier(props.membership.nextTier || "free")
  const progressStart = currentLevel?.minPaidCents || 0
  const progressEnd = nextLevel?.minPaidCents || Math.max(progressStart, props.membership.paidCents)
  const progress = progressEnd > progressStart
    ? Math.max(0, Math.min(100, Math.round(
        ((props.membership.paidCents - progressStart) / (progressEnd - progressStart)) * 100,
      )))
    : 100
  const initials = (currentUser.name || currentUser.email)
    .trim()
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="min-h-screen bg-[#F2F7FD] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-[#CFE4FA] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/brand/shitu-lockup-transparent-v2.png"
              alt="势途 GEO"
              width={150}
              height={45}
              className="h-9 w-auto object-contain"
              priority
            />
            <span className="hidden h-6 w-px bg-slate-200 sm:block" />
            <span className="hidden text-sm font-semibold text-slate-700 sm:block">我的主页</span>
          </div>
          <div className="flex items-center gap-2">
            <UserNotificationCenter />
            {props.isAdmin ? (
              <Link href="/admin" className="hidden h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-[#69B1FF] hover:text-[#0958D9] sm:inline-flex">
                <ShieldCheck className="h-4 w-4" />
                管理后台
              </Link>
            ) : null}
            <Link href="/workspace" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 transition hover:brightness-105">
              返回工作台
              <ArrowRight className="h-4 w-4" />
            </Link>
            <button type="button" onClick={() => setMobileNavOpen(value => !value)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 sm:hidden" aria-label="打开主页导航">
              {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-5 lg:px-8 lg:py-7">
        <section className="relative overflow-hidden rounded-lg bg-[linear-gradient(118deg,#001D66_0%,#0958D9_42%,#00AEEA_100%)] px-5 py-5 text-white shadow-[0_16px_42px_rgba(9,88,217,.2)] sm:px-7 sm:py-6">
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,.24),transparent_38%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-white/15 text-xl font-bold ring-1 ring-white/30 backdrop-blur sm:h-20 sm:w-20 sm:text-2xl">
                {initials}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl font-bold sm:text-2xl">{currentUser.name}</h1>
                  <span className="inline-flex items-center gap-1 rounded-md bg-white/14 px-2 py-1 text-[10px] font-semibold ring-1 ring-white/25">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    {props.isAdmin ? "管理员" : membershipTierLabel(props.membership.tier)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-cyan-50/80">{currentUser.email}</p>
                <p className="mt-2 text-xs text-cyan-50/65">
                  {props.access.mode === "client" ? `客户专属账号 · ${props.access.clientName || "已授权面板"}` : `已管理 ${clients.length} 个客户档案`}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-white/20 ring-1 ring-white/25 sm:grid-cols-4 lg:min-w-[560px]">
              <HeroMetric label="当前积分" value={props.unlimitedCredits ? "无限" : String(props.credits.total)} />
              <HeroMetric label="累计充值" value={`¥${(props.membership.paidCents / 100).toFixed(0)}`} />
              <HeroMetric label="客户档案" value={String(clients.length)} />
              <HeroMetric label="客户账号名额" value={String(props.membership.clientAccountLimit)} />
            </div>
          </div>
        </section>

        <nav className={cn("mt-4 border-b border-[#D8E7F7] bg-white sm:block", mobileNavOpen ? "block rounded-lg border px-2 pt-2 shadow-lg" : "hidden")} aria-label="我的主页导航">
          <div className="flex flex-col sm:flex-row sm:overflow-x-auto">
            {TABS.map(tab => {
              const Icon = tab.icon
              const selected = activeTab === tab.id
              return (
                <button key={tab.id} type="button" onClick={() => selectTab(tab.id)} className={cn("relative inline-flex h-11 shrink-0 items-center gap-2 px-4 text-xs font-semibold transition", selected ? "text-[#0958D9]" : "text-slate-500 hover:bg-sky-50 hover:text-slate-800")}>
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  {selected ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-gradient-to-r from-[#1677FF] to-[#00C8FF]" /> : null}
                </button>
              )
            })}
          </div>
        </nav>

        <div className="mt-4">
          {activeTab === "overview" ? (
            <OverviewTab {...props} clients={clients} progress={progress} onSelectTab={selectTab} />
          ) : null}
          {activeTab === "clients" ? (
            <ClientsTab userId={currentUser.id} access={props.access} clients={clients} setClients={setClients} />
          ) : null}
          {activeTab === "teams" ? (
            <TeamCenter
              membership={props.membership}
              isAdmin={props.isAdmin}
              isClientAccount={props.access.mode === "client"}
            />
          ) : null}
          {activeTab === "services" ? <ServicesTab services={props.managedServices} /> : null}
          {activeTab === "billing" ? <BillingTab {...props} /> : null}
          {activeTab === "reports" ? <ReportsTab clients={clients} onOpen={() => setHistoryOpen(true)} /> : null}
          {activeTab === "vip" ? <VipTab membership={props.membership} whiteLabelCredits={props.whiteLabelCredits} progress={progress} /> : null}
          {activeTab === "settings" ? <SettingsTab user={currentUser} setUser={setCurrentUser} isAdmin={props.isAdmin} /> : null}
        </div>
      </main>

      <SiteFooter />

      {historyOpen ? (
        <ReportHistoryDialog
          clients={clients.map(client => ({ id: client.id, name: client.name }))}
          activeClientId={clients.length === 1 ? clients[0]?.id || null : null}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </div>
  )
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#001D66]/35 px-3 py-3 backdrop-blur-sm sm:px-4">
      <div className="text-[10px] text-cyan-50/65">{label}</div>
      <div className="mt-1 truncate font-mono text-lg font-bold text-white">{value}</div>
    </div>
  )
}

function OverviewTab(props: Props & {
  clients: ClientSummary[]
  progress: number
  onSelectTab: (tab: AccountTab) => void
}) {
  const nextLabel = props.membership.nextTier ? membershipTierLabel(props.membership.nextTier) : "最高等级"
  return (
    <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
      <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">常用入口</h2>
            <p className="mt-1 text-xs text-slate-500">从账号到业务数据，一处进入。</p>
          </div>
          <Sparkles className="h-5 w-5 text-[#00AEEA]" />
        </div>
        <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <QuickAction icon={BookOpenCheck} title="新手体验教程" detail="无需等待，快速熟悉完整产出" href="/workspace/tutorial?manual=1" color="cyan" />
          <QuickAction icon={BriefcaseBusiness} title="客户资料" detail={`${props.clients.length} 个客户档案`} onClick={() => props.onSelectTab("clients")} color="blue" />
          <QuickAction icon={FileClock} title="历史报告" detail="检测快照与专业 PDF" onClick={() => props.onSelectTab("reports")} color="violet" />
          <QuickAction icon={ReceiptText} title="账单与积分" detail={`${props.unlimitedCredits ? "无限" : props.credits.total} 可用积分`} onClick={() => props.onSelectTab("billing")} color="amber" />
        </div>
      </section>

      <section className="rounded-lg border border-[#D8E7F7] bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-slate-500">当前会员等级</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[#0958D9]">{membershipTierLabel(props.membership.tier)}</span>
              <span className="text-xs text-slate-400">累计充值 ¥{(props.membership.paidCents / 100).toFixed(2)}</span>
            </div>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[linear-gradient(145deg,#EAF5FF,#CDEAFF)] text-[#0958D9] ring-1 ring-[#B7DBFF]">
            <Gem className="h-5 w-5" />
          </span>
        </div>
        {props.membership.nextTier ? (
          <div className="mt-5">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>距离 {nextLabel}</span>
              <span>还需 ¥{((props.membership.amountToNextTierCents || 0) / 100).toFixed(2)}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-[#1677FF] via-[#00AEEA] to-[#13C2C2]" style={{ width: `${props.progress}%` }} />
            </div>
          </div>
        ) : (
          <p className="mt-5 text-xs font-semibold text-emerald-600">已解锁当前全部会员等级</p>
        )}
        <button type="button" onClick={() => props.onSelectTab("vip")} className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-[#0958D9] hover:underline">
          查看全部 VIP 权益
          <ChevronRight className="h-4 w-4" />
        </button>
      </section>
    </div>
  )
}

function QuickAction({ icon: Icon, title, detail, href, onClick, color }: {
  icon: typeof BookOpenCheck
  title: string
  detail: string
  href?: string
  onClick?: () => void
  color: "cyan" | "blue" | "violet" | "amber"
}) {
  const className = "group flex min-h-24 items-center gap-3 px-5 py-4 text-left transition hover:bg-[#F4FAFF]"
  const content = <>
    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1", color === "cyan" && "bg-cyan-50 text-cyan-600 ring-cyan-200", color === "blue" && "bg-blue-50 text-[#1677FF] ring-blue-200", color === "violet" && "bg-violet-50 text-violet-600 ring-violet-200", color === "amber" && "bg-amber-50 text-amber-600 ring-amber-200")}><Icon className="h-5 w-5" /></span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="mt-1 block truncate text-xs text-slate-500">{detail}</span></span>
    <ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#1677FF]" />
  </>
  return href ? <Link href={href} className={className}>{content}</Link> : <button type="button" onClick={onClick} className={className}>{content}</button>
}

function ServicesTab({ services }: { services: Props["managedServices"] }) {
  const statusLabel: Record<string, string> = {
    pending_payment: "待付款",
    paid: "已付款",
    provisioning: "正在创建项目",
    awaiting_intake: "待提交资料",
    intake_submitted: "资料已提交",
    active: "执行中",
    paused: "已暂停",
    completed: "已完成",
    canceled: "已取消",
    provisioning_failed: "待人工处理",
  }
  return <div className="space-y-4">
    <ManagedServiceCard />
    <section className="rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">我的代运营项目</h2><p className="mt-1 text-xs text-slate-500">付款、资料和执行状态集中管理。</p></div><Link href="/account/services" className="inline-flex items-center gap-1 text-xs font-semibold text-[#0958D9]">全部项目<ChevronRight className="h-4 w-4" /></Link></div>
      {services.length ? <div className="divide-y divide-slate-100">{services.map(service => <Link key={service.id} href={`/account/services/${encodeURIComponent(service.id)}`} className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-[#F7FBFF]"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{service.projectName || service.planName}</p><p className="mt-1 text-[11px] text-slate-500">{service.durationMonths} 个月 · ¥{(service.priceCents / 100).toLocaleString("zh-CN")}</p></div><span className="shrink-0 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold text-[#0958D9]">{statusLabel[service.status] || service.status}</span></Link>)}</div> : <div className="px-5 py-10 text-center text-sm text-slate-500">尚未购买官方代运营套餐</div>}
    </section>
  </div>
}

function ClientsTab({ userId, access, clients, setClients }: {
  userId: string
  access: WorkspaceAccountAccess
  clients: ClientSummary[]
  setClients: Dispatch<SetStateAction<ClientSummary[]>>
}) {
  const [query, setQuery] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState("")
  const [subjectType, setSubjectType] = useState<AnalysisSubjectType>("brand")
  const [busy, setBusy] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [accountClient, setAccountClient] = useState<ClientSummary | null>(null)
  const [knowledgeClient, setKnowledgeClient] = useState<ClientSummary | null>(null)

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return clients
    return clients.filter(client => [client.name, client.ourBrand, client.industry, client.website].join(" ").toLowerCase().includes(term))
  }, [clients, query])

  function openClient(client: ClientSummary) {
    const storageUserId = client.teamId ? `${userId}:team:${client.teamId}` : userId
    setActiveId(storageUserId, client.id)
    const teamQuery = client.teamId
      ? `&teamId=${encodeURIComponent(client.teamId)}`
      : ""
    window.location.assign(`/workspace?clientId=${encodeURIComponent(client.id)}${teamQuery}&module=penetration`)
  }

  async function refreshCatalog() {
    const response = await fetch("/api/account/clients", {
      cache: "no-store",
      credentials: "same-origin",
    })
    const payload = await response.json().catch(() => ({})) as {
      clients?: ClientSummary[]
      error?: string
    }
    if (!response.ok || !Array.isArray(payload.clients)) {
      throw new Error(payload.error || "客户目录刷新失败")
    }
    setClients(payload.clients)
  }

  async function createNewClient(event: FormEvent) {
    event.preventDefault()
    if (busy || !name.trim()) return
    setBusy(true)
    setMessage("")
    try {
      const draft = createClient(name.trim(), subjectType)
      const response = await fetch("/api/workspace/clients", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: draft }),
      })
      const payload = await response.json() as { client?: unknown; error?: string }
      if (!response.ok || !payload.client) throw new Error(payload.error || "新建客户失败")
      await refreshCatalog()
      setName("")
      setShowCreate(false)
      setMessage("客户已创建")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新建客户失败")
    } finally {
      setBusy(false)
    }
  }

  async function deleteClient(client: ClientSummary) {
    if (deletingId || !window.confirm(`确认删除“${client.name}”？该客户的云端资料将无法恢复。`)) return
    setDeletingId(client.id)
    setMessage("")
    try {
      const response = await fetch(`/api/workspace/clients/${encodeURIComponent(client.id)}`, { method: "DELETE", credentials: "same-origin" })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error || "删除客户失败")
      setClients(current => current.filter(item => item.accessRef !== client.accessRef))
      setMessage("客户已删除")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除客户失败")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
    <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="text-sm font-bold text-slate-900">我的客户</h2>
          <p className="mt-1 text-xs text-slate-500">选择客户进入专属工作台，资料与报告随账号同步。</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1 sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索客户、品牌或行业" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs outline-none transition focus:border-[#69B1FF] focus:bg-white focus:ring-2 focus:ring-blue-100" />
          </label>
          {access.canCreateClients ? (
            <button type="button" onClick={() => setShowCreate(value => !value)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#1677FF] px-3 text-xs font-semibold text-white transition hover:bg-[#0958D9]">
              {showCreate ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              <span className="hidden sm:inline">新建客户</span>
            </button>
          ) : null}
        </div>
      </div>

      {showCreate && access.canCreateClients ? (
        <form onSubmit={createNewClient} className="grid gap-3 border-b border-blue-100 bg-[#F3F9FF] px-4 py-4 sm:grid-cols-[180px_1fr_auto] sm:px-5">
          <div className="flex h-10 rounded-lg border border-[#B7DBFF] bg-white p-1">
            <button type="button" onClick={() => setSubjectType("brand")} className={cn("flex-1 rounded-md text-xs font-semibold transition", subjectType === "brand" ? "bg-[#1677FF] text-white" : "text-slate-500")}>品牌</button>
            <button type="button" onClick={() => setSubjectType("person")} className={cn("flex-1 rounded-md text-xs font-semibold transition", subjectType === "person" ? "bg-[#1677FF] text-white" : "text-slate-500")}>个人 IP</button>
          </div>
          <input value={name} onChange={event => setName(event.target.value)} maxLength={160} autoFocus placeholder={subjectType === "person" ? "输入人物或项目名称" : "输入客户或品牌项目名称"} className="h-10 rounded-lg border border-[#B7DBFF] bg-white px-3 text-sm outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100" />
          <button type="submit" disabled={busy || !name.trim()} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            创建
          </button>
        </form>
      ) : null}

      {message ? <div className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs text-slate-600" role="status">{message}</div> : null}
      {filtered.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <Building2 className="mx-auto h-9 w-9 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-600">{query ? "没有匹配的客户" : "还没有客户档案"}</p>
          <p className="mt-1 text-xs text-slate-400">{access.canCreateClients ? "新建第一个客户后即可进入工作台。" : "当前账号只显示已授权的客户。"}</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {filtered.map(client => (
            <article key={client.accessRef} className="group flex flex-col gap-3 px-4 py-4 transition hover:bg-[#F6FBFF] sm:flex-row sm:items-center sm:px-5">
              <button type="button" onClick={() => openClient(client)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ring-1", client.subjectType === "person" ? "bg-violet-50 text-violet-600 ring-violet-200" : "bg-blue-50 text-[#1677FF] ring-blue-200")}>
                  {client.subjectType === "person" ? <UserRound className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{client.name}</span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{client.subjectType === "person" ? "个人 IP" : "品牌"}</span>
                    {client.sourceType === "team" ? (
                      <span className="rounded-md bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">{client.teamName || "团队共享"}</span>
                    ) : null}
                    {client.clientAccount ? (
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                        client.clientAccount.sourceStatus === "revoked"
                          ? "bg-rose-50 text-rose-700"
                          : client.clientAccount.status === "active"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                      }`}>
                        {client.clientAccount.sourceStatus === "revoked"
                          ? "子账号授权失效"
                          : client.clientAccount.status === "active" ? "子账号正常" : "子账号已暂停"}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{[client.ourBrand, client.industry, client.website].filter(Boolean).join(" · ") || "待完善基础资料"}</span>
                </span>
              </button>
              <div className="flex flex-col gap-2 pl-14 sm:flex-row sm:items-center sm:justify-between sm:pl-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
                  <span>{client.questionCount} 条疑问句</span>
                  <span>{client.completedModules.length} 个模块有结果</span>
                  <span className="hidden lg:inline">更新 {formatDate(client.updatedAt)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setKnowledgeClient(client)} className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-[#0958D9] transition hover:bg-blue-100">
                    <BookOpenCheck className="h-3.5 w-3.5" />
                    资料库
                  </button>
                  {client.canManageClientAccount ? (
                    <button type="button" onClick={() => setAccountClient(client)} className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 text-[11px] font-semibold text-cyan-700 transition hover:bg-cyan-100">
                      <UsersRound className="h-3.5 w-3.5" />
                      {client.clientAccount ? "管理账号" : "创建账号"}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => openClient(client)} className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-[#B7DBFF] bg-white px-2.5 text-[11px] font-semibold text-[#0958D9] transition group-hover:border-[#1677FF]">
                    打开
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  {client.canDelete ? (
                    <button type="button" onClick={() => void deleteClient(client)} disabled={deletingId === client.id} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" aria-label={`删除 ${client.name}`} title="删除客户">
                      {deletingId === client.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
      {accountClient ? (
        <ClientAccountDialog
          clientRef={accountClient.accessRef}
          clientName={accountClient.name}
          onClose={() => setAccountClient(null)}
          onChanged={refreshCatalog}
        />
      ) : null}
      {knowledgeClient ? (
        <ClientKnowledgeBaseDialog
          clientId={knowledgeClient.id}
          clientName={knowledgeClient.name}
          subjectType={knowledgeClient.subjectType}
          subjectName={knowledgeClient.ourBrand || knowledgeClient.name}
          teamId={knowledgeClient.teamId}
          canEdit={knowledgeClient.canEdit}
          onClose={() => setKnowledgeClient(null)}
        />
      ) : null}
    </>
  )
}

function BillingTab(props: Props) {
  return (
    <div className="space-y-4">
      <section className="grid gap-px overflow-hidden rounded-lg border border-[#D8E7F7] bg-[#D8E7F7] shadow-sm sm:grid-cols-3">
        <div className="bg-white px-5 py-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500"><WalletCards className="h-4 w-4 text-[#1677FF]" />可用积分</div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-950">{props.unlimitedCredits ? "无限" : props.credits.total}</div>
          {props.credits.monthly > 0 ? <p className="mt-1 text-[11px] text-slate-400">含本月专属额度 {props.credits.monthly}</p> : null}
        </div>
        <div className="bg-white px-5 py-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500"><CircleDollarSign className="h-4 w-4 text-emerald-500" />累计充值</div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-950">¥{(props.membership.paidCents / 100).toFixed(2)}</div>
          <p className="mt-1 text-[11px] text-slate-400">{props.membership.qualifyingOrderCount} 笔有效到账</p>
        </div>
        <div className="flex items-center justify-between gap-4 bg-white px-5 py-4">
          <div><div className="text-xs font-medium text-slate-500">充值积分</div><p className="mt-1 text-[11px] leading-5 text-slate-400">微信、支付宝与银行转账均可选择。</p></div>
          <RechargeButton triggerClassName="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 transition hover:brightness-105">
            <Plus className="h-4 w-4" />充值
          </RechargeButton>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div><h2 className="text-sm font-bold text-slate-900">充值记录</h2><p className="mt-1 text-xs text-slate-500">付款、审核、到账与开票状态。</p></div>
          <span className="text-xs text-slate-400">共 {props.rechargeRecords.length} 笔</span>
        </div>
        {props.rechargeRecords.length === 0 ? (
          <EmptyLine icon={ReceiptText} title="暂无充值记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] font-semibold text-slate-500"><tr><th className="px-5 py-3">套餐 / 订单号</th><th className="px-4 py-3">金额</th><th className="px-4 py-3">积分</th><th className="px-4 py-3">付款方式</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">提交时间</th><th className="px-5 py-3 text-right">发票</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {props.rechargeRecords.map(record => (
                  <tr key={record.id} className="transition hover:bg-[#F7FBFF]">
                    <td className="px-5 py-3">
                      {record.actionUrl ? <Link href={record.actionUrl} className="font-semibold text-[#0958D9] hover:underline">{record.packageName || "历史充值申请"}</Link> : <div className="font-semibold text-slate-800">{record.packageName || "历史充值申请"}</div>}
                      <div className="mt-1 max-w-60 truncate font-mono text-[10px] text-slate-400">{record.paymentOutTradeNo || record.id}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">{record.priceCents ? `¥${(record.priceCents / 100).toFixed(2)}` : "-"}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-[#0958D9]">+{record.credits}</td>
                    <td className="px-4 py-3 text-slate-600">{paymentLabel(record.paymentMethod)}</td>
                    <td className="px-4 py-3"><StatusBadge status={record.status} /></td>
                    <td className="px-4 py-3 text-slate-500">{formatTimestamp(record.createdAt)}</td>
                    <td className="px-5 py-3 text-right"><InvoiceSupportButton status={record.status} orderNo={record.paymentOutTradeNo || record.id} packageName={record.packageName || "历史充值申请"} priceCents={record.priceCents} paymentMethod={paymentLabel(record.paymentMethod)} createdAt={record.createdAt} processedAt={record.processedAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div><h2 className="text-sm font-bold text-slate-900">积分流水</h2><p className="mt-1 text-xs text-slate-500">每次扣费、退回、充值和调整都有记录。</p></div>
          <Link href="/billing" className="inline-flex items-center gap-1 text-xs font-semibold text-[#0958D9] hover:underline">完整账单页<ChevronRight className="h-4 w-4" /></Link>
        </div>
        {props.ledger.length === 0 ? <EmptyLine icon={History} title="暂无积分流水" /> : (
          <div className="divide-y divide-slate-100">
            {props.ledger.map(entry => (
              <div key={entry.id} className="grid gap-2 px-5 py-3 text-xs sm:grid-cols-[1fr_130px_130px] sm:items-center">
                <div className="min-w-0"><div className="truncate font-medium text-slate-800">{entry.description || LEDGER_LABELS[entry.type] || "积分变动"}</div><div className="mt-1 text-[10px] text-slate-400">{formatTimestamp(entry.createdAt)}</div></div>
                <div className={cn("font-mono text-sm font-bold sm:text-right", entry.delta > 0 ? "text-emerald-600" : "text-rose-600")}>{entry.delta > 0 ? "+" : ""}{entry.delta}</div>
                <div className="font-mono text-[11px] text-slate-500 sm:text-right">余额 {entry.balanceAfter ?? "-"}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ReportsTab({ clients, onOpen }: { clients: ClientSummary[]; onOpen: () => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
      <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
        <div className="bg-[linear-gradient(120deg,#001D66,#0958D9_56%,#00AEEA)] px-5 py-5 text-white">
          <div className="flex items-center justify-between gap-4">
            <div><div className="text-[10px] font-semibold text-cyan-100/75">REPORT ARCHIVE</div><h2 className="mt-1 text-lg font-bold">历史报告中心</h2><p className="mt-2 text-xs leading-5 text-cyan-50/75">查看每次渗透率检测快照，以及已生成的四模块专业 PDF。</p></div>
            <FileText className="h-10 w-10 shrink-0 text-cyan-100/80" />
          </div>
        </div>
        <div className="px-5 py-5">
          <button type="button" onClick={onOpen} className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 transition hover:brightness-105">
            <FileClock className="h-4 w-4" />
            打开完整历史报告中心
          </button>
          <p className="mt-3 text-xs leading-5 text-slate-500">可按客户、报告类型、状态和日期筛选，并支持在线预览、下载和删除。</p>
        </div>
      </section>
      <section className="rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-bold text-slate-900">报告覆盖客户</h2><p className="mt-1 text-xs text-slate-500">共 {clients.length} 个客户档案</p></div>
        <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
          {clients.length === 0 ? <EmptyLine icon={Building2} title="暂无客户档案" /> : clients.map(client => (
            <button key={client.id} type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-[#F5FAFF]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#1677FF] ring-1 ring-blue-100">{client.subjectType === "person" ? <UserRound className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800">{client.name}</span><span className="mt-0.5 block truncate text-[10px] text-slate-400">{client.industry || "待完善行业"}</span></span>
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function VipTab({ membership, whiteLabelCredits, progress }: {
  membership: MembershipSnapshot
  whiteLabelCredits: number
  progress: number
}) {
  return (
    <div className="space-y-4">
      <section className="grid gap-px overflow-hidden rounded-lg border border-[#CFE4FA] bg-[#CFE4FA] shadow-sm lg:grid-cols-[1fr_1.4fr]">
        <div className="bg-[linear-gradient(135deg,#001D66,#0958D9_60%,#00AEEA)] px-5 py-5 text-white">
          <div className="flex items-center gap-2 text-xs text-cyan-100/75"><Crown className="h-4 w-4" />当前等级</div>
          <div className="mt-2 text-3xl font-bold">{membershipTierLabel(membership.tier)}</div>
          <div className="mt-2 text-xs text-cyan-50/70">累计充值 ¥{(membership.paidCents / 100).toFixed(2)}</div>
          {membership.nextTier ? <><div className="mt-5 flex items-center justify-between text-[10px] text-cyan-50/70"><span>距离 {membershipTierLabel(membership.nextTier)}</span><span>¥{((membership.amountToNextTierCents || 0) / 100).toFixed(2)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-gradient-to-r from-white via-cyan-200 to-emerald-300" style={{ width: `${progress}%` }} /></div></> : <p className="mt-5 text-xs font-semibold text-emerald-200">已达到最高会员等级</p>}
        </div>
        <div className="bg-white px-5 py-5">
          <h2 className="text-sm font-bold text-slate-900">当前可用权益</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(membership.tier === "free" ? FREE_MEMBERSHIP_BENEFITS : membershipLevelForTier(membership.tier)?.benefits || []).map(item => <div key={item} className="flex items-start gap-2 text-xs leading-5 text-slate-600"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{item}</div>)}
            {membership.active ? <div className="flex items-start gap-2 text-xs leading-5 text-slate-600"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />白标专业报告按 {whiteLabelCredits} 积分/份使用</div> : null}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3"><RechargeButton /><Link href="/account?tab=clients" className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#B7DBFF] bg-[#F0F7FF] px-3 text-xs font-semibold text-[#0958D9]", membership.clientAccountLimit === 0 && "pointer-events-none opacity-50")}><UsersRound className="h-4 w-4" />前往我的客户</Link></div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-bold text-slate-900">VIP 等级权益</h2><p className="mt-1 text-xs text-slate-500">等级按累计实际到账金额自动提升，退款金额不计入。</p></div>
        <div className="grid gap-px bg-[#D8E7F7] sm:grid-cols-2 xl:grid-cols-6">
          {MEMBERSHIP_LEVELS.map(level => {
            const reached = membership.paidCents >= level.minPaidCents
            const current = membership.tier === level.tier
            return <div key={level.tier} className={cn("relative min-h-48 bg-white p-4", current && "bg-[#EEF7FF]")}>
              {current ? <span className="absolute right-3 top-3 rounded-md bg-[#1677FF] px-1.5 py-0.5 text-[9px] font-bold text-white">当前</span> : null}
              <div className={cn("text-sm font-bold", reached ? "text-[#0958D9]" : "text-slate-700")}>{membershipTierLabel(level.tier)}</div>
              <div className="mt-1 text-[11px] font-semibold text-slate-500">{level.title}</div>
              <div className="mt-3 font-mono text-xs text-slate-700">累计 ¥{(level.minPaidCents / 100).toFixed(0)}</div>
              <div className="mt-3 space-y-2">{level.benefits.map(benefit => <div key={benefit} className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-500"><Check className={cn("mt-0.5 h-3 w-3 shrink-0", reached ? "text-emerald-500" : "text-slate-300")} />{benefit}</div>)}</div>
            </div>
          })}
        </div>
      </section>
    </div>
  )
}

function SettingsTab({ user, setUser, isAdmin }: {
  user: AccountUser
  setUser: Dispatch<SetStateAction<AccountUser>>
  isAdmin: boolean
}) {
  const [name, setName] = useState(user.name)
  const [newEmail, setNewEmail] = useState("")
  const [emailPassword, setEmailPassword] = useState("")
  const [verificationCode, setVerificationCode] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [busy, setBusy] = useState<"name" | "email-code" | "email" | "password" | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1_000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  async function saveName(event: FormEvent) {
    event.preventDefault()
    setBusy("name"); setNotice(null)
    try {
      const data = await requestJson<{ user: AccountUser }>("/api/account/profile", { name }, "PATCH")
      setUser(current => ({ ...current, name: data.user.name }))
      setNotice({ tone: "success", text: "账号名称已更新" })
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "账号名称修改失败" }) } finally { setBusy(null) }
  }

  async function sendEmailCode() {
    if (!newEmail || cooldown > 0) return
    setBusy("email-code"); setNotice(null)
    try {
      await requestJson("/api/account/email/code", { email: newEmail }, "POST")
      setCooldown(60)
      setNotice({ tone: "success", text: "验证码已发送至新邮箱" })
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "验证码发送失败" }) } finally { setBusy(null) }
  }

  async function saveEmail(event: FormEvent) {
    event.preventDefault()
    setBusy("email"); setNotice(null)
    try {
      const data = await requestJson<{ user: AccountUser }>("/api/account/email", { currentPassword: emailPassword, newEmail, verificationCode }, "PATCH")
      setUser(current => ({ ...current, email: data.user.email }))
      setNewEmail(""); setEmailPassword(""); setVerificationCode("")
      setNotice({ tone: "success", text: "登录邮箱已更新，其他设备需要重新登录" })
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "登录邮箱修改失败" }) } finally { setBusy(null) }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault()
    if (newPassword !== confirmPassword) { setNotice({ tone: "error", text: "两次输入的新密码不一致" }); return }
    setBusy("password"); setNotice(null)
    try {
      await requestJson("/api/account/password", { currentPassword, newPassword }, "PATCH")
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("")
      setNotice({ tone: "success", text: "密码已更新，其他设备需要重新登录" })
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "密码修改失败" }) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      {notice ? <div role="status" className={cn("rounded-lg border px-4 py-3 text-xs font-medium", notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>{notice.text}</div> : null}
      <section className="grid overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm lg:grid-cols-[240px_1fr]">
        <SettingHeading icon={PencilLine} title="账号名称" detail="用于工作台和报告记录中的账号识别。" />
        <form onSubmit={saveName} className="flex flex-col gap-3 border-t border-slate-100 p-5 sm:flex-row sm:items-end lg:border-l lg:border-t-0">
          <Field label="账号名称" className="flex-1"><input value={name} onChange={event => setName(event.target.value)} maxLength={50} className={INPUT_CLASS} /></Field>
          <button type="submit" disabled={busy === "name" || name.trim() === user.name} className={PRIMARY_BUTTON_CLASS}>{busy === "name" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}保存名称</button>
        </form>
      </section>

      <section className="grid overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm lg:grid-cols-[240px_1fr]">
        <SettingHeading icon={Mail} title="登录邮箱" detail={isAdmin ? "管理员邮箱由服务端安全配置管理。" : `当前邮箱：${user.email}`} />
        {isAdmin ? <div className="flex items-center border-t border-slate-100 p-5 text-xs text-slate-500 lg:border-l lg:border-t-0"><LockKeyhole className="mr-2 h-4 w-4 text-amber-500" />管理员邮箱不能在网页端修改。</div> : (
          <form onSubmit={saveEmail} className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-2 lg:border-l lg:border-t-0">
            <Field label="新邮箱"><input type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} autoComplete="email" className={INPUT_CLASS} /></Field>
            <Field label="当前密码"><input type="password" value={emailPassword} onChange={event => setEmailPassword(event.target.value)} autoComplete="current-password" className={INPUT_CLASS} /></Field>
            <Field label="新邮箱验证码" className="sm:col-span-2"><div className="flex gap-2"><input inputMode="numeric" value={verificationCode} onChange={event => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className={cn(INPUT_CLASS, "flex-1")} /><button type="button" onClick={() => void sendEmailCode()} disabled={!newEmail || cooldown > 0 || busy === "email-code"} className="inline-flex h-10 min-w-28 items-center justify-center rounded-lg border border-[#91CAFF] bg-[#F0F7FF] px-3 text-xs font-semibold text-[#0958D9] disabled:opacity-50">{busy === "email-code" ? <Loader2 className="h-4 w-4 animate-spin" /> : cooldown > 0 ? `${cooldown} 秒` : "获取验证码"}</button></div></Field>
            <button type="submit" disabled={busy === "email" || !newEmail || !emailPassword || verificationCode.length !== 6} className={cn(PRIMARY_BUTTON_CLASS, "sm:col-span-2 sm:w-fit")}>{busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}确认更换邮箱</button>
          </form>
        )}
      </section>

      <section className="grid overflow-hidden rounded-lg border border-[#D8E7F7] bg-white shadow-sm lg:grid-cols-[240px_1fr]">
        <SettingHeading icon={KeyRound} title="登录密码" detail="修改后，其他设备的旧登录状态会自动失效。" />
        <form onSubmit={savePassword} className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-3 lg:border-l lg:border-t-0">
          <Field label="当前密码"><input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" className={INPUT_CLASS} /></Field>
          <Field label="新密码"><input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" className={INPUT_CLASS} /></Field>
          <Field label="确认新密码"><input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" className={INPUT_CLASS} /></Field>
          <p className="text-[11px] leading-5 text-slate-400 sm:col-span-2">至少 8 位，并同时包含字母和数字。</p>
          <button type="submit" disabled={busy === "password" || !currentPassword || !newPassword || !confirmPassword} className={cn(PRIMARY_BUTTON_CLASS, "sm:justify-self-end")}>{busy === "password" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}更新密码</button>
        </form>
      </section>
    </div>
  )
}

function SettingHeading({ icon: Icon, title, detail }: { icon: typeof Settings; title: string; detail: string }) {
  return <div className="bg-[#F5FAFF] p-5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[#1677FF] shadow-sm ring-1 ring-[#D8E7F7]"><Icon className="h-4 w-4" /></span><h2 className="mt-3 text-sm font-bold text-slate-900">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div>
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={cn("block", className)}><span className="mb-1.5 block text-[11px] font-semibold text-slate-600">{label}</span>{children}</label>
}

function EmptyLine({ icon: Icon, title }: { icon: typeof FileText; title: string }) {
  return <div className="flex flex-col items-center justify-center px-5 py-10 text-center"><Icon className="h-8 w-8 text-slate-300" /><p className="mt-2 text-xs font-medium text-slate-500">{title}</p></div>
}

function StatusBadge({ status }: { status: BillingRechargeStatus }) {
  const meta = RECHARGE_STATUS[status]
  return <span className={cn("inline-flex rounded-md px-2 py-1 text-[10px] font-semibold ring-1 ring-inset", meta.className)}>{meta.label}</span>
}

async function requestJson<T = Record<string, unknown>>(url: string, body: unknown, method: "POST" | "PATCH"): Promise<T> {
  const response = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const payload = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || "操作失败，请稍后重试")
  return payload
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return "-"
  return new Date(timestamp).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })
}

function formatTimestamp(value?: number): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

function paymentLabel(value?: string): string {
  if (value === "wechat") return "微信支付"
  if (value === "alipay") return "支付宝"
  if (value === "manual_transfer") return "银行转账"
  if (value === "other") return "其他"
  return "人工转账"
}

const INPUT_CLASS = "h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none transition focus:border-[#69B1FF] focus:bg-white focus:ring-2 focus:ring-blue-100"
const PRIMARY_BUTTON_CLASS = "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"

const RECHARGE_STATUS: Record<BillingRechargeStatus, { label: string; className: string }> = {
  pending_review: { label: "待审批", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  pending_payment: { label: "待支付", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  processing: { label: "处理中", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  credited: { label: "已到账", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  rejected: { label: "已拒绝", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  canceled: { label: "已取消", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  failed: { label: "支付失败", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  refunding: { label: "退款中", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  refunded: { label: "已退款", className: "bg-slate-100 text-slate-600 ring-slate-200" },
}

const LEDGER_LABELS: Record<CreditLedgerEntry["type"], string> = {
  trial_grant: "试用赠送",
  bootstrap_grant: "历史补足",
  client_monthly_grant: "客户月度额度",
  client_monthly_adjust: "客户额度调整",
  recharge_requested: "充值申请",
  recharge_approved: "充值到账",
  recharge_rejected: "充值拒绝",
  admin_adjust: "管理员调整",
  usage_reserved: "功能扣费",
  usage_refund: "积分退回",
  usage_extra: "超额结算",
}
