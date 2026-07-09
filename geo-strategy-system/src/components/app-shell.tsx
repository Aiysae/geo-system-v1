"use client"

// Browser-local customer workspace mounted behind the authenticated server page.
import { useEffect, useState, useCallback } from "react"
import Image from "next/image"
import ClientSidebar from "@/components/sidebar/client-sidebar"
import PenetrationModule from "@/components/penetration/penetration-module"
import ResearchModule from "@/components/research/research-module"
import DiagnosisModule from "@/components/diagnosis/diagnosis-module"
import KeywordStrategyModule from "@/components/keyword/keyword-strategy-module"
import ArticleGenerationModule from "@/components/article/article-generation-module"
import DifficultyAssessmentModule from "@/components/difficulty/difficulty-assessment-module"
import SiteFooter from "@/components/site-footer"
import { Brain, FileText, Gauge, ListOrdered, Menu, Printer, Radar, Sparkles, Target } from "lucide-react"
import { useCredits } from "@/components/credits/credits-provider"
import { RechargeButton } from "@/components/credits/recharge-button"
import { AccountMenu } from "@/components/auth/account-menu"
import {
  listClients,
  getActiveId,
  setActiveId as persistActiveId,
  upsertClient,
  deleteClient as removeClient,
  createClient,
} from "@/lib/storage"
import type { Client } from "@/types"

export default function Home() {
  const [clients, setClients] = useState<Client[]>([])
  const [activeId, setActive] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  // 移动端抽屉开关。桌面端 (md+) Sidebar 永远可见，该状态被忽略。
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    const list = listClients()
    const aid = getActiveId()
    const resolved = aid && list.some(c => c.id === aid) ? aid : list[0]?.id ?? null
    // eslint-disable-next-line react-hooks/set-state-in-effect -- LocalStorage hydration on mount
    setClients(list)
    setActive(resolved)
    setHydrated(true)
  }, [])

  const active = clients.find(c => c.id === activeId) ?? null

  const handleSelect = useCallback((id: string) => {
    setActive(id)
    persistActiveId(id)
    // 移动端：选中客户后自动收起抽屉，直接进入详情面板
    setSidebarOpen(false)
  }, [])

  const handleCreate = useCallback((name: string) => {
    const c = createClient(name)
    const saved = upsertClient(c)
    setClients(prev => [saved, ...prev])
    setActive(saved.id)
    persistActiveId(saved.id)
    setSidebarOpen(false)
  }, [])

  const handleDelete = useCallback((id: string) => {
    removeClient(id)
    setClients(prev => {
      const next = prev.filter(c => c.id !== id)
      if (activeId === id) {
        const newId = next[0]?.id ?? null
        setActive(newId)
        persistActiveId(newId)
      }
      return next
    })
  }, [activeId])

  const handleChangeClient = useCallback((patch: Partial<Client>) => {
    setClients(prev => {
      const idx = prev.findIndex(c => c.id === activeId)
      if (idx < 0) return prev
      const merged: Client = { ...prev[idx], ...patch }
      const saved = upsertClient(merged)
      const next = [...prev]
      next[idx] = saved
      return next
    })
  }, [activeId])

  return (
    <div className="flex h-screen w-screen overflow-hidden geo-workspace-bg print-root">
      {/* 移动端：抽屉展开时的半透明遮罩，点击关闭 */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40 no-print"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <ClientSidebar
        clients={clients}
        activeId={activeId}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex-1 min-w-0 h-screen overflow-y-auto overscroll-contain relative print-main">
        <div className="relative z-10">
        <StickyHeader
          client={active}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
        {!hydrated ? (
          <div className="h-screen flex items-center justify-center text-slate-400 text-sm">
            加载中...
          </div>
        ) : !active ? (
          <EmptyState onCreate={handleCreate} />
        ) : (
          // key={active.id}：切换客户时强制 Dashboard 整子树重挂载，
          // 彻底清空各 Module 内的 isDetecting/loading/progress 等运行时状态，根治状态泄露。
          <Dashboard key={active.id} client={active} onChangeClient={handleChangeClient} />
        )}
        <SiteFooter />
        </div>
      </main>
    </div>
  )
}

function StickyHeader({
  client,
  onOpenSidebar,
}: {
  client: Client | null
  onOpenSidebar: () => void
}) {
  function handlePrint() {
    window.print()
  }
  return (
    <header className="sticky top-0 z-30 border-b border-cyan-300/15 bg-[#061826]/95 text-white shadow-lg shadow-slate-950/20 backdrop-blur-md sticky-header">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-2.5 flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
          {/* 移动端汉堡按钮：触发左侧抽屉。md+ 隐藏 */}
          <button
            onClick={onOpenSidebar}
            className="no-print md:hidden p-2 -ml-1 rounded-lg hover:bg-white/10 transition shrink-0"
            aria-label="打开客户列表"
          >
            <Menu className="h-5 w-5 text-white" />
          </button>
          <Image
            src="/logo.jpg"
            alt=""
            width={935}
            height={1136}
            sizes="32px"
            priority
            className="h-8 w-auto rounded-lg ring-1 ring-white/20 shrink-0"
          />
          <div className="min-w-0">
            <div className="max-w-[150px] truncate bg-gradient-to-r from-white via-cyan-100 to-[#00D4FF] bg-clip-text text-sm font-bold tracking-wide text-transparent sm:max-w-none">
              势途 GEO · 市场情报大盘
            </div>
            {client ? (
              <div className="text-[11px] text-white/60 truncate">
                当前客户：<span className="font-medium text-white">{client.name}</span>
                {client.industry && <span className="text-cyan-100/60"> · {client.industry}</span>}
              </div>
            ) : (
              <div className="text-[11px] text-white/50">
                请先创建或选择一个客户
              </div>
            )}
          </div>
        </div>
        <div className="no-print order-last flex w-full justify-end sm:order-none sm:w-auto sm:justify-start">
          {client && (
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 md:px-3.5 py-2 rounded-lg bg-gradient-to-r from-[#00A6FB] to-[#7C3AED] text-white hover:shadow-lg hover:shadow-cyan-400/25 hover:-translate-y-0.5 transition-all whitespace-nowrap shrink-0"
            >
              <Printer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">导出 PDF 报告</span>
              <span className="sm:hidden">导出</span>
            </button>
          )}
        </div>
        <div className="no-print ml-auto shrink-0 flex items-center gap-1.5 sm:gap-2">
          <CreditsPill />
          <RechargeButton />
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}

function CreditsPill() {
  const { balance } = useCredits()
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-300/20 to-rose-400/20 ring-1 ring-amber-200/30 text-[11px] font-medium text-white"
      title="体验算力积分余额"
    >
      <Sparkles className="h-3.5 w-3.5 text-amber-300" />
      <span className="hidden sm:inline text-white/60">积分</span>
      <span className="font-mono font-bold text-white tabular-nums">
        {balance === null ? "…" : balance}
      </span>
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState("")
  return (
    <div className="h-screen flex flex-col items-center justify-center px-6 animate-fade-in-up">
      <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#004B73] via-[#0077B6] to-[#00B4D8] flex items-center justify-center mb-7 shadow-2xl shadow-blue-300/40 animate-pulse-ring">
        <Sparkles className="h-12 w-12 text-white" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
        欢迎使用势途 GEO 市场情报终端
      </h2>
      <p className="text-sm text-slate-500 mt-3 max-w-md text-center leading-relaxed">
        每个客户的调研数据、诊断结果与生成策略会自动保存在浏览器本地，刷新不丢失。
      </p>
      <div className="mt-8 flex gap-2 w-full max-w-sm">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && name.trim()) {
              onCreate(name.trim())
              setName("")
            }
          }}
          placeholder="输入第一个客户名称（如：势途 / 客户A）"
          className="flex-1 px-4 py-3 text-sm rounded-xl border border-slate-200 bg-white/70 backdrop-blur outline-none focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/20 transition-all"
        />
        <button
          onClick={() => {
            if (name.trim()) {
              onCreate(name.trim())
              setName("")
            }
          }}
          className="px-5 py-3 text-sm rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] hover:shadow-lg hover:shadow-blue-300/40 hover:-translate-y-0.5 text-white font-medium transition-all"
        >
          创建
        </button>
      </div>
    </div>
  )
}

function Dashboard({
  client,
  onChangeClient,
}: {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}) {
  const [activeModule, setActiveModule] = useState<DashboardModuleKey>("penetration")

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-4 md:py-6 animate-fade-in-up print-container">
      <header className="mb-4 md:mb-5 overflow-hidden rounded-lg border border-white/15 bg-[#061826] shadow-xl shadow-slate-950/15">
        <div className="flex flex-col gap-3 bg-[linear-gradient(110deg,rgba(0,166,251,0.28),rgba(124,58,237,0.22)_48%,rgba(244,63,94,0.2))] px-4 py-4 sm:flex-row sm:items-end sm:justify-between md:px-5">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            当前客户
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl break-words">
            {client.name}
          </h1>
          {client.industry && (
            <span className="inline-flex items-center gap-1.5 mt-2.5 text-xs px-2.5 py-1 rounded-full bg-white/10 backdrop-blur border border-white/15 text-cyan-50 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#00D4FF] to-[#F59E0B]"></span>
              {client.industry}
            </span>
          )}
        </div>
        <div className="text-xs text-white/55">
          创建于 {new Date(client.createdAt).toLocaleDateString("zh-CN")}
        </div>
        </div>
      </header>

      <ModuleNav active={activeModule} onChange={setActiveModule} />

      <section className="mt-5 md:mt-6">
        {activeModule === "penetration" && (
          <PenetrationModule
            client={client}
            onChangeClient={onChangeClient}
          />
        )}
        {activeModule === "research" && (
          <ResearchModule client={client} onChangeClient={onChangeClient} />
        )}
        {activeModule === "diagnosis" && (
          <DiagnosisModule client={client} onChangeClient={onChangeClient} />
        )}
        {activeModule === "difficulty" && (
          <DifficultyAssessmentModule client={client} onChangeClient={onChangeClient} />
        )}
        {activeModule === "keyword" && (
          <KeywordStrategyModule client={client} onChangeClient={onChangeClient} />
        )}
        {activeModule === "article" && (
          <ArticleGenerationModule client={client} onChangeClient={onChangeClient} />
        )}
      </section>
    </div>
  )
}

type DashboardModuleKey = "penetration" | "research" | "diagnosis" | "difficulty" | "keyword" | "article"

const DASHBOARD_MODULES: Array<{
  key: DashboardModuleKey
  label: string
  desc: string
  icon: typeof Target
  activeClass: string
  iconClass: string
  dotClass: string
}> = [
  {
    key: "penetration",
    label: "渗透率情报",
    desc: "多模型盲测",
    icon: Target,
    activeClass: "bg-gradient-to-r from-[#0077B6] to-[#00D4FF] text-white shadow-lg shadow-sky-400/25",
    iconClass: "bg-sky-100 text-[#0077B6]",
    dotClass: "from-[#0077B6] to-[#00D4FF]",
  },
  {
    key: "research",
    label: "独立调研",
    desc: "品牌画像",
    icon: Brain,
    activeClass: "bg-gradient-to-r from-[#10B981] to-[#00D4FF] text-white shadow-lg shadow-emerald-400/25",
    iconClass: "bg-emerald-100 text-emerald-700",
    dotClass: "from-[#10B981] to-[#00D4FF]",
  },
  {
    key: "diagnosis",
    label: "AI 诊断",
    desc: "五维评分",
    icon: Radar,
    activeClass: "bg-gradient-to-r from-[#7C3AED] to-[#E879F9] text-white shadow-lg shadow-violet-400/25",
    iconClass: "bg-violet-100 text-violet-700",
    dotClass: "from-[#7C3AED] to-[#E879F9]",
  },
  {
    key: "difficulty",
    label: "难度测评",
    desc: "行业垄断评分",
    icon: Gauge,
    activeClass: "bg-gradient-to-r from-[#F43F5E] to-[#F59E0B] text-white shadow-lg shadow-rose-400/25",
    iconClass: "bg-rose-100 text-rose-700",
    dotClass: "from-[#F43F5E] to-[#F59E0B]",
  },
  {
    key: "keyword",
    label: "关键词策略",
    desc: "资料抽取与疑问句池",
    icon: ListOrdered,
    activeClass: "bg-gradient-to-r from-[#F59E0B] to-[#00A6FB] text-white shadow-lg shadow-amber-400/25",
    iconClass: "bg-amber-100 text-amber-700",
    dotClass: "from-[#F59E0B] to-[#00A6FB]",
  },
  {
    key: "article",
    label: "文章生成",
    desc: "Prompt 内容生产",
    icon: FileText,
    activeClass: "bg-gradient-to-r from-[#7C3AED] to-[#F43F5E] text-white shadow-lg shadow-fuchsia-400/25",
    iconClass: "bg-fuchsia-100 text-fuchsia-700",
    dotClass: "from-[#7C3AED] to-[#F43F5E]",
  },
]

function ModuleNav({
  active,
  onChange,
}: {
  active: DashboardModuleKey
  onChange: (key: DashboardModuleKey) => void
}) {
  return (
    <nav className="no-print -mx-1 overflow-x-auto pb-1">
      <div className="inline-flex min-w-full gap-1.5 rounded-lg border border-white/70 bg-white/88 p-1.5 shadow-lg shadow-slate-900/10 backdrop-blur sm:grid sm:grid-cols-6">
        {DASHBOARD_MODULES.map(item => {
          const Icon = item.icon
          const isActive = active === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              className={`min-w-[148px] sm:min-w-0 flex items-center gap-2 rounded-lg px-3 py-2.5 text-left transition ${
                isActive
                  ? item.activeClass
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                isActive ? "bg-white/18" : item.iconClass
              }`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-semibold sm:text-sm">
                  <span className={`h-1.5 w-1.5 rounded-full bg-gradient-to-r ${item.dotClass}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className={`block text-[10px] truncate ${isActive ? "text-white/78" : "text-slate-400"}`}>
                  {item.desc}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
