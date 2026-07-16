"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Image from "next/image"
import Link from "next/link"
import ClientSidebar from "@/components/sidebar/client-sidebar"
import PenetrationModule from "@/components/penetration/penetration-module"
import ResearchModule from "@/components/research/research-module"
import DiagnosisModule from "@/components/diagnosis/diagnosis-module"
import KeywordStrategyModule from "@/components/keyword/keyword-strategy-module"
import ArticleGenerationModule from "@/components/article/article-generation-module"
import DifficultyAssessmentModule from "@/components/difficulty/difficulty-assessment-module"
import ReportExportDialog from "@/components/reports/report-export-dialog"
import ReportHistoryDialog from "@/components/reports/report-history-dialog"
import SiteFooter from "@/components/site-footer"
import {
  AlertTriangle,
  ArrowUp,
  Brain,
  CheckCircle2,
  Cloud,
  CloudOff,
  FileDown,
  FileText,
  Gauge,
  History,
  ListOrdered,
  LoaderCircle,
  Menu,
  Radar,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react"
import { useCredits } from "@/components/credits/credits-provider"
import { RechargeButton } from "@/components/credits/recharge-button"
import { AccountMenu } from "@/components/auth/account-menu"
import { useWorkspaceSync, type WorkspaceSyncState } from "@/hooks/use-workspace-sync"
import type { Client, ReportExportPreset } from "@/types"

export default function Home({ userId }: { userId: string }) {
  const {
    clients,
    activeId,
    hydrated,
    syncState,
    conflict,
    showMigration,
    legacyClientCount,
    handleSelect: selectClient,
    handleCreate: createWorkspaceClient,
    handleDelete,
    handleChangeClient,
    retry,
    importLegacy,
    dismissMigration,
    loadCloudConflictVersion,
    overwriteCloudConflictVersion,
  } = useWorkspaceSync(userId)
  // 移动端抽屉开关。桌面端 (md+) Sidebar 永远可见，该状态被忽略。
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [reportExportPreset, setReportExportPreset] = useState<ReportExportPreset | null>(null)
  const [reportHistoryOpen, setReportHistoryOpen] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const mainScrollRef = useRef<HTMLElement>(null)

  const active = clients.find(c => c.id === activeId) ?? null

  const handleSelect = useCallback((id: string) => {
    selectClient(id)
    // 移动端：选中客户后自动收起抽屉，直接进入详情面板
    setSidebarOpen(false)
    setReportExportPreset(null)
    setReportHistoryOpen(false)
  }, [selectClient])

  const handleCreate = useCallback((name: string) => {
    createWorkspaceClient(name)
    setSidebarOpen(false)
  }, [createWorkspaceClient])

  useEffect(() => {
    const scrollContainer = mainScrollRef.current
    if (!scrollContainer) return
    const updateVisibility = () => setShowBackToTop(scrollContainer.scrollTop > 500)
    updateVisibility()
    scrollContainer.addEventListener("scroll", updateVisibility, { passive: true })
    return () => scrollContainer.removeEventListener("scroll", updateVisibility)
  }, [])

  const scrollToTop = useCallback(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    mainScrollRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" })
  }, [])

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

      <main ref={mainScrollRef} className="flex-1 min-w-0 h-screen overflow-y-auto overscroll-contain relative print-main">
        <div className="relative z-10">
        <StickyHeader
          client={active}
          onOpenSidebar={() => setSidebarOpen(true)}
          onExportReport={() => setReportExportPreset({})}
          onOpenReportHistory={() => setReportHistoryOpen(true)}
          syncState={syncState}
          onRetrySync={retry}
        />
        {conflict ? (
          <WorkspaceConflictNotice
            onLoadCloud={loadCloudConflictVersion}
            onOverwriteCloud={overwriteCloudConflictVersion}
          />
        ) : null}
        {!hydrated ? (
          <div className="h-screen flex items-center justify-center text-slate-400 text-sm">
            加载中...
          </div>
        ) : !active ? (
          <EmptyState onCreate={handleCreate} />
        ) : (
          // key={active.id}：切换客户时强制 Dashboard 整子树重挂载，
          // 彻底清空各 Module 内的 isDetecting/loading/progress 等运行时状态，根治状态泄露。
          <Dashboard
            key={active.id}
            client={active}
            onChangeClient={handleChangeClient}
            onExportReport={setReportExportPreset}
          />
        )}
        <SiteFooter />
        </div>
      </main>
      {showBackToTop ? (
        <button
          type="button"
          onClick={scrollToTop}
          className="no-print fixed bottom-5 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#1677FF] to-[#00AEEA] text-white shadow-[0_14px_34px_-12px_rgba(0,119,255,0.82)] ring-1 ring-white/70 transition hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677FF] focus-visible:ring-offset-2 sm:bottom-7 sm:right-7"
          aria-label="回到页面顶部"
          title="回到顶部"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      ) : null}
      {active && reportExportPreset && (
        <ReportExportDialog
          client={active}
          preset={reportExportPreset}
          onClose={() => setReportExportPreset(null)}
        />
      )}
      {reportHistoryOpen ? (
        <ReportHistoryDialog
          clients={clients}
          activeClientId={activeId}
          onClose={() => setReportHistoryOpen(false)}
        />
      ) : null}
      {showMigration ? (
        <LegacyMigrationDialog
          count={legacyClientCount}
          onImport={() => void importLegacy()}
          onDismiss={dismissMigration}
        />
      ) : null}
    </div>
  )
}

function StickyHeader({
  client,
  onOpenSidebar,
  onExportReport,
  onOpenReportHistory,
  syncState,
  onRetrySync,
}: {
  client: Client | null
  onOpenSidebar: () => void
  onExportReport: () => void
  onOpenReportHistory: () => void
  syncState: WorkspaceSyncState
  onRetrySync: () => void
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#001D66]/96 text-white shadow-[0_12px_30px_-24px_rgba(0,29,102,0.88)] backdrop-blur-md sticky-header">
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
          <Link
            href="/"
            title="返回势途 GEO 品牌主页"
            className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <Image
              src="/brand/shitu-lockup.jpg"
              alt="势途"
              width={840}
              height={960}
              sizes="32px"
              priority
              className="h-8 w-auto rounded-md ring-1 ring-white/20"
            />
          </Link>
          <div className="min-w-0">
            <div className="geo-brand-title max-w-[150px] truncate text-base text-white sm:max-w-none">
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
        <div className="no-print order-last flex w-full justify-end gap-2 sm:order-none sm:w-auto sm:justify-start">
          <button
            type="button"
            onClick={onOpenReportHistory}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/16 md:px-3.5"
            title="查看历史专业报告"
          >
            <History className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">历史报告</span>
            <span className="sm:hidden">历史</span>
          </button>
          {client && (
            <button
              onClick={onExportReport}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#69DFFF]/65 bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 py-2 text-xs font-semibold text-white shadow-[0_10px_24px_-16px_rgba(0,200,255,0.8)] transition-[filter] hover:brightness-105 md:px-3.5"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">导出专业报告</span>
              <span className="sm:hidden">导出</span>
            </button>
          )}
        </div>
        <div className="no-print ml-auto shrink-0 flex items-center gap-1.5 sm:gap-2">
          <WorkspaceSyncIndicator state={syncState} onRetry={onRetrySync} />
          <CreditsPill />
          <RechargeButton />
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}

function WorkspaceSyncIndicator({
  state,
  onRetry,
}: {
  state: WorkspaceSyncState
  onRetry: () => void
}) {
  const isBusy = state.phase === "loading" || state.phase === "saving"
  const isError = state.phase === "error" || state.phase === "conflict"
  const Icon = isBusy
    ? LoaderCircle
    : isError
      ? CloudOff
      : state.phase === "saved"
        ? CheckCircle2
        : Cloud
  const label = state.phase === "loading"
    ? "云端读取中"
    : state.phase === "saving"
      ? "云端保存中"
      : state.phase === "error"
        ? "同步失败"
        : state.phase === "conflict"
          ? "需要处理冲突"
          : "云端已同步"

  if (state.phase === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={`${state.message}，点击重试`}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-400/15 px-2 text-[11px] font-medium text-rose-100 ring-1 ring-rose-300/30 transition-colors hover:bg-rose-400/25"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">{label}</span>
      </button>
    )
  }

  return (
    <div
      title={state.message}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium ring-1 ${
        isError
          ? "bg-amber-300/15 text-amber-100 ring-amber-200/30"
          : "bg-cyan-300/12 text-cyan-50 ring-cyan-200/25"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 ${isBusy ? "animate-spin" : ""}`} />
      <span className="hidden lg:inline">{label}</span>
    </div>
  )
}

function WorkspaceConflictNotice({
  onLoadCloud,
  onOverwriteCloud,
}: {
  onLoadCloud: () => void
  onOverwriteCloud: () => void
}) {
  return (
    <div className="no-print border-b border-amber-200 bg-amber-50 text-amber-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-8">
        <div className="flex min-w-0 items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-5">
            另一台设备已更新当前模块，本机内容尚未覆盖云端。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onLoadCloud}
            className="h-8 rounded-md border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            加载云端版本
          </button>
          <button
            type="button"
            onClick={onOverwriteCloud}
            className="h-8 rounded-md bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700"
          >
            保留本机版本
          </button>
        </div>
      </div>
    </div>
  )
}

function LegacyMigrationDialog({
  count,
  onImport,
  onDismiss,
}: {
  count: number
  onImport: () => void
  onDismiss: () => void
}) {
  return (
    <div className="no-print fixed inset-0 z-[80] flex items-center justify-center bg-[#00133F]/58 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-migration-title"
        className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-[0_30px_90px_-28px_rgba(0,29,102,0.72)] ring-1 ring-[#8AC8FF]"
      >
        <div className="bg-gradient-to-r from-[#075BDB] via-[#1677FF] to-[#00AEEA] px-5 py-4 text-white">
          <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100">
            <Cloud className="h-4 w-4" />
            云端工作区
          </div>
          <h2 id="legacy-migration-title" className="mt-2 text-lg font-semibold">
            发现 {count} 个本机历史客户
          </h2>
        </div>
        <div className="px-5 py-5">
          <p className="text-sm leading-7 text-slate-600">
            确认后会将这些数据归入当前登录账号。同名或冲突数据会保留副本，不会覆盖云端内容。
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="h-10 rounded-lg px-4 text-sm font-medium text-slate-500 hover:bg-slate-100"
            >
              稍后处理
            </button>
            <button
              type="button"
              onClick={onImport}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[#126BEB] to-[#00AEEA] px-4 text-sm font-semibold text-white shadow-[0_14px_28px_-18px_rgba(0,119,255,0.9)] hover:brightness-105"
            >
              <Cloud className="h-4 w-4" />
              同步到当前账号
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CreditsPill() {
  const { balance, unlimited } = useCredits()
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-lg bg-[#FFB020]/16 px-2.5 py-1.5 text-[11px] font-medium text-white ring-1 ring-[#FFB020]/35"
      title="体验算力积分余额"
    >
      <Sparkles className="h-3.5 w-3.5 text-amber-300" />
      <span className="hidden sm:inline text-white/60">积分</span>
      <span className="font-mono font-bold text-white tabular-nums">
        {unlimited ? "无限" : balance === null ? "…" : balance}
      </span>
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState("")
  return (
    <div className="h-screen flex flex-col items-center justify-center px-6 animate-fade-in-up">
      <div className="mb-7 flex h-20 w-20 items-center justify-center rounded-lg bg-gradient-to-br from-[#2F54EB] via-[#1677FF] to-[#00C8FF] shadow-[0_18px_40px_-22px_rgba(22,119,255,0.72)]">
        <Sparkles className="h-12 w-12 text-white" />
      </div>
      <h2 className="geo-display-title text-3xl text-slate-900">
        欢迎使用势途 GEO 市场情报终端
      </h2>
      <p className="text-sm text-slate-500 mt-3 max-w-md text-center leading-relaxed">
        每个客户的调研数据、诊断结果与生成策略会自动保存到当前账号，换设备也能继续使用。
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
          className="flex-1 px-4 py-3 text-sm rounded-xl border border-slate-200 bg-white/70 backdrop-blur outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/20 transition-all"
        />
        <button
          onClick={() => {
            if (name.trim()) {
              onCreate(name.trim())
              setName("")
            }
          }}
          className="rounded-lg bg-gradient-to-r from-[#1677FF] to-[#0958D9] px-5 py-3 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-105"
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
  onExportReport,
}: {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
  onExportReport: (preset: ReportExportPreset) => void
}) {
  const [activeModule, setActiveModule] = useState<DashboardModuleKey>("penetration")

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-4 md:py-6 animate-fade-in-up print-container">
      <header className="geo-client-banner mb-4 overflow-hidden rounded-lg border border-white/12 shadow-[0_16px_36px_-26px_rgba(0,0,0,0.78)] md:mb-5">
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-end sm:justify-between md:px-5">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase text-cyan-50/65">
            当前客户
          </div>
          <h1 className="geo-display-title break-words text-3xl text-white md:text-4xl">
            {client.name}
          </h1>
          {client.industry && (
            <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-white/18 bg-white/10 px-2.5 py-1 text-xs text-cyan-50 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00C8FF]"></span>
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
          <DifficultyAssessmentModule
            client={client}
            onChangeClient={onChangeClient}
            onExportReport={onExportReport}
          />
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
    activeClass: "bg-gradient-to-r from-[#1677FF] to-[#0958D9] text-white shadow-sm",
    iconClass: "bg-[#E6F4FF] text-[#1677FF]",
    dotClass: "bg-[#00C8FF]",
  },
  {
    key: "research",
    label: "独立调研",
    desc: "品牌画像",
    icon: Brain,
    activeClass: "bg-gradient-to-r from-[#13C2C2] to-[#1677FF] text-white shadow-sm",
    iconClass: "bg-cyan-50 text-[#08979C]",
    dotClass: "bg-[#13C2C2]",
  },
  {
    key: "diagnosis",
    label: "AI 诊断",
    desc: "五维评分",
    icon: Radar,
    activeClass: "bg-gradient-to-r from-[#2F54EB] to-[#597EF7] text-white shadow-sm",
    iconClass: "bg-indigo-50 text-[#2F54EB]",
    dotClass: "bg-[#2F54EB]",
  },
  {
    key: "difficulty",
    label: "难度测评",
    desc: "行业垄断评分",
    icon: Gauge,
    activeClass: "bg-gradient-to-r from-[#0958D9] to-[#003EB3] text-white shadow-sm",
    iconClass: "bg-blue-50 text-[#0958D9]",
    dotClass: "bg-[#0958D9]",
  },
  {
    key: "keyword",
    label: "关键词策略",
    desc: "资料抽取与疑问句池",
    icon: ListOrdered,
    activeClass: "bg-gradient-to-r from-[#4096FF] to-[#00C8FF] text-white shadow-sm",
    iconClass: "bg-sky-50 text-[#1677FF]",
    dotClass: "bg-[#4096FF]",
  },
  {
    key: "article",
    label: "文章生成",
    desc: "Prompt 内容生产",
    icon: FileText,
    activeClass: "bg-gradient-to-r from-[#6C5CE7] to-[#2F54EB] text-white shadow-sm",
    iconClass: "bg-violet-50 text-[#6C5CE7]",
    dotClass: "bg-[#6C5CE7]",
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
      <div className="inline-flex min-w-full gap-1 rounded-lg border border-[#D6E7FF] bg-white/96 p-1.5 shadow-[0_12px_30px_-25px_rgba(9,88,217,0.28)] backdrop-blur sm:grid sm:grid-cols-6">
        {DASHBOARD_MODULES.map(item => {
          const Icon = item.icon
          const isActive = active === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              className={`flex min-w-[148px] items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors sm:min-w-0 ${
                isActive
                  ? item.activeClass
                  : "text-slate-600 hover:bg-[#F0F6FF] hover:text-[#0958D9]"
              }`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                isActive ? "bg-white/16" : item.iconClass
              }`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-semibold sm:text-sm">
                  <span className={`h-1.5 w-1.5 rounded-full ${item.dotClass}`} />
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
