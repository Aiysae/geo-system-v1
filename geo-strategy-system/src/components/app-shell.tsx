"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Image from "next/image"
import Link from "next/link"
import WorkspaceSidebar, {
  isDashboardModuleKey,
  type DashboardModuleKey,
} from "@/components/sidebar/workspace-sidebar"
import PenetrationModule from "@/components/penetration/penetration-module"
import ResearchModule from "@/components/research/research-module"
import DiagnosisModule from "@/components/diagnosis/diagnosis-module"
import KeywordStrategyModule from "@/components/keyword/keyword-strategy-module"
import ArticleGenerationModule from "@/components/article/article-generation-module"
import DifficultyAssessmentModule from "@/components/difficulty/difficulty-assessment-module"
import ClientFeedbackModule from "@/components/client-feedback/client-feedback-module"
import ReportExportDialog from "@/components/reports/report-export-dialog"
import ReportHistoryDialog from "@/components/reports/report-history-dialog"
import SiteFooter from "@/components/site-footer"
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  Cloud,
  CloudOff,
  FileDown,
  GraduationCap,
  History,
  LockKeyhole,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
} from "lucide-react"
import { useCredits } from "@/components/credits/credits-provider"
import { RechargeButton } from "@/components/credits/recharge-button"
import { AccountMenu } from "@/components/auth/account-menu"
import { useWorkspaceSync, type WorkspaceSyncState } from "@/hooks/use-workspace-sync"
import type {
  Client,
  ReportExportPreset,
  WorkspaceAccountAccess,
} from "@/types"
import { getClientSubjectType, getSubjectCopy } from "@/lib/analysis-subject"

export default function Home({
  userId,
  access,
  adminNotifier,
}: {
  userId: string
  access: WorkspaceAccountAccess
  adminNotifier?: React.ReactNode
}) {
  const restricted = access.mode === "client"
  const {
    monthlyBalance,
    monthlyAllowance,
  } = useCredits()
  const {
    clients,
    activeId,
    hydrated,
    syncState,
    conflict,
    showMigration,
    legacyClientCount,
    handleSelect: selectClient,
    handleChangeClient,
    retry,
    importLegacy,
    dismissMigration,
    loadCloudConflictVersion,
    overwriteCloudConflictVersion,
  } = useWorkspaceSync(userId, {
    restrictedClientId: restricted ? access.clientId : undefined,
  })
  // 移动端抽屉开关。桌面端 (md+) Sidebar 永远可见，该状态被忽略。
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeModule, setActiveModule] = useState<DashboardModuleKey>(
    restricted ? "feedback" : "penetration",
  )
  const [reportExportPreset, setReportExportPreset] = useState<ReportExportPreset | null>(null)
  const [reportExportClient, setReportExportClient] = useState<Client | null>(null)
  const [reportHistoryOpen, setReportHistoryOpen] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const mainScrollRef = useRef<HTMLElement>(null)
  const urlInitializedRef = useRef(false)

  const active = clients.find(c => c.id === activeId) ?? null

  const handleModuleChange = useCallback((module: DashboardModuleKey) => {
    setActiveModule(module)
    setSidebarOpen(false)
    setReportExportPreset(null)
    setReportExportClient(null)
    setReportHistoryOpen(false)
  }, [])

  useEffect(() => {
    if (!hydrated || urlInitializedRef.current) return
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href)
      const requestedModule = url.searchParams.get("module")
      if (isDashboardModuleKey(requestedModule)) setActiveModule(requestedModule)
      const requestedClientId = url.searchParams.get("clientId")
      if (requestedClientId && clients.some(client => client.id === requestedClientId)) {
        selectClient(requestedClientId)
      }
      urlInitializedRef.current = true
    }, 0)
    return () => window.clearTimeout(timer)
  }, [clients, hydrated, selectClient])

  useEffect(() => {
    if (!hydrated || !urlInitializedRef.current) return
    const url = new URL(window.location.href)
    if (activeId) url.searchParams.set("clientId", activeId)
    else url.searchParams.delete("clientId")
    url.searchParams.set("module", activeModule)
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
  }, [activeId, activeModule, hydrated])

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

      <WorkspaceSidebar
        active={activeModule}
        onChange={handleModuleChange}
        client={active}
        access={access}
        monthlyCredits={monthlyBalance}
        monthlyAllowance={monthlyAllowance}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main ref={mainScrollRef} className="flex-1 min-w-0 h-screen overflow-y-auto overscroll-contain relative print-main">
        <div className="relative z-10">
        <StickyHeader
          client={active}
          onOpenSidebar={() => setSidebarOpen(true)}
          onExportReport={() => {
            setReportExportClient(null)
            setReportExportPreset({})
          }}
          onOpenReportHistory={() => setReportHistoryOpen(true)}
          syncState={syncState}
          onRetrySync={retry}
          access={access}
          adminNotifier={adminNotifier}
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
          <EmptyState restricted={restricted} clientName={access.clientName} />
        ) : (
          // key={active.id}：切换客户时强制 Dashboard 整子树重挂载，
          // 彻底清空各 Module 内的 isDetecting/loading/progress 等运行时状态，根治状态泄露。
          <Dashboard
            key={active.id}
            client={active}
            onChangeClient={handleChangeClient}
            access={access}
            activeModule={activeModule}
            onExportReport={preset => {
              setReportExportClient(null)
              setReportExportPreset(preset)
            }}
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
      {access.canCreateReports && (reportExportClient || active) && reportExportPreset && (
        <ReportExportDialog
          client={(reportExportClient || active) as Client}
          preset={reportExportPreset}
          onClose={() => {
            setReportExportPreset(null)
            setReportExportClient(null)
          }}
        />
      )}
      {reportHistoryOpen ? (
        <ReportHistoryDialog
          clients={clients}
          activeClientId={activeId}
          onExportPenetration={historyClient => {
            setReportHistoryOpen(false)
            setReportExportClient(historyClient)
            setReportExportPreset({ kind: "penetration" })
          }}
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
  access,
  adminNotifier,
}: {
  client: Client | null
  onOpenSidebar: () => void
  onExportReport: () => void
  onOpenReportHistory: () => void
  syncState: WorkspaceSyncState
  onRetrySync: () => void
  access: WorkspaceAccountAccess
  adminNotifier?: React.ReactNode
}) {
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false)

  return (
    <header className="sticky-header sticky top-0 z-30 border-b border-white/10 bg-[#001D66]/96 text-white shadow-[0_12px_30px_-24px_rgba(0,29,102,0.88)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-2 px-3 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* 移动端汉堡按钮：触发左侧抽屉。md+ 隐藏 */}
          <button
            onClick={onOpenSidebar}
            className="no-print -ml-1 shrink-0 rounded-lg p-2 transition hover:bg-white/10 md:hidden"
            aria-label="打开功能导航"
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
              className="h-8 w-auto rounded-md bg-white ring-1 ring-white/20"
            />
          </Link>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white sm:text-base">
              <span className="hidden sm:inline">势途 GEO · </span>
              {client?.name || "市场情报工作台"}
            </div>
            <div className="hidden truncate text-[10px] text-white/58 sm:block">
              {access.mode === "client"
                ? "客户专属工作台 · GEO 全链路操作工具"
                : `${client?.industry ? `${client.industry} · ` : ""}GEO 全链路操作工具`}
            </div>
          </div>
        </div>

        <div className="no-print hidden items-center gap-2 lg:flex">
          <Link
            href="/workspace/tutorial?manual=1"
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/20 bg-white/8 px-3 text-xs font-semibold text-white transition hover:bg-white/14"
            title="重新体验新手教程"
          >
            <GraduationCap className="h-3.5 w-3.5" />
            新手教程
          </Link>
          <button
            type="button"
            onClick={onOpenReportHistory}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/20 bg-white/8 px-3 text-xs font-semibold text-white transition hover:bg-white/14"
            title="查看历史专业报告"
          >
            <History className="h-3.5 w-3.5" />
            历史报告
          </button>
          {client && access.canCreateReports && (
            <button
              onClick={onExportReport}
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#69DFFF]/65 bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 text-xs font-semibold text-white shadow-[0_10px_24px_-16px_rgba(0,200,255,0.8)] transition-[filter] hover:brightness-105"
            >
              <FileDown className="h-3.5 w-3.5" />
              导出报告
            </button>
          )}
        </div>

        <div className="no-print flex shrink-0 items-center gap-1.5">
          <div className="hidden xl:block">
            <WorkspaceSyncIndicator state={syncState} onRetry={onRetrySync} />
          </div>
          <CreditsPill />
          <RechargeButton />
          {adminNotifier}
          <div className="relative lg:hidden">
            <button
              type="button"
              onClick={() => setMobileActionsOpen(open => !open)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/18 bg-white/8 text-white transition hover:bg-white/14"
              aria-label="更多工作台操作"
              aria-expanded={mobileActionsOpen}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {mobileActionsOpen ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="关闭更多操作"
                  onClick={() => setMobileActionsOpen(false)}
                />
                <div className="absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-lg border border-[#C8D7E8] bg-white p-1.5 text-[#38536E] shadow-xl">
                  <Link
                    href="/workspace/tutorial?manual=1"
                    onClick={() => setMobileActionsOpen(false)}
                    className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-semibold hover:bg-[#EEF5FC]"
                  >
                    <GraduationCap className="h-4 w-4 text-[#00AEEA]" />
                    新手体验教程
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenReportHistory()
                      setMobileActionsOpen(false)
                    }}
                    className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-semibold hover:bg-[#EEF5FC]"
                  >
                    <History className="h-4 w-4 text-[#1677FF]" />
                    历史专业报告
                  </button>
                  {client && access.canCreateReports ? (
                    <button
                      type="button"
                      onClick={() => {
                        onExportReport()
                        setMobileActionsOpen(false)
                      }}
                      className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-semibold hover:bg-[#EEF5FC]"
                    >
                      <FileDown className="h-4 w-4 text-[#1677FF]" />
                      导出专业报告
                    </button>
                  ) : null}
                  {syncState.phase === "error" ? (
                    <button
                      type="button"
                      onClick={() => {
                        onRetrySync()
                        setMobileActionsOpen(false)
                      }}
                      className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <RefreshCw className="h-4 w-4" />
                      重试云端同步
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
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
  const {
    balance,
    unlimited,
    monthlyBalance,
    monthlyAllowance,
    permanentBalance,
  } = useCredits()
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-lg bg-[#FFB020]/16 px-2.5 py-1.5 text-[11px] font-medium text-white ring-1 ring-[#FFB020]/35"
      title={monthlyAllowance > 0
        ? `本月专属额度 ${monthlyBalance}/${monthlyAllowance}，充值积分 ${permanentBalance ?? 0}`
        : "体验算力积分余额"}
    >
      <Sparkles className="h-3.5 w-3.5 text-amber-300" />
      <span className="hidden sm:inline text-white/60">积分</span>
      <span className="font-mono font-bold text-white tabular-nums">
        {unlimited ? "无限" : balance === null ? "…" : balance}
      </span>
    </div>
  )
}

function EmptyState({ restricted = false, clientName }: {
  restricted?: boolean
  clientName?: string
}) {
  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col items-center justify-center px-6 py-16 animate-fade-in-up">
      <div className="mb-7 flex h-20 w-20 items-center justify-center rounded-lg bg-gradient-to-br from-[#2F54EB] via-[#1677FF] to-[#00C8FF] shadow-[0_18px_40px_-22px_rgba(22,119,255,0.72)]">
        <Sparkles className="h-12 w-12 text-white" />
      </div>
      <h2 className="geo-display-title text-center text-2xl text-slate-900 sm:text-3xl">
        {restricted ? "客户面板暂不可用" : "还没有可用的客户档案"}
      </h2>
      <p className="text-sm text-slate-500 mt-3 max-w-md text-center leading-relaxed">
        {restricted
          ? `当前账号已关联「${clientName || "指定客户"}」，但面板数据暂时无法读取。请联系管理员检查授权客户是否仍然存在。`
          : "客户资料已统一移到“我的主页”管理。新建或选择客户后，即可进入对应工作台。"}
      </p>
      {!restricted ? <div className="mt-7 flex flex-wrap items-center justify-center gap-3"><Link href="/account?tab=clients" className="inline-flex h-10 items-center justify-center rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-5 text-xs font-semibold text-white shadow-sm">管理我的客户</Link><Link href="/workspace/tutorial?manual=1" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#B7D9FF] bg-white px-4 text-xs font-semibold text-[#0958D9]"><GraduationCap className="h-4 w-4" />新手体验教程</Link></div> : null}
    </div>
  )
}

function Dashboard({
  client,
  onChangeClient,
  onExportReport,
  access,
  activeModule,
}: {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
  onExportReport: (preset: ReportExportPreset) => void
  access: WorkspaceAccountAccess
  activeModule: DashboardModuleKey
}) {
  const subjectType = getClientSubjectType(client)
  const subjectCopy = getSubjectCopy(subjectType)
  const readOnlyModule = access.mode === "client"
    && activeModule !== "penetration"
    && activeModule !== "feedback"
  const moduleOnChange = readOnlyModule ? () => undefined : onChangeClient

  return (
    <div className="geo-page-wrap animate-fade-in-up py-3 md:py-4 print-container">
      <header className="geo-client-banner mb-3 hidden overflow-hidden rounded-lg border border-white/12 shadow-[0_16px_36px_-26px_rgba(0,0,0,0.78)] sm:block">
        <div className="flex min-h-[76px] items-center justify-between gap-4 px-5 py-3">
        <div>
          <div className="mb-1 text-[10px] font-semibold text-cyan-50/65">
            当前客户 · {subjectCopy.modeLabel}
          </div>
          <h1 className="break-words text-2xl font-semibold text-white">
            {client.name}
          </h1>
          {client.industry && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-cyan-50/78">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00C8FF]"></span>
              {client.industry}
            </span>
          )}
          {access.mode === "client" ? (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-[10px] font-semibold text-cyan-50 ring-1 ring-white/15">
              <LockKeyhole className="h-3 w-3" />
              客户专属授权
            </span>
          ) : null}
        </div>
        <div className="text-xs text-white/55">
          创建于 {new Date(client.createdAt).toLocaleDateString("zh-CN")}
        </div>
        </div>
      </header>

      <section className="mt-1 md:mt-2">
        {readOnlyModule ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-[#91CAFF] bg-[#EAF5FF] px-3 py-2.5 text-xs leading-5 text-[#0958D9] no-print">
            <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            当前为客户专属账号，本模块展示关联主体的现有数据；可使用渗透率情报，并查看已发布的执行反馈。
          </div>
        ) : null}
        <fieldset
          disabled={readOnlyModule}
          aria-disabled={readOnlyModule}
          className={readOnlyModule ? "min-w-0 opacity-[0.92]" : "min-w-0"}
          onClickCapture={event => {
            if (!readOnlyModule) return
            const target = event.target as HTMLElement
            if (target.closest("a,button,input,textarea,select,[role='button']")) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}
        >
        {activeModule === "penetration" && (
          <PenetrationModule
            client={client}
            onChangeClient={onChangeClient}
            identityReadOnly={!access.canManageClientIdentity}
          />
        )}
        {activeModule === "research" && (
          <ResearchModule client={client} onChangeClient={moduleOnChange} />
        )}
        {activeModule === "diagnosis" && (
          <DiagnosisModule client={client} onChangeClient={moduleOnChange} />
        )}
        {activeModule === "difficulty" && (
          <DifficultyAssessmentModule
            client={client}
            onChangeClient={moduleOnChange}
            onExportReport={onExportReport}
          />
        )}
        {activeModule === "keyword" && (
          <KeywordStrategyModule client={client} onChangeClient={moduleOnChange} />
        )}
        {activeModule === "article" && (
          <ArticleGenerationModule client={client} onChangeClient={moduleOnChange} />
        )}
        {activeModule === "feedback" && (
          <ClientFeedbackModule client={client} />
        )}
        </fieldset>
      </section>
    </div>
  )
}
